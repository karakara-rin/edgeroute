import { formatSSEChunk, SSE_DONE_CHUNK } from './sse.js';

/**
 * Creates an OpenAI-compatible SSE ReadableStream from a cached chat completion response.
 */
export function createCachedStream(
  cachedResponse: Record<string, unknown> | string,
  targetModel: string,
  chunkSize = 10,
): ReadableStream<Uint8Array> {
  const parsedResponse =
    typeof cachedResponse === 'string'
      ? (() => {
          try {
            return JSON.parse(cachedResponse);
          } catch {
            return {
              choices: [{ message: { role: 'assistant', content: cachedResponse } }],
            };
          }
        })()
      : cachedResponse;

  const choices = (parsedResponse.choices as any[]) || [];
  const message = choices[0]?.message || {};
  const content = message.content || '';
  const messageRole = message.role || 'assistant';
  const toolCalls = message.tool_calls as Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }> | undefined;
  const id = (parsedResponse.id as string) || `chatcmpl-cached-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const chunkDefaults = { id, model: targetModel, created };

  return new ReadableStream({
    async start(controller) {
      // 1. Initial role chunk
      controller.enqueue(
        formatSSEChunk({
          ...chunkDefaults,
          delta: { role: messageRole, content: '' },
        }),
      );

      // 2. Stream content in small chunks if text content exists
      if (typeof content === 'string' && content.length > 0) {
        for (let i = 0; i < content.length; i += chunkSize) {
          const chunkText = content.slice(i, i + chunkSize);
          controller.enqueue(
            formatSSEChunk({
              ...chunkDefaults,
              delta: { content: chunkText },
            }),
          );
        }
      }

      // 3. Stream tool calls if present
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        for (let tIdx = 0; tIdx < toolCalls.length; tIdx++) {
          const tc = toolCalls[tIdx]!;
          const toolCallId = tc.id || `call_${Date.now()}_${tIdx}`;
          const toolName = tc.function?.name || '';
          const toolArgs = tc.function?.arguments || '';

          // First chunk announces the tool call id and function name
          controller.enqueue(
            formatSSEChunk({
              ...chunkDefaults,
              delta: {
                tool_calls: [
                  {
                    index: tIdx,
                    id: toolCallId,
                    type: 'function',
                    function: {
                      name: toolName,
                      arguments: '',
                    },
                  },
                ],
              },
            }),
          );

          // Stream arguments in chunks
          if (toolArgs.length > 0) {
            for (let i = 0; i < toolArgs.length; i += chunkSize) {
              const argChunk = toolArgs.slice(i, i + chunkSize);
              controller.enqueue(
                formatSSEChunk({
                  ...chunkDefaults,
                  delta: {
                    tool_calls: [
                      {
                        index: tIdx,
                        function: {
                          arguments: argChunk,
                        },
                      },
                    ],
                  },
                }),
              );
            }
          }
        }
      }

      // 4. Finish chunk
      const finishReason =
        Array.isArray(toolCalls) && toolCalls.length > 0 ? 'tool_calls' : 'stop';
      controller.enqueue(
        formatSSEChunk({
          ...chunkDefaults,
          delta: {},
          finishReason,
        }),
      );

      // 5. [DONE] signal
      controller.enqueue(SSE_DONE_CHUNK);
      controller.close();
    },
  });
}
