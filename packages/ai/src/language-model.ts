import type {
  JSONValue,
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import {
  type ClassificationResult,
  type CostSavingsComparison,
  type EdgeRouteConfig,
  type EmbeddingProvider,
  SemanticCacheManager,
  SemanticClassifier,
  compareRoutingCost,
  createEmbeddingProvider,
  createSemanticCacheManager,
  defineConfig,
} from '@edgeroute/core';
import { autoResolveModel } from './auto-resolver.js';
import { extractPromptText } from './prompt-utils.js';
import type { EdgeRouteAIConfig, EdgeRouteMetadata } from './types.js';

export class EdgeRouteLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1';
  readonly defaultObjectGenerationMode = 'tool';
  readonly supportsImageUrls = true;
  readonly supportsStructuredOutputs = true;

  readonly provider = 'edgeroute';
  readonly modelId: string;

  private readonly config: EdgeRouteConfig;
  private readonly rawAIConfig: EdgeRouteAIConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly classifier: SemanticClassifier;
  private readonly cacheManager: SemanticCacheManager | null = null;
  private readonly models: Record<string, LanguageModelV1>;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(aiConfig: EdgeRouteAIConfig) {
    this.rawAIConfig = aiConfig;
    this.config = defineConfig(aiConfig);
    this.modelId = `edgeroute-router(${this.config.defaultModel})`;
    this.models = aiConfig.models ?? {};

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
  }

  /**
   * Ensures semantic vectors are initialized before classification.
   */
  private async ensureInitialized(): Promise<void> {
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
   * Resolves the target LanguageModelV1 instance for a given target model ID.
   */
  private async resolveModel(modelId: string): Promise<LanguageModelV1> {
    if (this.models[modelId]) {
      return this.models[modelId]!;
    }

    if (this.rawAIConfig.resolveModel) {
      const resolved = await this.rawAIConfig.resolveModel(modelId);
      if (resolved) {
        this.models[modelId] = resolved;
        return resolved;
      }
    }

    // Auto-resolve via standard provider packages (@ai-sdk/openai, @ai-sdk/anthropic, etc.)
    const autoResolved = await autoResolveModel(modelId, this.config);
    if (autoResolved) {
      this.models[modelId] = autoResolved;
      return autoResolved;
    }

    throw new Error(
      `[EdgeRoute] No LanguageModelV1 instance registered for target model "${modelId}". ` +
        `Please provide it in the 'models' mapping, e.g.: edgeroute({ models: { '${modelId}': openai('${modelId}') } }) ` +
        `or install the official provider package (e.g. @ai-sdk/openai, @ai-sdk/anthropic).`,
    );
  }

  /**
   * Estimates or calculates cost comparison between target model and default model.
   */
  private calculateCostSavings(
    targetModel: string,
    inputTokens = 1000,
    outputTokens = 1000,
  ): CostSavingsComparison | undefined {
    try {
      return compareRoutingCost(
        targetModel,
        this.config.defaultModel,
        inputTokens,
        outputTokens,
        this.config.customPricing,
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Generates a complete non-streaming completion.
   */
  async doGenerate(
    options: LanguageModelV1CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    await this.ensureInitialized();
    const promptText = extractPromptText(options.prompt);
    const temperature = options.temperature;

    // 1. Semantic Cache Lookup
    if (this.cacheManager && this.cacheManager.isCacheable(temperature)) {
      const lookup = await this.cacheManager.find(promptText);
      if (lookup.hit && lookup.match) {
        const match = lookup.match;
        const metadata: EdgeRouteMetadata = {
          matchedRoute: 'cache',
          targetModel: 'cache',
          routingPath: 'cache',
          score: match.score,
          latencyMs: lookup.latencyMs,
          cacheHit: true,
        };

        const headers: Record<string, string> = {
          'x-edgeroute-cache': 'HIT',
          'x-edgeroute-cache-similarity': match.score.toFixed(4),
          'x-edgeroute-target-model': 'cache',
          'x-edgeroute-matched-route': 'cache',
          'x-edgeroute-path': 'cache',
        };

        const content =
          typeof match.entry.response === 'string'
            ? match.entry.response
            : (match.entry.response.content as string) || '';

        return {
          text: content,
          finishReason: 'stop',
          usage: {
            promptTokens: match.entry.metadata?.usage?.prompt_tokens ?? 0,
            completionTokens:
              match.entry.metadata?.usage?.completion_tokens ?? 0,
          },
          rawCall: {
            rawPrompt: options.prompt,
            rawSettings: { temperature },
          },
          rawResponse: {
            headers,
          },
          response: {
            id: match.entry.id,
            timestamp: new Date(match.entry.createdAt),
            modelId: 'cache',
          },
          providerMetadata: {
            edgeroute: metadata as unknown as Record<string, JSONValue>,
          },
        };
      }
    }

    // 2. Semantic Routing Classification
    const classification = await this.classifier.classify(promptText);
    const estimatedTokens = Math.max(10, Math.ceil(promptText.length / 4));
    let costSavings = this.calculateCostSavings(
      classification.targetModel,
      estimatedTokens,
      estimatedTokens,
    );

    if (this.rawAIConfig.onRouteMatched) {
      this.rawAIConfig.onRouteMatched(classification, costSavings);
    }

    // 3. Dispatch to Target Model with Automatic Failover
    let targetModelInstance = await this.resolveModel(
      classification.targetModel,
    );
    let result: Awaited<ReturnType<LanguageModelV1['doGenerate']>>;
    let actualDispatchedModel = classification.targetModel;
    let fallbackTriggered = false;

    try {
      result = await targetModelInstance.doGenerate(options);
    } catch (err) {
      const maxRetries = this.config.maxRetries ?? 1;
      if (
        maxRetries > 0 &&
        classification.targetModel !== this.config.defaultModel
      ) {
        console.warn(
          `[EdgeRoute] Error invoking target model "${classification.targetModel}". Falling back to defaultModel "${this.config.defaultModel}". Error:`,
          err,
        );
        targetModelInstance = await this.resolveModel(this.config.defaultModel);
        result = await targetModelInstance.doGenerate(options);
        actualDispatchedModel = this.config.defaultModel;
        fallbackTriggered = true;
      } else {
        throw err;
      }
    }

    // Re-calculate cost savings with actual token usage
    if (result.usage) {
      costSavings = this.calculateCostSavings(
        actualDispatchedModel,
        result.usage.promptTokens,
        result.usage.completionTokens,
      );
    }

    // 4. Construct EdgeRoute Telemetry & Headers
    const metadata: EdgeRouteMetadata = {
      matchedRoute: classification.matchedRoute,
      targetModel: actualDispatchedModel,
      routingPath: fallbackTriggered ? 'fallback' : classification.path,
      score: classification.score,
      complexityScore: classification.complexityScore,
      latencyMs: classification.latencyMs,
      cacheHit: false,
      costSavings,
      ...(fallbackTriggered ? { fallbackTriggered: true } : {}),
    };

    const headers: Record<string, string> = {
      ...(result.rawResponse?.headers ?? {}),
      'x-edgeroute-target-model': actualDispatchedModel,
      'x-edgeroute-matched-route': classification.matchedRoute,
      'x-edgeroute-path': fallbackTriggered ? 'fallback' : classification.path,
      'x-edgeroute-score': classification.score.toFixed(4),
      'x-edgeroute-latency-ms': classification.latencyMs.toFixed(2),
      'x-edgeroute-cache': 'MISS',
    };

    if (fallbackTriggered) {
      headers['x-edgeroute-fallback-triggered'] = 'true';
    }

    if (costSavings && costSavings.savingsPercentage !== undefined) {
      headers['x-edgeroute-cost-savings'] = `${costSavings.savingsPercentage.toFixed(1)}%`;
    }

    // 5. Store in Semantic Cache
    if (
      this.cacheManager &&
      this.cacheManager.isCacheable(temperature) &&
      result.text
    ) {
      await this.cacheManager.save({
        prompt: promptText,
        response: { content: result.text },
        model: actualDispatchedModel,
        usage: {
          prompt_tokens: result.usage?.promptTokens,
          completion_tokens: result.usage?.completionTokens,
          total_tokens:
            (result.usage?.promptTokens ?? 0) +
            (result.usage?.completionTokens ?? 0),
        },
      });
    }

    return {
      ...result,
      rawResponse: {
        ...result.rawResponse,
        headers,
      },
      providerMetadata: {
        ...result.providerMetadata,
        edgeroute: metadata as unknown as Record<string, JSONValue>,
      },
    };
  }

  /**
   * Generates a streaming completion.
   */
  async doStream(
    options: LanguageModelV1CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    await this.ensureInitialized();
    const promptText = extractPromptText(options.prompt);
    const temperature = options.temperature;

    // 1. Semantic Cache Lookup
    if (this.cacheManager && this.cacheManager.isCacheable(temperature)) {
      const lookup = await this.cacheManager.find(promptText);
      if (lookup.hit && lookup.match) {
        const match = lookup.match;
        const metadata: EdgeRouteMetadata = {
          matchedRoute: 'cache',
          targetModel: 'cache',
          routingPath: 'cache',
          score: match.score,
          latencyMs: lookup.latencyMs,
          cacheHit: true,
        };

        const headers: Record<string, string> = {
          'x-edgeroute-cache': 'HIT',
          'x-edgeroute-cache-similarity': match.score.toFixed(4),
          'x-edgeroute-target-model': 'cache',
          'x-edgeroute-matched-route': 'cache',
          'x-edgeroute-path': 'cache',
        };

        const content =
          typeof match.entry.response === 'string'
            ? match.entry.response
            : (match.entry.response.content as string) || '';

        const stream = new ReadableStream<LanguageModelV1StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'response-metadata',
              id: match.entry.id,
              timestamp: new Date(match.entry.createdAt),
              modelId: 'cache',
            });
            controller.enqueue({
              type: 'text-delta',
              textDelta: content,
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: {
                promptTokens: match.entry.metadata?.usage?.prompt_tokens ?? 0,
                completionTokens:
                  match.entry.metadata?.usage?.completion_tokens ?? 0,
              },
              providerMetadata: {
                edgeroute: metadata as unknown as Record<string, JSONValue>,
              },
            });
            controller.close();
          },
        });

        return {
          stream,
          rawCall: {
            rawPrompt: options.prompt,
            rawSettings: { temperature },
          },
          rawResponse: { headers },
        };
      }
    }

    // 2. Semantic Routing Classification
    const classification = await this.classifier.classify(promptText);
    const estimatedTokens = Math.max(10, Math.ceil(promptText.length / 4));
    const costSavings = this.calculateCostSavings(
      classification.targetModel,
      estimatedTokens,
      estimatedTokens,
    );

    if (this.rawAIConfig.onRouteMatched) {
      this.rawAIConfig.onRouteMatched(classification, costSavings);
    }

    // 3. Dispatch to Target Model Stream with Automatic Failover
    let targetModelInstance = await this.resolveModel(
      classification.targetModel,
    );
    let streamResult: Awaited<ReturnType<LanguageModelV1['doStream']>>;
    let actualDispatchedModel = classification.targetModel;
    let fallbackTriggered = false;

    try {
      streamResult = await targetModelInstance.doStream(options);
    } catch (err) {
      const maxRetries = this.config.maxRetries ?? 1;
      if (
        maxRetries > 0 &&
        classification.targetModel !== this.config.defaultModel
      ) {
        console.warn(
          `[EdgeRoute] Error opening stream on target model "${classification.targetModel}". Falling back to defaultModel "${this.config.defaultModel}". Error:`,
          err,
        );
        targetModelInstance = await this.resolveModel(this.config.defaultModel);
        streamResult = await targetModelInstance.doStream(options);
        actualDispatchedModel = this.config.defaultModel;
        fallbackTriggered = true;
      } else {
        throw err;
      }
    }

    const metadata: EdgeRouteMetadata = {
      matchedRoute: classification.matchedRoute,
      targetModel: actualDispatchedModel,
      routingPath: fallbackTriggered ? 'fallback' : classification.path,
      score: classification.score,
      complexityScore: classification.complexityScore,
      latencyMs: classification.latencyMs,
      cacheHit: false,
      costSavings,
      ...(fallbackTriggered ? { fallbackTriggered: true } : {}),
    };

    const edgeRouteHeaders: Record<string, string> = {
      'x-edgeroute-target-model': actualDispatchedModel,
      'x-edgeroute-matched-route': classification.matchedRoute,
      'x-edgeroute-path': fallbackTriggered ? 'fallback' : classification.path,
      'x-edgeroute-score': classification.score.toFixed(4),
      'x-edgeroute-latency-ms': classification.latencyMs.toFixed(2),
      'x-edgeroute-cache': 'MISS',
    };

    if (fallbackTriggered) {
      edgeRouteHeaders['x-edgeroute-fallback-triggered'] = 'true';
    }

    if (costSavings && costSavings.savingsPercentage !== undefined) {
      edgeRouteHeaders['x-edgeroute-cost-savings'] =
        `${costSavings.savingsPercentage.toFixed(1)}%`;
    }

    const cacheManager = this.cacheManager;
    let accumulatedText = '';

    const transformStream = new TransformStream<
      LanguageModelV1StreamPart,
      LanguageModelV1StreamPart
    >({
      transform(chunk, controller) {
        if (chunk.type === 'text-delta') {
          accumulatedText += chunk.textDelta;
          controller.enqueue(chunk);
        } else if (chunk.type === 'finish') {
          controller.enqueue({
            ...chunk,
            providerMetadata: {
              ...chunk.providerMetadata,
              edgeroute: metadata as unknown as Record<string, JSONValue>,
            },
          });

          // Async Cache Storage
          if (
            cacheManager &&
            cacheManager.isCacheable(temperature) &&
            accumulatedText.length > 0
          ) {
            cacheManager
              .save({
                prompt: promptText,
                response: { content: accumulatedText },
                model: actualDispatchedModel,
                usage: {
                  prompt_tokens: chunk.usage?.promptTokens,
                  completion_tokens: chunk.usage?.completionTokens,
                  total_tokens:
                    (chunk.usage?.promptTokens ?? 0) +
                    (chunk.usage?.completionTokens ?? 0),
                },
              })
              .catch((err) => {
                console.warn(
                  '[EdgeRoute Cache] Failed to store stream result in cache:',
                  err,
                );
              });
          }
        } else {
          controller.enqueue(chunk);
        }
      },
    });

    return {
      stream: streamResult.stream.pipeThrough(transformStream),
      rawCall: streamResult.rawCall,
      rawResponse: {
        headers: {
          ...(streamResult.rawResponse?.headers ?? {}),
          ...edgeRouteHeaders,
        },
      },
      warnings: streamResult.warnings,
    };
  }
}
