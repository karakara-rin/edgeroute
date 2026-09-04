import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sanitizeOpenAICompatiblePayload,
  GeminiAdapter,
  GroqAdapter,
  OllamaAdapter,
  DeepSeekAdapter,
  OpenAIAdapter,
} from '../src/providers/index.js';
import { defineConfig, type EdgeRouteConfig } from '@edgeroute/core';

describe('Cross-Provider Parameter Sanitizer & Schema Normalizer', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dummyConfig: EdgeRouteConfig = defineConfig({
    defaultModel: 'gpt-4o',
    providers: {
      gemini: { apiKey: 'test-gemini-key' },
      groq: { apiKey: 'test-groq-key' },
      ollama: { baseUrl: 'http://localhost:11434/v1' },
      deepseek: { apiKey: 'test-deepseek-key' },
      openai: { apiKey: 'test-openai-key' },
    },
    routes: [],
  });

  describe('sanitizeOpenAICompatiblePayload unit tests', () => {
    it('normalizes max_completion_tokens to max_tokens and strips max_completion_tokens', () => {
      const payload = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
        max_completion_tokens: 1024,
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload);
      expect(sanitized.max_tokens).toBe(1024);
      expect(sanitized.max_completion_tokens).toBeUndefined();
    });

    it('does not overwrite existing max_tokens with max_completion_tokens', () => {
      const payload = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 256,
        max_completion_tokens: 1024,
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload);
      expect(sanitized.max_tokens).toBe(256);
      expect(sanitized.max_completion_tokens).toBeUndefined();
    });

    it('strips OpenAI proprietary fields (store, metadata, service_tier, prediction, modalities, audio)', () => {
      const payload = {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'hello' }],
        store: true,
        metadata: { user_id: 'user_123', project: 'agent_task' },
        service_tier: 'default',
        prediction: { type: 'content', content: 'test' },
        modalities: ['text'],
        audio: { voice: 'alloy', format: 'wav' },
        temperature: 0.7,
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload);
      expect(sanitized.store).toBeUndefined();
      expect(sanitized.metadata).toBeUndefined();
      expect(sanitized.service_tier).toBeUndefined();
      expect(sanitized.prediction).toBeUndefined();
      expect(sanitized.modalities).toBeUndefined();
      expect(sanitized.audio).toBeUndefined();
      expect(sanitized.temperature).toBe(0.7);
    });

    it('strips strict flag and $schema from tool function declarations', () => {
      const payload = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'execute_sql',
              description: 'Execute read-only SQL query',
              strict: true,
              parameters: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    $schema: 'http://json-schema.org/draft-07/schema#',
                  },
                },
                required: ['query'],
              },
            },
          },
        ],
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload, {
        stripToolStrict: true,
        sanitizeToolParameters: true,
      });

      const tools = sanitized.tools as Array<{
        type: string;
        function: { strict?: boolean; parameters: Record<string, unknown> };
      }>;
      expect(tools[0].function.strict).toBeUndefined();
      expect(tools[0].function.parameters.$schema).toBeUndefined();
      expect(
        (tools[0].function.parameters.properties as Record<string, unknown>)
          .query,
      ).toEqual({ type: 'string' });
    });

    it('strips strict flag from response_format json_schema', () => {
      const payload = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'output json' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'person',
            strict: true,
            schema: { type: 'object' },
          },
        },
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload);
      const rf = sanitized.response_format as {
        type: string;
        json_schema: { strict?: boolean };
      };
      expect(rf.json_schema.strict).toBeUndefined();
    });

    it('strips parallel_tool_calls when stripParallelToolCalls is enabled', () => {
      const payload = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
        parallel_tool_calls: false,
      };

      const sanitized = sanitizeOpenAICompatiblePayload(payload, {
        stripParallelToolCalls: true,
      });
      expect(sanitized.parallel_tool_calls).toBeUndefined();
    });
  });

  describe('GeminiAdapter parameter sanitization', () => {
    it('automatically sanitizes payload before dispatching to Google OpenAI endpoint', async () => {
      const adapter = new GeminiAdapter();

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'gemini-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await adapter.execute({
        model: 'gemini-2.5-flash',
        body: {
          messages: [{ role: 'user', content: 'Check DB' }],
          max_completion_tokens: 2048,
          store: true,
          metadata: { session_id: 's_999' },
          parallel_tool_calls: false,
          tools: [
            {
              type: 'function',
              function: {
                name: 'fetch_data',
                strict: true,
                parameters: {
                  $schema: 'http://json-schema.org/schema',
                  type: 'object',
                },
              },
            },
          ],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedBody.max_tokens).toBe(2048);
      expect(capturedBody.max_completion_tokens).toBeUndefined();
      expect(capturedBody.store).toBeUndefined();
      expect(capturedBody.metadata).toBeUndefined();
      expect(capturedBody.parallel_tool_calls).toBeUndefined();

      const tools = capturedBody.tools as Array<{
        type: string;
        function: { strict?: boolean; parameters: Record<string, unknown> };
      }>;
      expect(tools[0].function.strict).toBeUndefined();
      expect(tools[0].function.parameters.$schema).toBeUndefined();
    });
  });

  describe('GroqAdapter parameter sanitization', () => {
    it('automatically sanitizes payload before dispatching to Groq endpoint', async () => {
      const adapter = new GroqAdapter();

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'groq-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await adapter.execute({
        model: 'llama-3.3-70b-versatile',
        body: {
          messages: [{ role: 'user', content: 'Translate this' }],
          max_completion_tokens: 512,
          service_tier: 'flex',
          tools: [
            {
              type: 'function',
              function: {
                name: 'translate',
                strict: true,
                parameters: { type: 'object' },
              },
            },
          ],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedBody.max_tokens).toBe(512);
      expect(capturedBody.max_completion_tokens).toBeUndefined();
      expect(capturedBody.service_tier).toBeUndefined();

      const tools = capturedBody.tools as Array<{
        type: string;
        function: { strict?: boolean };
      }>;
      expect(tools[0].function.strict).toBeUndefined();
    });
  });

  describe('OpenAIAdapter preserves native fields', () => {
    it('does not strip proprietary parameters when sending to genuine OpenAI endpoint', async () => {
      const adapter = new OpenAIAdapter();

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'openai-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await adapter.execute({
        model: 'o3-mini',
        body: {
          messages: [{ role: 'user', content: 'Complex logic' }],
          max_completion_tokens: 4096,
          store: true,
          metadata: { agent: 'orchestrator' },
          tools: [
            {
              type: 'function',
              function: {
                name: 'solve',
                strict: true,
                parameters: { type: 'object' },
              },
            },
          ],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      // Genuine OpenAI endpoint must receive all modern fields intact
      expect(capturedBody.max_completion_tokens).toBe(4096);
      expect(capturedBody.store).toBe(true);
      expect(capturedBody.metadata).toEqual({ agent: 'orchestrator' });
      const tools = capturedBody.tools as Array<{
        type: string;
        function: { strict?: boolean };
      }>;
      expect(tools[0].function.strict).toBe(true);
    });
  });

  describe('OllamaAdapter & DeepSeekAdapter stripModelPrefix and sanitization', () => {
    it('strips ollama/ prefix and sanitizes parameters', async () => {
      const adapter = new OllamaAdapter();

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'ollama-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await adapter.execute({
        model: 'ollama/llama3.2',
        body: {
          messages: [{ role: 'user', content: 'hello' }],
          max_completion_tokens: 128,
          store: true,
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedBody.model).toBe('llama3.2');
      expect(capturedBody.max_tokens).toBe(128);
      expect(capturedBody.max_completion_tokens).toBeUndefined();
      expect(capturedBody.store).toBeUndefined();
    });

    it('strips deepseek/ prefix and sanitizes parameters', async () => {
      const adapter = new DeepSeekAdapter();

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'deepseek-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await adapter.execute({
        model: 'deepseek/deepseek-chat',
        body: {
          messages: [{ role: 'user', content: 'hello' }],
          max_completion_tokens: 256,
          prediction: { type: 'content', content: 'abc' },
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedBody.model).toBe('deepseek-chat');
      expect(capturedBody.max_tokens).toBe(256);
      expect(capturedBody.max_completion_tokens).toBeUndefined();
      expect(capturedBody.prediction).toBeUndefined();
    });
  });
});
