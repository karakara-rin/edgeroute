import {
  type EdgeRouteConfig,
  type EdgeRouteConfigInput,
  EdgeRouteEngine,
  defineConfig,
} from '@edgeroute/core';
import { ServerLogger, type ServerLoggerOptions } from './logger.js';
import { createRouterRoutes } from './routes.js';

export * from './logger.js';
export * from './proxy.js';
export * from './routes.js';
export * from './streaming.js';
export * from './providers/index.js';
export * from './middleware/index.js';

export interface CreateEdgeRouteServerOptions {
  logger?: ServerLogger | ServerLoggerOptions;
}

/**
 * Creates and initializes a configured Hono EdgeRoute proxy server instance.
 */
export async function createEdgeRouteServer(
  rawConfig: EdgeRouteConfig | EdgeRouteConfigInput,
  options?: CreateEdgeRouteServerOptions,
) {
  const config = defineConfig(rawConfig);
  const engine = new EdgeRouteEngine(config);

  // Pre-calculate and cache route example vectors in-memory
  await engine.initialize();

  const logger =
    options?.logger instanceof ServerLogger
      ? options.logger
      : new ServerLogger(options?.logger);

  const app = createRouterRoutes(config, engine, undefined, logger);

  return {
    app,
    engine,
    logger,
    classifier: engine.classifier,
    cacheManager: engine.cacheManager,
    embeddingProvider: engine.embeddingProvider,
  };
}


