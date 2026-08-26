import { describe, it, expect, beforeEach } from 'vitest';
import {
  cosineSimilarity,
  matchesFastPath,
  SemanticClassifier,
} from '../src/classifier.js';
import { LocalEmbeddingProvider } from '../src/embeddings/local.js';
import type { EdgeRouteConfig } from '../src/types.js';

describe('cosineSimilarity', () => {
  it('should return 1.0 for identical normalized vectors', () => {
    const v1 = [0.6, 0.8];
    const v2 = [0.6, 0.8];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const v1 = [1.0, 0.0];
    const v2 = [0.0, 1.0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const v1 = [1.0, 0.0];
    const v2 = [-1.0, 0.0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
  });
});

describe('matchesFastPath', () => {
  it('should match regex patterns', () => {
    const rules = {
      patterns: [/^(hello|hi|hey)/i, /^(translate|summarize)/i],
    };
    expect(matchesFastPath('Hello there', rules).matched).toBe(true);
    expect(matchesFastPath('Translate this to Japanese', rules).matched).toBe(true);
    expect(matchesFastPath('Write a compiler in C', rules).matched).toBe(false);
  });

  it('should respect character limits', () => {
    const rules = {
      maxCharacters: 20,
    };
    expect(matchesFastPath('Short prompt', rules).matched).toBe(true);
    expect(
      matchesFastPath('This is a very long prompt exceeding twenty characters limit', rules)
        .matched,
    ).toBe(false);
  });
});

describe('SemanticClassifier', () => {
  const sampleConfig: EdgeRouteConfig = {
    defaultModel: 'gpt-4o',
    routes: [
      {
        name: 'simple-tasks',
        targetModel: 'gpt-4o-mini',
        threshold: 0.6,
        rules: {
          patterns: [/^(こんにちは|hello|hi)/i],
        },
        examples: [
          'Fix typo and spelling mistakes in this text',
          'Summarize the following text briefly',
          'Convert JSON to CSV format',
        ],
      },
      {
        name: 'coding-expert',
        targetModel: 'o1-preview',
        threshold: 0.6,
        examples: [
          'Write a distributed lock algorithm using Redis in Rust',
          'Implement a compiler with AST parser and LLVM backend',
        ],
      },
    ],
  };

  let classifier: SemanticClassifier;

  beforeEach(async () => {
    const localProvider = new LocalEmbeddingProvider();
    classifier = new SemanticClassifier(sampleConfig, localProvider);
    await classifier.initialize();
  });

  it('should route greeting to fast-path gpt-4o-mini', async () => {
    const result = await classifier.classify('Hello there, how are you?');
    expect(result.path).toBe('fast-path');
    expect(result.matchedRoute).toBe('simple-tasks');
    expect(result.targetModel).toBe('gpt-4o-mini');
  });

  it('should route typo fixing prompt to semantic-path gpt-4o-mini', async () => {
    const result = await classifier.classify('Please fix the typo and spelling in this paragraph');
    expect(result.path).toBe('semantic-path');
    expect(result.matchedRoute).toBe('simple-tasks');
    expect(result.targetModel).toBe('gpt-4o-mini');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('should route complex coding prompt to semantic-path o1-preview', async () => {
    const result = await classifier.classify(
      'Write an AST parser compiler with LLVM backend in Rust',
    );
    expect(result.path).toBe('semantic-path');
    expect(result.matchedRoute).toBe('coding-expert');
    expect(result.targetModel).toBe('o1-preview');
  });

  it('should fallback to defaultModel if similarity is below threshold', async () => {
    const result = await classifier.classify(
      'Explain the geopolitical climate of the Byzantine empire during the 11th century',
    );
    expect(result.path).toBe('fallback');
    expect(result.matchedRoute).toBe('default');
    expect(result.targetModel).toBe('gpt-4o');
  });
});
