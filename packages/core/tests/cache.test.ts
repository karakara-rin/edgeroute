import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryCacheStore,
  CloudflareKVCacheStore,
  SemanticCacheManager,
  HashEmbeddingProvider,
  type CloudflareKVNamespace,
  type CacheEntry,
} from '../src/index.js';

describe('InMemoryCacheStore', () => {
  let store: InMemoryCacheStore;

  beforeEach(() => {
    store = new InMemoryCacheStore({ maxEntries: 3 });
  });

  it('should store and retrieve entries by id', async () => {
    const entry: CacheEntry = {
      id: 'entry-1',
      prompt: 'Hello world',
      vector: [0.1, 0.2, 0.3],
      response: { choices: [{ message: { content: 'Hi there!' } }] },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry);
    const retrieved = await store.get('entry-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('entry-1');
    expect(retrieved?.prompt).toBe('Hello world');
  });

  it('should evict oldest entries when maxEntries is exceeded (LRU)', async () => {
    const createEntry = (id: string): CacheEntry => ({
      id,
      prompt: `Prompt ${id}`,
      vector: [1, 0, 0],
      response: { choices: [] },
      createdAt: Date.now(),
      ttl: 3600,
    });

    await store.set(createEntry('e1'));
    await store.set(createEntry('e2'));
    await store.set(createEntry('e3'));

    expect(await store.size()).toBe(3);

    // Access e1 so it becomes recently used
    await store.get('e1');

    // Add e4, should evict e2 (oldest)
    await store.set(createEntry('e4'));

    expect(await store.size()).toBe(3);
    expect(await store.get('e2')).toBeNull(); // evicted
    expect(await store.get('e1')).not.toBeNull(); // kept
    expect(await store.get('e3')).not.toBeNull();
    expect(await store.get('e4')).not.toBeNull();
  });

  it('should not return expired entries based on TTL', async () => {
    const entry: CacheEntry = {
      id: 'expired-1',
      prompt: 'Old prompt',
      vector: [1, 0, 0],
      response: { choices: [] },
      createdAt: Date.now() - 5000, // 5s ago
      ttl: 2, // 2s TTL
    };

    await store.set(entry);
    const retrieved = await store.get('expired-1');
    expect(retrieved).toBeNull();
  });

  it('should find similar vectors with score >= threshold', async () => {
    // Vector normalized
    const entry: CacheEntry = {
      id: 'sim-1',
      prompt: 'What is the capital of France?',
      vector: [1, 0, 0, 0],
      response: { choices: [{ message: { content: 'Paris' } }] },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry);

    // Query with exact match
    const exactMatch = await store.findSimilar([1, 0, 0, 0], 0.95);
    expect(exactMatch).not.toBeNull();
    expect(exactMatch?.score).toBe(1);
    expect(exactMatch?.entry.id).toBe('sim-1');

    // Query with orthogonal vector (similarity 0)
    const noMatch = await store.findSimilar([0, 1, 0, 0], 0.95);
    expect(noMatch).toBeNull();
  });
});

describe('CloudflareKVCacheStore', () => {
  let mockKV: CloudflareKVNamespace;
  let kvStorage: Map<string, string>;
  let store: CloudflareKVCacheStore;

  beforeEach(() => {
    kvStorage = new Map();
    mockKV = {
      get: vi.fn(async (key: string, type?: string) => {
        const val = kvStorage.get(key);
        if (!val) return null;
        if (type === 'json') return JSON.parse(val);
        return val;
      }),
      put: vi.fn(async (key: string, val: string) => {
        kvStorage.set(key, val);
      }),
      delete: vi.fn(async (key: string) => {
        kvStorage.delete(key);
      }),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    };

    store = new CloudflareKVCacheStore(mockKV);
  });

  it('should store and find similar entries in Cloudflare KV', async () => {
    const entry: CacheEntry = {
      id: 'kv-1',
      prompt: 'Translate to Japanese',
      vector: [0.8, 0.6, 0],
      response: { choices: [{ message: { content: '翻訳結果' } }] },
      createdAt: Date.now(),
      ttl: 3600,
    };

    await store.set(entry);

    const match = await store.findSimilar([0.8, 0.6, 0], 0.95);
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('kv-1');
    expect(match?.score).toBeGreaterThanOrEqual(0.95);
  });
});

describe('SemanticCacheManager', () => {
  const embeddingProvider = new HashEmbeddingProvider(64);

  it('should hit cache for semantically identical / highly similar prompts', async () => {
    const manager = new SemanticCacheManager(
      { enabled: true, threshold: 0.9, ttl: 3600 },
      embeddingProvider,
    );

    const prompt1 = 'How do I center a div in CSS?';
    await manager.save({
      prompt: prompt1,
      response: { choices: [{ message: { content: 'Use display: flex and justify-content: center.' } }] },
      model: 'gpt-4o',
      usage: { prompt_tokens: 15, completion_tokens: 20, total_tokens: 35 },
    });

    // Query with the exact same prompt
    const lookup1 = await manager.find(prompt1);
    expect(lookup1.hit).toBe(true);
    expect(lookup1.match?.score).toBeGreaterThanOrEqual(0.99);

    // Query with very similar phrasing
    const lookup2 = await manager.find('How to center a div in CSS?');
    expect(lookup2.hit).toBe(true);
    expect(lookup2.match?.score).toBeGreaterThanOrEqual(0.9);

    // Cost saved calculation
    const savedCost = manager.calculateSavedCost(lookup1.match!.entry);
    expect(savedCost).toBeGreaterThan(0);
  });

  it('should miss cache for completely different prompts', async () => {
    const manager = new SemanticCacheManager(
      { enabled: true, threshold: 0.95, ttl: 3600 },
      embeddingProvider,
    );

    await manager.save({
      prompt: 'Write a quicksort algorithm in Python',
      response: { choices: [{ message: { content: 'def quicksort...' } }] },
      model: 'gpt-4o-mini',
    });

    const lookup = await manager.find('What is the capital city of France?');
    expect(lookup.hit).toBe(false);
  });

  it('should bypass cache when enabled is false', async () => {
    const manager = new SemanticCacheManager(
      { enabled: false },
      embeddingProvider,
    );

    await manager.save({
      prompt: 'Test prompt',
      response: { choices: [] },
      model: 'gpt-4o',
    });

    const lookup = await manager.find('Test prompt');
    expect(lookup.hit).toBe(false);
  });

  it('should deduplicate concurrent in-flight save requests for the same prompt', async () => {
    let embedCallCount = 0;
    const trackingEmbeddingProvider = {
      name: 'test-tracking',
      embed: vi.fn(async (text: string) => {
        embedCallCount++;
        // Simulate async embedding latency
        await new Promise((r) => setTimeout(r, 20));
        return new Array(64).fill(0.1);
      }),
      embedBatch: vi.fn(async (texts: string[]) => {
        return texts.map(() => new Array(64).fill(0.1));
      }),
    };

    const manager = new SemanticCacheManager(
      { enabled: true, ttl: 3600 },
      trackingEmbeddingProvider as any,
    );

    const testPrompt = 'Concurrent prompt for deduplication testing';

    // Launch 5 concurrent save operations for the identical prompt
    const promises = [
      manager.save({ prompt: testPrompt, response: { content: '1' }, model: 'gpt-4o' }),
      manager.save({ prompt: testPrompt, response: { content: '2' }, model: 'gpt-4o' }),
      manager.save({ prompt: testPrompt, response: { content: '3' }, model: 'gpt-4o' }),
      manager.save({ prompt: testPrompt, response: { content: '4' }, model: 'gpt-4o' }),
      manager.save({ prompt: testPrompt, response: { content: '5' }, model: 'gpt-4o' }),
    ];

    const results = await Promise.all(promises);

    // All concurrent calls should resolve to the shared CacheEntry
    expect(results[0]).not.toBeNull();
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results[0]?.id).toBe(results[4]?.id);

    // Embedding provider must be called only once thanks to promise coalescing
    expect(embedCallCount).toBe(1);

    // Ensure cache store contains exactly 1 entry for this prompt
    const store = manager.getStore();
    expect(await store.size()).toBe(1);
  });

  it('should maintain deterministic ID across repeated save calls', async () => {
    const manager = new SemanticCacheManager(
      { enabled: true, ttl: 3600 },
      embeddingProvider,
    );

    const testPrompt = 'Deterministic ID prompt';
    const entry1 = await manager.save({
      prompt: testPrompt,
      response: { content: 'First version' },
      model: 'gpt-4o',
    });

    const entry2 = await manager.save({
      prompt: testPrompt,
      response: { content: 'Second updated version' },
      model: 'gpt-4o',
    });

    expect(entry1?.id).toBe(entry2?.id);
    // Should overwrite/update without duplicate accumulation
    const store = manager.getStore();
    expect(await store.size()).toBe(1);
  });
});

