import type {
  JSONValue,
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import {
  type CostSavingsComparison,
  type EdgeRouteConfig,
  EdgeRouteEngine,
  compareRoutingCost,
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
  private readonly engine: EdgeRouteEngine;
  private readonly models: Record<string, LanguageModelV1>;

  constructor(aiConfig: EdgeRouteAIConfig) {
    this.rawAIConfig = aiConfig;
    this.config = defineConfig(aiConfig);
    this.modelId = `edgeroute-router(${this.config.defaultModel})`;
    this.models = aiConfig.models ?? {};
    this.engine = new EdgeRouteEngine(this.config);
  }

  /**
   * Ensures semantic vectors are initialized before classification.
   */
  private async ensureInitialized(): Promise<void> {
    await this.engine.initialize();
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

    let targetModelInstance: LanguageModelV1;

    const result = await this.engine.execute(
      {
        prompt: promptText,
        temperature,
        stream: false,
      },
      async (modelToCall) => {
        targetModelInstance = await this.resolveModel(modelToCall);
        const generated = await targetModelInstance.doGenerate(options);
        return {
          response: generated,
          ok: true,
          status: 200,
          actualModel: modelToCall,
          actualProvider: 'openai',
          usage: {
            prompt_tokens: generated.usage?.promptTokens,
            completion_tokens: generated.usage?.completionTokens,
            total_tokens:
              (generated.usage?.promptTokens ?? 0) +
              (generated.usage?.completionTokens ?? 0),
          },
          headers: (generated.rawResponse?.headers ?? {}) as Record<string, string>,
        };
      },
    );

    // 1. Cache Hit handling
    if (result.fromCache && result.cachedResponse) {
      const matchScore = result.cacheScore ?? 1.0;
      const metadata: EdgeRouteMetadata = {
        matchedRoute: 'cache',
        targetModel: 'cache',
        routingPath: 'cache',
        score: matchScore,
        latencyMs: result.cacheLatencyMs ?? 0,
        cacheHit: true,
      };

      const headers: Record<string, string> = {
        'x-edgeroute-cache': 'HIT',
        'x-edgeroute-cache-similarity': matchScore.toFixed(4),
        'x-edgeroute-target-model': 'cache',
        'x-edgeroute-matched-route': 'cache',
        'x-edgeroute-path': 'cache',
      };

      const content =
        typeof result.cachedResponse === 'string'
          ? result.cachedResponse
          : (result.cachedResponse.content as string) || '';

      return {
        text: content,
        finishReason: 'stop',
        usage: {
          promptTokens: result.usage?.prompt_tokens ?? 0,
          completionTokens: result.usage?.completion_tokens ?? 0,
        },
        rawCall: {
          rawPrompt: options.prompt,
          rawSettings: { temperature },
        },
        rawResponse: { headers },
        response: {
          id: `cache-${Date.now()}`,
          timestamp: new Date(),
          modelId: 'cache',
        },
        providerMetadata: {
          edgeroute: metadata as unknown as Record<string, JSONValue>,
        },
      };
    }

    // 2. Route Matched Callback
    if (this.rawAIConfig.onRouteMatched) {
      this.rawAIConfig.onRouteMatched(result.classification, result.costSavings);
    }

    // 3. Construct EdgeRoute Telemetry
    const generated = result.response as Awaited<ReturnType<LanguageModelV1['doGenerate']>>;

    const metadata: EdgeRouteMetadata = {
      matchedRoute: result.classification.matchedRoute,
      targetModel: result.actualModel,
      routingPath: result.retriedWithFallback ? 'fallback' : result.classification.path,
      score: result.classification.score,
      complexityScore: result.classification.complexityScore,
      latencyMs: result.classification.latencyMs,
      cacheHit: false,
      costSavings: result.costSavings,
      ...(result.retriedWithFallback ? { fallbackTriggered: true } : {}),
    };

    const edgeRouteHeaders: Record<string, string> = {
      ...(generated?.rawResponse?.headers ?? {}),
      'x-edgeroute-target-model': result.actualModel,
      'x-edgeroute-matched-route': result.classification.matchedRoute,
      'x-edgeroute-path': result.retriedWithFallback ? 'fallback' : result.classification.path,
      'x-edgeroute-score': result.classification.score.toFixed(4),
      'x-edgeroute-latency-ms': result.classification.latencyMs.toFixed(2),
      'x-edgeroute-cache': 'MISS',
    };

    if (result.retriedWithFallback) {
      edgeRouteHeaders['x-edgeroute-fallback-triggered'] = 'true';
    }

    if (result.costSavings && result.costSavings.savingsPercentage !== undefined) {
      edgeRouteHeaders['x-edgeroute-cost-savings'] = `${result.costSavings.savingsPercentage.toFixed(1)}%`;
    }

    return {
      ...generated,
      rawResponse: {
        ...generated.rawResponse,
        headers: edgeRouteHeaders,
      },
      providerMetadata: {
        ...generated.providerMetadata,
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

    // Check cache first via Engine Cache Manager
    if (this.engine.cacheManager && this.engine.cacheManager.isCacheable(temperature)) {
      const lookup = await this.engine.cacheManager.find(promptText);
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
                completionTokens: match.entry.metadata?.usage?.completion_tokens ?? 0,
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

    // Routing Classification
    const classification = await this.engine.classifier.classify(promptText);
    const estimatedTokens = Math.max(10, Math.ceil(promptText.length / 4));
    const costSavings = this.calculateCostSavings(
      classification.targetModel,
      estimatedTokens,
      estimatedTokens,
    );

    if (this.rawAIConfig.onRouteMatched) {
      this.rawAIConfig.onRouteMatched(classification, costSavings);
    }

    // Target Stream Dispatch with failover
    let targetModelInstance = await this.resolveModel(classification.targetModel);
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
      edgeRouteHeaders['x-edgeroute-cost-savings'] = `${costSavings.savingsPercentage.toFixed(1)}%`;
    }

    const engine = this.engine;
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

          // Async Cache Storage via Engine
          if (
            engine.cacheManager &&
            engine.cacheManager.isCacheable(temperature) &&
            accumulatedText.length > 0
          ) {
            engine
              .saveStreamResponse(
                promptText,
                { content: accumulatedText },
                actualDispatchedModel,
                undefined,
                undefined,
                {
                  prompt_tokens: chunk.usage?.promptTokens,
                  completion_tokens: chunk.usage?.completionTokens,
                  total_tokens:
                    (chunk.usage?.promptTokens ?? 0) +
                    (chunk.usage?.completionTokens ?? 0),
                },
              )
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

