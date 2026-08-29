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
 * Low-level standalone dispatcher for chat completion requests to upstream providers
 * with automatic cross-provider fallback retry on errors or rate limits.
 *
 * Note: For full routing, caching, and telemetry, use `createEdgeRouteServer()` or `EdgeRouteEngine`.
 */
export async function forwardChatCompletion(
  options: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  const { model, body, clientHeaders, config, explicitProvider } = options;

  let response: Response;
  let actualProvider: ProviderType;

  // Attempt primary routed model & provider
  try {
    const primaryResult = await dispatchProviderRequest(
      {
        model,
        body,
        clientHeaders,
        config,
      },
      explicitProvider,
    );
    response = primaryResult.response;
    actualProvider = primaryResult.provider;
  } catch (primaryErr) {
    const maxRetries = config.maxRetries ?? 1;
    if (maxRetries > 0 && model !== config.defaultModel) {
      console.warn(
        `[EdgeRoute/Proxy] Primary dispatch for model "${model}" failed with network error. Attempting fallback to defaultModel "${config.defaultModel}"... Error:`,
        primaryErr,
      );
      try {
        const fallbackResult = await dispatchProviderRequest({
          model: config.defaultModel,
          body,
          clientHeaders,
          config,
        });
        return {
          response: fallbackResult.response,
          retriedWithFallback: true,
          actualModel: config.defaultModel,
          actualProvider: fallbackResult.provider,
        };
      } catch (fallbackErr) {
        console.error(
          `[EdgeRoute/Proxy] Both primary "${model}" and fallback "${config.defaultModel}" failed to connect:`,
          fallbackErr,
        );
        throw primaryErr;
      }
    } else {
      throw primaryErr;
    }
  }

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
    console.warn(
      `[EdgeRoute/Proxy] Primary model "${model}" returned status ${response.status}. Attempting fallback to defaultModel "${config.defaultModel}"...`,
    );
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
      } else {
        console.warn(
          `[EdgeRoute/Proxy] Fallback model "${config.defaultModel}" returned status ${fallbackResult.response.status}. Keeping primary response.`,
        );
      }
    } catch (fallbackErr) {
      console.warn(
        `[EdgeRoute/Proxy] Fallback to defaultModel "${config.defaultModel}" connection failed:`,
        fallbackErr,
      );
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