describe('SemanticCacheManager - Provider Tagging', () => {
  it('should tag cache entries with embedding provider name', async () => {
    const provider = new HashEmbeddingProvider(64);
    const manager = new SemanticCacheManager(
      { enabled: true, threshold: 0.9, ttl: 3600 },
      provider,
    );

    const entry = await manager.save({
      prompt: 'test prompt',
      response: { choices: [] },
      model: 'gpt-4o',
    });

    expect(entry).not.toBeNull();
    expect(entry!.embeddingProvider).toBe('hash');
  });

  it('should skip cache entries from a different embedding provider', async () => {
    const store = new InMemoryCacheStore({ maxEntries: 100 });

    // Save entry tagged with provider 'transformers'
    const entry: CacheEntry = {
      id: 'cross-provider-1',
      prompt: 'Test prompt for cross-provider',
      vector: [1, 0, 0, 0],
      response: { choices: [] },
      createdAt: Date.now(),
      ttl: 3600,
      embeddingProvider: 'transformers',
    };
    await store.set(entry);

    // Search with a different provider name — should NOT match
    const noMatch = await store.findSimilar([1, 0, 0, 0], 0.5, 'hash');
    expect(noMatch).toBeNull();

    // Search with matching provider name — should match
    const match = await store.findSimilar([1, 0, 0, 0], 0.5, 'transformers');
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('cross-provider-1');
  });

  it('should match entries with no provider tag (backward compatibility)', async () => {
    const store = new InMemoryCacheStore({ maxEntries: 100 });

    // Legacy entry without embeddingProvider tag
    const entry: CacheEntry = {
      id: 'legacy-1',
      prompt: 'Legacy prompt',
      vector: [1, 0, 0, 0],
      response: { choices: [] },
      createdAt: Date.now(),
      ttl: 3600,
      // No embeddingProvider field
    };
    await store.set(entry);

    // Should still match even when searching with a provider name
    const match = await store.findSimilar([1, 0, 0, 0], 0.5, 'hash');
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('legacy-1');
  });
});
