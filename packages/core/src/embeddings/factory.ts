import type { EmbeddingProvider } from './types.js';
import type { EmbeddingConfig } from '../types.js';
import { HashEmbeddingProvider } from './local.js';

/**
 * Detects whether the current runtime is Cloudflare Workers.
 */
function isCloudflareWorkers(): boolean {
  try {
    // Cloudflare Workers defines `navigator.userAgent` as 'Cloudflare-Workers'
    return (
      typeof navigator !== 'undefined' &&
      navigator.userAgent === 'Cloudflare-Workers'
    );
  } catch {
    return false;
  }
}

/**
 * Attempts to dynamically import and create a TransformersEmbeddingProvider.
 * Returns null if @huggingface/transformers is not installed.
 */
async function tryCreateTransformersProvider(
  model?: string,
): Promise<EmbeddingProvider | null> {
  try {
    const { TransformersEmbeddingProvider } = await import('./transformers.js');
    return new TransformersEmbeddingProvider({ model });
  } catch {
    return null;
  }
}

/**
 * Auto-detects the best available embedding provider for the current runtime:
 *
 * 1. **Cloudflare Workers** → `WorkersAIEmbeddingProvider` (requires `workersAiBinding`)
 * 2. **Node.js / Bun** → `TransformersEmbeddingProvider` (requires `@huggingface/transformers`)
 * 3. **Fallback** → `HashEmbeddingProvider` (lexical, zero dependencies)
 *
 * A console warning is emitted when falling back to the hash provider,
 * since it provides only lexical (not semantic) matching.
 */
export async function createAutoEmbeddingProvider(
  config?: EmbeddingConfig,
): Promise<EmbeddingProvider> {
  // 1. If Cloudflare Workers AI binding is available, use it
  if (isCloudflareWorkers() && config?.workersAiBinding) {
    const { WorkersAIEmbeddingProvider } = await import('./workers-ai.js');
    return new WorkersAIEmbeddingProvider({
      binding: config.workersAiBinding,
      model: config?.model,
    });
  }

  // 2. Try Transformers.js (Node.js / Bun with @huggingface/transformers)
  const transformersProvider = await tryCreateTransformersProvider(config?.model);
  if (transformersProvider) {
    return transformersProvider;
  }

  // 3. Fallback to hash-based lexical provider
  console.warn(
    '[EdgeRoute] Falling back to HashEmbeddingProvider (lexical/keyword matching only). ' +
      'For true semantic routing, install @huggingface/transformers: npm install @huggingface/transformers',
  );
  return new HashEmbeddingProvider();
}
