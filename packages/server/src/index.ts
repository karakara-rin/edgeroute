import {
  type EdgeRouteConfig,
  type EdgeRouteConfigInput,
  SemanticClassifier,
  createEmbeddingProvider,
  createSemanticCacheManager,
  defineConfig,
} from '@edgeroute/core';
import { createRouterRoutes } from './routes.js';

export * from './proxy.js';
export * from './routes.js';
export * from './streaming.js';
export * from './providers/index.js';

/**
 * Creates and initializes a configured Hono EdgeRoute proxy server instance.
 */
export async function createEdgeRouteServer(
  rawConfig: EdgeRouteConfig | EdgeRouteConfigInput,
) {
  const config = defineConfig(rawConfig);
  const embeddingProvider = createEmbeddingProvider(config);
  const classifier = new SemanticClassifier(config, embeddingProvider);
  const cacheManager = createSemanticCacheManager(config, embeddingProvider);

  // Pre-calculate and cache route example vectors in-memory
  await classifier.initialize();

  const app = createRouterRoutes(config, classifier, cacheManager);

  return {
    app,
    classifier,
    cacheManager,
    embeddingProvider,
  };
}

