import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    '@edgeroute/core',
    '@edgeroute/server',
    '@huggingface/transformers',
    'onnxruntime-node',
    '@upstash/redis',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
