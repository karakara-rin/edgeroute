import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardChatCompletion } from '../src/proxy.js';
import { createSafeStream } from '../src/streaming.js';
import { createRouterRoutes } from '../src/routes.js';
import { EdgeRouteEngine, defineConfig } from '@edgeroute/core';

describe('Reliability & Error Handling Tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('forwardChatCompletion Fallback', () => {
    it('should retry with defaultModel when primary returns 429', async () => {
      const config = defineConfig({
        defaultModel: 'gpt-4o-mini',
        routes: [
          {
            name: 'fast',
            targetModel: 'llama-3.3-70b-versatile',
            examples: ['Fast task'],
          },
        ],
        maxRetries: 1,
      });

      // Mock fetch
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
          return originalFetch(url, init);
        }
        callCount++;
        if (callCount === 1) {
          // Primary llama fails with 429
          return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        // Fallback gpt-4o-mini succeeds
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-fallback',
            choices: [{ message: { role: 'assistant', content: 'Fallback success' } }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await forwardChatCompletion({
        model: 'llama-3.3-70b-versatile',
        body: { messages: [{ role: 'user', content: 'Hello' }] },
        clientHeaders: new Headers(),
        config,
      });

      expect(result.retriedWithFallback).toBe(true);
      expect(result.actualModel).toBe('gpt-4o-mini');
      expect(result.response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should fallback to defaultModel when primary throws network exception', async () => {
      const config = defineConfig({
        defaultModel: 'gpt-4o-mini',
        routes: [],
        maxRetries: 1,
      });

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
          return originalFetch(url, init);
        }
        callCount++;
        if (callCount === 1) {
          throw new Error('Connection reset by peer');
        }
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-fallback-net',
            choices: [{ message: { role: 'assistant', content: 'Network recovery' } }],
          }),
          { status: 200 },
        );
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await forwardChatCompletion({
        model: 'llama-3.3-70b-versatile',
        body: { messages: [{ role: 'user', content: 'Hello' }] },
        clientHeaders: new Headers(),
        config,
      });

      expect(result.retriedWithFallback).toBe(true);
      expect(result.actualModel).toBe('gpt-4o-mini');
      expect(result.response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('Mid-Stream Error Handling (createSafeStream)', () => {
    it('should inject SSE error payload and close gracefully when stream throws mid-way', async () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // Create a faulty stream that emits 1 chunk and throws
      const faultyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        },
        pull() {
          throw new Error('Mid-stream connection abort');
        },
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const safeStream = createSafeStream(faultyStream, 'gpt-4o');
      const reader = safeStream.getReader();

      let chunks = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += decoder.decode(value, { stream: true });
      }

      expect(chunks).toContain('data: {"choices":[{"delta":{"content":"Hi"}}]}');
      expect(chunks).toContain('"stream_error"');
      expect(chunks).toContain('Mid-stream connection abort');
      expect(chunks).toContain('data: [DONE]');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('Non-JSON Response Handling in Routes', () => {
    it('should keep raw Response and log warning without crashing when JSON parsing fails', async () => {
      const config = defineConfig({
        defaultModel: 'gpt-4o-mini',
        routes: [],
      });
      const engine = new EdgeRouteEngine(config);
      await engine.initialize();
      const app = createRouterRoutes(config, engine);

      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('huggingface.co') || urlStr.includes('.onnx')) {
          return originalFetch(url, init);
        }
        return new Response('<html>502 Bad Gateway</html>', {
          status: 200, // Even if status is 200 with HTML body
          headers: { 'content-type': 'text/html' },
        });
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('<html>502 Bad Gateway</html>');
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
