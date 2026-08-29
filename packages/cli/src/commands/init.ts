import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

const STARTER_CONFIG = `import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  // Default fallback model (high capability / reasoning model)
  defaultModel: 'gpt-4o',

  // Providers configuration (pass API keys or use environment variables)
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },

  // Embedding engine: 'auto' (runtime auto-detect) | 'transformers' | 'workers-ai' | 'openai' | 'hash'
  embedding: {
    provider: 'auto',
  },

  // Sub-millisecond Semantic Cache
  cache: {
    enabled: true,
    threshold: 0.95,
    ttl: 3600,
  },

  // Defined routing targets
  routes: [
    {
      name: 'simple-tasks',
      targetModel: 'gpt-4o-mini',
      threshold: 0.78,

      // Tier 1: Fast-path rules (0ms overhead)
      rules: {
        maxCharacters: 200,
        patterns: [
          /^(hello|hi|hey|good morning|こんにちは)/i,
          /^(translate|summarize|format as json)/i,
        ],
      },

      // Tier 2: Semantic sample prompts
      examples: [
        'Fix spelling and grammar in the following sentence',
        'Convert this JSON data to CSV format',
        'Summarize this paragraph in 3 bullet points',
        'Tell me a short joke',
      ],
    },
    {
      name: 'code-generation',
      targetModel: 'gpt-4o',
      threshold: 0.82,
      examples: [
        'Write a high-performance HTTP server in Rust',
        'Implement a Red-Black tree in TypeScript with unit tests',
        'Debug this race condition in Go goroutines',
      ],
    },
  ],
});
`;

export interface InitOptions {
  force?: boolean;
  output?: string;
  cwd?: string;
}

export async function initCommand(options: InitOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const targetFile = path.resolve(cwd, options.output ?? 'router.config.ts');

  if (fs.existsSync(targetFile) && !options.force) {
    console.log(pc.yellow(`⚠️  Configuration file already exists at ${path.basename(targetFile)} (use --force to overwrite)`));
    return targetFile;
  }

  fs.writeFileSync(targetFile, STARTER_CONFIG, 'utf-8');
  console.log(pc.green(pc.bold(`✔ Created starter EdgeRoute configuration at ${pc.underline(path.relative(cwd, targetFile) || path.basename(targetFile))}`)));
  console.log(pc.dim('  Run "edgeroute build-embeddings" to pre-compile example vectors, or "edgeroute eval" to simulate routing.'));
  console.log('');

  return targetFile;
}
