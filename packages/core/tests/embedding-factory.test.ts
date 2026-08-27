import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HashEmbeddingProvider } from '../src/embeddings/local.js';
import { createAutoEmbeddingProvider } from '../src/embeddings/factory.js';

describe('createAutoEmbeddingProvider', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    // Restore navigator after each test
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('should fall back to HashEmbeddingProvider when no ML runtime is available', async () => {
    // In a standard test environment without @huggingface/transformers installed,
    // the factory should fall back to hash
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const provider = await createAutoEmbeddingProvider();

    // If transformers is installed it'll use that; otherwise hash
    if (provider.name === 'hash') {
      expect(provider).toBeInstanceOf(HashEmbeddingProvider);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to HashEmbeddingProvider'),
      );
    } else {
      expect(provider.name).toBe('transformers');
    }
  });

  it('should use WorkersAI when in Cloudflare Workers environment with binding', async () => {
    // Simulate Cloudflare Workers environment
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Cloudflare-Workers' },
      writable: true,
      configurable: true,
    });

    const mockBinding = {
      run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
    };

    const provider = await createAutoEmbeddingProvider({
      provider: 'auto',
      workersAiBinding: mockBinding,
    });

    expect(provider.name).toBe('workers-ai');
  });

  it('should NOT use WorkersAI when in CF Workers but no binding provided', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Cloudflare-Workers' },
      writable: true,
      configurable: true,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const provider = await createAutoEmbeddingProvider();

    // Without binding, should fall through to Transformers or Hash
    expect(provider.name).not.toBe('workers-ai');
  });
});
