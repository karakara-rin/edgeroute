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

  it('should isolate cache entries with different system prompts to prevent cache collision', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      upstreamCallCount++;
      const body = JSON.parse(init.body as string);
      const isLawyer = body.messages.some((m: any) => m.content.includes('lawyer'));
      return new Response(
        JSON.stringify({
          id: `chatcmpl-${upstreamCallCount}`,
          choices: [
            {
              message: {
                role: 'assistant',
                content: isLawyer ? 'Legal perspective.' : 'Casual perspective.',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);

    // Request A: System prompt "lawyer", User prompt "What is a contract?"
    const resA = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a legal expert lawyer.' },
          { role: 'user', content: 'What is a contract?' },
        ],
      }),
    });
    expect(resA.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    const jsonA = await resA.json();
    expect(jsonA.choices[0].message.content).toBe('Legal perspective.');
    expect(upstreamCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 50));

    // Request B: System prompt "pirate", User prompt SAME "What is a contract?"
    const resB = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a friendly pirate companion.' },
          { role: 'user', content: 'What is a contract?' },
        ],
      }),
    });

    // Must be a MISS and NOT return the cached lawyer response!
    expect(resB.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    const jsonB = await resB.json();
    expect(jsonB.choices[0].message.content).toBe('Casual perspective.');
    expect(upstreamCallCount).toBe(2);
  });

  it('should isolate cache entries for multi-turn conversations with different history', async () => {
    let upstreamCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      upstreamCallCount++;
      const body = JSON.parse(init.body as string);
      const isTokyo = body.messages.some((m: any) => m.content?.includes('Tokyo'));
      return new Response(
        JSON.stringify({
          id: `chatcmpl-turn-${upstreamCallCount}`,
          choices: [
            {
              message: {
                role: 'assistant',
                content: isTokyo ? 'Tokyo population is ~14 million.' : 'Paris population is ~2 million.',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const { app } = await createEdgeRouteServer(config);

    // Multi-turn conversation 1 about Tokyo
    const res1 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Tell me about Tokyo' },
          { role: 'assistant', content: 'Tokyo is the capital of Japan.' },
          { role: 'user', content: 'What is its population?' },
        ],
      }),
    });
    expect(res1.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    const json1 = await res1.json();
    expect(json1.choices[0].message.content).toBe('Tokyo population is ~14 million.');
    expect(upstreamCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 50));

    // Multi-turn conversation 2 about Paris, where the last message is identical: "What is its population?"
    const res2 = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Tell me about Paris' },
          { role: 'assistant', content: 'Paris is the capital of France.' },
          { role: 'user', content: 'What is its population?' },
        ],
      }),
    });

    // Must be a MISS because previous dialogue context differs
    expect(res2.headers.get('X-EdgeRoute-Cache')).toBe('MISS');
    const json2 = await res2.json();
    expect(json2.choices[0].message.content).toBe('Paris population is ~2 million.');
    expect(upstreamCallCount).toBe(2);
  });
});
