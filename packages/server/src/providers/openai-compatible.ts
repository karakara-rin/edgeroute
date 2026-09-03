import type { ProviderType } from '@edgeroute/core';
import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';

export interface OpenAICompatibleAdapterOptions {
  name: ProviderType;
  defaultBaseUrl: string;
  envKey: string;
  headerKey: string;
  additionalHeaderKeys?: string[];
  forwardOpenAIHeaders?: boolean;
  attachCustomHeaders?: (apiKey: string) => Record<string, string>;
}

/**
 * Base adapter for providers using the standard OpenAI `/chat/completions` REST protocol
 * (e.g. OpenAI, Groq, DeepSeek, Together AI, vLLM, Ollama, Gemini, custom proxies).
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: ProviderType;
  protected readonly defaultBaseUrl: string;
  protected readonly envKey: string;
  protected readonly headerKey: string;
  protected readonly additionalHeaderKeys?: string[];
  protected readonly forwardOpenAIHeaders: boolean;
  protected readonly attachCustomHeaders?: (apiKey: string) => Record<string, string>;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.name = options.name;
    this.defaultBaseUrl = options.defaultBaseUrl;
    this.envKey = options.envKey;
    this.headerKey = options.headerKey;
    this.additionalHeaderKeys = options.additionalHeaderKeys;
    this.forwardOpenAIHeaders = options.forwardOpenAIHeaders ?? false;
    this.attachCustomHeaders = options.attachCustomHeaders;
  }

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.[this.name];

    const baseUrl = (
      providerConfig?.baseUrl || this.defaultBaseUrl
    ).replace(/\/+$/, '');

    const specificHeaders = [this.headerKey];
    if (this.additionalHeaderKeys) {
      specificHeaders.push(...this.additionalHeaderKeys);
    }

    const apiKey = resolveProviderApiKey({
      provider: this.name,
      config,
      clientHeaders,
      envKey: this.envKey,
      specificHeaderNames: specificHeaders,
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
      if (this.attachCustomHeaders) {
        Object.assign(headers, this.attachCustomHeaders(apiKey));
      }
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
