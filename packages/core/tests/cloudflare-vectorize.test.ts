import { describe, expect, it } from 'vitest';
import {
  CloudflareVectorizeCacheStore,
  cloudflareVectorize,
} from '../src/cache/cloudflare-vectorize.js';
import type {
  CacheEntry,
  CloudflareKVNamespace,
  CloudflareVectorizeIndex,
  VectorizeVector,
} from '../src/cache/types.js';

function createMockKV(): CloudflareKVNamespace {
  const store = new Map<string, string>();

  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') {
        return JSON.parse(val);
      }
      return val;
    },
    async put(key: string, value: any) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      const keys = Array.from(store.keys()).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

function createMockVectorize(): CloudflareVectorizeIndex {
  const vectors = new Map<string, VectorizeVector>();

  return {
    async insert(vecs: VectorizeVector[]) {
      for (const v of vecs) {
        vectors.set(v.id, v);
      }
      return { count: vecs.length };
    },
    async upsert(vecs: VectorizeVector[]) {
      for (const v of vecs) {
        vectors.set(v.id, v);
      }
      return { count: vecs.length };
    },
    async query(queryVector: any, options: any = {}) {
      const topK = options.topK ?? 1;
      const matches: Array<{ id: string; score: number; metadata?: any }> = [];

      for (const [id, v] of vectors.entries()) {
        if (options.namespace && v.namespace !== options.namespace) {
          continue;
        }

        // Simple cosine similarity simulation for mock
        const vecValues = v.values as number[];
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < queryVector.length; i++) {
          dot += queryVector[i] * vecValues[i];
          normA += queryVector[i] * queryVector[i];
          normB += vecValues[i] * vecValues[i];
        }
        const score = normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;

        matches.push({
          id,
          score,
          metadata: v.metadata,
        });
      }

      matches.sort((a, b) => b.score - a.score);
      return {
        matches: matches.slice(0, topK),
        count: matches.length,
      };
    },
    async getByIds(ids: string[]) {
      const res: VectorizeVector[] = [];
      for (const id of ids) {
        const found = vectors.get(id);
        if (found) res.push(found);
      }
      return res;
    },
    async deleteByIds(ids: string[]) {
      for (const id of ids) {
        vectors.delete(id);
      }
      return { count: ids.length };
    },
  };
}

describe('CloudflareVectorizeCacheStore', () => {
  it('should create store using cloudflareVectorize helper', () => {
    const mockKv = createMockKV();
    const mockVec = createMockVectorize();
    const store = cloudflareVectorize(mockVec, mockKv, { prefix: 'test:' });
    expect(store).toBeInstanceOf(CloudflareVectorizeCacheStore);
  });

  it('should set and find similar entries with Vectorize', async () => {
    const mockKv = createMockKV();
    const mockVec = createMockVectorize();
    const store = new CloudflareVectorizeCacheStore(mockVec, mockKv);

    const entry1: CacheEntry = {
      id: 'entry-vec-1',
      prompt: 'What is Cloudflare Vectorize?',
      vector: [1.0, 0.0, 0.0],
      response: { answer: 'A vector database built for Workers.' },
      createdAt: Date.now(),
      ttl: 3600,
      embeddingProvider: 'workers-ai',
    };

    await store.set(entry1);

    // 1. High similarity match
    const match = await store.findSimilar([0.98, 0.02, 0.0], 0.9);
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('entry-vec-1');
    expect(match?.entry.response).toEqual({ answer: 'A vector database built for Workers.' });
    expect(match?.score).toBeGreaterThan(0.9);

    // 2. Below threshold
    const miss = await store.findSimilar([0.0, 1.0, 0.0], 0.9);
    expect(miss).toBeNull();
  });

  it('should filter by embeddingProvider when specified', async () => {
    const mockKv = createMockKV();
    const mockVec = createMockVectorize();
    const store = new CloudflareVectorizeCacheStore(mockVec, mockKv);

    const entry: CacheEntry = {
      id: 'entry-provider',
      prompt: 'Test provider',
      vector: [1.0, 0.0],
      response: { ok: true },
      createdAt: Date.now(),
      ttl: 3600,
      embeddingProvider: 'openai',
    };

    await store.set(entry);

    // Matches with same provider
    const matchSame = await store.findSimilar([1.0, 0.0], 0.8, 'openai');
    expect(matchSame).not.toBeNull();

    // Mismatched provider
    const matchDiff = await store.findSimilar([1.0, 0.0], 0.8, 'workers-ai');
    expect(matchDiff).toBeNull();
  });

  it('should delete entry from both KV and Vectorize', async () => {
    const mockKv = createMockKV();
    const mockVec = createMockVectorize();
    const store = new CloudflareVectorizeCacheStore(mockVec, mockKv);

    const entry: CacheEntry = {
      id: 'entry-delete',
      prompt: 'Delete me',
      vector: [0.5, 0.5],
      response: { val: 123 },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry);
    expect(await store.get('entry-delete')).not.toBeNull();

    await store.delete('entry-delete');
    expect(await store.get('entry-delete')).toBeNull();

    const matchAfterDelete = await store.findSimilar([0.5, 0.5], 0.8);
    expect(matchAfterDelete).toBeNull();
  });

  it('should ignore expired entries', async () => {
    const mockKv = createMockKV();
    const mockVec = createMockVectorize();
    const store = new CloudflareVectorizeCacheStore(mockVec, mockKv);

    const expiredEntry: CacheEntry = {
      id: 'entry-expired',
      prompt: 'Expired content',
      vector: [1.0, 0.0],
      response: { val: 999 },
      createdAt: Date.now() - 100_000,
      ttl: 50, // expired 50s ago
    };

    await store.set(expiredEntry);

    const match = await store.findSimilar([1.0, 0.0], 0.8);
    expect(match).toBeNull();
  });
});
