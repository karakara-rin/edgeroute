import { OpenAICompatibleAdapter } from './openai-compatible.js';
import type { ProviderRequestOptions } from './types.js';

export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      name: 'deepseek',
      defaultBaseUrl: 'https://api.deepseek.com/v1',
      envKey: 'DEEPSEEK_API_KEY',
      headerKey: 'x-deepseek-api-key',
    });
  }

  override async execute(options: ProviderRequestOptions): Promise<Response> {
    const cleanModel = options.model.startsWith('deepseek/')
      ? options.model.slice(9)
      : options.model;

    return super.execute({
      ...options,
      model: cleanModel,
    });
  }
}
