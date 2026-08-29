import { Hono } from 'hono';
import {
  type EdgeRouteConfig,
  type SemanticCacheManager,
  EdgeRouteEngine,
  SemanticClassifier,
} from '@edgeroute/core';
import { dispatchProviderRequest } from './providers/index.js';
import {
  captureAndCacheStream,
  createCachedStream,
  createSafeStream,
} from './streaming.js';

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
  configOrEngine: EdgeRouteConfig | EdgeRouteEngine,
  classifierOrEngine?: SemanticClassifier | EdgeRouteEngine,
  cacheManager?: SemanticCacheManager,
) {
  let engine: EdgeRouteEngine;
  let config: EdgeRouteConfig;

  if (configOrEngine instanceof EdgeRouteEngine) {
    engine = configOrEngine;
    config = engine.config;
  } else if (classifierOrEngine instanceof EdgeRouteEngine) {
    engine = classifierOrEngine;
    config = engine.config;
  } else {
    config = configOrEngine;
    engine = new EdgeRouteEngine({
      config,
      classifier: classifierOrEngine,
      cacheManager,
    });
  }

  const app = new Hono();

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      defaultModel: config.defaultModel,
      routesCount: config.routes.length,
      cacheEnabled: engine.cacheManager?.isEnabled() ?? false,
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

        let parsedBody: any = undefined;
        let usage: any = undefined;
        let rawBodyText: string | undefined = undefined;

        if (!body.stream && response.ok) {
          try {
            rawBodyText = await response.text();
            parsedBody = JSON.parse(rawBodyText);
            usage = parsedBody?.usage;
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
              fullResponse.usage as any,
            );
          },
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

    if (result.response && typeof result.response === 'object' && !(result.response instanceof Response)) {
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
  });

  return app;
}


