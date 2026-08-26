import type { ProviderAdapter, ProviderRequestOptions } from './types.js';

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['openai'];

    const baseUrl = (
      providerConfig?.baseUrl || 'https://api.openai.com/v1'
    ).replace(/\/+$/, '');

    const apiKey =
      providerConfig?.apiKey ||
      clientHeaders.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : '');

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

    const org = clientHeaders.get('openai-organization');
    if (org) headers['openai-organization'] = org;
    const project = clientHeaders.get('openai-project');
    if (project) headers['openai-project'] = project;

    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}
