import { cosineSimilarity } from '../classifier.js';
import type { Vector } from '../embeddings/types.js';
import type { CacheEntry, CacheSimilarityMatch, CacheStore } from './types.js';

export interface InMemoryCacheStoreOptions {
  /** Maximum number of entries to retain in memory (default: 1000) */
  maxEntries?: number;
}

/**
 * Ultra-fast In-Memory Cache Store with LRU eviction and cosine similarity search.
 * Suitable for sub-millisecond edge semantic caching.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly maxEntries: number;
  private readonly entries: Map<string, CacheEntry> = new Map();

  constructor(options: InMemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
  }

  public async get(id: string): Promise<CacheEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.entries.delete(id);
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  public async set(entry: CacheEntry): Promise<void> {
    // If key already exists, delete first to update position in LRU
    if (this.entries.has(entry.id)) {
      this.entries.delete(entry.id);
    } else if (this.entries.size >= this.maxEntries) {
      // Evict oldest (first key in Map iterator)
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(entry.id, entry);
  }

  public async findSimilar(
    vector: Vector,
    threshold: number,
  ): Promise<CacheSimilarityMatch | null> {
    const now = Date.now();
    let bestMatch: CacheSimilarityMatch | null = null;
    const expiredIds: string[] = [];

    // Iterate through all entries in reverse order (most recent first)
    const allEntries = Array.from(this.entries.entries());
    for (let i = allEntries.length - 1; i >= 0; i--) {
      const [id, entry] = allEntries[i]!;

      if (this.isExpired(entry, now)) {
        expiredIds.push(id);
        continue;
      }

      const score = cosineSimilarity(vector, entry.vector);
      if (score >= threshold) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            entry,
            score: Number(score.toFixed(4)),
          };
          // If score is 1.0 (exact match), we can return immediately
          if (score >= 0.9999) {
            break;
          }
        }
      }
    }

    // Clean up expired entries found during search
    for (const id of expiredIds) {
      this.entries.delete(id);
    }

    if (bestMatch) {
      // Refresh accessed entry in LRU
      this.entries.delete(bestMatch.entry.id);
      this.entries.set(bestMatch.entry.id, bestMatch.entry);
    }

    return bestMatch;
  }

  public async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  public async clear(): Promise<void> {
    this.entries.clear();
  }

  public async size(): Promise<number> {
    return this.entries.size;
  }

  private isExpired(entry: CacheEntry, now: number = Date.now()): boolean {
    if (entry.ttl <= 0) return false;
    return now - entry.createdAt > entry.ttl * 1000;
  }
}
