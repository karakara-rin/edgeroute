import { describe, expect, it } from 'vitest';
import {
  CloudflareKVCacheStore,
  cloudflareKV,
} from '../src/cache/cloudflare-kv.js';
import type { CacheEntry, CloudflareKVNamespace } from '../src/cache/types.js';

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

describe('CloudflareKVCacheStore', () => {
  it('should create store using cloudflareKV helper', () => {
    const mockKv = createMockKV();
    const store = cloudflareKV(mockKv, { prefix: 'test:' });
    expect(store).toBeInstanceOf(CloudflareKVCacheStore);
  });

  it('should store cache entries, sync index, and find similar vectors', async () => {
    const mockKv = createMockKV();
    const store = new CloudflareKVCacheStore(mockKv, { prefix: 'edge:' });

    const vector1 = [1.0, 0.0, 0.0];
    const entry1: CacheEntry = {
      id: 'entry-1',
      prompt: 'Hello world',
      vector: vector1,
      response: { content: 'Hello there!' },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry1);

    // 1. Exact or near match
    const match = await store.findSimilar([0.99, 0.01, 0.0], 0.95);
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('entry-1');
    expect(match?.entry.response).toEqual({ content: 'Hello there!' });
    expect(match?.score).toBeGreaterThan(0.95);

    // 2. Orthogonal vector (miss)
    const miss = await store.findSimilar([0.0, 1.0, 0.0], 0.95);
    expect(miss).toBeNull();
  });

  it('should delete and clear entries properly', async () => {
    const mockKv = createMockKV();
    const store = new CloudflareKVCacheStore(mockKv);

    const entry: CacheEntry = {
      id: 'entry-to-del',
      prompt: 'Temporary',
      vector: [0.5, 0.5],
      response: { content: 'Temp' },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry);
    expect(await store.size()).toBe(1);

    await store.delete('entry-to-del');
    expect(await store.size()).toBe(0);
    expect(await store.get('entry-to-del')).toBeNull();
  });
});
