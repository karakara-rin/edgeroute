import { describe, it, expect, vi } from 'vitest';
import { WorkersAIEmbeddingProvider } from '../src/embeddings/workers-ai.js';
import type { WorkersAIBinding } from '../src/embeddings/workers-ai.js';

function createMockBinding(vectors: number[][]): WorkersAIBinding {
  return {
    run: vi.fn().mockResolvedValue({ data: vectors }),
  };
}

describe('WorkersAIEmbeddingProvider', () => {
  it('should have name "workers-ai"', () => {
    const binding = createMockBinding([[0.1, 0.2, 0.3]]);
    const provider = new WorkersAIEmbeddingProvider({ binding });
    expect(provider.name).toBe('workers-ai');
  });

  it('should throw if no binding is provided', () => {
    expect(() => {
      new WorkersAIEmbeddingProvider({ binding: undefined as any });
    }).toThrow('requires a Cloudflare Workers AI binding');
  });

  it('should embed a single text using the AI binding', async () => {
    const mockVector = [0.1, 0.2, 0.3, 0.4, 0.5];
    const binding = createMockBinding([mockVector]);
    const provider = new WorkersAIEmbeddingProvider({ binding });

    const result = await provider.embed('Hello world');

    expect(result).toEqual(mockVector);
    expect(binding.run).toHaveBeenCalledWith(
      '@cf/baai/bge-small-en-v1.5',
      { text: 'Hello world' },
    );
  });

  it('should use custom model when specified', async () => {
    const mockVector = [0.1, 0.2, 0.3];
    const binding = createMockBinding([mockVector]);
    const provider = new WorkersAIEmbeddingProvider({
      binding,
      model: '@cf/baai/bge-m3',
    });

    await provider.embed('test');

    expect(binding.run).toHaveBeenCalledWith(
      '@cf/baai/bge-m3',
      { text: 'test' },
    );
  });

  it('should embed batch of texts', async () => {
    const mockVectors = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ];
    const binding = createMockBinding(mockVectors);
    const provider = new WorkersAIEmbeddingProvider({ binding });

    const results = await provider.embedBatch(['Hello', 'World', 'Test']);

    expect(results).toEqual(mockVectors);
    expect(binding.run).toHaveBeenCalledWith(
      '@cf/baai/bge-small-en-v1.5',
      { text: ['Hello', 'World', 'Test'] },
    );
  });

  it('should return empty array for empty batch', async () => {
    const binding = createMockBinding([]);
    const provider = new WorkersAIEmbeddingProvider({ binding });

    const results = await provider.embedBatch([]);

    expect(results).toEqual([]);
    expect(binding.run).not.toHaveBeenCalled();
  });

  it('should throw on empty result from binding', async () => {
    const binding: WorkersAIBinding = {
      run: vi.fn().mockResolvedValue({ data: [] }),
    };
    const provider = new WorkersAIEmbeddingProvider({ binding });

    await expect(provider.embed('test')).rejects.toThrow('empty result');
  });
});
