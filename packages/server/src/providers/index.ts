import type { ProviderType } from '@edgeroute/core';
import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { GroqAdapter } from './groq.js';

export * from './types.js';
export * from './openai.js';
export * from './anthropic.js';
export * from './gemini.js';
export * from './groq.js';

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  groq: new GroqAdapter(),
  custom: new OpenAIAdapter(), // custom defaults to standard OpenAI protocol
};

/**
 * Detects the upstream provider from model identifier or explicit configuration.
 */
export function detectProvider(
  model: string,
  explicitProvider?: ProviderType,
): ProviderType {
  if (explicitProvider && adapters[explicitProvider]) {
    return explicitProvider;
  }

  const lower = model.toLowerCase();

  // Anthropic Claude
  if (lower.startsWith('claude-') || lower.startsWith('anthropic/')) {
    return 'anthropic';
  }

  // Google Gemini
  if (lower.startsWith('gemini-') || lower.startsWith('google/')) {
    return 'gemini';
  }

  // Groq / Open Models
  if (
    lower.startsWith('llama-') ||
    lower.startsWith('llama3-') ||
    lower.startsWith('mixtral-') ||
    lower.startsWith('gemma-') ||
    lower.startsWith('deepseek-') ||
    lower.startsWith('groq/')
  ) {
    return 'groq';
  }

  // OpenAI (Default)
  return 'openai';
}

/**
 * Dispatches the request through the appropriate provider adapter.
 */
export async function dispatchProviderRequest(
  options: ProviderRequestOptions,
  explicitProvider?: ProviderType,
): Promise<{ response: Response; provider: ProviderType }> {
  const provider = detectProvider(options.model, explicitProvider);
  const adapter = adapters[provider] || adapters.openai;

  const response = await adapter.execute(options);
  return { response, provider };
}
