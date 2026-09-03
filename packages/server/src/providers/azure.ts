import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import { resolveProviderApiKey } from './utils.js';

export class AzureOpenAIAdapter implements ProviderAdapter {
  readonly name = 'azure' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['azure'];

    // Resolve resourceName and baseUrl
    let baseUrl = providerConfig?.baseUrl;
    const resourceName =
      providerConfig?.resourceName ||
      (typeof process !== 'undefined' ? process.env?.AZURE_OPENAI_RESOURCE_NAME : undefined);

    if (!baseUrl && resourceName) {
      baseUrl = `https://${resourceName}.openai.azure.com`;
    }

    if (!baseUrl) {
      baseUrl =
        (typeof process !== 'undefined' ? process.env?.AZURE_OPENAI_ENDPOINT : undefined) ||
        'https://api.openai.azure.com';
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    // Resolve deployment name
    let deploymentName = providerConfig?.deploymentName;
    if (!deploymentName) {
      deploymentName = model.startsWith('azure/') ? model.slice(6) : model;
    }

    // Resolve api-version
    const apiVersion =
      providerConfig?.apiVersion ||
      (typeof process !== 'undefined' ? process.env?.AZURE_OPENAI_API_VERSION : undefined) ||
      '2024-08-01-preview';

    // Resolve API key
    const apiKey = resolveProviderApiKey({
      provider: 'azure',
      config,
      clientHeaders,
      envKey: 'AZURE_OPENAI_API_KEY',
      specificHeaderNames: ['api-key', 'x-api-key'],
    });

    const endpoint = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['api-key'] = apiKey;
    }

    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
}
