import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEdgeRouteServer } from '../src/index.js';
import type { EdgeRouteConfigInput } from '@edgeroute/core';

describe('Server Semantic Cache Layer', () => {
  const config: EdgeRouteConfigInput = {
    defaultModel: 'gpt-4o',
    routes: [
      {
        name: 'simple-tasks',
        targetModel: 'gpt-4o-mini',
        threshold: 0.6,
        examples: ['Explain photosynthesis', 'How does photosynthesis work?'],
      },
    ],
    embedding: {
      provider: 'local',
    },
    cache: {
      enabled: true,
      threshold: 0.9,
      ttl: 3600,
      maxEntries: 50,
    },
    providers: {
      openai: {
        apiKey: 'test-key',
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

  it('should MISS on first request, save to cache, and HIT on second similar request', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      upstreamCallCount++;
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-1',
          object: 'chat.completion',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Photosynthesis is the process by which green plants create food.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 15, total_tokens: 27 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);

    // 1st request: Cache MISS
    const res1 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Explain photosynthesis in simple terms' }],
      }),
    });

    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    expect(upstreamCallCount).toBe(1);

    // Allow async cache save tick
    await new Promise((r) => setTimeout(r, 50));

    // 2nd request: Cache HIT (Exact or near-identical prompt)
    const res2 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Explain photosynthesis in simple terms' }],
      }),
    });

    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-EdgeRoute-Cache')).toBe('HIT');
    expect(res2.headers.get('X-EdgeRoute-Target-Model')).toBe('gpt-4o-mini');
    expect(Number(res2.headers.get('X-EdgeRoute-Score'))).toBeGreaterThanOrEqual(0.9);
    expect(res2.headers.get('X-EdgeRoute-Cost-Saved-USD')).toBeTruthy();
    expect(res2.headers.get('X-EdgeRoute-Cost-Saved-Percent')).toBe('100%');

    // Upstream LLM should NOT have been called again
    expect(upstreamCallCount).toBe(1);

    const body2 = (await res2.json()) as { choices: Array<{ message: { content: string } }> };
    expect(body2.choices[0]?.message.content).toContain('Photosynthesis is the process');
  });

  it('should stream cached responses as OpenAI SSE chunks when stream: true', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      upstreamCallCount++;
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-cached-src',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello streaming cached world!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);

    // Warm cache with initial non-stream request
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Test stream cache warm prompt' }],
      }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(upstreamCallCount).toBe(1);

    // Stream request hitting cache
    const streamRes = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Test stream cache warm prompt' }],
        stream: true,
      }),
    });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('X-EdgeRoute-Cache')).toBe('HIT');
    expect(streamRes.headers.get('Content-Type')).toContain('text/event-stream');
    expect(upstreamCallCount).toBe(1); // No new upstream call

    const text = await streamRes.text();
    expect(text).toContain('data:');
    expect(text).toContain('[DONE]');
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('Hello');
  });

  it('should capture upstream SSE streams and cache for subsequent hits', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      upstreamCallCount++;
      const encoder = new TextEncoder();
      const ssePayload = [
        'data: {"id":"chatcmpl-stream-1","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"Streamed "}}]}\n\n',
        'data: {"id":"chatcmpl-stream-1","object":"chat.completion.chunk","choices":[{"delta":{"content":"response text."}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(encoder.encode(ssePayload), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const { app } = await createEdgeRouteServer(config);

    // Initial streaming request (MISS)
    const streamRes1 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Stream and cache me please' }],
        stream: true,
      }),
    });

    expect(streamRes1.status).toBe(200);
    expect(streamRes1.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    const text1 = await streamRes1.text();
    expect(text1).toContain('Streamed ');
    expect(text1).toContain('response text.');
    expect(upstreamCallCount).toBe(1);

    // Allow background stream reader to finish caching
    await new Promise((r) => setTimeout(r, 100));

    // Follow-up non-streaming request (HIT)
    const res2 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Stream and cache me please' }],
      }),
    });

    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-EdgeRoute-Cache')).toBe('HIT');
    expect(upstreamCallCount).toBe(1);

    const body2 = (await res2.json()) as { choices: Array<{ message: { content: string } }> };
    expect(body2.choices[0]?.message.content).toBe('Streamed response text.');
  });

  it('should BYPASS cache lookup when Cache-Control: no-cache header is provided', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      upstreamCallCount++;
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-bypass',
          choices: [{ message: { role: 'assistant', content: 'Fresh upstream response' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);

    // Warm cache first
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Bypass test prompt' }],
      }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(upstreamCallCount).toBe(1);

    // Request with Cache-Control: no-cache
    const bypassRes = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Bypass test prompt' }],
      }),
    });

    expect(bypassRes.status).toBe(200);
    expect(bypassRes.headers.get('X-EdgeRoute-Cache')).toBe('BYPASS');
    expect(upstreamCallCount).toBe(2); // Upstream was queried again
  });

  it('should SKIP cache when temperature exceeds maxTemperature guardrail', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      upstreamCallCount++;
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-temp-test',
          choices: [{ message: { role: 'assistant', content: 'Creative output' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const tempConfig: EdgeRouteConfigInput = {
      ...config,
      cache: {
        enabled: true,
        threshold: 0.9,
        maxTemperature: 0.2, // Only cache deterministic temperature <= 0.2
      },
    };

    const { app } = await createEdgeRouteServer(tempConfig);

    // High temperature request (creative)
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Write a poem about the sea' }],
        temperature: 0.9,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-EdgeRoute-Cache')).toBe('SKIPPED');
    expect(upstreamCallCount).toBe(1);
  });
});
