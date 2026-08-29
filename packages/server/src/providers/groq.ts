import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';

export class GroqAdapter implements ProviderAdapter {
  readonly name = 'groq' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['groq'];

    const baseUrl = (
      providerConfig?.baseUrl || 'https://api.groq.com/openai/v1'
    ).replace(/\/+$/, '');

    const apiKey = resolveProviderApiKey({
      provider: 'groq',
      config,
      clientHeaders,
      envKey: 'GROQ_API_KEY',
      specificHeaderNames: ['x-groq-api-key'],
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
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}
