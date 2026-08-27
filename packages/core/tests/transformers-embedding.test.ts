import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/classifier.js';

/**
 * TransformersEmbeddingProvider tests.
 *
 * These tests require @huggingface/transformers to be installed.
 * They are skipped if the dependency is not available.
 *
 * The synonym parity test demonstrates the critical difference between
 * true semantic embeddings and lexical hash-based approaches.
 */

let TransformersEmbeddingProvider: any;
let isAvailable = false;

try {
  const mod = await import('../src/embeddings/transformers.js');
  TransformersEmbeddingProvider = mod.TransformersEmbeddingProvider;
  // Quick availability check
  await import('@huggingface/transformers');
  isAvailable = true;
} catch {
  isAvailable = false;
}

describe.skipIf(!isAvailable)('TransformersEmbeddingProvider', () => {
  it('should have name "transformers"', () => {
    const provider = new TransformersEmbeddingProvider();
    expect(provider.name).toBe('transformers');
  });

  it('should generate 384-dimensional normalized vectors', async () => {
    const provider = new TransformersEmbeddingProvider();
    const vector = await provider.embed('Hello world');

    expect(vector.length).toBe(384);

    let norm = 0;
    for (const val of vector) {
      norm += val * val;
    }
    expect(norm).toBeCloseTo(1.0, 2);
  }, 30000); // Model loading can take time

  it('should capture semantic similarity between synonyms/paraphrases', async () => {
    const provider = new TransformersEmbeddingProvider();

    const v1 = await provider.embed('What is the weather in Tokyo?');
    const v2 = await provider.embed('Tell me the climate conditions in the capital of Japan');
    const vUnrelated = await provider.embed('How to implement a binary search tree in Rust');

    const scoreSemantic = cosineSimilarity(v1, v2);
    const scoreUnrelated = cosineSimilarity(v1, vUnrelated);

    // True semantic embeddings should score synonyms/paraphrases much higher than unrelated content
    expect(scoreSemantic).toBeGreaterThan(scoreUnrelated);
    expect(scoreSemantic).toBeGreaterThan(0.5);
  }, 30000);

  it('should capture Japanese synonym/paraphrase similarity (synonym parity test)', async () => {
    const provider = new TransformersEmbeddingProvider({
      model: 'Xenova/all-MiniLM-L6-v2',
    });

    const v1 = await provider.embed('東京の天気は？');
    const v2 = await provider.embed('日本の首都の気象状況を教えて');
    const vUnrelated = await provider.embed('Rustで高速なHTTPサーバーを実装する方法');

    const scoreSynonym = cosineSimilarity(v1, v2);
    const scoreUnrelated = cosineSimilarity(v1, vUnrelated);

    // Semantic provider should capture the relationship between these paraphrases
    expect(scoreSynonym).toBeGreaterThan(scoreUnrelated);
  }, 30000);

  it('should support batch embedding', async () => {
    const provider = new TransformersEmbeddingProvider();
    const texts = ['Hello', 'World', 'Test'];
    const vectors = await provider.embedBatch(texts);

    expect(vectors).toHaveLength(3);
    for (const vec of vectors) {
      expect(vec.length).toBe(384);
    }
  }, 30000);

  it('should return empty array for empty batch', async () => {
    const provider = new TransformersEmbeddingProvider();
    const vectors = await provider.embedBatch([]);
    expect(vectors).toHaveLength(0);
  });
});
