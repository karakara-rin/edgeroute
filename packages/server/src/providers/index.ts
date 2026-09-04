import type { ProviderType } from '@edgeroute/core';
import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { GroqAdapter } from './groq.js';
import { OllamaAdapter } from './ollama.js';
import { DeepSeekAdapter } from './deepseek.js';
import { AzureOpenAIAdapter } from './azure.js';

export * from './types.js';
export * from './openai-compatible.js';
export * from './openai.js';
export * from './anthropic.js';
export * from './gemini.js';
export * from './groq.js';
export * from './ollama.js';
export * from './deepseek.js';
export * from './azure.js';
export * from './sanitizer.js';

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  groq: new GroqAdapter(),
  ollama: new OllamaAdapter(),
  deepseek: new DeepSeekAdapter(),
  azure: new AzureOpenAIAdapter(),
  custom: new OpenAIAdapter(), // custom defaults to standard OpenAI protocol
};

interface ProviderDetectionRule {
  provider: ProviderType;
  match: (lowerModel: string) => boolean;
}

const PROVIDER_DETECTION_RULES: ProviderDetectionRule[] = [
  { provider: 'ollama', match: (m) => m.startsWith('ollama/') || m.startsWith('ollama-') },
  { provider: 'azure', match: (m) => m.startsWith('azure/') },
  { provider: 'groq', match: (m) => m.startsWith('groq/') || m.startsWith('deepseek-r1-distill') },
  {
    provider: 'deepseek',
    match: (m) =>
      m.startsWith('deepseek/') ||
      m === 'deepseek-chat' ||
      m === 'deepseek-reasoner' ||
      m === 'deepseek-v3' ||
      m === 'deepseek-r1',
  },
  { provider: 'anthropic', match: (m) => m.startsWith('claude-') || m.startsWith('anthropic/') },
  { provider: 'gemini', match: (m) => m.startsWith('gemini-') || m.startsWith('google/') },
  {
    provider: 'groq',
    match: (m) =>
      m.startsWith('llama-') ||
      m.startsWith('llama3-') ||
      m.startsWith('mixtral-') ||
      m.startsWith('gemma-'),
  },
];

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
  const matched = PROVIDER_DETECTION_RULES.find((rule) => rule.match(lower));
  return matched?.provider ?? 'openai';
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
