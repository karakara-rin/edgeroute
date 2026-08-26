import { LocalEmbeddingProvider } from './embeddings/local.js';
import { OpenAIEmbeddingProvider } from './embeddings/openai.js';
import type { EmbeddingProvider } from './embeddings/types.js';
import { SemanticCacheManager } from './cache/manager.js';
import {
  type EdgeRouteConfig,
  type EdgeRouteConfigInput,
  EdgeRouteConfigSchema,
} from './types.js';

/**
 * Type-safe configuration helper for defining router rules and providers.
 */
export function defineConfig(config: EdgeRouteConfigInput): EdgeRouteConfig {
  const parsed = EdgeRouteConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Invalid EdgeRoute configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

/**
 * Resolves the appropriate embedding provider based on config.
 */
export function createEmbeddingProvider(config: EdgeRouteConfig): EmbeddingProvider {
  const embedding = config.embedding;

  if (embedding?.provider === 'openai') {
    return new OpenAIEmbeddingProvider({
      apiKey: embedding.apiKey || config.providers?.['openai']?.apiKey,
      baseUrl: embedding.baseUrl || config.providers?.['openai']?.baseUrl,
      model: embedding.model,
    });
  }

  // Default to zero-API local provider
  return new LocalEmbeddingProvider();
}

/**
 * Creates and initializes the SemanticCacheManager instance from config.
 */
export function createSemanticCacheManager(
  config: EdgeRouteConfig,
  embeddingProvider: EmbeddingProvider,
): SemanticCacheManager {
  return new SemanticCacheManager(
    config.cache || { enabled: false },
    embeddingProvider,
    config.customPricing,
  );
}

