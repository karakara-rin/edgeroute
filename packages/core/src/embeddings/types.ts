export type Vector = number[];

export interface EmbeddingProvider {
  /**
   * Unique identifier for this embedding provider (e.g. 'hash', 'transformers', 'workers-ai', 'openai').
   * Used to tag cache entries and prevent cross-provider vector comparisons.
   */
  readonly name: string;

  /**
   * Generates embedding vector for a single text
   */
  embed(text: string): Promise<Vector>;

  /**
   * Generates embedding vectors for multiple texts in batch
   */
  embedBatch(texts: string[]): Promise<Vector[]>;
}
