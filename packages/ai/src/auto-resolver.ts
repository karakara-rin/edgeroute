import type { LanguageModelV1 } from '@ai-sdk/provider';
import type { EdgeRouteConfig } from '@edgeroute/core';

async function safeImport(moduleName: string): Promise<any> {
  try {
    // Dynamic import without static TS module resolution constraint
    const importer = new Function('m', 'return import(m)');
    return await importer(moduleName);
  } catch {
    return null;
  }
}

/**
 * Attempts to automatically resolve and instantiate a LanguageModelV1 instance
 * using AI SDK provider packages (@ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, etc.)
 */
export async function autoResolveModel(
  modelId: string,
  config: EdgeRouteConfig,
): Promise<LanguageModelV1 | null> {
  const normalized = modelId.toLowerCase();

  // 1. Anthropic Claude Models
  if (normalized.startsWith('claude')) {
    const mod = await safeImport('@ai-sdk/anthropic');
    if (mod?.createAnthropic) {
      const apiKey =
        config.providers?.['anthropic']?.apiKey ||
        (typeof process !== 'undefined' ? process.env?.['ANTHROPIC_API_KEY'] : undefined);
      const anthropic = mod.createAnthropic({ apiKey });
      return anthropic(modelId);
    }
  }

  // 2. Google Gemini Models
  if (normalized.startsWith('gemini')) {
    const mod = await safeImport('@ai-sdk/google');
    if (mod?.createGoogleGenerativeAI) {
      const apiKey =
        config.providers?.['gemini']?.apiKey ||
        (typeof process !== 'undefined'
          ? process.env?.['GOOGLE_GENERATIVE_AI_API_KEY'] || process.env?.['GEMINI_API_KEY']
          : undefined);
      const google = mod.createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
  }

  // 3. Groq Models
  if (
    normalized.startsWith('llama') ||
    normalized.startsWith('mixtral') ||
    normalized.startsWith('deepseek')
  ) {
    const mod = await safeImport('@ai-sdk/groq');
    if (mod?.createGroq) {
      const apiKey =
        config.providers?.['groq']?.apiKey ||
        (typeof process !== 'undefined' ? process.env?.['GROQ_API_KEY'] : undefined);
      const groq = mod.createGroq({ apiKey });
      return groq(modelId);
    }
  }

  // 4. OpenAI Models (gpt-*, o1-*, o3-*, or general default)
  if (
    normalized.startsWith('gpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('chatgpt')
  ) {
    const mod = await safeImport('@ai-sdk/openai');
    if (mod?.createOpenAI) {
      const apiKey =
        config.providers?.['openai']?.apiKey ||
        (typeof process !== 'undefined' ? process.env?.['OPENAI_API_KEY'] : undefined);
      const baseUrl = config.providers?.['openai']?.baseUrl;
      const openai = mod.createOpenAI({ apiKey, baseURL: baseUrl });
      return openai(modelId);
    }
  }

  return null;
}
