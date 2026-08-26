export type Vector = number[];

export interface EmbeddingProvider {
  /**
   * Generates embedding vector for a single text
   */
  embed(text: string): Promise<Vector>;

  /**
   * Generates embedding vectors for multiple texts in batch
   */
  embedBatch(texts: string[]): Promise<Vector[]>;
}
