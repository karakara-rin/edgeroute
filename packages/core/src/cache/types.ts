import type { Vector } from '../embeddings/types.js';

export interface CacheEntryMetadata {
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export interface CacheEntry {
  /** Unique ID for the cache entry (e.g. SHA-256 or uuid) */
  id: string;
  /** Original user prompt text */
  prompt: string;
  /** Embedding vector representation */
  vector: Vector;
  /** Cached OpenAI-compatible chat completion response */
  response: Record<string, unknown>;
  /** Timestamp when cached (epoch ms) */
  createdAt: number;
  /** Time-to-live in seconds */
  ttl: number;
  /** Embedding provider that generated the vector (e.g. 'hash', 'transformers', 'workers-ai', 'openai') */
  embeddingProvider?: string;
  /** Optional metadata attached to entry */
  metadata?: CacheEntryMetadata;
}

export interface CacheSimilarityMatch {
  entry: CacheEntry;
  score: number;
}

export interface CacheStore {
  /** Get a cache entry by ID */
  get(id: string): Promise<CacheEntry | null>;
  /** Save or update a cache entry */
  set(entry: CacheEntry): Promise<void>;
  /** Find the best matching cache entry with cosine similarity >= threshold, optionally filtering by embedding provider */
  findSimilar(vector: Vector, threshold: number, embeddingProvider?: string): Promise<CacheSimilarityMatch | null>;
  /** Delete a cache entry by ID */
  delete?(id: string): Promise<void>;
  /** Clear all entries in the store */
  clear?(): Promise<void>;
  /** Get current number of stored entries */
  size?(): Promise<number>;
}

/**
 * Minimal Cloudflare Workers KVNamespace interface compatibility.
 */
export interface CloudflareKVNamespace {
  get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<any>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: any },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: any }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Minimal Cloudflare Vectorize interface compatibility.
 */
export interface VectorizeVector {
  id: string;
  values: Vector | Float32Array | Float64Array | number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface VectorizeMatches {
  matches: VectorizeMatch[];
  count: number;
}

export interface VectorizeQueryOptions {
  topK?: number;
  namespace?: string;
  returnValues?: boolean;
  returnMetadata?: 'none' | 'indexed' | 'all';
}

export interface CloudflareVectorizeIndex {
  insert(vectors: VectorizeVector[]): Promise<any>;
  upsert(vectors: VectorizeVector[]): Promise<any>;
  query(
    vector: Vector | Float32Array | Float64Array | number[],
    options?: VectorizeQueryOptions,
  ): Promise<VectorizeMatches>;
  getByIds(ids: string[]): Promise<VectorizeVector[]>;
  deleteByIds(ids: string[]): Promise<any>;
}

