import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class GeminiAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      name: 'gemini',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      envKey: 'GEMINI_API_KEY',
      headerKey: 'x-goog-api-key',
      additionalHeaderKeys: ['x-gemini-api-key'],
      attachCustomHeaders: (apiKey) => ({
        'x-goog-api-key': apiKey,
      }),
      stripModelPrefix: ['google/'],
      sanitizerOptions: {
        stripParallelToolCalls: true,
      },
    });
  }
}
