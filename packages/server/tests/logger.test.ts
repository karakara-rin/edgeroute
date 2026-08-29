import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerLogger } from '../src/logger.js';
import { createEdgeRouteServer } from '../src/index.js';
import { defineConfig } from '@edgeroute/core';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, '');
}

describe('ServerLogger Unit & Integration Tests', () => {
  it('should correctly format status codes with picocolors', () => {
    const logger = new ServerLogger({ enabled: true });

    const status200 = logger.formatStatus(200);
    const status429 = logger.formatStatus(429);
    const status500 = logger.formatStatus(500);

    expect(status200).toContain('200');
    expect(status429).toContain('429');
    expect(status500).toContain('500');
  });

  it('should correctly format cache hit badge and saved cost', () => {
    const logger = new ServerLogger({ enabled: true });
    const formatted = logger.formatCacheHit(0.3, 0.005);
    const clean = stripAnsi(formatted);

    expect(clean).toContain('[HIT ⚡ 0.3ms]');
    expect(clean).toContain('Semantic Cache Hit, Saved $0.0050');
  });

  it('should correctly format route decision badge and saved cost vs default model', () => {
    const logger = new ServerLogger({ enabled: true });
    const formatted = logger.formatRoute('simple-qa', 'gpt-4o-mini', 'gpt-4o', 0.0042);
    const clean = stripAnsi(formatted);

    expect(clean).toContain('[ROUTE 🎯]');
    expect(clean).toContain('"simple-qa"');
    expect(clean).toContain('gpt-4o-mini');
    expect(clean).toContain('Saved $0.0042 vs gpt-4o');
  });

  it('should correctly format fallback badge', () => {
    const logger = new ServerLogger({ enabled: true });
    const formatted = logger.formatFallback(429, 'gpt-4o');
    const clean = stripAnsi(formatted);

    expect(clean).toContain('[FALLBACK 🛡️]');
    expect(clean).toContain('Primary model 429 -> Fallback to defaultModel (gpt-4o)');
  });

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '4' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should log rich request details when enabled on proxy completion', async () => {
    const logs: string[] = [];
    const customWriter = (msg: string) => logs.push(msg);

    const config = defineConfig({
      defaultModel: 'gpt-4o',
      providers: {
        openai: { apiKey: 'test-key' },
      },
      routes: [
        {
          name: 'simple-qa',
          targetModel: 'gpt-4o-mini',
          threshold: 0.7,
          examples: ['What is 2+2?'],
        },
      ],
    });

    const logger = new ServerLogger({ enabled: true, writer: customWriter });
    const { app } = await createEdgeRouteServer(config, { logger });

    const mockRequest = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      }),
    });

    const res = await app.fetch(mockRequest);
    expect(res.status).toBe(200);

    expect(logs.length).toBeGreaterThan(0);
    const combinedLog = stripAnsi(logs.join('\n'));
    expect(combinedLog).toContain('POST /v1/chat/completions');
    expect(combinedLog).toContain('200');
    expect(combinedLog).toContain('[ROUTE 🎯]');
    expect(combinedLog).toContain('"simple-qa"');
    expect(combinedLog).toContain('gpt-4o-mini');
  });

  it('should log cache hit when prompt is served from semantic cache', async () => {
    const logs: string[] = [];
    const customWriter = (msg: string) => logs.push(msg);

    const config = defineConfig({
      defaultModel: 'gpt-4o',
      providers: { openai: { apiKey: 'test-key' } },
      cache: { enabled: true, threshold: 0.9 },
      routes: [
        {
          name: 'simple-qa',
          targetModel: 'gpt-4o-mini',
          threshold: 0.7,
          examples: ['Tell me the capital of France'],
        },
      ],
    });

    const logger = new ServerLogger({ enabled: true, writer: customWriter });
    const { app } = await createEdgeRouteServer(config, { logger });

    const req1 = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Tell me the capital of France' }],
      }),
    });

    const res1 = await app.fetch(req1);
    expect(res1.status).toBe(200);

    // Wait a brief moment for async cache storage
    await new Promise((r) => setTimeout(r, 50));

    // Clear logs for the second request
    logs.length = 0;

    const req2 = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Tell me the capital of France' }],
      }),
    });

    const res2 = await app.fetch(req2);
    expect(res2.status).toBe(200);

    const combinedLog = stripAnsi(logs.join('\n'));
    expect(combinedLog).toContain('[HIT ⚡');
    expect(combinedLog).toContain('Semantic Cache Hit, Saved $');
  });

  it('should log fallback retry when primary model fails', async () => {
    const logs: string[] = [];
    const customWriter = (msg: string) => logs.push(msg);

    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-fb',
          model: 'gpt-4o',
          choices: [{ message: { role: 'assistant', content: 'Fallback response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const config = defineConfig({
      defaultModel: 'gpt-4o',
      providers: { openai: { apiKey: 'test-key' } },
      routes: [
        {
          name: 'simple-qa',
          targetModel: 'gpt-4o-mini',
          threshold: 0.7,
          rules: { patterns: [/^(hello|hi)/i] },
        },
      ],
    });

    const logger = new ServerLogger({ enabled: true, writer: customWriter });
    const { app } = await createEdgeRouteServer(config, { logger });

    const mockRequest = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    const res = await app.fetch(mockRequest);
    expect(res.status).toBe(200);

    const combinedLog = stripAnsi(logs.join('\n'));
    expect(combinedLog).toContain('[FALLBACK 🛡️]');
    expect(combinedLog).toContain('Primary model 429 -> Fallback to defaultModel (gpt-4o)');
  });

  it('should respect silent / disabled logging when enabled is false', async () => {
    const logs: string[] = [];
    const customWriter = (msg: string) => logs.push(msg);

    const config = defineConfig({
      defaultModel: 'gpt-4o',
      providers: { openai: { apiKey: 'test-key' } },
      routes: [],
    });

    const logger = new ServerLogger({ enabled: false, writer: customWriter });
    const { app } = await createEdgeRouteServer(config, { logger });

    const mockRequest = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello world' }],
      }),
    });

    const res = await app.fetch(mockRequest);
    expect(res.status).toBe(200);
    expect(logs.length).toBe(0);
  });
});
