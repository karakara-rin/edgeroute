import { z } from 'zod';
import type { ComplexityFeatures, ComplexityWeights } from './complexity.js';
import type { CacheStore } from './cache/types.js';
import type { CostSavingsComparison } from './cost.js';

export const ComplexityWeightsSchema = z.object({
  code: z.number().nonnegative().optional(),
  reasoning: z.number().nonnegative().optional(),
  mathLogic: z.number().nonnegative().optional(),
  constraints: z.number().nonnegative().optional(),
  contextLength: z.number().nonnegative().optional(),
});

export const FastPathRulesSchema = z.object({
  /** Maximum prompt character length to match */
  maxCharacters: z.number().positive().optional(),
  /** Minimum prompt character length to match */
  minCharacters: z.number().nonnegative().optional(),
  /** Maximum query complexity score to match (0.0 - 1.0) */
  maxComplexity: z.number().min(0).max(1).optional(),
  /** Minimum query complexity score to match (0.0 - 1.0) */
  minComplexity: z.number().min(0).max(1).optional(),
  /** Regex patterns or exact prefix matches */
  patterns: z.array(z.union([z.instanceof(RegExp), z.string()])).optional(),
});

export type FastPathRules = z.infer<typeof FastPathRulesSchema>;

export const ProviderTypeSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'custom',
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const RouteDefinitionSchema = z.object({
  /** Unique name identifier for the route */
  name: z.string(),
  /** Target model identifier, e.g. 'gpt-5.6-luna', 'claude-sonnet-5', 'gemini-3.7-flash', 'llama-3.3-70b-versatile' */
  targetModel: z.string(),
  /** Optional explicit provider name; if omitted, provider is auto-detected from model name */
  provider: ProviderTypeSchema.optional(),
  /** Cosine similarity threshold for semantic matching (0.0 to 1.0) */
  threshold: z.number().min(0).max(1).optional().default(0.75),
  /** Maximum query complexity threshold for this route (queries under this score route here) */
  complexityThreshold: z.number().min(0).max(1).optional(),
  /** Fast-path rule based constraints */
  rules: FastPathRulesSchema.optional(),
  /** Sample prompts for semantic vector matching */
  examples: z.array(z.string()).optional().default([]),
  /** Optional metadata attached to route */
  metadata: z.record(z.unknown()).optional(),
});

export type RouteDefinition = z.infer<typeof RouteDefinitionSchema>;
export type RouteDefinitionInput = z.input<typeof RouteDefinitionSchema>;

