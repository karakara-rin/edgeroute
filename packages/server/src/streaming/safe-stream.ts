import { encodeSSE, SSE_DONE_CHUNK } from './sse.js';

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
          const errorMessage =
            err?.message || 'Upstream stream interrupted unexpectedly';
          const errorPayload = {
            error: {
              message: `[EdgeRoute] Stream interrupted: ${errorMessage}`,
              type: 'stream_error',
              code: 500,
              model,
            },
          };
          controller.enqueue(encodeSSE(errorPayload));
          controller.enqueue(SSE_DONE_CHUNK);
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
