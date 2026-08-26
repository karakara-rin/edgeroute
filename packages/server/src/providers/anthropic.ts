import type { ProviderAdapter, ProviderRequestOptions } from './types.js';
import type {
  ChatCompletionMessage,
  ChatCompletionTool,
  ChatCompletionToolChoice,
  ChatCompletionResponseFormat,
} from '../routes.js';

interface AnthropicContentBlock {
  type: string;
  id?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown> | string;
  [key: string]: unknown;
}

interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic' as const;

  async execute(options: ProviderRequestOptions): Promise<Response> {
    const { model, body, clientHeaders, config } = options;
    const providerConfig = config.providers?.['anthropic'];

    const baseUrl = (
      providerConfig?.baseUrl || 'https://api.anthropic.com/v1'
    ).replace(/\/+$/, '');

    const apiKey =
      providerConfig?.apiKey ||
      clientHeaders.get('x-api-key') ||
      clientHeaders.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');

    const apiVersion = providerConfig?.apiVersion || '2023-06-01';

    // 1. Transform OpenAI body to Anthropic Messages payload
    const { anthropicPayload, isStream, syntheticStructuredOutputToolName } =
      this.transformRequest(model, body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': apiVersion,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const upstreamResponse = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(anthropicPayload),
    });

    if (!upstreamResponse.ok) {
      // Pass error through
      return upstreamResponse;
    }

    // 2. Transform Anthropic response back to OpenAI format
    if (isStream && upstreamResponse.body) {
      return this.transformStreamResponse(
        upstreamResponse,
        model,
        syntheticStructuredOutputToolName,
      );
    } else {
      return this.transformJsonResponse(
        upstreamResponse,
        model,
        syntheticStructuredOutputToolName,
      );
    }
  }

  /**
   * Transforms OpenAI Chat Completions payload into Anthropic Messages API payload.
   */
  public transformRequest(
    model: string,
    openAiBody: Record<string, unknown>,
  ): {
    anthropicPayload: Record<string, unknown>;
    isStream: boolean;
    syntheticStructuredOutputToolName?: string;
  } {
    const rawMessages = (openAiBody.messages || []) as ChatCompletionMessage[];

    const systemParts: string[] = [];
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }> = [];

    // Helper to append blocks while preserving string type for simple text and merging consecutive turns
    const appendBlockToRole = (
      role: 'user' | 'assistant',
      blockOrText: string | Record<string, unknown> | Array<Record<string, unknown>>,
    ) => {
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];

      if (lastMsg && lastMsg.role === role) {
        if (typeof lastMsg.content === 'string') {
          lastMsg.content = [{ type: 'text', text: lastMsg.content }];
        }
        if (typeof blockOrText === 'string') {
          lastMsg.content.push({ type: 'text', text: blockOrText });
        } else if (Array.isArray(blockOrText)) {
          lastMsg.content.push(...blockOrText);
        } else {
          lastMsg.content.push(blockOrText);
        }
      } else {
        if (typeof blockOrText === 'string') {
          anthropicMessages.push({ role, content: blockOrText });
        } else if (Array.isArray(blockOrText)) {
          anthropicMessages.push({ role, content: blockOrText });
        } else {
          anthropicMessages.push({ role, content: [blockOrText] });
        }
      }
    };

    for (const msg of rawMessages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemParts.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          const text = msg.content
            .filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text)
            .join('\n');
          if (text) systemParts.push(text);
        }
      } else if (msg.role === 'user') {
        if (typeof msg.content === 'string' && msg.content) {
          appendBlockToRole('user', msg.content);
        } else if (Array.isArray(msg.content)) {
          const blocks: Array<Record<string, unknown>> = [];
          for (const part of msg.content) {
            if (part.type === 'text' && typeof part.text === 'string') {
              blocks.push({ type: 'text', text: part.text });
            } else if (typeof part === 'object' && part !== null) {
              blocks.push(part as Record<string, unknown>);
            }
          }
          if (blocks.length > 0) {
            appendBlockToRole('user', blocks);
          }
        }
      } else if (msg.role === 'assistant') {
        const assistantBlocks: Array<Record<string, unknown>> = [];

        // Assistant text content
        if (typeof msg.content === 'string' && msg.content) {
          if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
            // Simple text only assistant message
            appendBlockToRole('assistant', msg.content);
          } else {
            assistantBlocks.push({ type: 'text', text: msg.content });
          }
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text' && typeof part.text === 'string') {
              assistantBlocks.push({ type: 'text', text: part.text });
            }
          }
        }

        // Assistant tool calls -> Anthropic tool_use blocks
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            let parsedInput: Record<string, unknown> = {};
            if (typeof tc.function?.arguments === 'string') {
              try {
                parsedInput = JSON.parse(tc.function.arguments);
              } catch {
                parsedInput = { _raw_input: tc.function.arguments };
              }
            } else if (typeof tc.function?.arguments === 'object' && tc.function?.arguments !== null) {
              parsedInput = tc.function.arguments as Record<string, unknown>;
            }

            assistantBlocks.push({
              type: 'tool_use',
              id: tc.id || `toolu_${Math.random().toString(36).substring(2, 10)}`,
              name: tc.function?.name || '',
              input: parsedInput,
            });
          }
          appendBlockToRole('assistant', assistantBlocks);
        }
      } else if (msg.role === 'tool') {
        // Tool result message -> Anthropic tool_result block in a user message
        const rawContent = msg.content;
        const stringContent =
          typeof rawContent === 'string'
            ? rawContent
            : typeof rawContent === 'object' && rawContent !== null
              ? JSON.stringify(rawContent)
              : '';

        appendBlockToRole('user', {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: stringContent,
        });
      }
    }

    // 2. Handle tools conversion
    const anthropicTools: Array<{
      name: string;
      description?: string;
      input_schema: Record<string, unknown>;
    }> = [];

    const rawTools = openAiBody.tools as ChatCompletionTool[] | undefined;
    if (Array.isArray(rawTools)) {
      for (const tool of rawTools) {
        if (tool.type === 'function' && tool.function) {
          anthropicTools.push({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters || {
              type: 'object',
              properties: {},
            },
          });
        }
      }
    }

    // 3. Handle response_format (Structured Outputs / JSON Mode)
    let syntheticStructuredOutputToolName: string | undefined;
    const responseFormat = openAiBody.response_format as
      | ChatCompletionResponseFormat
      | undefined;

    if (responseFormat) {
      if (responseFormat.type === 'json_object') {
        systemParts.push(
          'CRITICAL: You must respond ONLY with a valid JSON object matching JSON syntax. Do not output conversational filler.',
        );
      } else if (
        responseFormat.type === 'json_schema' &&
        responseFormat.json_schema
      ) {
        const schemaDef = responseFormat.json_schema;
        syntheticStructuredOutputToolName =
          schemaDef.name || 'structured_json_output';

        anthropicTools.push({
          name: syntheticStructuredOutputToolName,
          description:
            schemaDef.description ||
            'Return output adhering to this strict JSON schema',
          input_schema:
            schemaDef.schema || {
              type: 'object',
              properties: {},
            },
        });
      }
    }

    // 4. Handle tool_choice conversion
    let anthropicToolChoice: Record<string, unknown> | undefined;

    if (syntheticStructuredOutputToolName) {
      // Force synthetic tool for structured output
      anthropicToolChoice = {
        type: 'tool',
        name: syntheticStructuredOutputToolName,
      };
    } else if (openAiBody.tool_choice !== undefined) {
      const choice = openAiBody.tool_choice as ChatCompletionToolChoice;
      if (choice === 'auto') {
        anthropicToolChoice = { type: 'auto' };
      } else if (choice === 'required') {
        anthropicToolChoice = { type: 'any' };
      } else if (choice === 'none') {
        anthropicToolChoice = undefined;
      } else if (typeof choice === 'object' && choice !== null) {
        if ('function' in choice && choice.function?.name) {
          anthropicToolChoice = {
            type: 'tool',
            name: choice.function.name,
          };
        }
      }
    }

    const maxTokens =
      (openAiBody.max_tokens as number) ||
      (openAiBody.max_completion_tokens as number) ||
      4096;

    const anthropicPayload: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
    };

    if (systemParts.length > 0) {
      anthropicPayload.system = systemParts.join('\n\n');
    }

    if (anthropicTools.length > 0 && openAiBody.tool_choice !== 'none') {
      anthropicPayload.tools = anthropicTools;
    }

    if (anthropicToolChoice) {
      anthropicPayload.tool_choice = anthropicToolChoice;
    }

    if (typeof openAiBody.temperature === 'number') {
      anthropicPayload.temperature = openAiBody.temperature;
    }
    if (typeof openAiBody.top_p === 'number') {
      anthropicPayload.top_p = openAiBody.top_p;
    }
    if (Array.isArray(openAiBody.stop)) {
      anthropicPayload.stop_sequences = openAiBody.stop;
    } else if (typeof openAiBody.stop === 'string') {
      anthropicPayload.stop_sequences = [openAiBody.stop];
    }
    if (openAiBody.stream === true) {
      anthropicPayload.stream = true;
    }

    return {
      anthropicPayload,
      isStream: openAiBody.stream === true,
      syntheticStructuredOutputToolName,
    };
  }

  private async transformJsonResponse(
    response: Response,
    model: string,
    syntheticStructuredOutputToolName?: string,
  ): Promise<Response> {
    const data = (await response.json()) as AnthropicMessageResponse;

    const textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];

    let isSyntheticToolOutput = false;
    let syntheticContent = '';

    for (const block of data.content || []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        if (
          syntheticStructuredOutputToolName &&
          block.name === syntheticStructuredOutputToolName
        ) {
          isSyntheticToolOutput = true;
          syntheticContent =
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {});
        } else {
          toolCalls.push({
            id: (block.id as string) || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: (block.name as string) || '',
              arguments:
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input ?? {}),
            },
          });
        }
      }
    }

    let finalContent: string | null = null;
    let finishReason = this.mapStopReason(data.stop_reason);

    if (isSyntheticToolOutput) {
      finalContent = syntheticContent;
      finishReason = 'stop';
    } else {
      finalContent =
        textParts.length > 0
          ? textParts.join('')
          : toolCalls.length > 0
            ? null
            : '';
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    const messageObj: {
      role: 'assistant';
      content: string | null;
      tool_calls?: typeof toolCalls;
    } = {
      role: 'assistant',
      content: finalContent,
    };

    if (toolCalls.length > 0) {
      messageObj.tool_calls = toolCalls;
    }

    const openAiResponse = {
      id: data.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || model,
      choices: [
        {
          index: 0,
          message: messageObj,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    };

    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json');

    return new Response(JSON.stringify(openAiResponse), {
      status: response.status,
      headers,
    });
  }

  private transformStreamResponse(
    response: Response,
    model: string,
    syntheticStructuredOutputToolName?: string,
  ): Response {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageId = `chatcmpl-${Date.now()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    const blockIndexToToolIndex = new Map<number, number>();
    const syntheticBlockIndices = new Set<number>();
    let nextToolIndex = 0;

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEventType = '';
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEventType = trimmed.replace(/^event:\s*/, '');
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.replace(/^data:\s*/, '');
            try {
              const parsed = JSON.parse(jsonStr);

              // 1. Message start event
              if (
                currentEventType === 'message_start' ||
                parsed.type === 'message_start'
              ) {
                if (parsed.message?.id) {
                  messageId = parsed.message.id;
                }
                const firstChunk = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: createdAt,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { role: 'assistant', content: '' },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(firstChunk)}\n\n`),
                );
              }
              // 2. Content block start event
              else if (
                currentEventType === 'content_block_start' ||
                parsed.type === 'content_block_start'
              ) {
                const blockIdx = parsed.index as number;
                const contentBlock = parsed.content_block;

                if (contentBlock?.type === 'tool_use') {
                  if (
                    syntheticStructuredOutputToolName &&
                    contentBlock.name === syntheticStructuredOutputToolName
                  ) {
                    syntheticBlockIndices.add(blockIdx);
                  } else {
                    const toolIdx = nextToolIndex++;
                    blockIndexToToolIndex.set(blockIdx, toolIdx);

                    const chunkObj = {
                      id: messageId,
                      object: 'chat.completion.chunk',
                      created: createdAt,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: toolIdx,
                                id: contentBlock.id || `call_${Date.now()}`,
                                type: 'function',
                                function: {
                                  name: contentBlock.name || '',
                                  arguments: '',
                                },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                    );
                  }
                } else if (contentBlock?.type === 'text' && contentBlock.text) {
                  const chunkObj = {
                    id: messageId,
                    object: 'chat.completion.chunk',
                    created: createdAt,
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: contentBlock.text },
                        finish_reason: null,
                      },
                    ],
                  };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                  );
                }
              }
              // 3. Content block delta event
              else if (
                currentEventType === 'content_block_delta' ||
                parsed.type === 'content_block_delta'
              ) {
                const blockIdx = parsed.index as number;
                const delta = parsed.delta;

                if (delta?.type === 'text_delta' && delta.text) {
                  const chunkObj = {
                    id: messageId,
                    object: 'chat.completion.chunk',
                    created: createdAt,
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: delta.text },
                        finish_reason: null,
                      },
                    ],
                  };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                  );
                } else if (
                  delta?.type === 'input_json_delta' &&
                  typeof delta.partial_json === 'string'
                ) {
                  if (syntheticBlockIndices.has(blockIdx)) {
                    // Stream as standard text content for structured output
                    const chunkObj = {
                      id: messageId,
                      object: 'chat.completion.chunk',
                      created: createdAt,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: { content: delta.partial_json },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                    );
                  } else {
                    const toolIdx = blockIndexToToolIndex.get(blockIdx) ?? 0;
                    const chunkObj = {
                      id: messageId,
                      object: 'chat.completion.chunk',
                      created: createdAt,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: toolIdx,
                                function: {
                                  arguments: delta.partial_json,
                                },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                    );
                  }
                }
              }
              // 4. Message delta event
              else if (
                currentEventType === 'message_delta' ||
                parsed.type === 'message_delta'
              ) {
                let finishReason = this.mapStopReason(parsed.delta?.stop_reason);
                if (
                  syntheticBlockIndices.size > 0 &&
                  finishReason === 'tool_calls'
                ) {
                  finishReason = 'stop';
                }

                const chunkObj = {
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: createdAt,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: finishReason,
                    },
                  ],
                  usage: parsed.usage
                    ? {
                        completion_tokens: parsed.usage.output_tokens,
                      }
                    : undefined,
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`),
                );
              }
              // 5. Message stop event
              else if (
                currentEventType === 'message_stop' ||
                parsed.type === 'message_stop'
              ) {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch {
              // Ignore unparseable SSE lines
            }
          }
        }
      },
      flush: (controller) => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
    });

    const transformedBody = response.body!.pipeThrough(transformStream);
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'text/event-stream');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Connection', 'keep-alive');

    return new Response(transformedBody, {
      status: response.status,
      headers,
    });
  }

  private mapStopReason(anthropicStopReason?: string | null): string {
    switch (anthropicStopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}
