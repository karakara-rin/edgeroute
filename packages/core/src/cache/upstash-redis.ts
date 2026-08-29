import { cosineSimilarity } from '../classifier.js';
import type { Vector } from '../embeddings/types.js';
import type { CacheEntry, CacheSimilarityMatch, CacheStore } from './types.js';

export interface UpstashRedisCacheStoreOptions {
  /** Upstash Redis REST URL (e.g. process.env.UPSTASH_REDIS_REST_URL) */
  url: string;
  /** Upstash Redis REST Token (e.g. process.env.UPSTASH_REDIS_REST_TOKEN) */
  token: string;
  /** Key prefix (default: 'edgeroute:cache:') */
  prefix?: string;
  /** Maximum number of vectors maintained in the search index (default: 1000) */
  maxIndexEntries?: number;
}

interface IndexRecord {
  id: string;
  vector: Vector;
  createdAt: number;
  ttl: number;
  embeddingProvider?: string;
}

/**
 * Distributed Semantic CacheStore backed by Upstash Redis over REST.
 * Compatible with Node.js, Bun, Cloudflare Workers, Vercel Edge, Deno, and serverless environments.
 */
export class UpstashRedisCacheStore implements CacheStore {
  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private readonly indexKey: string;
  private readonly maxIndexEntries: number;

  constructor(options: UpstashRedisCacheStoreOptions) {
    if (!options.url || !options.token) {
      throw new Error('UpstashRedisCacheStore requires valid "url" and "token" options.');
    }
    this.url = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.prefix = options.prefix ?? 'edgeroute:cache:';
    this.indexKey = `${this.prefix}__vector_index__`;
    this.maxIndexEntries = options.maxIndexEntries ?? 1000;
  }

  private async command<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(`${this.url}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash Redis error (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as { result: T; error?: string };
    if (json.error) {
      throw new Error(`Upstash Redis command error: ${json.error}`);
    }
    return json.result;
  }

  private entryKey(id: string): string {
    return `${this.prefix}entry:${id}`;
  }

  public async get(id: string): Promise<CacheEntry | null> {
    try {
      const data = await this.command<string | null>('GET', this.entryKey(id));
      if (!data) return null;
      return typeof data === 'string' ? JSON.parse(data) : (data as CacheEntry);
    } catch {
      return null;
    }
  }

  public async set(entry: CacheEntry): Promise<void> {
    const payload = JSON.stringify(entry);
    const key = this.entryKey(entry.id);

    if (entry.ttl && entry.ttl > 0) {
      await this.command('SET', key, payload, 'EX', entry.ttl);
    } else {
      await this.command('SET', key, payload);
    }

    // Update vector index
    await this.updateIndex(entry);
  }

  private async updateIndex(entry: CacheEntry): Promise<void> {
    try {
      const raw = await this.command<string | null>('GET', this.indexKey);
      let index: IndexRecord[] = [];
      if (raw) {
        index = typeof raw === 'string' ? JSON.parse(raw) : (raw as IndexRecord[]);
      }

      const now = Date.now();
      // Filter out expired items and existing item with same id
      index = index.filter((item) => {
        if (item.id === entry.id) return false;
        if (item.ttl && now - item.createdAt > item.ttl * 1000) return false;
        return true;
      });

      index.push({
        id: entry.id,
        vector: entry.vector,
        createdAt: entry.createdAt,
        ttl: entry.ttl,
        embeddingProvider: entry.embeddingProvider,
      });

      // Keep only most recent maxIndexEntries
      if (index.length > this.maxIndexEntries) {
        index = index.slice(index.length - this.maxIndexEntries);
      }

      await this.command('SET', this.indexKey, JSON.stringify(index));
    } catch (err) {
      console.warn('[EdgeRoute/UpstashRedis] Failed to update vector index:', err);
    }
  }

  public async findSimilar(
    vector: Vector,
    threshold: number,
    embeddingProvider?: string,
  ): Promise<CacheSimilarityMatch | null> {
    try {
      const raw = await this.command<string | null>('GET', this.indexKey);
      if (!raw) return null;

      const index: IndexRecord[] =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as IndexRecord[]);
      const now = Date.now();

      let bestMatch: { id: string; score: number } | null = null;
      let highestScore = -1;

      for (const item of index) {
        // Expiration check
        if (item.ttl && now - item.createdAt > item.ttl * 1000) {
          continue;
        }

        // Embedding provider safety check
        if (
          embeddingProvider &&
          item.embeddingProvider &&
          item.embeddingProvider !== embeddingProvider
        ) {
          continue;
        }

        const score = cosineSimilarity(vector, item.vector);
        if (score >= threshold && score > highestScore) {
          highestScore = score;
          bestMatch = { id: item.id, score };
        }
      }

      if (!bestMatch) return null;

      const entry = await this.get(bestMatch.id);
      if (!entry) return null;

      return {
        entry,
        score: bestMatch.score,
      };
    } catch (err) {
      console.warn('[EdgeRoute/UpstashRedis] Failed to query vector index:', err);
      return null;
    }
  }

  public async delete(id: string): Promise<void> {
    await this.command('DEL', this.entryKey(id));
  }

  public async clear(): Promise<void> {
    await this.command('DEL', this.indexKey);
  }

  public async size(): Promise<number> {
    try {
      const raw = await this.command<string | null>('GET', this.indexKey);
      if (!raw) return 0;
      const index: IndexRecord[] =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as IndexRecord[]);
      return index.length;
    } catch {
      return 0;
    }
  }
}
