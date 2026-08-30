import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    '@edgeroute/core',
    '@huggingface/transformers',
    'onnxruntime-node',
    '@upstash/redis',
  ],
});
