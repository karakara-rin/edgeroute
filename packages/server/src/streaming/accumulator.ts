import { estimateTokens, type TokenUsage } from '@edgeroute/core';
import { textDecoder } from './sse.js';
import { createSafeStream } from './safe-stream.js';

export interface CaptureAndCacheStreamOptions {
  promptTokens?: number;
  prompt?: string;
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
  options?: CaptureAndCacheStreamOptions,
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
      let usage: TokenUsage | undefined = undefined;

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;

        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]' || !dataStr.startsWith('{')) return;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.id) id = parsed.id;
          if (parsed.usage) usage = parsed.usage as TokenUsage;

          const choice = parsed.choices?.[0];
          if (choice) {
            const delta = choice.delta;
            if (delta?.content) {
              accumulatedContent += delta.content;
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx =
                  typeof tc.index === 'number' ? tc.index : toolCallsMap.size;
                const existing = toolCallsMap.get(idx) || {
                  id: '',
                  type: 'function' as const,
                  function: { name: '', arguments: '' },
                };
                if (tc.id) existing.id = tc.id;
                if (tc.type) existing.type = tc.type;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments)
                  existing.function.arguments += tc.function.arguments;
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
              finish_reason:
                finishReason || (hasToolCalls ? 'tool_calls' : 'stop'),
            },
          ],
        };

        if (usage) {
          fullResponse['usage'] = usage;
        } else {
          // Approximate tokens if not provided in stream using multilingual estimator
          const promptEstimate =
            options?.promptTokens ??
            (options?.prompt ? estimateTokens(options.prompt) : 20);
          const completionEstimate = Math.max(
            1,
            estimateTokens(accumulatedContent) +
              (hasToolCalls
                ? estimateTokens(JSON.stringify(toolCallsArray))
                : 0),
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
          console.warn(
            '[EdgeRoute/Stream] Error saving stream response to cache:',
            saveErr,
          );
        }
      }
    } catch (err) {
      console.warn(
        '[EdgeRoute/Stream] Background cache stream processing ended with error:',
        err,
      );
    }
  })();

  return clientStream;
}
