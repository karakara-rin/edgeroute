import { cosineSimilarity } from '../classifier.js';
import type { Vector } from '../embeddings/types.js';
import type {
  CacheEntry,
  CacheSimilarityMatch,
  CacheStore,
  CloudflareKVNamespace,
} from './types.js';

export interface CloudflareKVCacheStoreOptions {
  /** Prefix for KV keys (default: 'edgeroute:') */
  prefix?: string;
  /** Max entries kept in the vector index (default: 500) */
  maxIndexEntries?: number;
}

interface IndexRecord {
  id: string;
  vector: Vector;
  createdAt: number;
  ttl: number;
}

/**
 * Cloudflare Workers KV CacheStore adapter.
 * Stores full response payloads under individual KV keys and maintains a synchronized index for semantic vector search.
 *
 * @warning For high-concurrency or production use cases, prefer `cloudflareVectorize(...)` with Cloudflare Vectorize
 * to avoid race conditions on the single JSON index and to support large-scale approximate nearest neighbor search.
 */
export class CloudflareKVCacheStore implements CacheStore {
  private readonly kv: CloudflareKVNamespace;
  private readonly prefix: string;
  private readonly indexKey: string;
  private readonly maxIndexEntries: number;

  // In-memory cached index copy to avoid extra KV reads on every request in the same worker isolate
  private cachedIndex: IndexRecord[] | null = null;
  private lastIndexFetch = 0;
  private readonly indexTtlMs = 10_000; // 10s local TTL for index

  constructor(kv: CloudflareKVNamespace, options: CloudflareKVCacheStoreOptions = {}) {
    this.kv = kv;
    this.prefix = options.prefix ?? 'edgeroute:';
    this.indexKey = `${this.prefix}__vector_index__`;
    this.maxIndexEntries = options.maxIndexEntries ?? 500;
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
      // Cloudflare KV requires minimum 60s expirationTtl if used
      kvOptions.expirationTtl = Math.max(60, Math.floor(entry.ttl));
    }

    // 1. Put the full cache entry payload in KV
    await this.kv.put(this.entryKey(entry.id), JSON.stringify(entry), kvOptions);

    // 2. Update the vector index
    const index = await this.loadIndex(true);
    const existingIdx = index.findIndex((item) => item.id === entry.id);

    const record: IndexRecord = {
      id: entry.id,
      vector: entry.vector,
      createdAt: entry.createdAt,
      ttl: entry.ttl,
    };

    if (existingIdx >= 0) {
      index.splice(existingIdx, 1);
    }

    index.unshift(record);

    if (index.length > this.maxIndexEntries) {
      index.splice(this.maxIndexEntries);
    }

    this.cachedIndex = index;
    this.lastIndexFetch = Date.now();

    // Persist index
    await this.kv.put(this.indexKey, JSON.stringify(index));
  }

  public async findSimilar(
    vector: Vector,
    threshold: number,
  ): Promise<CacheSimilarityMatch | null> {
    const index = await this.loadIndex();
    const now = Date.now();

    let bestId: string | null = null;
    let bestScore = 0;

    for (const record of index) {
      if (record.ttl > 0 && now - record.createdAt > record.ttl * 1000) {
        continue;
      }

      const score = cosineSimilarity(vector, record.vector);
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestId = record.id;
        if (score >= 0.9999) break;
      }
    }

    if (!bestId) {
      return null;
    }

    // Fetch the full entry for the best match
    const entry = await this.get(bestId);
    if (!entry) {
      return null;
    }

    return {
      entry,
      score: Number(bestScore.toFixed(4)),
    };
  }

  public async delete(id: string): Promise<void> {
    await this.kv.delete(this.entryKey(id));
    const index = await this.loadIndex(true);
    const filtered = index.filter((item) => item.id !== id);
    this.cachedIndex = filtered;
    this.lastIndexFetch = Date.now();
    await this.kv.put(this.indexKey, JSON.stringify(filtered));
  }

  public async clear(): Promise<void> {
    this.cachedIndex = [];
    this.lastIndexFetch = Date.now();
    await this.kv.delete(this.indexKey);
  }

  public async size(): Promise<number> {
    const index = await this.loadIndex();
    return index.length;
  }

  private async loadIndex(force = false): Promise<IndexRecord[]> {
    const now = Date.now();
    if (!force && this.cachedIndex && now - this.lastIndexFetch < this.indexTtlMs) {
      return this.cachedIndex;
    }

    try {
      const raw = await this.kv.get(this.indexKey, 'json');
      this.cachedIndex = (raw as IndexRecord[]) || [];
      this.lastIndexFetch = now;
      return this.cachedIndex;
    } catch {
      this.cachedIndex = [];
      this.lastIndexFetch = now;
      return [];
    }
  }
}

/**
 * Creates a CloudflareKVCacheStore instance from a Cloudflare KVNamespace binding.
 *
 * @example
 * ```ts
 * import { defineConfig, cloudflareKV } from '@edgeroute/core';
 *
 * export default (env: Env) => defineConfig({
 *   defaultModel: 'gpt-4o-mini',
 *   routes: [...],
 *   cache: {
 *     store: cloudflareKV(env.MY_KV_BINDING),
 *   },
 * });
 * ```
 */
export function cloudflareKV(
  kv: CloudflareKVNamespace,
  options?: CloudflareKVCacheStoreOptions,
): CloudflareKVCacheStore {
  return new CloudflareKVCacheStore(kv, options);
}

