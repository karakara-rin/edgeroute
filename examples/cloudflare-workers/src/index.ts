import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  type EdgeRouteConfig,
  cloudflareKV,
  defineConfig,
} from '@edgeroute/core';
import { createEdgeRouteServer } from '@edgeroute/server';

export interface Env {
  AI?: any;
  CACHE_KV?: KVNamespace;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  DEFAULT_MODEL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend applications & OpenAI SDK clients
app.use('*', cors());

// Health check endpoint
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    runtime: 'cloudflare-workers',
    edgeNative: true,
    workersAi: Boolean(c.env.AI),
    kvCache: Boolean(c.env.CACHE_KV),
  }),
);

// Forward all /v1/* chat completion and embedding requests through EdgeRoute
app.all('/v1/*', async (c) => {
  const env = c.env;

  const config: EdgeRouteConfig = defineConfig({
    // High-capability frontier model for complex queries & reasoning
    defaultModel: env.DEFAULT_MODEL || 'gpt-5.6-sol',
    // Dynamic Complexity Routing strategy (rules -> semantic -> complexity threshold -> fallback)
    routingStrategy: 'hybrid',
    complexityThreshold: 0.55,
    // $0 Workers AI Neural Embedding Provider (@cf/baai/bge-small-en-v1.5)
    embedding: env.AI
      ? {
          provider: 'workers-ai',
          model: '@cf/baai/bge-small-en-v1.5',
          workersAiBinding: env.AI,
        }
      : {
          provider: 'auto',
        },
    routes: [
      {
        name: 'lightweight-fast',
        targetModel: 'gemini-3.7-flash',
        // Queries with complexity score <= 0.55 are routed to low-cost Flash
        complexityThreshold: 0.55,
        rules: {
          patterns: [/^(hello|hi|hey|こんにちは|translate|要約|format)/i],
        },
      },
      {
        name: 'coding-specialist',
        targetModel: 'claude-sonnet-5',
        rules: {
          patterns: ['refactor', 'rust', 'typescript', 'architecture', 'algorithm'],
        },
        examples: [
          'Fix this race condition and memory leak',
          'Implement a Red-Black Tree in TypeScript',
        ],
      },
      {
        name: 'ultra-fast-groq',
        targetModel: 'llama-3.3-70b-versatile',
        rules: {
          maxCharacters: 150,
          patterns: ['summary', 'bullet point', 'tldr'],
        },
      },
    ],
    providers: {
      openai: { apiKey: env.OPENAI_API_KEY },
      anthropic: { apiKey: env.ANTHROPIC_API_KEY },
      gemini: { apiKey: env.GEMINI_API_KEY },
      groq: { apiKey: env.GROQ_API_KEY },
    },
    // Distributed Edge Semantic Cache powered by Cloudflare KV
    cache: {
      enabled: Boolean(env.CACHE_KV),
      threshold: 0.95,
      ttl: 3600, // 1 hour TTL
      store: env.CACHE_KV ? cloudflareKV(env.CACHE_KV) : undefined,
    },
  });

  const { app: routerServer } = await createEdgeRouteServer(config);
  return routerServer.fetch(c.req.raw);
});

export default app;
