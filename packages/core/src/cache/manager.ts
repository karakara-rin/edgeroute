import { calculateTokenCost } from '../cost.js';
import type { EmbeddingProvider, Vector } from '../embeddings/types.js';
import type { CacheConfig, CacheConfigInput, ModelPricing } from '../types.js';
import { InMemoryCacheStore } from './memory.js';
import type { CacheEntry, CacheSimilarityMatch, CacheStore } from './types.js';

export interface CacheLookupResult {
  hit: boolean;
  match?: CacheSimilarityMatch;
  queryVector: Vector;
  latencyMs: number;
}

export interface SaveCacheParams {
  prompt: string;
  response: Record<string, unknown>;
  model: string;
  vector?: Vector;
  ttl?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Fast 32-bit FNV-1a hex string hash for generating deterministic cache entry IDs
 */
function fastHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class SemanticCacheManager {
  private readonly config: CacheConfigInput;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly store: CacheStore;
  private readonly customPricing?: Record<string, ModelPricing>;
  private readonly pendingWrites = new Map<string, Promise<CacheEntry | null>>();

  constructor(
    config: CacheConfig | CacheConfigInput,
    embeddingProvider: EmbeddingProvider,
    customPricing?: Record<string, ModelPricing>,
  ) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.customPricing = customPricing;

    if (config.store && typeof config.store === 'object' && 'findSimilar' in config.store) {
      this.store = config.store as CacheStore;
    } else {
      this.store = new InMemoryCacheStore({ maxEntries: config.maxEntries ?? 1000 });
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled ?? true;
  }

  /**
   * Checks if a request with given temperature is eligible for caching.
   */
  public isCacheable(temperature?: number): boolean {
    if (!this.isEnabled()) return false;
    if (this.config.maxTemperature !== undefined && temperature !== undefined) {
      return temperature <= this.config.maxTemperature;
    }
    return true;
  }

  public getStore(): CacheStore {
    return this.store;
  }

  /**
   * Searches for a semantically similar cached response for the given prompt.
   */
  public async find(prompt: string): Promise<CacheLookupResult> {
    const start = performance.now();
    const normalizedPrompt = prompt.trim();

    if (!this.isEnabled() || !normalizedPrompt) {
      return {
        hit: false,
        queryVector: [],
        latencyMs: 0,
      };
    }

    const queryVector = await this.embeddingProvider.embed(normalizedPrompt);
    const threshold = this.config.threshold ?? 0.95;

    const match = await this.store.findSimilar(queryVector, threshold, this.embeddingProvider.name);
    const latencyMs = Number((performance.now() - start).toFixed(2));

    if (match) {
      return {
        hit: true,
        match,
        queryVector,
        latencyMs,
      };
    }

    return {
      hit: false,
      queryVector,
      latencyMs,
    };
  }

  /**
   * Asynchronously saves a new completion response to the semantic cache with in-flight deduplication.
   */
  public async save(params: SaveCacheParams): Promise<CacheEntry | null> {
    const trimmedPrompt = params.prompt.trim();
    if (!this.isEnabled() || !trimmedPrompt) {
      return null;
    }

    // Deterministic ID preventing duplicate key accumulation
    const id = `${params.model}:${fastHash(trimmedPrompt)}`;

    // In-flight deduplication: return active save promise if already pending for this entry
    const existing = this.pendingWrites.get(id);
    if (existing) {
      return existing;
    }

    const savePromise = (async () => {
      try {
        const vector =
          params.vector && params.vector.length > 0
            ? params.vector
            : await this.embeddingProvider.embed(trimmedPrompt);

        const ttl = params.ttl ?? this.config.ttl ?? 3600;

        const entry: CacheEntry = {
          id,
          prompt: params.prompt,
          vector,
          response: params.response,
          createdAt: Date.now(),
          ttl,
          embeddingProvider: this.embeddingProvider.name,
          metadata: {
            model: params.model,
            usage: params.usage,
            ...params.metadata,
          },
        };

        await this.store.set(entry);
        return entry;
      } finally {
        this.pendingWrites.delete(id);
      }
    })();

    this.pendingWrites.set(id, savePromise);
    return savePromise;
  }

  /**
   * Calculates the estimated cost saved (USD) by serving from cache instead of querying the upstream LLM.
   */
  public calculateSavedCost(entry: CacheEntry): number {
    const model = entry.metadata?.model || 'gpt-4o';
    const usage = entry.metadata?.usage;

    const promptTokens = usage?.prompt_tokens ?? Math.ceil(entry.prompt.length / 4);
    const completionTokens =
      usage?.completion_tokens ??
      Math.ceil(JSON.stringify(entry.response).length / 4);

    const savedCost = calculateTokenCost(
      model,
      promptTokens,
      completionTokens,
      this.customPricing,
    );

    return Number(savedCost.toFixed(6));
  }
}
