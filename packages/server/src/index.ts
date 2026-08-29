import {
  type EdgeRouteConfig,
  type EdgeRouteConfigInput,
  EdgeRouteEngine,
  defineConfig,
} from '@edgeroute/core';
import { createRouterRoutes } from './routes.js';

export * from './proxy.js';
export * from './routes.js';
export * from './streaming.js';
export * from './providers/index.js';
export * from './middleware/index.js';

/**
 * Creates and initializes a configured Hono EdgeRoute proxy server instance.
 */
export async function createEdgeRouteServer(
  rawConfig: EdgeRouteConfig | EdgeRouteConfigInput,
) {
  const config = defineConfig(rawConfig);
  const engine = new EdgeRouteEngine(config);

  // Pre-calculate and cache route example vectors in-memory
  await engine.initialize();

  const app = createRouterRoutes(config, engine);

  return {
    app,
    engine,
    classifier: engine.classifier,
    cacheManager: engine.cacheManager,
    embeddingProvider: engine.embeddingProvider,
  };
}


