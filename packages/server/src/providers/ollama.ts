import { OpenAICompatibleAdapter } from './openai-compatible.js';
import type { ProviderRequestOptions } from './types.js';

export class OllamaAdapter extends OpenAICompatibleAdapter {
  constructor() {
    const envBaseUrl =
      typeof process !== 'undefined' && process.env
        ? process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST
        : undefined;

    super({
      name: 'ollama',
      defaultBaseUrl: envBaseUrl || 'http://localhost:11434/v1',
      envKey: 'OLLAMA_API_KEY',
      headerKey: 'x-ollama-api-key',
    });
  }

  override async execute(options: ProviderRequestOptions): Promise<Response> {
    const cleanModel = options.model.startsWith('ollama/')
      ? options.model.slice(7)
      : options.model;

    return super.execute({
      ...options,
      model: cleanModel,
    });
  }
}
