import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    '@huggingface/transformers',
    'onnxruntime-node',
    '@upstash/redis',
    '@cloudflare/workers-types',
  ],
});
