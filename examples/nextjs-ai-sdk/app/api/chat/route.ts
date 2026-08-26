import { createDataStreamResponse, streamText } from 'ai';
import { edgeroute } from '@edgeroute/ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// Edge Runtime compatible (Cloudflare Workers / Vercel Edge / Node.js)
export const runtime = 'edge';

export async function POST(req: Request) {
  const { messages } = await req.json();

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const router = edgeroute({
        defaultModel: 'gpt-4o-mini',
        routes: [
          {
            name: 'complex-code',
            targetModel: 'claude-3-5-sonnet-20241022',
            rules: {
              minCharacters: 300,
              patterns: ['refactor', 'architecture', 'kubernetes', 'compiler', 'typescript'],
            },
            examples: [
              'Write a concurrent queue in Rust with Tokio',
              'Design a microservices architecture with distributed transactions',
            ],
          },
          {
            name: 'quick-qa',
            targetModel: 'gpt-4o-mini',
            rules: {
              maxCharacters: 80,
            },
            examples: [
              'What is the capital of France?',
              'Translate hello to Spanish',
            ],
          },
        ],
        cache: {
          enabled: true,
          threshold: 0.95,
          ttl: 3600,
        },
        models: {
          'claude-3-5-sonnet-20241022': anthropic('claude-3-5-sonnet-20241022'),
          'gpt-4o-mini': openai('gpt-4o-mini'),
        },
        onRouteMatched: (result, savings) => {
          // Send real-time routing telemetry to client UI
          dataStream.writeData({
            type: 'edgeroute-telemetry',
            targetModel: result.targetModel,
            matchedRoute: result.matchedRoute,
            path: result.path,
            latencyMs: result.latencyMs,
            savingsPercentage: savings?.savingsPercentage ?? 0,
          });
        },
      });

      const result = await streamText({
        model: router,
        messages,
      });

      result.mergeIntoDataStream(dataStream);
    },
  });
}
