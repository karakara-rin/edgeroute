# Next.js App Router + Vercel AI SDK with EdgeRoute

Minimal example demonstrating zero-latency semantic routing, dynamic multi-provider dispatch, and semantic caching using `@edgeroute/ai` in Next.js Edge Route Handlers.

## Features

- **LanguageModelV1 Compatibility**: Seamlessly drops into `streamText({ model: edgeroute(...) })` or `generateText({ model: edgeroute(...) })`.
- **Hybrid Dispatch**: Fast local routing rules + semantic vector matching dispatching to OpenAI (`gpt-4o-mini`) and Anthropic (`claude-3-5-sonnet`).
- **Semantic Caching**: Zero-latency cache hits served straight from memory/KV stores.
- **Observability**: Automatically injects routing decisions, latency, and estimated cost savings into headers (`x-edgeroute-*`) and `providerMetadata.edgeroute`.

## Quick Start

```bash
# Set your API keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Run development server
pnpm dev # or npm run dev
```

## Route Handler Code

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { edgeroute } from '@edgeroute/ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

export const runtime = 'edge';

const router = edgeroute({
  defaultModel: 'gpt-4o-mini',
  routes: [
    {
      name: 'complex-code',
      targetModel: 'claude-3-5-sonnet-20241022',
      rules: { patterns: ['refactor', 'architecture'] },
    },
    {
      name: 'quick-qa',
      targetModel: 'gpt-4o-mini',
      rules: { maxCharacters: 80 },
    },
  ],
  cache: { enabled: true },
  models: {
    'claude-3-5-sonnet-20241022': anthropic('claude-3-5-sonnet-20241022'),
    'gpt-4o-mini': openai('gpt-4o-mini'),
  },
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await streamText({
    model: router,
    messages,
  });
  return result.toDataStreamResponse();
}
```
