import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEdgeRouteServer } from '../src/index.js';

describe('Proxy Authentication & Upstream Credential Isolation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('allows access to public endpoints (/health) even with auth configured', async () => {
    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        apiKeys: ['er-secret-key-123'],
      },
    });

    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('rejects /v1/chat/completions with 401 when API key is missing', async () => {
    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        apiKeys: ['er-secret-key-123'],
      },
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('missing_api_key');
  });

  it('rejects /v1/chat/completions with 401 when API key is invalid', async () => {
    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        apiKeys: ['er-secret-key-123'],
      },
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-999',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_api_key');
  });

  it('accepts valid API key via Authorization: Bearer or x-api-key', async () => {
    // Mock global fetch to return OpenAI mock response
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
        return originalFetch(url, init);
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Hello world' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        apiKeys: ['er-secret-key-123'],
      },
      providers: {
        openai: { apiKey: 'sk-server-configured-openai-key' },
      },
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer er-secret-key-123',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it('supports custom auth validator', async () => {
    const validator = vi.fn().mockImplementation((key: string) => {
      return key.startsWith('tenant-valid-');
    });

    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        validator,
      },
    });

    const rejectRes = await app.request('/v1/models', {
      headers: {
        'x-api-key': 'tenant-invalid-1',
      },
    });
    expect(rejectRes.status).toBe(401);

    const acceptRes = await app.request('/v1/models', {
      headers: {
        'x-api-key': 'tenant-valid-abc',
      },
    });
    expect(acceptRes.status).toBe(200);
    expect(validator).toHaveBeenCalledTimes(2);
  });

  it('prevents leaking proxy API keys to upstream providers and uses BYOK correctly', async () => {
    let capturedUpstreamHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
        return originalFetch(url, init);
      }
      capturedUpstreamHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Safe response' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const { app } = await createEdgeRouteServer({
      defaultModel: 'gpt-4o',
      routes: [],
      embedding: { provider: 'hash' },
      auth: {
        apiKeys: ['er-proxy-admin-key'],
      },
      // No server provider key configured
    });

    // Client passes proxy key for auth AND BYOK key for upstream
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer er-proxy-admin-key',
        'x-openai-api-key': 'sk-user-byok-openai-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
    // Upstream authorization header should use BYOK key, NOT the proxy admin key!
    expect(capturedUpstreamHeaders['Authorization']).toBe('Bearer sk-user-byok-openai-key');
    expect(capturedUpstreamHeaders['Authorization']).not.toContain('er-proxy-admin-key');
  });
});
