import { OpenAICompatibleAdapter } from './openai-compatible.js';

export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      name: 'deepseek',
      defaultBaseUrl: 'https://api.deepseek.com/v1',
      envKey: 'DEEPSEEK_API_KEY',
      headerKey: 'x-deepseek-api-key',
      stripModelPrefix: 'deepseek/',
      sanitizerOptions: true,
    });
  }
}
