import type { EmbeddingProvider, Vector } from './types.js';

export interface TransformersEmbeddingOptions {
  /** HuggingFace model ID (default: 'Xenova/all-MiniLM-L6-v2') */
  model?: string;
  /** Quantized model variant / data type (e.g. 'q8', 'fp32', 'fp16', or boolean for quantized) */
  dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | string;
  quantized?: boolean;
}

/**
 * True semantic embedding provider using Transformers.js (ONNX Runtime).
 *
 * Runs the `all-MiniLM-L6-v2` sentence-transformer model locally via ONNX,
 * producing 384-dimensional dense vectors that capture semantic meaning.
 * Synonyms, paraphrases, and semantically similar texts will have high
 * cosine similarity scores.
 *
 * Requires `@huggingface/transformers` as an optional dependency.
 * Best suited for Node.js and Bun runtimes.
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'transformers';
  private readonly modelId: string;
  private readonly dtype: string;
  private pipeline: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: TransformersEmbeddingOptions = {}) {
    this.modelId = options.model || 'Xenova/all-MiniLM-L6-v2';
    if (options.dtype) {
      this.dtype = options.dtype;
    } else if (options.quantized !== undefined) {
      this.dtype = options.quantized ? 'q8' : 'fp32';
    } else {
      this.dtype = 'fp32';
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.pipeline) return;
    if (!this.initPromise) {
      this.initPromise = this.loadPipeline();
    }
    await this.initPromise;
  }

  private async loadPipeline(): Promise<void> {
    try {
      // Dynamic import to keep the dependency optional
      const { pipeline } = await import('@huggingface/transformers');
      this.pipeline = await pipeline('feature-extraction', this.modelId, {
        dtype: this.dtype as any,
      });
    } catch (err) {
      throw new Error(
        `Failed to load Transformers.js model "${this.modelId}". ` +
          `Ensure @huggingface/transformers is installed: npm install @huggingface/transformers\n` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public async embed(text: string): Promise<Vector> {
    await this.ensureInitialized();

    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data as Float32Array);
  }

  public async embedBatch(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];

    // Process individually for now — Transformers.js batching support varies by model
    const results: Vector[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
