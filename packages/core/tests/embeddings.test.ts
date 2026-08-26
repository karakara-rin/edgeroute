import { describe, it, expect } from 'vitest';
import { LocalEmbeddingProvider } from '../src/embeddings/local.js';
import { cosineSimilarity } from '../src/classifier.js';

describe('LocalEmbeddingProvider', () => {
  it('should generate normalized vectors with expected dimension', async () => {
    const provider = new LocalEmbeddingProvider(256);
    const vector = await provider.embed('Hello world');
    expect(vector.length).toBe(256);

    let norm = 0;
    for (const val of vector) {
      norm += val * val;
    }
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('should yield higher cosine similarity for semantically closer texts', async () => {
    const provider = new LocalEmbeddingProvider(256);
    const vRef = await provider.embed('fix spelling error in this sentence');
    const vSimilar = await provider.embed('fix grammar and spelling error in paragraph');
    const vDifferent = await provider.embed('quantum physics and general relativity in astrophysics');

    const scoreSimilar = cosineSimilarity(vRef, vSimilar);
    const scoreDifferent = cosineSimilarity(vRef, vDifferent);

    expect(scoreSimilar).toBeGreaterThan(scoreDifferent);
  });

  it('should support Japanese text effectively', async () => {
    const provider = new LocalEmbeddingProvider(256);
    const vRef = await provider.embed('日本語の文章を短く要約してください');
    const vSimilar = await provider.embed('この文章をわかりやすく要約して');
    const vDifferent = await provider.embed('Rust言語で高パフォーマンスなHTTPサーバーを書く');

    const scoreSimilar = cosineSimilarity(vRef, vSimilar);
    const scoreDifferent = cosineSimilarity(vRef, vDifferent);

    expect(scoreSimilar).toBeGreaterThan(scoreDifferent);
  });
});
