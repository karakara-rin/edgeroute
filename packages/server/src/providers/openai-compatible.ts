import type { ProviderType } from '@edgeroute/core';
import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';

export interface OpenAICompatibleAdapterOptions {
  name: ProviderType;
  defaultBaseUrl: string;
  envKey: string;
  headerKey: string;
  forwardOpenAIHeaders?: boolean;
}

/**
 * Base adapter for providers using the standard OpenAI `/chat/completions` REST protocol
 * (e.g. OpenAI, Groq, DeepSeek, Together AI, vLLM, Ollama, custom proxies).
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: ProviderType;
  protected readonly defaultBaseUrl: string;
  protected readonly envKey: string;
  protected readonly headerKey: string;
  protected readonly forwardOpenAIHeaders: boolean;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.name = options.name;
    this.defaultBaseUrl = options.defaultBaseUrl;
    this.envKey = options.envKey;
    this.headerKey = options.headerKey;
    this.forwardOpenAIHeaders = options.forwardOpenAIHeaders ?? false;
  }

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.[this.name];

    const baseUrl = (
      providerConfig?.baseUrl || this.defaultBaseUrl
    ).replace(/\/+$/, '');

    const apiKey = resolveProviderApiKey({
      provider: this.name,
      config,
      clientHeaders,
      envKey: this.envKey,
      specificHeaderNames: [this.headerKey],
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

    if (this.forwardOpenAIHeaders) {
      const org = clientHeaders.get('openai-organization');
      if (org) headers['openai-organization'] = org;
      const project = clientHeaders.get('openai-project');
      if (project) headers['openai-project'] = project;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}
