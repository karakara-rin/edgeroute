import type { EmbeddingProvider, Vector } from './types.js';

/**
 * Minimal interface for Cloudflare Workers AI binding (`env.AI`).
 */
export interface WorkersAIBinding {
  run(
    model: string,
    inputs: { text: string | string[] },
  ): Promise<{ data: number[][] }>;
}

export interface WorkersAIEmbeddingOptions {
  /** Cloudflare Workers AI binding (pass `env.AI` from Workers runtime) */
  binding: WorkersAIBinding;
  /** Workers AI model ID (default: '@cf/baai/bge-small-en-v1.5') */
  model?: string;
}

/**
 * True semantic embedding provider using Cloudflare Workers AI.
 *
 * Runs embedding models (e.g. `bge-small-en-v1.5`) directly on Cloudflare's
 * inference infrastructure with near-zero latency from Workers.
 * Produces 384-dimensional dense vectors with genuine semantic understanding.
 *
 * Requires a Cloudflare Workers AI binding (`env.AI`).
 */
export class WorkersAIEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'workers-ai';
  private readonly binding: WorkersAIBinding;
  private readonly model: string;

  constructor(options: WorkersAIEmbeddingOptions) {
    if (!options.binding) {
      throw new Error(
        'WorkersAIEmbeddingProvider requires a Cloudflare Workers AI binding. ' +
          'Pass `env.AI` from your Workers handler via `embedding: { provider: "workers-ai", workersAiBinding: env.AI }`.',
      );
    }
    this.binding = options.binding;
    this.model = options.model || '@cf/baai/bge-small-en-v1.5';
  }

  public async embed(text: string): Promise<Vector> {
    const result = await this.binding.run(this.model, { text });
    if (!result?.data?.[0]) {
      throw new Error(`Workers AI embedding returned empty result for model "${this.model}"`);
    }
    return result.data[0];
  }

  public async embedBatch(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];

    const result = await this.binding.run(this.model, { text: texts });
    if (!result?.data || result.data.length !== texts.length) {
      throw new Error(
        `Workers AI embedding batch returned ${result?.data?.length ?? 0} vectors for ${texts.length} inputs`,
      );
    }
    return result.data;
  }
}
