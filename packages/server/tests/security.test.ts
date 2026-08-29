import { describe, it, expect } from 'vitest';
import { createEdgeRouteServer } from '../src/index.js';

describe('Security & Protection Middleware', () => {
  it('applies CORS headers when cors is enabled', async () => {
    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      security: {
        cors: true,
      },
    });

    const res = await app.request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects oversized payloads when maxBodySize is configured', async () => {
    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      security: {
        maxBodySize: 100, // 100 bytes max
      },
    });

    const oversizedBody = JSON.stringify({
      messages: [{ role: 'user', content: 'A'.repeat(500) }],
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: oversizedBody,
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('payload_too_large');
  });
});
