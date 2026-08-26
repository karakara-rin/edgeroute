import {
  type CacheStatus,
  type ClassificationResult,
  type EdgeRouteConfig,
  type ProviderType,
  type RouteCaller,
  type RouteEngineExecutionResult,
  type RouteEngineRequest,
} from './types.js';
import { SemanticClassifier } from './classifier.js';
import { SemanticCacheManager } from './cache/manager.js';
import type { EmbeddingProvider } from './embeddings/index.js';
import { compareRoutingCost } from './cost.js';
import {
  createEmbeddingProvider,
  createSemanticCacheManager,
} from './config.js';


export interface EdgeRouteEngineOptions {
  config: EdgeRouteConfig;
  embeddingProvider?: EmbeddingProvider;
  classifier?: SemanticClassifier;
  cacheManager?: SemanticCacheManager;
}

/**
 * EdgeRouteEngine orchestrates the entire routing, caching, provider dispatch,
 * failover retry, and cost telemetry pipeline.
 *
 * This serves as the core Domain / Use-Case layer in Clean Architecture,
 * decoupled from transport protocols (HTTP / Hono, Vercel AI SDK, CLI).
 */
export class EdgeRouteEngine {
  readonly config: EdgeRouteConfig;
  readonly embeddingProvider: EmbeddingProvider;
  readonly classifier: SemanticClassifier;
  readonly cacheManager: SemanticCacheManager | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: EdgeRouteEngineOptions | EdgeRouteConfig) {
    if ('routes' in options && 'defaultModel' in options) {
      // Direct EdgeRouteConfig passed
      this.config = options as EdgeRouteConfig;
      this.embeddingProvider = createEmbeddingProvider(this.config);
      this.classifier = new SemanticClassifier(
        this.config,
        this.embeddingProvider,
      );
      if (this.config.cache?.enabled !== false && this.config.cache) {
        this.cacheManager = createSemanticCacheManager(
          this.config,
          this.embeddingProvider,
        );
      }
    } else {
      const opts = options as EdgeRouteEngineOptions;
      this.config = opts.config;
      this.embeddingProvider =
        opts.embeddingProvider ?? createEmbeddingProvider(this.config);
      this.classifier =
        opts.classifier ??
        new SemanticClassifier(this.config, this.embeddingProvider);
      if (opts.cacheManager !== undefined) {
        this.cacheManager = opts.cacheManager;
      } else if (this.config.cache?.enabled !== false && this.config.cache) {
        this.cacheManager = createSemanticCacheManager(
          this.config,
          this.embeddingProvider,
        );
      }
    }
  }

  /**
   * Initializes semantic vectors for route examples.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.classifier.initialize();
        this.initialized = true;
      })();
    }
    await this.initPromise;
  }

  /**
   * Resolves cache control directives into cache status flags.
   */
  parseCacheDirectives(request: RouteEngineRequest): {
    cacheStatus: CacheStatus;
    isStoreAllowed: boolean;
    isCacheableTemperature: boolean;
  } {
    const cacheControlHeader = request.cacheControl || '';
    const isBypassRequested =
      request.bypassCache === true ||
      cacheControlHeader.includes('no-cache') ||
      cacheControlHeader.includes('no-store');
    const isStoreAllowed =
      request.storeAllowed !== false && !cacheControlHeader.includes('no-store');
    const isCacheableTemperature = this.cacheManager
      ? this.cacheManager.isCacheable(request.temperature)
      : true;

    let cacheStatus: CacheStatus = 'MISS';
    if (isBypassRequested) {
      cacheStatus = 'BYPASS';
    } else if (!isCacheableTemperature) {
      cacheStatus = 'SKIPPED';
    }

    return { cacheStatus, isStoreAllowed, isCacheableTemperature };
  }

  /**
   * Executes the full routing and dispatch pipeline:
   * 1. Cache lookup
   * 2. Semantic/fast-path/complexity classification
   * 3. Target provider dispatch with automatic failover retry
   * 4. Cost tracking & telemetry header creation
   * 5. Async cache persistence
   */
  async execute<T = any>(
    request: RouteEngineRequest,
    caller: RouteCaller<T>,
  ): Promise<RouteEngineExecutionResult<T>> {
    await this.initialize();

    const { prompt, customTtl, explicitProvider, stream } = request;
    const { cacheStatus: initialCacheStatus, isStoreAllowed, isCacheableTemperature } =
      this.parseCacheDirectives(request);

    let cacheStatus = initialCacheStatus;
    let queryVector: number[] = [];

    // 1. Semantic Cache Lookup Layer
    if (
      this.cacheManager &&
      this.cacheManager.isEnabled() &&
      cacheStatus === 'MISS' &&
      prompt
    ) {
      const cacheLookup = await this.cacheManager.find(prompt);
      queryVector = cacheLookup.queryVector;

      if (cacheLookup.hit && cacheLookup.match) {
        const match = cacheLookup.match;
        const targetModel = match.entry.metadata?.model || this.config.defaultModel;
        const savedCostUSD = this.cacheManager.calculateSavedCost(match.entry);

        const headers: Record<string, string> = {
          'Content-Type': stream ? 'text/event-stream' : 'application/json',
          'X-EdgeRoute-Cache': 'HIT',
          'X-EdgeRoute-Score': match.score.toString(),
          'X-EdgeRoute-Cache-Latency': `${cacheLookup.latencyMs}ms`,
          'X-EdgeRoute-Target-Model': targetModel,
          'X-EdgeRoute-Cost-Saved-USD': savedCostUSD.toString(),
          'X-EdgeRoute-Cost-Saved-Percent': '100%',
        };

        const syntheticClassification: ClassificationResult = {
          targetModel,
          matchedRoute: 'cache',
          path: 'semantic-path',
          score: match.score,
          latencyMs: cacheLookup.latencyMs,
        };

        return {
          fromCache: true,
          cachedResponse: match.entry.response,
          cacheStatus: 'HIT',
          cacheScore: match.score,
          cacheLatencyMs: cacheLookup.latencyMs,
          classification: syntheticClassification,
          actualModel: targetModel,
          actualProvider: 'openai',
          retriedWithFallback: false,
          savedCostUSD,
          headers,
          queryVector,
          usage: match.entry.metadata?.usage,
        };
      }
    }

    // 2. Routing Classification Layer
    const classification = await this.classifier.classify(prompt);

    // Find explicit provider from route definition if configured
    const matchedRouteDef = this.config.routes.find(
      (r) => r.name === classification.matchedRoute,
    );
    const resolvedExplicitProvider =
      explicitProvider ?? matchedRouteDef?.provider;

    // 3. Dispatch to Upstream Provider with Automatic Failover
    let targetModel = classification.targetModel;
    let actualProvider: ProviderType = resolvedExplicitProvider ?? 'openai';
    let retriedWithFallback = false;
    let callerResult: {
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
    };

    try {
      callerResult = await caller(targetModel, resolvedExplicitProvider);
      if (callerResult.actualModel) targetModel = callerResult.actualModel;
      if (callerResult.actualProvider) actualProvider = callerResult.actualProvider;

      // Failover retry on error status (429 or 5xx)
      const isFailedStatus =
        callerResult.ok === false ||
        (callerResult.status && (callerResult.status === 429 || callerResult.status >= 500));

      const maxRetries = this.config.maxRetries ?? 1;

      if (
        isFailedStatus &&
        targetModel !== this.config.defaultModel &&
        maxRetries > 0
      ) {
        try {
          const fallbackResult = await caller(this.config.defaultModel);
          const fallbackFailed =
            fallbackResult.ok === false ||
            (fallbackResult.status &&
              (fallbackResult.status === 429 || fallbackResult.status >= 500));

          if (!fallbackFailed) {
            callerResult = fallbackResult;
            targetModel = fallbackResult.actualModel ?? this.config.defaultModel;
            if (fallbackResult.actualProvider) {
              actualProvider = fallbackResult.actualProvider;
            }
            retriedWithFallback = true;
          }
        } catch {
          // If fallback fails to connect, keep original callerResult
        }
      }
    } catch (err) {
      // If primary threw an exception, attempt fallback if eligible
      const maxRetries = this.config.maxRetries ?? 1;
      if (maxRetries > 0 && targetModel !== this.config.defaultModel) {
        try {
          const fallbackResult = await caller(this.config.defaultModel);
          callerResult = fallbackResult;
          targetModel = fallbackResult.actualModel ?? this.config.defaultModel;
          if (fallbackResult.actualProvider) {
            actualProvider = fallbackResult.actualProvider;
          }
          retriedWithFallback = true;
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // 4. Cost Comparison & Telemetry Header Construction
    const headers: Record<string, string> = {};

    // Copy raw headers if present
    if (callerResult.headers) {
      if (callerResult.headers instanceof Headers) {
        callerResult.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else {
        Object.assign(headers, callerResult.headers);
      }
    }

    headers['X-EdgeRoute-Cache'] = cacheStatus;
    headers['X-EdgeRoute-Matched-Route'] = classification.matchedRoute;
    headers['X-EdgeRoute-Target-Model'] = targetModel;
    headers['X-EdgeRoute-Provider'] = actualProvider;
    headers['X-EdgeRoute-Path'] = retriedWithFallback
      ? 'fallback-retry'
      : classification.path;
    headers['X-EdgeRoute-Score'] = classification.score.toString();
    headers['X-EdgeRoute-Latency-Routing'] = `${classification.latencyMs}ms`;

    let costSavings: ReturnType<typeof compareRoutingCost> | undefined;
    const usage = callerResult.usage;

    if (usage) {
      costSavings = compareRoutingCost(
        targetModel,
        this.config.defaultModel,
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        this.config.customPricing,
      );
      headers['X-EdgeRoute-Cost-Saved-USD'] = costSavings.savingsUSD.toString();
      headers['X-EdgeRoute-Cost-Saved-Percent'] = `${costSavings.savingsPercentage}%`;
    }

    // 5. Semantic Cache Storage (Non-stream, background)
    const isSuccess = callerResult.ok !== false && (!callerResult.status || (callerResult.status >= 200 && callerResult.status < 300));
    if (
      !stream &&
      isSuccess &&
      this.cacheManager &&
      this.cacheManager.isEnabled() &&
      isStoreAllowed &&
      isCacheableTemperature &&
      prompt &&
      callerResult.response
    ) {
      this.cacheManager
        .save({
          prompt,
          response: callerResult.response as Record<string, unknown>,
          model: targetModel,
          vector: queryVector,
          ttl: customTtl,
          usage,
        })
        .catch(() => {});
    }

    return {
      fromCache: false,
      cacheStatus,
      classification,
      actualModel: targetModel,
      actualProvider,
      retriedWithFallback,
      response: callerResult.response,
      usage,
      costSavings,
      headers,
      queryVector,
    };
  }

  /**
   * Helper to persist a stream response into the cache once stream completion finishes.
   */
  async saveStreamResponse(
    prompt: string,
    response: Record<string, unknown>,
    model: string,
    queryVector?: number[],
    customTtl?: number,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  ): Promise<void> {
    if (this.cacheManager && this.cacheManager.isEnabled() && prompt) {
      await this.cacheManager.save({
        prompt,
        response,
        model,
        vector: queryVector ?? [],
        ttl: customTtl,
        usage,
      });
    }
  }
}
