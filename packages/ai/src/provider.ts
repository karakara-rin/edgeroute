import { EdgeRouteLanguageModel } from './language-model.js';
import type { EdgeRouteAIConfig } from './types.js';

export interface EdgeRouteProvider {
  (modelId?: string): EdgeRouteLanguageModel;
  languageModel(modelId?: string): EdgeRouteLanguageModel;
}

/**
 * Creates an EdgeRoute provider instance compatible with Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { createEdgeRoute } from '@edgeroute/ai';
 * import { openai } from '@ai-sdk/openai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const edgeroute = createEdgeRoute({
 *   defaultModel: 'gpt-4o-mini',
 *   routes: [
 *     { name: 'complex-code', targetModel: 'claude-3-5-sonnet-20241022', rules: { minCharacters: 500 } }
 *   ],
 *   models: {
 *     'claude-3-5-sonnet-20241022': anthropic('claude-3-5-sonnet-20241022'),
 *     'gpt-4o-mini': openai('gpt-4o-mini'),
 *   }
 * });
 *
 * const model = edgeroute();
 * ```
 */
export function createEdgeRoute(config: EdgeRouteAIConfig): EdgeRouteProvider {
  const defaultModelInstance = new EdgeRouteLanguageModel(config);

  const provider = function (modelId?: string): EdgeRouteLanguageModel {
    if (!modelId) {
      return defaultModelInstance;
    }
    return new EdgeRouteLanguageModel({
      ...config,
      defaultModel: modelId,
    });
  };

  provider.languageModel = function (modelId?: string): EdgeRouteLanguageModel {
    return provider(modelId);
  };

  return provider;
}

/**
 * Direct shorthand to instantiate an EdgeRoute LanguageModelV1 instance for Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { streamText } from 'ai';
 * import { edgeroute } from '@edgeroute/ai';
 *
 * const result = await streamText({
 *   model: edgeroute({
 *     defaultModel: 'gpt-4o-mini',
 *     routes: [...],
 *     models: { ... }
 *   }),
 *   prompt: 'Hello world'
 * });
 * ```
 */
export function edgeroute(config: EdgeRouteAIConfig): EdgeRouteLanguageModel {
  return new EdgeRouteLanguageModel(config);
}
