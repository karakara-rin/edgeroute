import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectProvider,
  AnthropicAdapter,
  createEdgeRouteServer,
} from '../src/index.js';
import { type EdgeRouteConfig, defineConfig } from '@edgeroute/core';

describe('Provider Detection Heuristics', () => {
  it('should detect Anthropic Claude models', () => {
    expect(detectProvider('claude-fable-5')).toBe('anthropic');
    expect(detectProvider('claude-sonnet-5')).toBe('anthropic');
    expect(detectProvider('claude-haiku-4-5')).toBe('anthropic');
    expect(detectProvider('claude-3-7-sonnet')).toBe('anthropic');
    expect(detectProvider('claude-3-5-haiku-20241022')).toBe('anthropic');
  });

  it('should detect Google Gemini models', () => {
    expect(detectProvider('gemini-3.7-flash')).toBe('gemini');
    expect(detectProvider('gemini-3.6-flash')).toBe('gemini');
    expect(detectProvider('gemini-3.5-flash-lite')).toBe('gemini');
    expect(detectProvider('gemini-2.5-pro')).toBe('gemini');
    expect(detectProvider('gemini-1.5-flash')).toBe('gemini');
  });

  it('should detect Groq open-weights models', () => {
    expect(detectProvider('llama-3.3-70b-versatile')).toBe('groq');
    expect(detectProvider('llama-3.1-8b-instant')).toBe('groq');
    expect(detectProvider('mixtral-8x7b-32768')).toBe('groq');
    expect(detectProvider('deepseek-r1-distill-llama-70b')).toBe('groq');
  });

  it('should detect OpenAI models by default', () => {
    expect(detectProvider('gpt-5.6-sol')).toBe('openai');
    expect(detectProvider('gpt-5.6-terra')).toBe('openai');
    expect(detectProvider('gpt-5.6-luna')).toBe('openai');
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('o3-mini')).toBe('openai');
    expect(detectProvider('unknown-custom-model')).toBe('openai');
  });

  it('should respect explicit provider overrides', () => {
    expect(detectProvider('gpt-4o', 'groq')).toBe('groq');
    expect(detectProvider('custom-hosted', 'anthropic')).toBe('anthropic');
  });
});

describe('Anthropic Adapter Transformation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dummyConfig: EdgeRouteConfig = defineConfig({
    defaultModel: 'gpt-5.6-sol',
    providers: {
      anthropic: {
        apiKey: 'test-anthropic-key',
        baseUrl: 'https://api.anthropic.com/v1',
      },
    },
    routes: [],
  });

  it('transforms OpenAI request format to Anthropic Messages payload and returns OpenAI formatted response', async () => {
    const adapter = new AnthropicAdapter();

    const mockAnthropicResponse = {
      id: 'msg_123456',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'Hello, this is Claude 5!' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 15,
        output_tokens: 25,
      },
    };

    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    let capturedApiKey: string | null = null;
    let capturedVersion: string | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = init?.body ? JSON.parse(init.body as string) : {};
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      capturedApiKey = headers.get('x-api-key');
      capturedVersion = headers.get('anthropic-version');
      return new Response(JSON.stringify(mockAnthropicResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const openAiBody = {
      model: 'claude-sonnet-5',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    };

    const response = await adapter.execute({
      model: 'claude-sonnet-5',
      body: openAiBody,
      clientHeaders: new Headers(),
      config: dummyConfig,
    });

    // Check outgoing Anthropic request
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedApiKey).toBe('test-anthropic-key');
    expect(capturedVersion).toBe('2023-06-01');
    expect(capturedBody['system']).toBe('You are a helpful assistant.');
    expect(capturedBody['messages']).toEqual([{ role: 'user', content: 'Hello!' }]);
    expect(capturedBody['max_tokens']).toBe(1000);
    expect(capturedBody['temperature']).toBe(0.7);

    // Check transformed OpenAI response
    const json = (await response.json()) as {
      object: string;
      model: string;
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(json.object).toBe('chat.completion');
    expect(json.model).toBe('claude-sonnet-5');
    expect(json.choices[0]?.message.content).toBe('Hello, this is Claude 5!');
    expect(json.choices[0]?.finish_reason).toBe('stop');
    expect(json.usage.prompt_tokens).toBe(15);
    expect(json.usage.completion_tokens).toBe(25);
    expect(json.usage.total_tokens).toBe(40);
  });

  it('transforms Anthropic SSE stream to OpenAI compatible SSE stream', async () => {
    const adapter = new AnthropicAdapter();

    const sseEvents = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_1","model":"claude-haiku-4-5"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Fast"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" response"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const evt of sseEvents) {
          controller.enqueue(encoder.encode(evt));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const response = await adapter.execute({
      model: 'claude-haiku-4-5',
      body: {
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      },
      clientHeaders: new Headers(),
      config: dummyConfig,
    });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await response.text();
    expect(text).toContain('data: {"id":"msg_stream_1"');
    expect(text).toContain('"content":"Fast"');
    expect(text).toContain('"content":" response"');
    expect(text).toContain('data: [DONE]');
  });
});

describe('Multi-Provider Proxy Dispatch and Cross-Provider Fallback', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const config: EdgeRouteConfig = defineConfig({
    defaultModel: 'gpt-5.6-sol',
    providers: {
      openai: { apiKey: 'openai-key' },
      anthropic: { apiKey: 'anthropic-key' },
      gemini: { apiKey: 'gemini-key' },
      groq: { apiKey: 'groq-key' },
    },
    routes: [
      {
        name: 'claude-route',
        targetModel: 'claude-sonnet-5',
        rules: { patterns: [/claude/i] },
      },
      {
        name: 'gemini-route',
        targetModel: 'gemini-3.7-flash',
        rules: { patterns: [/gemini/i] },
      },
      {
        name: 'groq-route',
        targetModel: 'llama-3.3-70b-versatile',
        rules: { patterns: [/groq/i] },
      },
    ],
  });

  it('routes and sets X-EdgeRoute-Provider header for Anthropic', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (url.toString().includes('anthropic.com')) {
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            content: [{ type: 'text', text: 'Anthropic Output' }],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'use claude please' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-EdgeRoute-Matched-Route')).toBe('claude-route');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('claude-sonnet-5');
    expect(res.headers.get('X-EdgeRoute-Provider')).toBe('anthropic');
  });

  it('routes and sets X-EdgeRoute-Provider header for Gemini', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (url.toString().includes('googleapis.com')) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-gemini-1',
            choices: [{ message: { role: 'assistant', content: 'Gemini Output' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'use gemini please' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-EdgeRoute-Matched-Route')).toBe('gemini-route');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('gemini-3.7-flash');
    expect(res.headers.get('X-EdgeRoute-Provider')).toBe('gemini');
  });

  it('performs cross-provider failover when target provider returns 429 rate limit', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      // Anthropic returns 429 rate limit
      if (url.toString().includes('anthropic.com')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // OpenAI default fallback succeeds
      if (url.toString().includes('openai.com')) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-fallback',
            choices: [{ message: { role: 'assistant', content: 'Fallback from OpenAI GPT-5.6' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const { app } = await createEdgeRouteServer(config);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'use claude please' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-EdgeRoute-Path')).toBe('fallback-retry');
    expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe('gpt-5.6-sol');
    expect(res.headers.get('X-EdgeRoute-Provider')).toBe('openai');
  });
});
