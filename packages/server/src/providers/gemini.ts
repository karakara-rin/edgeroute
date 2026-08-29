import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['gemini'];

    const baseUrl = (
      providerConfig?.baseUrl ||
      'https://generativelanguage.googleapis.com/v1beta/openai'
    ).replace(/\/+$/, '');

    const apiKey = resolveProviderApiKey({
      provider: 'gemini',
      config,
      clientHeaders,
      envKey: 'GEMINI_API_KEY',
      specificHeaderNames: ['x-goog-api-key', 'x-gemini-api-key'],
    });

    const payload = {
      ...body,
      model,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-goog-api-key'] = apiKey;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}
