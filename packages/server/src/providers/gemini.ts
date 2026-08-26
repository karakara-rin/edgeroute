import type { ProviderAdapter, ProviderRequestOptions } from './types.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly name = 'gemini' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['gemini'];

    const baseUrl = (
      providerConfig?.baseUrl ||
      'https://generativelanguage.googleapis.com/v1beta/openai'
    ).replace(/\/+$/, '');

    const apiKey =
      providerConfig?.apiKey ||
      clientHeaders.get('x-goog-api-key') ||
      clientHeaders.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '');

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
