import type { Vector } from '../embeddings/types.js';
import type {
  CacheEntry,
  CacheSimilarityMatch,
  CacheStore,
  CloudflareKVNamespace,
  CloudflareVectorizeIndex,
} from './types.js';

export interface CloudflareVectorizeCacheStoreOptions {
  /** Prefix for KV keys (default: 'edgeroute:') */
  prefix?: string;
  /** Optional namespace for Vectorize index */
  namespace?: string;
}

/**
 * Cloudflare Vectorize + KV CacheStore adapter.
 * Uses Cloudflare Vectorize for scalable, race-free approximate nearest neighbor (ANN) vector search,
 * and Cloudflare KV for storing response payloads and metadata.
 */
export class CloudflareVectorizeCacheStore implements CacheStore {
  private readonly vectorize: CloudflareVectorizeIndex;
  private readonly kv: CloudflareKVNamespace;
  private readonly prefix: string;
  private readonly namespace?: string;

  constructor(
    vectorize: CloudflareVectorizeIndex,
    kv: CloudflareKVNamespace,
    options: CloudflareVectorizeCacheStoreOptions = {},
  ) {
    this.vectorize = vectorize;
    this.kv = kv;
    this.prefix = options.prefix ?? 'edgeroute:';
    this.namespace = options.namespace;
  }

  private entryKey(id: string): string {
    return `${this.prefix}entry:${id}`;
  }

  public async get(id: string): Promise<CacheEntry | null> {
    const raw = await this.kv.get(this.entryKey(id), 'json');
    if (!raw) return null;
    return raw as CacheEntry;
  }

  public async set(entry: CacheEntry): Promise<void> {
    const kvOptions: { expirationTtl?: number } = {};
    if (entry.ttl > 0) {
      // Cloudflare KV requires minimum 60s expirationTtl
      kvOptions.expirationTtl = Math.max(60, Math.floor(entry.ttl));
    }

    // 1. Put the full cache payload in KV
    await this.kv.put(this.entryKey(entry.id), JSON.stringify(entry), kvOptions);

    // 2. Upsert vector to Vectorize index
    await this.vectorize.upsert([
      {
        id: entry.id,
        values: entry.vector,
        namespace: this.namespace,
        metadata: {
          createdAt: entry.createdAt,
          ttl: entry.ttl,
          embeddingProvider: entry.embeddingProvider ?? '',
        },
      },
    ]);
  }

  public async findSimilar(
    vector: Vector,
    threshold: number,
    embeddingProvider?: string,
  ): Promise<CacheSimilarityMatch | null> {
    const res = await this.vectorize.query(vector, {
      topK: 1,
      namespace: this.namespace,
      returnMetadata: 'all',
    });

    if (!res || !res.matches || res.matches.length === 0) {
      return null;
    }

    const topMatch = res.matches[0];
    if (topMatch.score < threshold) {
      return null;
    }

    // Check embeddingProvider filter if specified
    if (
      embeddingProvider &&
      topMatch.metadata?.embeddingProvider &&
      topMatch.metadata.embeddingProvider !== embeddingProvider
    ) {
      return null;
    }

    // Fetch the full entry from KV
    const entry = await this.get(topMatch.id);
    if (!entry) {
      // KV entry expired or deleted
      return null;
    }

    // Check expiration timestamp
    if (entry.ttl > 0 && Date.now() - entry.createdAt > entry.ttl * 1000) {
      return null;
    }

    return {
      entry,
      score: Number(topMatch.score.toFixed(4)),
    };
  }

  public async delete(id: string): Promise<void> {
    await Promise.all([
      this.kv.delete(this.entryKey(id)),
      this.vectorize.deleteByIds([id]),
    ]);
  }
}

/**
 * Creates a CloudflareVectorizeCacheStore instance using Cloudflare Vectorize and KV.
 *
 * @example
 * ```ts
 * import { defineConfig, cloudflareVectorize } from '@edgeroute/core';
 *
 * export default (env: Env) => defineConfig({
 *   defaultModel: 'gpt-4o-mini',
 *   routes: [...],
 *   cache: {
 *     store: cloudflareVectorize(env.VECTORIZE_INDEX, env.CACHE_KV),
 *   },
 * });
 * ```
 */
export function cloudflareVectorize(
  vectorize: CloudflareVectorizeIndex,
  kv: CloudflareKVNamespace,
  options?: CloudflareVectorizeCacheStoreOptions,
): CloudflareVectorizeCacheStore {
  return new CloudflareVectorizeCacheStore(vectorize, kv, options);
}
