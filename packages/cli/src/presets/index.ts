export interface PresetDefinition {
  id: 'cost-saver' | 'coding-agent' | 'minimal-cache-only';
  name: string;
  description: string;
  configContent: string;
  envExampleContent: string;
}

export const PRESET_COST_SAVER: PresetDefinition = {
  id: 'cost-saver',
  name: 'Cost Saver (Default)',
  description: 'Route casual chat/translations to gpt-5.6-luna/haiku-4-5, complex queries to gpt-5.6-sol + semantic cache',
  configContent: `import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  // Default fallback model (high capability / frontier reasoning model)
  defaultModel: 'gpt-5.6-sol',

  // Providers configuration (read from environment variables)
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  },

  // Embedding engine: 'auto' (runtime auto-detect) | 'transformers' | 'workers-ai' | 'openai' | 'hash'
  embedding: {
    provider: 'auto',
  },

  // Sub-millisecond Semantic Cache (threshold 0.92 = 92% similarity)
  cache: {
    enabled: true,
    threshold: 0.92,
    ttl: 3600, // 1 hour
  },

  // Defined routing targets
  routes: [
    {
      name: 'simple-tasks',
      targetModel: 'gpt-5.6-luna',
      threshold: 0.78,

      // Tier 1: Fast-path zero-latency regex matching
      rules: {
        maxCharacters: 200,
        patterns: [
          /^(hello|hi|hey|good morning|こんにちは|お疲れ様です)/i,
          /^(format as json|fix spelling|summarize in short)/i,
        ],
      },

      // Tier 2: Semantic sample prompts
      examples: [
        'Fix spelling and grammar in the following sentence',
        'Convert this JSON data to CSV format',
        'Summarize this paragraph in 3 bullet points',
        'Tell me a short joke',
        'こんにちは、今日の調子はどうですか？',
      ],
    },
    {
      name: 'fast-haiku-translation',
      targetModel: 'claude-haiku-4-5',
      threshold: 0.80,
      rules: {
        patterns: [
          /^(translate to (japanese|french|spanish|german)|以下の文章を.*翻訳)/i,
        ],
      },
      examples: [
        'Translate this English paragraph into natural Japanese',
        '以下の文章を英語から日本語に翻訳してください',
        'Proofread and translate the following release notes into Spanish',
      ],
    },
  ],
});
`,
  envExampleContent: `# EdgeRoute Environment Configuration — Cost Saver Preset
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
`,
};

export const PRESET_CODING_AGENT: PresetDefinition = {
  id: 'coding-agent',
  name: 'Coding Agent',
  description: 'Fast syntax & refactoring via Groq Llama 3.3, deep architecture & tool use via Claude Sonnet 5',
  configContent: `import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  // Default fallback model for complex system design, reasoning, and multi-step tool use
  defaultModel: 'claude-sonnet-5',

  // Providers configuration
  providers: {
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
    },
  },

  embedding: {
    provider: 'auto',
  },

  // Semantic Cache for repeated code queries, AST lookups, and lint explanations
  cache: {
    enabled: true,
    threshold: 0.95,
    ttl: 7200, // 2 hours
  },

  routes: [
    {
      name: 'syntax-and-refactor-fast',
      targetModel: 'llama-3.3-70b-versatile',
      threshold: 0.75,
      rules: {
        patterns: [
          /^(lint|format|syntax check|fix typo|check types)/i,
          /^(generate jsdoc|add comments|rename variable)/i,
        ],
      },
      examples: [
        'Fix this syntax error in Python script',
        'Add JSDoc documentation to this TypeScript interface',
        'Refactor this simple switch-case into an object lookup table',
        'Format this CSS snippet according to style guide',
      ],
    },
    {
      name: 'architecture-and-tools',
      targetModel: 'claude-sonnet-5',
      threshold: 0.85,
      examples: [
        'Design a distributed rate-limiting algorithm using Redis and token bucket',
        'Implement an asynchronous lock-free queue in Rust with full formal proof',
        'Refactor this monolithic database schema into microservice event-driven models',
      ],
    },
  ],
});
`,
  envExampleContent: `# EdgeRoute Environment Configuration — Coding Agent Preset
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GROQ_API_KEY=your_groq_api_key_here
`,
};

export const PRESET_MINIMAL_CACHE_ONLY: PresetDefinition = {
  id: 'minimal-cache-only',
  name: 'Minimal Cache Only',
  description: 'Ultra-fast semantic cache proxy layer in front of OpenAI / Anthropic without custom routes',
  configContent: `import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  // Forward non-cached queries to your primary LLM
  defaultModel: 'gpt-5.6-sol',

  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },

  embedding: {
    provider: 'auto',
  },

  // Sub-millisecond semantic cache layer (intercepts & returns identical / near-identical requests)
  cache: {
    enabled: true,
    threshold: 0.92,
    ttl: 3600, // 1 hour
  },

  // All traffic passes through the cache before hitting defaultModel
  routes: [],
});
`,
  envExampleContent: `# EdgeRoute Environment Configuration — Minimal Cache Only Preset
OPENAI_API_KEY=your_openai_api_key_here
`,
};

export const PRESETS: Record<string, PresetDefinition> = {
  'cost-saver': PRESET_COST_SAVER,
  'coding-agent': PRESET_CODING_AGENT,
  'minimal-cache-only': PRESET_MINIMAL_CACHE_ONLY,
};

export type PresetName = 'cost-saver' | 'coding-agent' | 'minimal-cache-only';

export function getPreset(name: string): PresetDefinition {
  const normalized = name.toLowerCase().trim();
  const preset = PRESETS[normalized];
  if (!preset) {
    const validNames = Object.keys(PRESETS).join(', ');
    throw new Error(`Unknown preset "${name}". Available presets: ${validNames}`);
  }
  return preset;
}
