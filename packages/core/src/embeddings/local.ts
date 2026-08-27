import type { EmbeddingProvider, Vector } from './types.js';

/**
 * Ultra-fast, zero-dependency, zero-API lexical hashing vectorizer for Edge runtimes.
 *
 * ⚠️ This is NOT a semantic embedding provider. It uses character and word n-gram
 * hashing (FNV-1a Feature Hashing Trick) to produce sparse-dense feature vectors.
 * It cannot capture synonyms, paraphrases, or semantic similarity between texts
 * with different surface forms.
 *
 * Use `TransformersEmbeddingProvider` or `WorkersAIEmbeddingProvider` for true
 * semantic understanding. This provider serves as a zero-cost lexical fallback
 * when no ML runtime is available.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'hash';
  private readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  public async embed(text: string): Promise<Vector> {
    return this.calculateVector(text);
  }

  public async embedBatch(texts: string[]): Promise<Vector[]> {
    return texts.map((t) => this.calculateVector(t));
  }

  private calculateVector(text: string): Vector {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().trim();

    if (!normalized) {
      return vector;
    }

    // 1. Word tokens & bigrams
    const words = normalized.split(/[\s,.;:!?()[\]{}"'`/\\|<>+=-]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      const hash1 = this.hashString(word);
      const idx1 = Math.abs(hash1) % this.dimensions;
      vector[idx1] += 2.0;

      if (i < words.length - 1) {
        const bigram = `${word}_${words[i + 1]}`;
        const hash2 = this.hashString(bigram);
        const idx2 = Math.abs(hash2) % this.dimensions;
        vector[idx2] += 1.5;
      }
    }

    // 2. Character 3-grams & 4-grams (works effectively for non-spaced languages like Japanese, and code)
    for (let i = 0; i < normalized.length - 2; i++) {
      const charTri = normalized.slice(i, i + 3);
      const hashTri = this.hashString(charTri);
      const idxTri = Math.abs(hashTri) % this.dimensions;
      vector[idxTri] += 1.0;
    }

    // 3. L2 Normalize the vector
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i]! * vector[i]!;
    }

    if (norm > 0) {
      const sqrtNorm = Math.sqrt(norm);
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = vector[i]! / sqrtNorm;
      }
    }

    return vector;
  }

  /**
   * Fast 32-bit FNV-1a hash algorithm
   */
  private hashString(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash;
  }
}

/**
 * @deprecated Use `HashEmbeddingProvider` instead. This alias exists for backward compatibility.
 * The "Local" name was misleading as it implied semantic understanding.
 */
export const LocalEmbeddingProvider = HashEmbeddingProvider;
