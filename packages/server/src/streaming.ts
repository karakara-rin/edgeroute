/**
 * Utilities for OpenAI-compatible Server-Sent Events (SSE) streaming and cache stream capture.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Creates an OpenAI-compatible SSE ReadableStream from a cached chat completion response.
 */
export function createCachedStream(
  cachedResponse: Record<string, unknown>,
  targetModel: string,
  chunkSize = 10,
): ReadableStream<Uint8Array> {
  const choices = (cachedResponse.choices as any[]) || [];
  const message = choices[0]?.message || {};
  const content = message.content || '';
  const messageRole = message.role || 'assistant';
  const toolCalls = message.tool_calls as Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }> | undefined;
  const id = (cachedResponse.id as string) || `chatcmpl-cached-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return new ReadableStream({
    async start(controller) {
      // 1. Initial role chunk
      const roleChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model: targetModel,
        choices: [
          {
            index: 0,
            delta: { role: messageRole, content: '' },
            finish_reason: null,
          },
        ],
      };
      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

      // 2. Stream content in small chunks if text content exists
      if (typeof content === 'string' && content.length > 0) {
        for (let i = 0; i < content.length; i += chunkSize) {
          const chunkText = content.slice(i, i + chunkSize);
          const chunkObj = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: targetModel,
            choices: [
              {
                index: 0,
                delta: { content: chunkText },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`));
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
          const toolStartChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: targetModel,
            choices: [
              {
                index: 0,
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
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(toolStartChunk)}\n\n`));

          // Stream arguments in chunks
          if (toolArgs.length > 0) {
            for (let i = 0; i < toolArgs.length; i += chunkSize) {
              const argChunk = toolArgs.slice(i, i + chunkSize);
              const toolArgChunk = {
                id,
                object: 'chat.completion.chunk',
                created,
                model: targetModel,
                choices: [
                  {
                    index: 0,
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
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(toolArgChunk)}\n\n`));
            }
          }
        }
      }

      // 4. Finish chunk
      const finishReason = Array.isArray(toolCalls) && toolCalls.length > 0 ? 'tool_calls' : 'stop';
      const finishChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model: targetModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason,
          },
        ],
      };
      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));

      // 5. [DONE] signal
      controller.enqueue(textEncoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/**
 * Wraps an upstream ReadableStream with error handling so that if an error occurs
 * during streaming (Mid-stream error), an SSE error payload is safely delivered
 * to the client before closing the stream, avoiding silent disconnects or hangs.
 */
export function createSafeStream(
  upstreamStream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const reader = upstreamStream.getReader();

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          controller.enqueue(value);
        }
      } catch (err: any) {
        console.error(
          `[EdgeRoute/Stream] Mid-stream error encountered on model "${model}":`,
          err,
        );
        try {
          const errorMessage = err?.message || 'Upstream stream interrupted unexpectedly';
          const errorPayload = {
            error: {
              message: `[EdgeRoute] Stream interrupted: ${errorMessage}`,
              type: 'stream_error',
              code: 500,
              model,
            },
          };
          controller.enqueue(
            textEncoder.encode(`data: ${JSON.stringify(errorPayload)}\n\n`),
          );
          controller.enqueue(textEncoder.encode('data: [DONE]\n\n'));
        } catch {
          // Ignore if controller is already closed
        } finally {
          controller.close();
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

/**
 * Tees an upstream SSE stream so the client receives chunks immediately without lag,
 * while asynchronously accumulating the full response payload (including text & tool calls)
 * to save into semantic cache.
 */
export function captureAndCacheStream(
  upstreamStream: ReadableStream<Uint8Array>,
  model: string,
  onComplete: (fullResponse: Record<string, unknown>) => Promise<void> | void,
): ReadableStream<Uint8Array> {
  const safeStream = createSafeStream(upstreamStream, model);
  const [clientStream, cacheStream] = safeStream.tee();

  // Process cacheStream in background
  (async () => {
    try {
      const reader = cacheStream.getReader();
      let buffer = '';
      let accumulatedContent = '';
      const toolCallsMap = new Map<
        number,
        {
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }
      >();
      let finishReason: string | null = null;
      let id = `chatcmpl-${Date.now()}`;
      let usage: any = undefined;

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        
        // Strip single leading space after 'data:' if present without trimming trailing characters
        const rawData = line.startsWith('data: ')
          ? line.slice(6)
          : line.startsWith('data:')
            ? line.slice(5)
            : '';
        const dataStr = rawData.trim();
        if (dataStr === '[DONE]' || !dataStr.startsWith('{')) return;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.id) id = parsed.id;
          if (parsed.usage) usage = parsed.usage;

          const choice = parsed.choices?.[0];
          if (choice) {
            const delta = choice.delta;
            if (delta?.content) {
              accumulatedContent += delta.content;
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : toolCallsMap.size;
                const existing = toolCallsMap.get(idx) || {
                  id: '',
                  type: 'function' as const,
                  function: { name: '', arguments: '' },
                };
                if (tc.id) existing.id = tc.id;
                if (tc.type) existing.type = tc.type;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                toolCallsMap.set(idx, existing);
              }
            }
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
          }
        } catch {
          // Ignore partial/non-json SSE lines
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += textDecoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          processLine(line);
        }
      }

      // Process any remaining buffer line
      if (buffer.trim()) {
        processLine(buffer);
      }

      const toolCallsArray = Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => tc);

      const hasContent = Boolean(accumulatedContent);
      const hasToolCalls = toolCallsArray.length > 0;

      if (hasContent || hasToolCalls) {
        const messageObj: {
          role: 'assistant';
          content: string | null;
          tool_calls?: typeof toolCallsArray;
        } = {
          role: 'assistant',
          content: hasContent ? accumulatedContent : null,
        };

        if (hasToolCalls) {
          messageObj.tool_calls = toolCallsArray;
        }

        const fullResponse: Record<string, unknown> = {
          id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: messageObj,
              finish_reason: finishReason || (hasToolCalls ? 'tool_calls' : 'stop'),
            },
          ],
        };

        if (usage) {
          fullResponse['usage'] = usage;
        } else {
          // Approximate tokens if not provided in stream
          const promptEstimate = 20;
          const completionEstimate = Math.max(
            1,
            Math.ceil((accumulatedContent.length + JSON.stringify(toolCallsArray).length) / 4),
          );
          fullResponse['usage'] = {
            prompt_tokens: promptEstimate,
            completion_tokens: completionEstimate,
            total_tokens: promptEstimate + completionEstimate,
          };
        }

        try {
          await onComplete(fullResponse);
        } catch (saveErr) {
          console.warn('[EdgeRoute/Stream] Error saving stream response to cache:', saveErr);
        }
      }
    } catch (err) {
      console.warn('[EdgeRoute/Stream] Background cache stream processing ended with error:', err);
    }
  })();

  return clientStream;
}
