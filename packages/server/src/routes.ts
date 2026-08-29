import { Hono } from 'hono';
import {
  type EdgeRouteConfig,
  type SemanticCacheManager,
  EdgeRouteEngine,
  SemanticClassifier,
} from '@edgeroute/core';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createSecurityMiddlewares,
} from './middleware/index.js';
import { ServerLogger, type ServerLoggerOptions } from './logger.js';
import { handleChatCompletions } from './handlers/chat-completions.js';

// Re-export types and utilities for 100% backward compatibility
export * from './types.js';
export * from './utils/prompt.js';

/**
 * Creates a configured Hono application instance with EdgeRoute proxy endpoints:
 * - Security middlewares (CORS, Body Limit)
 * - Rate Limiting & Auth middlewares
 * - GET /health
 * - GET /v1/models
 * - POST /v1/chat/completions
 */
export function createRouterRoutes(
  configOrEngine: EdgeRouteConfig | EdgeRouteEngine,
  classifierOrEngine?: SemanticClassifier | EdgeRouteEngine,
  cacheManager?: SemanticCacheManager,
  loggerOrOptions?: ServerLogger | ServerLoggerOptions,
) {
  let engine: EdgeRouteEngine;
  let config: EdgeRouteConfig;

  if (configOrEngine instanceof EdgeRouteEngine) {
    engine = configOrEngine;
    config = engine.config;
  } else if (classifierOrEngine instanceof EdgeRouteEngine) {
    engine = classifierOrEngine;
    config = engine.config;
  } else {
    config = configOrEngine;
    engine = new EdgeRouteEngine({
      config,
      classifier: classifierOrEngine,
      cacheManager,
    });
  }

  const logger =
    loggerOrOptions instanceof ServerLogger
      ? loggerOrOptions
      : new ServerLogger(loggerOrOptions);

  const app = new Hono();

  // 1. Security Middlewares (CORS & Body limits)
  const securityMiddlewares = createSecurityMiddlewares(config.security);
  for (const mw of securityMiddlewares) {
    app.use('*', mw);
  }

  // 2. Rate Limiting Middleware (applied globally across API paths)
  if (config.rateLimit) {
    app.use('/v1/*', createRateLimitMiddleware(config.rateLimit));
  }

  // 3. Proxy Authentication Middleware (protects /v1/* endpoints)
  if (config.auth) {
    app.use('/v1/*', createAuthMiddleware(config.auth));
  }

  // Health check endpoint (public)
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      defaultModel: config.defaultModel,
      routesCount: config.routes.length,
      cacheEnabled: engine.cacheManager?.isEnabled() ?? false,
    });
  });

  // Models listing mock endpoint
  app.get('/v1/models', (c) => {
    const models = [
      { id: config.defaultModel, object: 'model', owned_by: 'edgeroute' },
      ...config.routes.map((r) => ({
        id: r.targetModel,
        object: 'model',
        owned_by: 'edgeroute',
      })),
    ];
    return c.json({ object: 'list', data: models });
  });

  // Main OpenAI-compatible chat completions proxy
  app.post('/v1/chat/completions', (c) =>
    handleChatCompletions(c, { config, engine, logger }),
  );

  return app;
}
