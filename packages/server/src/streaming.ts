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
  const content = choices[0]?.message?.content || '';
  const messageRole = choices[0]?.message?.role || 'assistant';
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

      // 2. Stream content in small chunks
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

      // 3. Finish chunk
      const finishChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model: targetModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      };
      controller.enqueue(textEncoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));

      // 4. [DONE] signal
      controller.enqueue(textEncoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/**
 * Tees an upstream SSE stream so the client receives chunks immediately without lag,
 * while asynchronously accumulating the full response payload to save into semantic cache.
 */
export function captureAndCacheStream(
  upstreamStream: ReadableStream<Uint8Array>,
  model: string,
  onComplete: (fullResponse: Record<string, unknown>) => Promise<void> | void,
): ReadableStream<Uint8Array> {
  const [clientStream, cacheStream] = upstreamStream.tee();

  // Process cacheStream in background
  (async () => {
    try {
      const reader = cacheStream.getReader();
      let buffer = '';
      let accumulatedContent = '';
      let finishReason: string | null = 'stop';
      let id = `chatcmpl-${Date.now()}`;
      let usage: any = undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += textDecoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.id) id = parsed.id;
            if (parsed.usage) usage = parsed.usage;

            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              accumulatedContent += delta.content;
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
          } catch {
            // Ignore partial/non-json SSE lines
          }
        }
      }

      if (accumulatedContent) {
        const fullResponse: Record<string, unknown> = {
          id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: accumulatedContent,
              },
              finish_reason: finishReason,
            },
          ],
        };

        if (usage) {
          fullResponse['usage'] = usage;
        } else {
          // Approximate tokens if not provided in stream
          const promptEstimate = 20;
          const completionEstimate = Math.ceil(accumulatedContent.length / 4);
          fullResponse['usage'] = {
            prompt_tokens: promptEstimate,
            completion_tokens: completionEstimate,
            total_tokens: promptEstimate + completionEstimate,
          };
        }

        await onComplete(fullResponse);
      }
    } catch {
      // Non-blocking catch on background caching
    }
  })();

  return clientStream;
}
