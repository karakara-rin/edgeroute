import { HashEmbeddingProvider } from './embeddings/local.js';
import { OpenAIEmbeddingProvider } from './embeddings/openai.js';
import { createAutoEmbeddingProvider } from './embeddings/factory.js';
import { TransformersEmbeddingProvider } from './embeddings/transformers.js';
import { WorkersAIEmbeddingProvider } from './embeddings/workers-ai.js';
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
 *
 * Provider resolution order:
 * - `'auto'`: Runtime auto-detection (CF Workers → Workers AI, Node/Bun → Transformers.js, fallback → Hash)
 * - `'hash'` / `'local'`: Zero-dependency lexical hashing vectorizer (not semantic)
 * - `'transformers'`: Transformers.js ONNX runtime (all-MiniLM-L6-v2)
 * - `'workers-ai'`: Cloudflare Workers AI (bge-small-en-v1.5)
 * - `'openai'`: OpenAI Embeddings API (text-embedding-3-small)
 *
 * Note: `'auto'` returns a Promise since it performs async runtime detection.
 * All other providers are synchronous.
 */
export function createEmbeddingProvider(config: EdgeRouteConfig): EmbeddingProvider | Promise<EmbeddingProvider> {
  const embedding = config.embedding;
  const provider = embedding?.provider ?? 'auto';

  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider({
        apiKey: embedding?.apiKey || config.providers?.['openai']?.apiKey,
        baseUrl: embedding?.baseUrl || config.providers?.['openai']?.baseUrl,
        model: embedding?.model,
      });

    case 'transformers':
      return new TransformersEmbeddingProvider({
        model: embedding?.model,
      });

    case 'workers-ai':
      if (!embedding?.workersAiBinding) {
        throw new Error(
          'Embedding provider "workers-ai" requires `workersAiBinding` (pass `env.AI` from Workers runtime).',
        );
      }
      return new WorkersAIEmbeddingProvider({
        binding: embedding.workersAiBinding,
        model: embedding?.model,
      });

    case 'hash':
    case 'local':
      // 'local' is a deprecated alias for 'hash'
      return new HashEmbeddingProvider();

    case 'auto':
    default:
      // Auto-detection is async
      return createAutoEmbeddingProvider(embedding);
  }
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
