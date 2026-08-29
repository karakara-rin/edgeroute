import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { EdgeRouteSecurityConfig } from '@edgeroute/core';

/**
 * Creates security middlewares (CORS and Request Body Limiting) for EdgeRoute.
 */
export function createSecurityMiddlewares(
  securityConfig?: EdgeRouteSecurityConfig,
): MiddlewareHandler[] {
  const middlewares: MiddlewareHandler[] = [];

  // 1. CORS
  if (securityConfig?.cors) {
    if (typeof securityConfig.cors === 'boolean') {
      middlewares.push(
        cors({
          origin: '*',
          allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowHeaders: [
            'Content-Type',
            'Authorization',
            'x-api-key',
            'x-edgeroute-cache-bypass',
            'x-edgeroute-cache-ttl',
            'x-openai-api-key',
            'x-anthropic-api-key',
            'x-goog-api-key',
            'x-gemini-api-key',
            'x-groq-api-key',
            'x-provider-api-key',
            'openai-organization',
            'openai-project',
          ],
          exposeHeaders: [
            'x-edgeroute-model',
            'x-edgeroute-route',
            'x-edgeroute-path',
            'x-edgeroute-score',
            'x-edgeroute-complexity',
            'x-edgeroute-latency-ms',
            'x-edgeroute-cache',
            'x-edgeroute-cost-savings-usd',
            'x-edgeroute-cost-savings-percent',
            'x-ratelimit-limit',
            'x-ratelimit-remaining',
            'x-ratelimit-reset',
            'retry-after',
          ],
        }),
      );
    } else {
      middlewares.push(cors(securityConfig.cors));
    }
  }

  // 2. Max Body Size
  if (securityConfig?.maxBodySize) {
    middlewares.push(
      bodyLimit({
        maxSize: securityConfig.maxBodySize,
        onError: (c) => {
          return c.json(
            {
              error: {
                message: `Request payload too large. Maximum size allowed is ${securityConfig.maxBodySize} bytes.`,
                type: 'invalid_request_error',
                code: 'payload_too_large',
              },
            },
            413,
          );
        },
      }),
    );
  }

  return middlewares;
}
