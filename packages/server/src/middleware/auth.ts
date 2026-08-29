import type { MiddlewareHandler } from 'hono';
import type { EdgeRouteAuthConfig } from '@edgeroute/core';

/**
 * Constant-time string equality check to prevent timing side-channel attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Creates authentication and authorization middleware for EdgeRoute proxy.
 * Validates incoming client API keys against configured keys or custom validator.
 */
export function createAuthMiddleware(authConfig?: EdgeRouteAuthConfig): MiddlewareHandler {
  return async (c, next) => {
    // If no auth config or no validation rules specified, allow request
    if (!authConfig || (!authConfig.apiKeys?.length && !authConfig.validator)) {
      return next();
    }

    const authHeader = c.req.header('authorization');
    const xApiKey = c.req.header('x-api-key');

    let clientKey: string | undefined;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      clientKey = authHeader.substring(7).trim();
    } else if (xApiKey) {
      clientKey = xApiKey.trim();
    }

    if (!clientKey) {
      return c.json(
        {
          error: {
            message: 'Missing API key. Please provide Authorization: Bearer <key> or x-api-key header.',
            type: 'invalid_request_error',
            code: 'missing_api_key',
          },
        },
        401,
      );
    }

    // 1. Custom validator if provided
    if (authConfig.validator) {
      try {
        const isValid = await authConfig.validator(clientKey, c.req.raw);
        if (!isValid) {
          return c.json(
            {
              error: {
                message: 'Invalid API key provided.',
                type: 'invalid_request_error',
                code: 'invalid_api_key',
              },
            },
            401,
          );
        }
      } catch (err) {
        return c.json(
          {
            error: {
              message: 'Authentication error.',
              type: 'invalid_request_error',
              code: 'auth_error',
            },
          },
          401,
        );
      }
    }

    // 2. Exact match against apiKeys list using constant-time comparison
    if (authConfig.apiKeys && authConfig.apiKeys.length > 0) {
      const isMatched = authConfig.apiKeys.some((validKey) =>
        constantTimeEqual(clientKey!, validKey),
      );
      if (!isMatched) {
        return c.json(
          {
            error: {
              message: 'Invalid API key provided.',
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            },
          },
          401,
        );
      }
    }

    // Attach validated key to context
    c.set('edgeRouteClientKey', clientKey);

    return next();
  };
}
