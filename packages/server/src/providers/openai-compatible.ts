import type { ProviderType } from '@edgeroute/core';
import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';
import {
  type SanitizerOptions,
  sanitizeOpenAICompatiblePayload,
} from './sanitizer.js';

export interface OpenAICompatibleAdapterOptions {
  name: ProviderType;
  defaultBaseUrl: string;
  envKey: string;
  headerKey: string;
  additionalHeaderKeys?: string[];
  forwardOpenAIHeaders?: boolean;
  attachCustomHeaders?: (apiKey: string) => Record<string, string>;
  sanitizerOptions?: SanitizerOptions | boolean;
  stripModelPrefix?: string | string[];
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
  protected readonly sanitizerOptions?: SanitizerOptions | boolean;
  protected readonly stripModelPrefix?: string | string[];

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.name = options.name;
    this.defaultBaseUrl = options.defaultBaseUrl;
    this.envKey = options.envKey;
    this.headerKey = options.headerKey;
    this.additionalHeaderKeys = options.additionalHeaderKeys;
    this.forwardOpenAIHeaders = options.forwardOpenAIHeaders ?? false;
    this.attachCustomHeaders = options.attachCustomHeaders;
    this.sanitizerOptions = options.sanitizerOptions;
    this.stripModelPrefix = options.stripModelPrefix;
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

    let cleanModel = model;
    if (this.stripModelPrefix) {
      const prefixes = Array.isArray(this.stripModelPrefix)
        ? this.stripModelPrefix
        : [this.stripModelPrefix];
      for (const prefix of prefixes) {
        if (cleanModel.startsWith(prefix)) {
          cleanModel = cleanModel.slice(prefix.length);
          break;
        }
      }
    }

    let payload: Record<string, unknown> = {
      ...body,
      model: cleanModel,
    };

    if (this.sanitizerOptions) {
      payload = sanitizeOpenAICompatiblePayload(
        payload,
        typeof this.sanitizerOptions === 'object' ? this.sanitizerOptions : {},
      );
    }

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
