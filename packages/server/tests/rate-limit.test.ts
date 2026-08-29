import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEdgeRouteServer } from '../src/index.js';

describe('Proxy Rate Limiting Middleware', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('limits requests according to maxRequests and windowMs', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
        return originalFetch(url, init);
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'OK' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      rateLimit: {
        maxRequests: 2,
        windowMs: 60000,
      },
    });

    // Request 1: OK
    const res1 = await app.request('/v1/models', {
      headers: { 'x-forwarded-for': '192.168.1.100' },
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('1');

    // Request 2: OK
    const res2 = await app.request('/v1/models', {
      headers: { 'x-forwarded-for': '192.168.1.100' },
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('0');

    // Request 3: 429 Rate Limit Exceeded
    const res3 = await app.request('/v1/models', {
      headers: { 'x-forwarded-for': '192.168.1.100' },
    });
    expect(res3.status).toBe(429);
    expect(res3.headers.get('Retry-After')).toBeDefined();
    const body = await res3.json();
    expect(body.error.code).toBe('rate_limit_exceeded');

    // Different IP should still succeed
    const resOtherIp = await app.request('/v1/models', {
      headers: { 'x-forwarded-for': '192.168.1.200' },
    });
    expect(resOtherIp.status).toBe(200);
  });
});
