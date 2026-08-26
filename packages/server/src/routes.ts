import { Hono } from 'hono';
import {
  type EdgeRouteConfig,
  type SemanticCacheManager,
  SemanticClassifier,
  compareRoutingCost,
} from '@edgeroute/core';
import { forwardChatCompletion } from './proxy.js';
import { captureAndCacheStream, createCachedStream } from './streaming.js';

export interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null | Array<{ type: string; text?: string; [key: string]: unknown }>;
  tool_calls?: ChatCompletionToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ChatCompletionToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      type: 'function';
      function: {
        name: string;
      };
    };

export interface ChatCompletionResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    description?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatCompletionRequestBody {
  model?: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  tools?: ChatCompletionTool[];
  tool_choice?: ChatCompletionToolChoice;
  response_format?: ChatCompletionResponseFormat;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  [key: string]: unknown;
}

/**
 * Extracts the primary user prompt text from OpenAI messages array.
 */
export function extractUserPrompt(messages: ChatCompletionMessage[]): string {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text);
        return textParts.join('\n');
      }
    }
  }

  // Fallback: stringify last message content
  const last = messages[messages.length - 1]!;
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}

export function createRouterRoutes(
  config: EdgeRouteConfig,
  classifier: SemanticClassifier,
  cacheManager?: SemanticCacheManager,
) {
  const app = new Hono();

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      defaultModel: config.defaultModel,
      routesCount: config.routes.length,
      cacheEnabled: cacheManager?.isEnabled() ?? false,
    });
  });

  // Models listing mock endpoint
  app.get('/v1/models', (c) => {
    const models = [
      { id: config.defaultModel, object: 'model', owned_by: 'edgeroute' },
      ...config.routes.map((r) => ({
        id: r.targetModel,
        object: 'model',
        owned_by: 'edgeroute',
      })),
    ];
    return c.json({ object: 'list', data: models });
  });

  // Main OpenAI-compatible chat completions proxy
  app.post('/v1/chat/completions', async (c) => {
    let body: ChatCompletionRequestBody;
    try {
      body = await c.req.json<ChatCompletionRequestBody>();
    } catch {
      return c.json({ error: { message: 'Invalid JSON request body' } }, 400);
    }

    const prompt = extractUserPrompt(body.messages || []);
    const reqHeaders = c.req.raw.headers;

    // Cache control flags (0ms overhead)
    const cacheControlHeader = reqHeaders.get('cache-control') || '';
    const isBypassRequested =
      reqHeaders.get('x-edgeroute-cache-bypass') === 'true' ||
      cacheControlHeader.includes('no-cache') ||
      cacheControlHeader.includes('no-store');
    const isStoreAllowed = !cacheControlHeader.includes('no-store');
    const isCacheableTemperature = cacheManager ? cacheManager.isCacheable(body.temperature) : true;
    const customTtlHeader = reqHeaders.get('x-edgeroute-cache-ttl');
    const customTtl = customTtlHeader ? parseInt(customTtlHeader, 10) : undefined;

    let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'SKIPPED' = 'MISS';
    if (isBypassRequested) {
      cacheStatus = 'BYPASS';
    } else if (!isCacheableTemperature) {
      cacheStatus = 'SKIPPED';
    }

    // 1. Semantic Cache Lookup Layer
    let queryVector: number[] = [];
    if (
      cacheManager &&
      cacheManager.isEnabled() &&
      cacheStatus === 'MISS' &&
      prompt
    ) {
      const cacheLookup = await cacheManager.find(prompt);
      queryVector = cacheLookup.queryVector;

      if (cacheLookup.hit && cacheLookup.match) {
        const match = cacheLookup.match;
        const targetModel = match.entry.metadata?.model || config.defaultModel;
        const savedCostUSD = cacheManager.calculateSavedCost(match.entry);

        const cacheHeaders = new Headers({
          'Content-Type': body.stream ? 'text/event-stream' : 'application/json',
          'X-EdgeRoute-Cache': 'HIT',
          'X-EdgeRoute-Score': match.score.toString(),
          'X-EdgeRoute-Cache-Latency': `${cacheLookup.latencyMs}ms`,
          'X-EdgeRoute-Target-Model': targetModel,
          'X-EdgeRoute-Cost-Saved-USD': savedCostUSD.toString(),
          'X-EdgeRoute-Cost-Saved-Percent': '100%',
        });

        if (body.stream) {
          const stream = createCachedStream(match.entry.response, targetModel);
          return new Response(stream, {
            status: 200,
            headers: cacheHeaders,
          });
        }

        return new Response(JSON.stringify(match.entry.response), {
          status: 200,
          headers: cacheHeaders,
        });
      }
    }

    // 2. Routing Classification Layer
    const classification = await classifier.classify(prompt);

    // Find explicit provider from route definition if configured
    const matchedRouteDef = config.routes.find(
      (r) => r.name === classification.matchedRoute,
    );
    const explicitProvider = matchedRouteDef?.provider;

    // Forward to upstream provider
    const upstream = await forwardChatCompletion({
      model: classification.targetModel,
      body,
      clientHeaders: reqHeaders,
      config,
      explicitProvider,
    });

    const headers = new Headers(upstream.response.headers);

    // Attach EdgeRoute metadata headers
    headers.set('X-EdgeRoute-Cache', cacheStatus);
    headers.set('X-EdgeRoute-Matched-Route', classification.matchedRoute);
    headers.set('X-EdgeRoute-Target-Model', upstream.actualModel);
    headers.set('X-EdgeRoute-Provider', upstream.actualProvider);
    headers.set(
      'X-EdgeRoute-Path',
      upstream.retriedWithFallback ? 'fallback-retry' : classification.path,
    );
    headers.set('X-EdgeRoute-Score', classification.score.toString());
    headers.set('X-EdgeRoute-Latency-Routing', `${classification.latencyMs}ms`);

    // Handle non-streaming response & save to cache
    if (!body.stream && upstream.response.ok) {
      try {
        const responseData = (await upstream.response.json()) as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
          [key: string]: unknown;
        };

        if (responseData.usage) {
          const savings = compareRoutingCost(
            upstream.actualModel,
            config.defaultModel,
            responseData.usage.prompt_tokens || 0,
            responseData.usage.completion_tokens || 0,
            config.customPricing,
          );
          headers.set('X-EdgeRoute-Cost-Saved-USD', savings.savingsUSD.toString());
          headers.set(
            'X-EdgeRoute-Cost-Saved-Percent',
            `${savings.savingsPercentage}%`,
          );
        }

        // Save to semantic cache in background if eligible
        if (
          cacheManager &&
          cacheManager.isEnabled() &&
          isStoreAllowed &&
          isCacheableTemperature &&
          prompt
        ) {
          cacheManager
            .save({
              prompt,
              response: responseData,
              model: upstream.actualModel,
              vector: queryVector,
              ttl: customTtl,
              usage: responseData.usage,
            })
            .catch(() => {});
        }

        return new Response(JSON.stringify(responseData), {
          status: upstream.response.status,
          headers,
        });
      } catch {
        // If JSON parsing fails, return raw body
      }
    }

    // Handle streaming response & tee to cache
    if (body.stream && upstream.response.ok && upstream.response.body) {
      if (
        cacheManager &&
        cacheManager.isEnabled() &&
        isStoreAllowed &&
        isCacheableTemperature &&
        prompt
      ) {
        const capturedStream = captureAndCacheStream(
          upstream.response.body,
          upstream.actualModel,
          async (fullResponse) => {
            await cacheManager.save({
              prompt,
              response: fullResponse,
              model: upstream.actualModel,
              vector: queryVector,
              ttl: customTtl,
              usage: fullResponse.usage as any,
            });
          },
        );

        return new Response(capturedStream, {
          status: upstream.response.status,
          headers,
        });
      }
    }

    // Stream pass-through fallback
    return new Response(upstream.response.body, {
      status: upstream.response.status,
      headers,
    });
  });

  return app;
}

