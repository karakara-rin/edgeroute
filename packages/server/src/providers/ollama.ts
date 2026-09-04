import { OpenAICompatibleAdapter } from './openai-compatible.js';

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
      stripModelPrefix: 'ollama/',
      sanitizerOptions: true,
    });
  }
}
