import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../src/providers/anthropic.js';

describe('Cross-Provider Tool Calling Fidelity', () => {
  const adapter = new AnthropicAdapter();

  it('should transform OpenAI tools into Anthropic input_schema format', () => {
    const openAiBody = {
      messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a city',
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
    };

    const { anthropicPayload } = adapter.transformRequest(
      'claude-3-5-sonnet-20241022',
      openAiBody,
    );

    expect(anthropicPayload.tools).toBeDefined();
    const tools = anthropicPayload.tools as Array<any>;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('get_weather');
    expect(tools[0].description).toBe('Get the current weather for a city');
    expect(tools[0].input_schema).toEqual({
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location'],
    });
  });

  it('should map tool_choice "auto", "required", and specific functions correctly', () => {
    // 1. auto
    const resAuto = adapter.transformRequest('claude-3-5-sonnet', {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'test_tool', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'auto',
    });
    expect(resAuto.anthropicPayload.tool_choice).toEqual({ type: 'auto' });

    // 2. required -> any
    const resRequired = adapter.transformRequest('claude-3-5-sonnet', {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'test_tool', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'required',
    });
    expect(resRequired.anthropicPayload.tool_choice).toEqual({ type: 'any' });

    // 3. specific tool object: { type: 'function', function: { name: 'get_weather' } }
    const resSpecific = adapter.transformRequest('claude-3-5-sonnet', {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'get_weather', parameters: { type: 'object' } },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    });
    expect(resSpecific.anthropicPayload.tool_choice).toEqual({
      type: 'tool',
      name: 'get_weather',
    });

    // 4. tool_choice: "none" -> tools not sent
    const resNone = adapter.transformRequest('claude-3-5-sonnet', {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'test_tool', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'none',
    });
    expect(resNone.anthropicPayload.tools).toBeUndefined();
  });

  it('should transform tool result messages and support is_error', () => {
    const openAiBody = {
      messages: [
        { role: 'user', content: 'Get weather in Tokyo' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"Tokyo"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: JSON.stringify({ temp: 22, condition: 'Sunny' }),
        },
        {
          role: 'tool',
          tool_call_id: 'call_error',
          content: 'Device disconnected',
          is_error: true,
        },
      ],
    };

    const { anthropicPayload } = adapter.transformRequest(
      'claude-3-5-sonnet',
      openAiBody,
    );

    const msgs = anthropicPayload.messages as Array<any>;
    expect(msgs.length).toBe(3); // user turn 1, assistant turn 2 with tool_use, user turn 3 with tool_results

    // Assistant message should have tool_use block
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content[0].type).toBe('tool_use');
    expect(assistantMsg.content[0].id).toBe('call_123');
    expect(assistantMsg.content[0].name).toBe('get_weather');
    expect(assistantMsg.content[0].input).toEqual({ location: 'Tokyo' });

    // User message should contain tool_result blocks
    const lastUserMsg = msgs[msgs.length - 1];
    expect(lastUserMsg.role).toBe('user');
    const toolResults = lastUserMsg.content as Array<any>;
    const normalResult = toolResults.find((b) => b.tool_use_id === 'call_123');
    expect(normalResult).toBeDefined();
    expect(normalResult.type).toBe('tool_result');
    expect(normalResult.is_error).toBeUndefined();

    const errorResult = toolResults.find((b) => b.tool_use_id === 'call_error');
    expect(errorResult).toBeDefined();
    expect(errorResult.is_error).toBe(true);
  });
});
