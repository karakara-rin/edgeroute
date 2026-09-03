import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@edgeroute/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@edgeroute/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
