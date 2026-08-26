import type { EdgeRouteConfig, ProviderType } from '@edgeroute/core';
import { dispatchProviderRequest } from './providers/index.js';

export interface UpstreamRequestOptions {
  model: string;
  body: Record<string, unknown>;
  clientHeaders: Headers;
  config: EdgeRouteConfig;
  explicitProvider?: ProviderType;
}

export interface UpstreamResponse {
  response: Response;
  retriedWithFallback: boolean;
  actualModel: string;
  actualProvider: ProviderType;
}

/**
 * Dispatches the chat completion request to the appropriate upstream provider,
 * with automatic cross-provider fallback retry on errors or rate limits.
 */
export async function forwardChatCompletion(
  options: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  const { model, body, clientHeaders, config, explicitProvider } = options;

  // Attempt primary routed model & provider
  let { response, provider: actualProvider } = await dispatchProviderRequest(
    {
      model,
      body,
      clientHeaders,
      config,
    },
    explicitProvider,
  );

  // If failed with 429 (rate limit) or 5xx server error, and targetModel isn't already defaultModel, fallback!
  let retriedWithFallback = false;
  let finalModel = model;

  const maxRetries = config.maxRetries ?? 1;

  if (
    !response.ok &&
    (response.status === 429 || response.status >= 500) &&
    model !== config.defaultModel &&
    maxRetries > 0
  ) {
    try {
      const fallbackResult = await dispatchProviderRequest({
        model: config.defaultModel,
        body,
        clientHeaders,
        config,
      });

      if (fallbackResult.response.ok) {
        response = fallbackResult.response;
        retriedWithFallback = true;
        finalModel = config.defaultModel;
        actualProvider = fallbackResult.provider;
      }
    } catch {
      // If fallback fails to connect, keep original response
    }
  }

  return {
    response,
    retriedWithFallback,
    actualModel: finalModel,
    actualProvider,
  };
}

