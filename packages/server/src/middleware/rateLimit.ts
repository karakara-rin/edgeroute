import type { MiddlewareHandler } from 'hono';
import type { EdgeRouteRateLimitConfig } from '@edgeroute/core';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Creates rate-limiting middleware for EdgeRoute proxy endpoints.
 */
export function createRateLimitMiddleware(
  rateLimitConfig?: EdgeRouteRateLimitConfig,
): MiddlewareHandler {
  if (!rateLimitConfig || !rateLimitConfig.maxRequests) {
    return async (_c, next) => next();
  }

  const windowMs = rateLimitConfig.windowMs ?? 60000;
  const maxRequests = rateLimitConfig.maxRequests;
  const store = new Map<string, RateLimitRecord>();

  // Cleanup expired records periodically
  const cleanupInterval = 30000;
  let lastCleanup = Date.now();

  const cleanup = () => {
    const now = Date.now();
    if (now - lastCleanup > cleanupInterval) {
      lastCleanup = now;
      for (const [key, record] of store.entries()) {
        if (now > record.resetTime) {
          store.delete(key);
        }
      }
    }
  };

  return async (c, next) => {
    cleanup();

    let identifier = 'anonymous';
    if (rateLimitConfig.keyGenerator) {
      try {
        identifier = await rateLimitConfig.keyGenerator(c.req.raw);
      } catch {
        identifier = 'anonymous';
      }
    } else {
      identifier =
        (c.get('edgeRouteClientKey') as string) ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'anonymous';
    }

    const now = Date.now();
    let record = store.get(identifier);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      store.set(identifier, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil(record.resetTime / 1000);

    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetSeconds.toString());

    if (record.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      c.header('Retry-After', retryAfter.toString());

      return c.json(
        {
          error: {
            message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000}s allowed.`,
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        },
        429,
      );
    }

    return next();
  };
}
