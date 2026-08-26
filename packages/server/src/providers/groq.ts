import type { ProviderAdapter, ProviderRequestOptions } from './types.js';

export class GroqAdapter implements ProviderAdapter {
  readonly name = 'groq' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['groq'];

    const baseUrl = (
      providerConfig?.baseUrl || 'https://api.groq.com/openai/v1'
    ).replace(/\/+$/, '');

    const apiKey =
      providerConfig?.apiKey ||
      clientHeaders.get('x-groq-api-key') ||
      clientHeaders.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      (typeof process !== 'undefined' ? process.env.GROQ_API_KEY : '');

    const payload = {
      ...body,
      model,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}
