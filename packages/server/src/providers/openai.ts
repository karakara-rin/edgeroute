import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      name: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      envKey: 'OPENAI_API_KEY',
      headerKey: 'x-openai-api-key',
      forwardOpenAIHeaders: true,
    });
  }
}
