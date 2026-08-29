import type {
  ChatCompletionChunk,
  ChatCompletionChunkChoiceDelta,
} from '../types.js';

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

/**
 * Standard SSE terminal chunk signal indicating end of stream.
 */
export const SSE_DONE_CHUNK: Uint8Array = textEncoder.encode('data: [DONE]\n\n');

/**
 * Serializes an arbitrary payload or raw string into standard SSE `data: <payload>\n\n` bytes.
 */
export function encodeSSE(data: string | Record<string, unknown>): Uint8Array {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return textEncoder.encode(`data: ${content}\n\n`);
}

export interface BuildSSEChunkOptions {
  id: string;
  model: string;
  delta: ChatCompletionChunkChoiceDelta;
  finishReason?: string | null;
  created?: number;
  index?: number;
}

/**
 * Constructs an OpenAI-compatible ChatCompletionChunk object.
 */
export function createSSEChunk(options: BuildSSEChunkOptions): ChatCompletionChunk {
  const {
    id,
    model,
    delta,
    finishReason = null,
    created = Math.floor(Date.now() / 1000),
    index = 0,
  } = options;

  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * Serializes a ChatCompletionChunk directly to SSE encoded bytes.
 */
export function formatSSEChunk(options: BuildSSEChunkOptions): Uint8Array {
  return encodeSSE(createSSEChunk(options) as unknown as Record<string, unknown>);
}
