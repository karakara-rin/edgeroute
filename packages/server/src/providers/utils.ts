import type { EdgeRouteConfig, ProviderType } from '@edgeroute/core';

export interface ResolveApiKeyOptions {
  provider: ProviderType;
  config: EdgeRouteConfig;
  clientHeaders: Headers;
  envKey?: string;
  specificHeaderNames?: string[];
}

/**
 * Resolves upstream provider API key safely without leaking proxy-side credentials.
 * Priority:
 * 1. Server configuration (`config.providers[provider].apiKey`)
 * 2. Provider-specific BYOK header (`x-openai-api-key`, `x-anthropic-api-key`, `x-provider-api-key`, etc.)
 * 3. Environment variable (e.g. `process.env.OPENAI_API_KEY`)
 * 4. Pass-through `Authorization` / `x-api-key` header (Only if it does NOT match proxy API keys)
 */
export function resolveProviderApiKey(options: ResolveApiKeyOptions): string {
  const { provider, config, clientHeaders, envKey, specificHeaderNames = [] } = options;

  // 1. Explicit provider config in server
  const providerConfig = config.providers?.[provider];
  if (providerConfig?.apiKey) {
    return providerConfig.apiKey;
  }

  // 2. Specific BYOK headers
  for (const headerName of specificHeaderNames) {
    const val = clientHeaders.get(headerName);
    if (val) return val.trim();
  }
  const genericByok = clientHeaders.get('x-provider-api-key');
  if (genericByok) return genericByok.trim();

  // 3. Environment variable
  if (envKey && typeof process !== 'undefined' && process.env?.[envKey]) {
    return process.env[envKey]!;
  }

  // 4. Pass-through authorization header only if not used as an EdgeRoute proxy key
  const authHeader = clientHeaders.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const xApiKey = clientHeaders.get('x-api-key')?.trim();
  const candidateKey = authHeader || xApiKey;

  if (candidateKey) {
    const proxyKeys = config.auth?.apiKeys;
    if (proxyKeys && proxyKeys.includes(candidateKey)) {
      // Prevent leaking proxy credentials to upstream LLM providers
      return '';
    }
    if (!proxyKeys || proxyKeys.length === 0) {
      return candidateKey;
    }
  }

  return '';
}
