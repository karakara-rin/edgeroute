import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEdgeRouteServer } from '../src/index.js';
import type { EdgeRouteConfigInput } from '@edgeroute/core';

describe('EdgeRoute Server & Proxy', () => {
  const config: EdgeRouteConfigInput = {
    defaultModel: 'gpt-4o',
    routes: [
      {
        name: 'simple-tasks',
        targetModel: 'gpt-4o-mini',
        threshold: 0.6,
        rules: {
          patterns: [/^(hello|hi|こんにちは)/i],
        },
        examples: [
          'Fix typos in this sentence',
          'Summarize the following text briefly',
        ],
      },
    ],
    embedding: {
      provider: 'local',
    },
    providers: {
      openai: {
        apiKey: 'test-api-key',
        baseUrl: 'https://mock-openai.com/v1',
      },
    },
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should serve /health endpoint correctly', async () => {
    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; defaultModel: string };
    expect(data.status).toBe('ok');
    expect(data.defaultModel).toBe('gpt-4o');
  });

  it('should route fast-path greeting to gpt-4o-mini and attach diagnostic headers', async () => {
    let capturedRequestBody: Record<string, unknown> | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedRequestBody = JSON.parse(options.body as string);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello! How can I help?' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 8,
            total_tokens: 18,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello there!' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedRequestBody).not.toBeNull();
    expect(capturedRequestBody!['model']).toBe('gpt-4o-mini');

    expect(res.headers.get('X-EdgeRoute-Matched-Route')).toBe('simple-tasks');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('gpt-4o-mini');
    expect(res.headers.get('X-EdgeRoute-Path')).toBe('fast-path');
    expect(res.headers.get('X-EdgeRoute-Cost-Saved-USD')).toBeTruthy();
  });

  it('should fallback to defaultModel for unmatched complex prompt', async () => {
    let capturedRequestBody: Record<string, unknown> | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedRequestBody = JSON.parse(options.body as string);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-large',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Here is the detailed analysis.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Explain the history of the Byzantine empire in depth',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(capturedRequestBody!['model']).toBe('gpt-4o');
    expect(res.headers.get('X-EdgeRoute-Matched-Route')).toBe('default');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('gpt-4o');
    expect(res.headers.get('X-EdgeRoute-Path')).toBe('fallback');
  });

  it('should retry on 429 rate limit with defaultModel fallback', async () => {
    let attempts = 0;
    const requestedModels: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      attempts++;
      const reqBody = JSON.parse(options.body as string);
      requestedModels.push(reqBody.model);

      if (attempts === 1) {
        // First attempt (gpt-4o-mini) returns 429
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Second attempt fallback (gpt-4o) succeeds
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-fallback',
          choices: [{ message: { role: 'assistant', content: 'Success after fallback' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi there' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
    expect(requestedModels).toEqual(['gpt-4o-mini', 'gpt-4o']);
    expect(res.headers.get('X-EdgeRoute-Path')).toBe('fallback-retry');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('gpt-4o');
  });
});
