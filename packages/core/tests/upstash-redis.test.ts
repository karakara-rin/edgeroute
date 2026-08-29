import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpstashRedisCacheStore } from '../src/cache/upstash-redis.js';
import type { CacheEntry } from '../src/cache/types.js';

describe('UpstashRedisCacheStore (Distributed REST Cache)', () => {
  const mockUrl = 'https://mock-redis.upstash.io';
  const mockToken = 'mock-token-xyz';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves cache entries via REST commands', async () => {
    const memoryKv = new Map<string, string>();

    global.fetch = vi.fn().mockImplementation(async (_url, init) => {
      const [cmd, ...args] = JSON.parse(init.body) as [string, ...string[]];
      if (cmd === 'GET') {
        const val = memoryKv.get(args[0]) || null;
        return new Response(JSON.stringify({ result: val }));
      }
      if (cmd === 'SET') {
        memoryKv.set(args[0], args[1]);
        return new Response(JSON.stringify({ result: 'OK' }));
      }
      if (cmd === 'DEL') {
        memoryKv.delete(args[0]);
        return new Response(JSON.stringify({ result: 1 }));
      }
      return new Response(JSON.stringify({ result: null }));
    });

    const store = new UpstashRedisCacheStore({
      url: mockUrl,
      token: mockToken,
      prefix: 'test:cache:',
    });

    const entry: CacheEntry = {
      id: 'entry-123',
      prompt: 'Summarize quantum computing',
      vector: [0.1, 0.2, 0.3],
      response: { id: 'chatcmpl-1', choices: [] },
      createdAt: Date.now(),
      ttl: 3600,
      embeddingProvider: 'test-embed',
    };

    await store.set(entry);

    const retrieved = await store.get('entry-123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.prompt).toBe('Summarize quantum computing');

    // Vector similarity match
    const match = await store.findSimilar([0.1, 0.2, 0.3], 0.95, 'test-embed');
    expect(match).not.toBeNull();
    expect(match?.score).toBeGreaterThanOrEqual(0.99);
    expect(match?.entry.id).toBe('entry-123');
  });
});
