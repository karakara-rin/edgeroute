import { createEdgeRouteServer } from '@edgeroute/server';
import { defineConfig } from '@edgeroute/core';

const config = defineConfig({
  defaultModel: 'gpt-5.6-sol',
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },
  // Zero-API local embedding engine (100% free, 0 network latency)
  embedding: {
    provider: 'local',
  },
  routes: [
    {
      name: 'simple-tasks',
      targetModel: 'gpt-5.6-luna',
      threshold: 0.65,
      rules: {
        maxCharacters: 250,
        patterns: [/^(hello|hi|hey|こんにちは|要約|校正)/i],
      },
      examples: [
        'Fix grammar and typo mistakes in this sentence',
        'Convert this JSON data into CSV format',
        'Summarize this paragraph in 3 bullet points',
        'Tell me a short joke',
      ],
    },
    {
      name: 'complex-reasoning',
      targetModel: 'gpt-5.6-sol',
      threshold: 0.7,
      examples: [
        'Implement an AST parser and compiler pipeline in Rust',
        'Design a high-availability distributed consensus protocol',
        'Audit this smart contract for reentrancy vulnerabilities',
      ],
    },
  ],
});

async function main() {
  const { app } = await createEdgeRouteServer(config);
  console.log('🚀 EdgeRoute Server ready with 2-tier Semantic Classifier!');
  console.log('🔗 Health check: http://localhost:3000/health');
  console.log('📡 Proxy endpoint: POST http://localhost:3000/v1/chat/completions');
  
  // Export app for Cloudflare Workers / Node.js Hono adapter
  return app;
}

export default await main();