export const EmbeddingConfigSchema = z.object({
  /** Embedding engine: 'auto' (runtime auto-detect), 'hash' (lexical/keyword), 'transformers' (ONNX), 'workers-ai' (CF), 'openai', or 'local' (deprecated alias for 'hash') */
  provider: z.enum(['auto', 'hash', 'local', 'transformers', 'workers-ai', 'openai']).optional().default('auto'),
  /** Model name, e.g. 'text-embedding-3-small', 'Xenova/all-MiniLM-L6-v2', '@cf/baai/bge-small-en-v1.5' */
  model: z.string().optional(),
  /** API key if using cloud provider */
  apiKey: z.string().optional(),
  /** Base URL if using custom proxy */
  baseUrl: z.string().optional(),
  /** Cloudflare Workers AI binding (pass `env.AI` from Workers runtime) */
  workersAiBinding: z.any().optional(),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type EmbeddingConfigInput = z.input<typeof EmbeddingConfigSchema>;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  organization: z.string().optional(),
  apiVersion: z.string().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const CacheConfigSchema = z.object({
  /** Whether semantic caching is enabled (default: true) */
  enabled: z.boolean().optional().default(true),
  /** Cosine similarity threshold for cache hits (0.0 to 1.0, default: 0.95) */
  threshold: z.number().min(0).max(1).optional().default(0.95),
  /** Cache entry time-to-live in seconds (default: 3600 = 1 hour) */
  ttl: z.number().positive().optional().default(3600),
  /** Maximum number of in-memory cache entries (default: 1000) */
  maxEntries: z.number().positive().optional().default(1000),
  /** Maximum allowable temperature for caching (e.g. 0.0 or 0.5; prompts with temperature above this will bypass cache) */
  maxTemperature: z.number().min(0).max(2).optional(),
  /** Optional custom cache store instance (e.g. InMemoryCacheStore, CloudflareKVCacheStore) */
  store: z.custom<CacheStore>().optional(),
});

export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type CacheConfigInput = z.input<typeof CacheConfigSchema>;

export const RoutingStrategySchema = z.enum(['hybrid', 'semantic', 'complexity']);
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>;

export const EdgeRouteAuthConfigSchema = z.object({
  /** Array of valid API keys for authenticating client requests to EdgeRoute proxy */
  apiKeys: z.array(z.string()).optional(),
  /** Custom validation function (async or sync) */
  validator: z.custom<((key: string, req: Request) => Promise<boolean> | boolean)>().optional(),
});

export type EdgeRouteAuthConfig = z.infer<typeof EdgeRouteAuthConfigSchema>;

export const EdgeRouteRateLimitConfigSchema = z.object({
  /** Maximum number of requests allowed within the window */
  maxRequests: z.number().int().positive(),
  /** Sliding window duration in milliseconds (default: 60,000ms = 1 minute) */
  windowMs: z.number().positive().optional().default(60000),
  /** Custom identifier extraction function (e.g. client IP or authenticated key) */
  keyGenerator: z.custom<((req: Request) => string | Promise<string>)>().optional(),
});

export type EdgeRouteRateLimitConfig = z.infer<typeof EdgeRouteRateLimitConfigSchema>;

export const EdgeRouteSecurityConfigSchema = z.object({
  /** Enable or configure Cross-Origin Resource Sharing (CORS) */
  cors: z
    .union([
      z.boolean(),
      z.object({
        origin: z.union([z.string(), z.array(z.string())]).optional(),
        allowMethods: z.array(z.string()).optional(),
        allowHeaders: z.array(z.string()).optional(),
        exposeHeaders: z.array(z.string()).optional(),
        maxAge: z.number().optional(),
        credentials: z.boolean().optional(),
      }),
    ])
    .optional(),
  /** Maximum request body size in bytes (default: 10MB = 10485760 bytes) */
  maxBodySize: z.number().positive().optional().default(10485760),
});

export type EdgeRouteSecurityConfig = z.infer<typeof EdgeRouteSecurityConfigSchema>;

export const EdgeRouteConfigSchema = z.object({
  /** Fallback model if no routes match with sufficient score or high-complexity queries */
  defaultModel: z.string(),
  /** Defined routes for routing classification */
  routes: z.array(RouteDefinitionSchema),
  /** Routing strategy: 'hybrid' (rules -> semantic -> complexity -> fallback), 'semantic', or 'complexity' */
  routingStrategy: RoutingStrategySchema.optional().default('hybrid'),
  /** Default complexity threshold (0.0 - 1.0). Queries with score >= threshold route to defaultModel */
  complexityThreshold: z.number().min(0).max(1).optional().default(0.6),
  /** Custom feature weights for complexity scorer */
  complexityWeights: ComplexityWeightsSchema.optional(),
  /** Providers configuration for upstream dispatch */
  providers: z.record(ProviderConfigSchema).optional(),
  /** Authentication & authorization configuration for the proxy */
  auth: EdgeRouteAuthConfigSchema.optional(),
  /** Rate limiting configuration */
  rateLimit: EdgeRouteRateLimitConfigSchema.optional(),
  /** Security and protection configuration (CORS, body limits) */
  security: EdgeRouteSecurityConfigSchema.optional(),
  /** Embedding provider configuration */
  embedding: EmbeddingConfigSchema.optional().default({ provider: 'auto' }),
  /** Semantic cache configuration */
  cache: CacheConfigSchema.optional(),
  /** Fallback retry count on downstream 429/5xx error */
  maxRetries: z.number().int().nonnegative().optional().default(1),
  /** Custom pricing table overrides ($ per 1M tokens) */
  customPricing: z
    .record(
      z.object({
        inputPerMillion: z.number(),
        outputPerMillion: z.number(),
      }),
    )
    .optional(),
});

export type EdgeRouteConfig = z.infer<typeof EdgeRouteConfigSchema>;
export type EdgeRouteConfigInput = z.input<typeof EdgeRouteConfigSchema>;

export type RouteMatchPath = 'fast-path' | 'semantic-path' | 'complexity-path' | 'fallback';

export interface ClassificationResult {
  /** Target model resolved by the router */
  targetModel: string;
  /** Matched route name or 'default' */
  matchedRoute: string;
  /** Decision path used */
  path: RouteMatchPath;
  /** Score: cosine similarity (semantic), 1.0 (fast-path), complexity score (complexity-path), or 0.0 (fallback) */
  score: number;
  /** Calculated query complexity score (0.0 to 1.0) */
  complexityScore?: number;
  /** Granular feature breakdown of query complexity */
  complexityFeatures?: ComplexityFeatures;
  /** Milliseconds elapsed during routing classification */
  latencyMs: number;
  /** Matched rule pattern, example snippet, or complexity reason */
  matchedPatternOrExample?: string;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'SKIPPED';

export interface RouteEngineRequest {
  prompt: string;
  temperature?: number;
  cacheControl?: string;
  bypassCache?: boolean;
  storeAllowed?: boolean;
  customTtl?: number;
  explicitProvider?: ProviderType;
  stream?: boolean;
}

export interface RouteCallerResult<T = any> {
  response: T;
  ok?: boolean;
  status?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  headers?: Record<string, string> | Headers;
  actualModel?: string;
  actualProvider?: ProviderType;
}

export type RouteCaller<T = any> = (
  model: string,
  explicitProvider?: ProviderType,
) => Promise<RouteCallerResult<T>>;

export interface RouteEngineExecutionResult<T = any> {
  fromCache: boolean;
  cachedResponse?: any;
  cacheStatus: CacheStatus;
  cacheScore?: number;
  cacheLatencyMs?: number;
  classification: ClassificationResult;
  actualModel: string;
  actualProvider: ProviderType;
  retriedWithFallback: boolean;
  response?: T;
  ok?: boolean;
  status?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  costSavings?: CostSavingsComparison;
  savedCostUSD?: number;
  headers: Record<string, string>;
  queryVector?: number[];
}


