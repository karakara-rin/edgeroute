import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnthropicAdapter,
  GeminiAdapter,
  GroqAdapter,
  createEdgeRouteServer,
} from '../src/index.js';
import { type EdgeRouteConfig, defineConfig } from '@edgeroute/core';

describe('Tool Calling (Function Calling) Bidirectional Conversion', () => {
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
      gemini: {
        apiKey: 'test-gemini-key',
      },
      groq: {
        apiKey: 'test-groq-key',
      },
    },
    routes: [],
  });

  describe('OpenAI to Anthropic Request Transformation', () => {
    it('converts OpenAI tools and tool_choice to Anthropic format', () => {
      const adapter = new AnthropicAdapter();

      const openAiBody = {
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_current_weather',
              description: 'Get current weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
                },
                required: ['location'],
              },
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: 'get_current_weather' },
        },
      };

      const { anthropicPayload } = adapter.transformRequest(
        'claude-sonnet-5',
        openAiBody,
      );

      // Verify tools conversion
      expect(anthropicPayload.tools).toEqual([
        {
          name: 'get_current_weather',
          description: 'Get current weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      ]);

      // Verify tool_choice conversion
      expect(anthropicPayload.tool_choice).toEqual({
        type: 'tool',
        name: 'get_current_weather',
      });
    });

    it('handles tool_choice auto and required (any)', () => {
      const adapter = new AnthropicAdapter();

      const { anthropicPayload: payloadAuto } = adapter.transformRequest(
        'claude-sonnet-5',
        {
          messages: [{ role: 'user', content: 'Hi' }],
          tools: [
            {
              type: 'function',
              function: { name: 'tool_a', parameters: { type: 'object' } },
            },
          ],
          tool_choice: 'auto',
        },
      );
      expect(payloadAuto.tool_choice).toEqual({ type: 'auto' });

      const { anthropicPayload: payloadRequired } = adapter.transformRequest(
        'claude-sonnet-5',
        {
          messages: [{ role: 'user', content: 'Hi' }],
          tools: [
            {
              type: 'function',
              function: { name: 'tool_a', parameters: { type: 'object' } },
            },
          ],
          tool_choice: 'required',
        },
      );
      expect(payloadRequired.tool_choice).toEqual({ type: 'any' });
    });

    it('transforms multi-turn conversation with assistant tool_calls and tool results', () => {
      const adapter = new AnthropicAdapter();

      const openAiBody = {
        model: 'claude-sonnet-5',
        messages: [
          { role: 'user', content: 'Compare weather in Tokyo and Paris' },
          {
            role: 'assistant',
            content: 'Let me look that up for you.',
            tool_calls: [
              {
                id: 'call_tokyo_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ city: 'Tokyo' }),
                },
              },
              {
                id: 'call_paris_2',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ city: 'Paris' }),
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_tokyo_1',
            content: JSON.stringify({ temp: 22, condition: 'Sunny' }),
          },
          {
            role: 'tool',
            tool_call_id: 'call_paris_2',
            content: JSON.stringify({ temp: 16, condition: 'Rainy' }),
          },
        ],
      };

      const { anthropicPayload } = adapter.transformRequest(
        'claude-sonnet-5',
        openAiBody,
      );
      const messages = anthropicPayload.messages as Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;

      // Check alternating user/assistant count
      expect(messages.length).toBe(3);

      // 1. Initial user message
      expect(messages[0]!.role).toBe('user');
      expect(messages[0]!.content).toBe('Compare weather in Tokyo and Paris');

      // 2. Assistant message with text + 2 tool_use blocks
      expect(messages[1]!.role).toBe('assistant');
      expect(messages[1]!.content).toEqual([
        { type: 'text', text: 'Let me look that up for you.' },
        {
          type: 'tool_use',
          id: 'call_tokyo_1',
          name: 'get_weather',
          input: { city: 'Tokyo' },
        },
        {
          type: 'tool_use',
          id: 'call_paris_2',
          name: 'get_weather',
          input: { city: 'Paris' },
        },
      ]);

      // 3. User message merging consecutive tool results into a single turn
      expect(messages[2]!.role).toBe('user');
      expect(messages[2]!.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'call_tokyo_1',
          content: '{"temp":22,"condition":"Sunny"}',
        },
        {
          type: 'tool_result',
          tool_use_id: 'call_paris_2',
          content: '{"temp":16,"condition":"Rainy"}',
        },
      ]);
    });
  });

  describe('Anthropic to OpenAI Response Transformation', () => {
    it('transforms non-streaming Anthropic tool_use response to OpenAI tool_calls format', async () => {
      const adapter = new AnthropicAdapter();

      const mockAnthropicResponse = {
        id: 'msg_tool_resp_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          { type: 'text', text: 'Checking the weather right now.' },
          {
            type: 'tool_use',
            id: 'toolu_abc123',
            name: 'get_weather',
            input: { location: 'Tokyo', unit: 'celsius' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 30, output_tokens: 45 },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockAnthropicResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const response = await adapter.execute({
        model: 'claude-sonnet-5',
        body: {
          messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
          tools: [
            {
              type: 'function',
              function: { name: 'get_weather', parameters: { type: 'object' } },
            },
          ],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        id: string;
        choices: Array<{
          finish_reason: string;
          message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      expect(json.id).toBe('msg_tool_resp_123');
      expect(json.choices[0]!.finish_reason).toBe('tool_calls');
      expect(json.choices[0]!.message.role).toBe('assistant');
      expect(json.choices[0]!.message.content).toBe(
        'Checking the weather right now.',
      );
      expect(json.choices[0]!.message.tool_calls).toEqual([
        {
          id: 'toolu_abc123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'Tokyo', unit: 'celsius' }),
          },
        },
      ]);
    });

    it('transforms SSE streaming Anthropic tool_use delta to OpenAI tool_calls stream', async () => {
      const adapter = new AnthropicAdapter();

      const sseEvents = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_tool","model":"claude-3-7-sonnet"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_live_1","name":"get_stock_price","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sym"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"bol\\":\\"GOOG\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":18}}\n\n',
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
        model: 'claude-3-7-sonnet',
        body: {
          messages: [{ role: 'user', content: 'What is GOOG stock price?' }],
          stream: true,
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_stock_price',
                parameters: { type: 'object' },
              },
            },
          ],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      const text = await response.text();

      // Verify tool_calls chunks exist in stream
      expect(text).toContain('data: {"id":"msg_stream_tool"');
      expect(text).toContain('"name":"get_stock_price"');
      expect(text).toContain('"arguments":"{\\"sym"');
      expect(text).toContain('"arguments":"bol\\":\\"GOOG\\"}"');
      expect(text).toContain('"finish_reason":"tool_calls"');
      expect(text).toContain('data: [DONE]');
    });
  });

  describe('Structured Outputs & JSON Mode Transformation', () => {
    it('injects system prompt instruction when response_format is json_object', () => {
      const adapter = new AnthropicAdapter();

      const { anthropicPayload } = adapter.transformRequest(
        'claude-sonnet-5',
        {
          messages: [
            { role: 'system', content: 'You are an analytics assistant.' },
            { role: 'user', content: 'Generate user summary data.' },
          ],
          response_format: { type: 'json_object' },
        },
      );

      expect(anthropicPayload.system).toContain(
        'You are an analytics assistant.',
      );
      expect(anthropicPayload.system).toContain('valid JSON object');
    });

    it('transforms response_format json_schema to forced tool calling and unpacks non-streaming response', async () => {
      const adapter = new AnthropicAdapter();

      const userSchema = {
        name: 'user_profile',
        description: 'Extract user profile',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      };

      const mockAnthropicResponse = {
        id: 'msg_structured_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_struct_1',
            name: 'user_profile',
            input: { name: 'Alice', age: 28 },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 15 },
      };

      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(mockAnthropicResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const response = await adapter.execute({
        model: 'claude-sonnet-5',
        body: {
          messages: [
            {
              role: 'user',
              content: 'Extract: Alice is 28 years old.',
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: userSchema,
          },
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      // Verify outgoing request forced synthetic tool
      expect(capturedBody.tools).toEqual([
        {
          name: 'user_profile',
          description: 'Extract user profile',
          input_schema: userSchema.schema,
        },
      ]);
      expect(capturedBody.tool_choice).toEqual({
        type: 'tool',
        name: 'user_profile',
      });

      // Verify transformed OpenAI response unpacked tool input into message.content with finish_reason: 'stop'
      const json = (await response.json()) as {
        choices: Array<{
          finish_reason: string;
          message: { role: string; content: string; tool_calls?: unknown };
        }>;
      };

      expect(json.choices[0]!.finish_reason).toBe('stop');
      expect(json.choices[0]!.message.tool_calls).toBeUndefined();
      expect(JSON.parse(json.choices[0]!.message.content)).toEqual({
        name: 'Alice',
        age: 28,
      });
    });

    it('transforms response_format json_schema into SSE stream of content deltas', async () => {
      const adapter = new AnthropicAdapter();

      const userSchema = {
        name: 'user_profile',
        schema: { type: 'object' },
      };

      const sseEvents = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_struct","model":"claude-3-7-sonnet"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_schema_1","name":"user_profile","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\":\\"Alice\\","}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"age\\":28}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}\n\n',
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
        model: 'claude-3-7-sonnet',
        body: {
          messages: [{ role: 'user', content: 'Alice 28' }],
          stream: true,
          response_format: {
            type: 'json_schema',
            json_schema: userSchema,
          },
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      const text = await response.text();
      // Should stream JSON into `content` (not tool_calls)
      expect(text).toContain('{"content":"{\\"name\\":\\"Alice\\","}');
      expect(text).toContain('{"content":"\\"age\\":28}"}');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text).toContain('data: [DONE]');
    });
  });

  describe('Gemini and Groq Pass-Through', () => {
    it('forwards tools and response_format to Gemini OpenAI endpoint', async () => {
      const adapter = new GeminiAdapter();

      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};
      let capturedHeaders: Headers | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        capturedHeaders = new Headers(init?.headers as HeadersInit | undefined);
        return new Response(JSON.stringify({ id: 'gemini-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const toolDef = {
        type: 'function' as const,
        function: { name: 'search', parameters: { type: 'object' } },
      };

      await adapter.execute({
        model: 'gemini-3.7-flash',
        body: {
          messages: [{ role: 'user', content: 'Search docs' }],
          tools: [toolDef],
          tool_choice: 'auto',
          response_format: { type: 'json_object' },
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedUrl).toContain('googleapis.com');
      expect(capturedHeaders?.get('x-goog-api-key')).toBe('test-gemini-key');
      expect(capturedBody.model).toBe('gemini-3.7-flash');
      expect(capturedBody.tools).toEqual([toolDef]);
      expect(capturedBody.tool_choice).toBe('auto');
      expect(capturedBody.response_format).toEqual({ type: 'json_object' });
    });

    it('forwards tools to Groq OpenAI endpoint', async () => {
      const adapter = new GroqAdapter();

      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: 'groq-resp', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const toolDef = {
        type: 'function' as const,
        function: { name: 'calculator', parameters: { type: 'object' } },
      };

      await adapter.execute({
        model: 'llama-3.3-70b-versatile',
        body: {
          messages: [{ role: 'user', content: 'Calculate 2+2' }],
          tools: [toolDef],
        },
        clientHeaders: new Headers(),
        config: dummyConfig,
      });

      expect(capturedUrl).toContain('api.groq.com');
      expect(capturedBody.model).toBe('llama-3.3-70b-versatile');
      expect(capturedBody.tools).toEqual([toolDef]);
    });
  });

  describe('End-to-End EdgeRoute Server Route Execution with Tools', () => {
    it('processes tool calling request routed to Anthropic via EdgeRoute server', async () => {
      const serverConfig: EdgeRouteConfig = defineConfig({
        defaultModel: 'gpt-5.6-sol',
        providers: {
          anthropic: { apiKey: 'test-anthropic-key' },
        },
        routes: [
          {
            name: 'complex-code-route',
            targetModel: 'claude-sonnet-5',
            rules: { patterns: [/refactor/i] },
          },
        ],
      });

      globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
        if (url.toString().includes('anthropic.com')) {
          return new Response(
            JSON.stringify({
              id: 'msg_e2e_tool_1',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_exec_1',
                  name: 'run_linter',
                  input: { filepath: 'src/index.ts' },
                },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 25, output_tokens: 35 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const { app } = await createEdgeRouteServer(serverConfig);

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Please refactor this file' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'run_linter',
                parameters: {
                  type: 'object',
                  properties: { filepath: { type: 'string' } },
                },
              },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-EdgeRoute-Matched-Route')).toBe(
        'complex-code-route',
      );
      expect(res.headers.get('X-EdgeRoute-Target-Model')).toBe(
        'claude-sonnet-5',
      );
      expect(res.headers.get('X-EdgeRoute-Provider')).toBe('anthropic');

      const json = (await res.json()) as {
        choices: Array<{
          finish_reason: string;
          message: {
            tool_calls: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      expect(json.choices[0]!.finish_reason).toBe('tool_calls');
      expect(json.choices[0]!.message.tool_calls[0]!.function.name).toBe(
        'run_linter',
      );
      expect(
        JSON.parse(json.choices[0]!.message.tool_calls[0]!.function.arguments),
      ).toEqual({ filepath: 'src/index.ts' });
    });
  });
});
