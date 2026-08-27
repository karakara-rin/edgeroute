import { describe, it, expect } from 'vitest';
import { HashEmbeddingProvider, LocalEmbeddingProvider } from '../src/embeddings/local.js';
import { cosineSimilarity } from '../src/classifier.js';

describe('HashEmbeddingProvider', () => {
  it('should generate normalized vectors with expected dimension', async () => {
    const provider = new HashEmbeddingProvider(256);
    const vector = await provider.embed('Hello world');
    expect(vector.length).toBe(256);

    let norm = 0;
    for (const val of vector) {
      norm += val * val;
    }
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('should have name "hash"', () => {
    const provider = new HashEmbeddingProvider();
    expect(provider.name).toBe('hash');
  });

  it('should yield higher cosine similarity for lexically closer texts', async () => {
    const provider = new HashEmbeddingProvider(256);
    const vRef = await provider.embed('fix spelling error in this sentence');
    const vSimilar = await provider.embed('fix grammar and spelling error in paragraph');
    const vDifferent = await provider.embed('quantum physics and general relativity in astrophysics');

    const scoreSimilar = cosineSimilarity(vRef, vSimilar);
    const scoreDifferent = cosineSimilarity(vRef, vDifferent);

    expect(scoreSimilar).toBeGreaterThan(scoreDifferent);
  });

  it('should support Japanese text effectively', async () => {
    const provider = new HashEmbeddingProvider(256);
    const vRef = await provider.embed('日本語の文章を短く要約してください');
    const vSimilar = await provider.embed('この文章をわかりやすく要約して');
    const vDifferent = await provider.embed('Rust言語で高パフォーマンスなHTTPサーバーを書く');

    const scoreSimilar = cosineSimilarity(vRef, vSimilar);
    const scoreDifferent = cosineSimilarity(vRef, vDifferent);

    expect(scoreSimilar).toBeGreaterThan(scoreDifferent);
  });

  it('should FAIL to capture synonym/paraphrase similarity (demonstrating lexical limitation)', async () => {
    const provider = new HashEmbeddingProvider(256);
    const v1 = await provider.embed('東京の天気は？');
    const v2 = await provider.embed('日本の首都の気象状況を教えて');

    const score = cosineSimilarity(v1, v2);
    // Hash-based provider cannot capture synonyms — score should be very low
    expect(score).toBeLessThan(0.5);
  });
});

describe('LocalEmbeddingProvider (deprecated alias)', () => {
  it('should be the same class as HashEmbeddingProvider', () => {
    expect(LocalEmbeddingProvider).toBe(HashEmbeddingProvider);
  });

  it('should work as a drop-in replacement', async () => {
    const provider = new LocalEmbeddingProvider(128);
    const vector = await provider.embed('test text');
    expect(vector.length).toBe(128);
    expect(provider.name).toBe('hash');
  });
});
