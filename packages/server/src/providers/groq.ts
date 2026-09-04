import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class GroqAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      name: 'groq',
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      envKey: 'GROQ_API_KEY',
      headerKey: 'x-groq-api-key',
      stripModelPrefix: 'groq/',
      sanitizerOptions: true,
    });
  }
}
