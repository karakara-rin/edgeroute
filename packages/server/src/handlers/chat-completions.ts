import type { Context } from 'hono';
import {
  type EdgeRouteConfig,
  type EdgeRouteEngine,
  type TokenUsage,
  estimateMessagesTokens,
  compareRoutingCost,
} from '@edgeroute/core';
import type { ServerLogger } from '../logger.js';
import type { ChatCompletionRequestBody } from '../types.js';
import { extractPromptContext } from '../utils/prompt.js';
import { dispatchProviderRequest } from '../providers/index.js';
import {
  captureAndCacheStream,
  createCachedStream,
  createSafeStream,
} from '../streaming.js';

export interface HandleChatCompletionsOptions {
  config: EdgeRouteConfig;
  engine: EdgeRouteEngine;
  logger: ServerLogger;
}

/**
 * Handles incoming POST /v1/chat/completions requests:
 * 1. Request body parsing and header extraction
 * 2. Execution via EdgeRouteEngine (cache lookup -> routing -> dispatch -> failover retry)
 * 3. Cache-hit handling (JSON & SSE streaming)
 * 4. Upstream streaming response handling with on-the-fly caching
 * 5. Non-streaming response formatting
 * 6. Structured logging and telemetry
 */
export async function handleChatCompletions(
  c: Context,
  options: HandleChatCompletionsOptions,
): Promise<Response> {
  const { config, engine, logger } = options;
  const startTime = performance.now();
  let body: ChatCompletionRequestBody;

  try {
    body = await c.req.json<ChatCompletionRequestBody>();
  } catch {
    logger.logRequest({
      method: 'POST',
      path: '/v1/chat/completions',
      status: 400,
      durationMs: performance.now() - startTime,
    });
    return c.json({ error: { message: 'Invalid JSON request body' } }, 400);
  }

  const prompt = extractPromptContext(body.messages || []);
  const promptTokens = estimateMessagesTokens(body.messages || []);
  const reqHeaders = c.req.raw.headers;

  const cacheControlHeader = reqHeaders.get('cache-control') || '';
  const bypassCache =
    reqHeaders.get('x-edgeroute-cache-bypass') === 'true' ||
    cacheControlHeader.includes('no-cache') ||
    cacheControlHeader.includes('no-store');
  const storeAllowed = !cacheControlHeader.includes('no-store');
  const customTtlHeader = reqHeaders.get('x-edgeroute-cache-ttl');
  const customTtl = customTtlHeader ? parseInt(customTtlHeader, 10) : undefined;

  // Execute through Core Engine
  const result = await engine.execute(
    {
      prompt,
      temperature: body.temperature,
      cacheControl: cacheControlHeader,
      bypassCache,
      storeAllowed,
      customTtl,
      stream: body.stream,
    },
    async (targetModel, explicitProvider) => {
      const { response, provider } = await dispatchProviderRequest(
        {
          model: targetModel,
          body,
          clientHeaders: reqHeaders,
          config,
        },
        explicitProvider,
      );

      let parsedBody: Record<string, unknown> | undefined = undefined;
      let usage: TokenUsage | undefined = undefined;
      let rawBodyText: string | undefined = undefined;

      if (!body.stream && response.ok) {
        try {
          rawBodyText = await response.text();
          parsedBody = JSON.parse(rawBodyText) as Record<string, unknown>;
          usage = parsedBody?.usage as TokenUsage | undefined;
        } catch (parseErr) {
          console.warn(
            `[EdgeRoute/Server] Failed to parse JSON response body for model "${targetModel}". Keeping raw body text. Error:`,
            parseErr,
          );
        }
      }

      return {
        response: parsedBody ?? rawBodyText ?? response,
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        actualModel: targetModel,
        actualProvider: provider,
        usage,
      };
    },
  );

  // Calculate saved cost USD (defaultModel hypothetical cost vs actual/cache cost)
  let savedCostUSD = result.savedCostUSD;
  if (savedCostUSD === undefined || savedCostUSD === null) {
    if (result.costSavings?.savingsUSD !== undefined) {
      savedCostUSD = result.costSavings.savingsUSD;
    } else {
      const estimatedInputTokens = result.usage?.prompt_tokens ?? promptTokens;
      const estimatedOutputTokens = result.usage?.completion_tokens ?? 50;
      const comparison = compareRoutingCost(
        result.actualModel,
        config.defaultModel,
        estimatedInputTokens,
        estimatedOutputTokens,
        config.customPricing,
      );
      savedCostUSD = result.fromCache
        ? comparison.hypotheticalDefaultCostUSD
        : comparison.savingsUSD;
    }
  }

  const durationMs = performance.now() - startTime;
  const responseStatus = result.status ?? (result.ok === false ? 500 : 200);

  const logEvent = {
    method: 'POST',
    path: '/v1/chat/completions',
    status: responseStatus,
    durationMs,
    fromCache: result.fromCache,
    cacheLatencyMs: result.cacheLatencyMs,
    matchedRoute: result.classification?.matchedRoute,
    targetModel: result.actualModel,
    defaultModel: config.defaultModel,
    provider: result.actualProvider,
    savedCostUSD,
    retriedWithFallback: result.retriedWithFallback,
    tokens: {
      prompt: result.usage?.prompt_tokens ?? promptTokens,
      completion: result.usage?.completion_tokens,
      total: result.usage?.total_tokens,
    },
  };

  logger.logRequest(logEvent);

  // 1. If Cache Hit
  if (result.fromCache && result.cachedResponse) {
    if (body.stream) {
      const stream = createCachedStream(result.cachedResponse, result.actualModel);
      return new Response(stream, {
        status: 200,
        headers: result.headers,
      });
    }
    return new Response(JSON.stringify(result.cachedResponse), {
      status: 200,
      headers: result.headers,
    });
  }

  // 2. If Streaming
  if (body.stream) {
    const upstreamResponse = result.response as Response;
    const headers = new Headers(result.headers);

    if (
      upstreamResponse?.ok &&
      upstreamResponse.body &&
      engine.cacheManager?.isEnabled() &&
      storeAllowed &&
      prompt
    ) {
      const capturedStream = captureAndCacheStream(
        upstreamResponse.body,
        result.actualModel,
        async (fullResponse) => {
          await engine.saveStreamResponse(
            prompt,
            fullResponse,
            result.actualModel,
            result.queryVector,
            customTtl,
            fullResponse.usage as TokenUsage | undefined,
          );
        },
        { promptTokens, prompt },
      );

      return new Response(capturedStream, {
        status: upstreamResponse.status,
        headers,
      });
    }

    const safeStream = upstreamResponse?.body
      ? createSafeStream(upstreamResponse.body, result.actualModel)
      : upstreamResponse?.body;

    return new Response(safeStream, {
      status: upstreamResponse?.status ?? 200,
      headers,
    });
  }

  // 3. Non-streaming response
  const headers = new Headers(result.headers);
  if (typeof result.response === 'string') {
    return new Response(result.response, {
      status: result.status ?? 200,
      headers,
    });
  }

  if (
    result.response &&
    typeof result.response === 'object' &&
    !(result.response instanceof Response)
  ) {
    return new Response(JSON.stringify(result.response), {
      status: result.status ?? 200,
      headers,
    });
  }

  if (result.response instanceof Response) {
    return new Response(result.response.body, {
      status: result.response.status,
      headers,
    });
  }

  return new Response(String(result.response ?? ''), {
    status: result.status ?? 200,
    headers,
  });
}
