import type { EmbeddingProvider, Vector } from './types.js';

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly cache = new Map<string, Vector>();

  constructor(options: OpenAIEmbeddingOptions = {}) {
    this.apiKey = options.apiKey || (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY || '' : '');
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
    this.model = options.model || 'text-embedding-3-small';
  }

  public async embed(text: string): Promise<Vector> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const [vector] = await this.embedBatch([text]);
    if (!vector) {
      throw new Error('Failed to retrieve embedding vector from OpenAI API');
    }
    return vector;
  }

  public async embedBatch(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];

    const uncachedTexts: { text: string; index: number }[] = [];
    const results: Vector[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      const cached = this.cache.get(text);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push({ text, index: i });
      }
    }

    if (uncachedTexts.length > 0) {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: uncachedTexts.map((item) => item.text),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Embeddings API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      for (let i = 0; i < data.data.length; i++) {
        const item = data.data[i]!;
        const original = uncachedTexts[item.index]!;
        this.cache.set(original.text, item.embedding);
        results[original.index] = item.embedding;
      }
    }

    return results;
  }
}
