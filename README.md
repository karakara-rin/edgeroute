<div align="center">

# ⚡️ EdgeRoute

**Edge-Ready AI Semantic Router & Dynamic Cost-Optimizing LLM Proxy**

Zero-latency rule matching + in-memory vector cosine similarity + OpenAI API drop-in compatibility.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Edge Ready](https://img.shields.io/badge/Runtime-Cloudflare%20Workers%20%7C%20Node%20%7C%20Bun-green.svg)](#)

</div>

---

## 🌟 Why EdgeRoute?

Most LLM routers are Python-heavy, slow to boot, and impossible to deploy directly to the edge (e.g. Cloudflare Workers, Fastly, Deno Deploy).

**EdgeRoute** is designed from the ground up for ultra-low latency edge environments:

- ⚡ **2-Tier Hybrid Routing**:
  - **Tier 1 (Fast-path)**: Regex & token constraints evaluated in **0.00ms**.
  - **Tier 2 (Semantic-path)**: In-memory cosine similarity against pre-embedded route vectors (**< 0.5ms**).
- 🚀 **Sub-Millisecond Semantic Cache ($0 Cost Immediate Hits)**: In-memory & Cloudflare KV caching layer that serves semantically equivalent past prompts (cosine similarity > threshold) with **< 1ms latency**, $0 API cost, and OpenAI-compatible SSE streaming support.
- 🌐 **Multi-Provider Support**: Seamlessly route between **Anthropic** (`claude-*`), **Google Gemini** (`gemini-*`), **Groq** (`llama-*`, `mixtral-*`, `deepseek-*`), and **OpenAI** (`gpt-*`, `o1`, `o3-mini`) using standard OpenAI client SDKs.
- 🧠 **True Semantic Embedding (Auto-Detected)**: Runtime auto-detection selects the best embedding provider — **Transformers.js** (ONNX `all-MiniLM-L6-v2`) for Node.js/Bun, **Cloudflare Workers AI** (`bge-small-en-v1.5`) for edge — with a zero-dependency lexical hash fallback.
- 🔄 **Drop-in OpenAI Compatibility**: Works instantly with OpenAI SDK, Vercel AI SDK, LangChain, and LlamaIndex simply by pointing `baseURL` to `http://localhost:3000/v1`.
- 🛡️ **Cross-Provider Automatic Failover**: Automatic retry against `defaultModel` (even across different AI providers) on downstream `429` (Rate Limit) or `5xx` server errors.
- 📊 **Real-time Cost Diagnostics**: Injects `X-EdgeRoute-Cache`, `X-EdgeRoute-Cost-Saved-USD`, `X-EdgeRoute-Provider`, and `X-EdgeRoute-Matched-Route` headers into responses.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    Client[Client App / OpenAI SDK / Vercel AI SDK] -->|POST /v1/chat/completions| Proxy[EdgeRoute Hono Proxy]
    
    subgraph Semantic Cache Layer
        Proxy --> CacheCheck{Semantic Cache Hit?}
        CacheCheck -- Hit (Cosine Sim >= 0.95) --> ReturnCache[Instant Cache Response < 1ms / $0]
    end

    subgraph Core Routing Engine
        CacheCheck -- Miss --> FastPath{Fast-Path Match?}
        FastPath -- Match Found (0ms) --> TargetModel[Target Model]
        
        FastPath -- No Match --> VectorCalc[Local Vector Calculation]
        VectorCalc --> CosineSim[Cosine Similarity vs In-Memory Examples]
        CosineSim --> ThresholdCheck{Score >= Threshold?}
        ThresholdCheck -- Yes --> TargetModel
        ThresholdCheck -- No --> DefaultModel[Default Model: gpt-5.6-sol / claude-sonnet-5]
    end

    TargetModel --> Dispatcher{Provider Adapter}
    DefaultModel --> Dispatcher

    Dispatcher -->|OpenAI| OpenAI[OpenAI API]
    Dispatcher -->|Anthropic| Anthropic[Anthropic Messages API]
    Dispatcher -->|Gemini| Gemini[Gemini OpenAI-Compat API]
    Dispatcher -->|Groq| Groq[Groq LPU Fast Inference]

    OpenAI --> Return[Return OpenAI Response + Diagnostic Headers]
    Anthropic --> Return
    Gemini --> Return
    Groq --> Return
    Return --> AsyncCache[Async Store to Semantic Cache]
    Return --> Client
    ReturnCache --> Client
```

---

## 🚀 Quickstart

Choose your deployment mode below:

### 🌟 Option A: Cloudflare Workers ($0/mo Edge Deployment)

Run a production LLM proxy worldwide at **$0 infrastructure cost** with Cloudflare Workers (100k req/day free), Workers AI ($0 free neural embeddings), and Cloudflare KV (sub-millisecond distributed cache).

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karakara-rin/edgeroute/tree/main/examples/cloudflare-workers)

```bash
# 1. Clone the ready-to-deploy Cloudflare Worker example
git clone https://github.com/karakara-rin/edgeroute.git
cd edgeroute/examples/cloudflare-workers && npm install

# 2. Create your free KV Cache namespace
npx wrangler kv namespace create CACHE_KV
# (Paste the generated id into wrangler.jsonc)

# 3. Configure your API key secrets & deploy in 1 click
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

---

### 🐳 Option B: Docker & docker-compose (Self-Hosted)

Run EdgeRoute with Docker anywhere (VPS, Fly.io, Render, AWS, GCP, or local machine) with zero installation:

```bash
# 1. Copy environment template
cp .env.example .env
# Edit .env with your OPENAI_API_KEY / ANTHROPIC_API_KEY

# 2. Launch with docker-compose
docker-compose up -d

# 3. EdgeRoute is ready at http://localhost:3000
curl http://localhost:3000/health
```

Or run directly with Docker CLI:

```bash
docker build -t edgeroute .
docker run -d -p 3000:3000 -e OPENAI_API_KEY="sk-..." edgeroute
```

---

### 💻 Option C: Node.js / TypeScript Proxy Server

#### 1. Installation

```bash
npm install @edgeroute/core @edgeroute/server
```

#### 2. Configure Router (`router.config.ts`)

```typescript
import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  // Default large reasoning model for fallback
  defaultModel: 'gpt-5.6-sol',

  // Providers configuration
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY },
    groq: { apiKey: process.env.GROQ_API_KEY },
  },

  // Embedding provider: 'auto' (default) auto-detects the best provider for your runtime
  //   - Cloudflare Workers → Workers AI (bge-small-en-v1.5, true semantic, $0)
  //   - Node.js / Bun → Transformers.js (all-MiniLM-L6-v2, true semantic, $0)
  //   - Fallback → Hash-based lexical matching (zero dependencies, NOT semantic)
  // Other options: 'transformers', 'workers-ai', 'openai', 'hash'
  embedding: {
    provider: 'auto',
  },

  // Sub-millisecond Semantic Cache configuration (In-Memory, Cloudflare KV, or Upstash Redis)
  cache: {
    enabled: true,
    threshold: 0.95, // Cosine similarity threshold
    ttl: 3600, // 1 hour TTL
    maxEntries: 1000,
    maxTemperature: 0.2, // Guardrail: only cache deterministic queries
  },

  // Proxy Authentication & Authorization
  auth: {
    apiKeys: [process.env.EDGEROUTE_API_KEY || 'sk-edgeroute-proxy-secret'],
  },

  // Rate Limiting (Sliding Window)
  rateLimit: {
    maxRequests: 100,
    windowMs: 60_000, // 100 requests per minute
  },

  // Security & Protection Guardrails
  security: {
    cors: true,
    maxBodySize: 5 * 1024 * 1024, // 5MB limit
  },

  routes: [
    {
      name: 'instant-greeting-and-qa',
      targetModel: 'gemini-3.7-flash',
      rules: {
        maxCharacters: 150,
        patterns: [/^(hello|hi|hey|こんにちは)/i],
      },
    },
    {
      name: 'high-speed-code-assist',
      targetModel: 'llama-3.3-70b-versatile',
      threshold: 0.7,
      examples: [
        'Format this JSON string properly',
        'Fix syntax error in this SQL query',
        'Convert this curl command to python requests',
      ],
    },
    {
      name: 'concise-writing',
      targetModel: 'claude-haiku-4-5',
      threshold: 0.75,
      examples: [
        'Fix typos and improve readability',
        'Summarize this customer feedback into bullet points',
      ],
    },
  ],
});
```

#### 3. Start the Proxy Server

```typescript
import { createEdgeRouteServer } from '@edgeroute/server';
import config from './router.config.js';

const { app } = await createEdgeRouteServer(config);

export default app; // For Cloudflare Workers or Node.js Hono adapter
```

#### 4. Use with OpenAI SDK

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:3000/v1', // Point to EdgeRoute
});

const response = await client.chat.completions.create({
  model: 'gpt-5.6-sol', // EdgeRoute will dynamically route or serve from cache!
  messages: [{ role: 'user', content: 'Hello! How are you?' }],
});
```


---

## ⚡ Next.js & Vercel AI SDK Integration (`@edgeroute/ai`)

EdgeRoute provides a first-class `LanguageModelV1` adapter for the [Vercel AI SDK](https://sdk.vercel.ai/docs). Use `streamText` or `generateText` directly in Next.js Route Handlers without spinning up a separate proxy server.

```bash
npm install @edgeroute/ai @edgeroute/core ai @ai-sdk/openai @ai-sdk/anthropic
```

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
      name: 'coding-expert',
      targetModel: 'claude-3-5-sonnet-20241022',
      rules: { patterns: ['refactor', 'architecture', 'typescript'] },
    },
    {
      name: 'quick-qa',
      targetModel: 'gpt-4o-mini',
      rules: { maxCharacters: 100 },
    },
  ],
  cache: { enabled: true, threshold: 0.95 },
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

---

## 🛠️ CLI & Diagnostic Tools (`@edgeroute/cli`)

EdgeRoute includes a rich CLI for offline routing verification, threshold auto-tuning, and embedding pre-compilation without booting a live proxy server.

```bash
npm install -g @edgeroute/cli
# or run via npx / pnpm
npx edgeroute --help
```

### 1. Local Dev Proxy Server with Real-Time Feedback (`edgeroute dev`)

Start the EdgeRoute proxy server locally with colorful real-time feedback showing routing matches, semantic cache hits, fallback retries, and estimated cost savings:

```bash
# Start local dev server (default: port 3000)
npx edgeroute dev

# Custom port and config path
npx edgeroute dev --port 8080 --config ./router.config.ts
```

**Real-Time Terminal Output Example:**
```text
🚀 EdgeRoute Dev Server running!
──────────────────────────────────────────────────
  • Local:   http://localhost:3000
  • Health:  http://localhost:3000/health
  • Proxy:   http://localhost:3000/v1/chat/completions
  • Default: gpt-4o
  • Routes:  2 configured
──────────────────────────────────────────────────

8:30:15 PM POST /v1/chat/completions 200 (14.2ms)
  [ROUTE 🎯] Matched "simple-qa" -> gpt-4o-mini (Saved $0.0042 vs gpt-4o)

8:30:18 PM POST /v1/chat/completions 200 (0.3ms)
  [HIT ⚡ 0.3ms] (Semantic Cache Hit, Saved $0.0050)

8:30:25 PM POST /v1/chat/completions 200 (450.0ms)
  [FALLBACK 🛡️] Primary model 429 -> Fallback to defaultModel (gpt-4o)
  [ROUTE 🎯] Matched "simple-qa" -> gpt-4o
```

### 2. Instant Prompt Routing Test (`edgeroute test`)

Debug and verify routing tier decisions, similarity scores, selected target model, and cost savings in 1 second directly from your terminal:

```bash
# Basic test
npx edgeroute test "Hello, what is the capital of France?"

# Verbose mode (view candidate route scores, token estimation, and complexity analysis)
npx edgeroute test "Write a distributed consensus engine in Rust" --verbose

# JSON output for CI / test automation
npx edgeroute test "Translate this to Japanese" --json
```

**Terminal Output Example:**
```text
⚡ Routing Decision for: "What is the capital of France?"
──────────────────────────────────────────────────
• Decision:   Tier 2 (Semantic Match)
• Matched:    "general-knowledge" (Score: 0.892, Threshold: 0.80)
• Target:     gpt-4o-mini (Provider: openai)
• Cost Est.:  $0.00015 (Default: $0.00500 -> Saved 97.0%)
• Latency:    0.34ms (Local vector math)
```

### 3. Dataset Simulation & Threshold Auto-Tuning (`edgeroute eval`)

Replay historical request logs against your routing configuration to measure cumulative cost savings and find the optimal threshold:

```bash
# Evaluate baseline against a dataset
npx edgeroute eval --dataset ./logs/prompts.jsonl

# Auto-tune threshold range for optimal accuracy/cost balance
npx edgeroute eval --dataset ./logs/prompts.jsonl --tune --threshold-range 0.5:0.95:0.05
```

### 4. Offline Vector Pre-Compiler (`edgeroute build-embeddings`)

Pre-compile route example vectors offline to eliminate edge cold-start overhead:

```bash
npx edgeroute build-embeddings --output router.embeddings.json
```

---

## 📡 Diagnostic Response Headers

EdgeRoute enriches every upstream response with transparent routing and caching metadata:

| Header Key | Example | Description |
| :--- | :--- | :--- |
| `X-EdgeRoute-Cache` | `HIT` \| `MISS` \| `BYPASS` \| `SKIPPED` | Semantic cache status |
| `X-EdgeRoute-Cache-Latency` | `0.08ms` | Semantic cache lookup time |
| `X-EdgeRoute-Matched-Route` | `instant-greeting-and-qa` | Name of matched route or `default` |
| `X-EdgeRoute-Target-Model` | `gemini-3.7-flash` | Actual model dispatched to or served from cache |
| `X-EdgeRoute-Provider` | `gemini` \| `anthropic` \| `groq` \| `openai` | Upstream provider utilized |
| `X-EdgeRoute-Path` | `fast-path` \| `semantic-path` \| `fallback` | Decision mechanism |
| `X-EdgeRoute-Score` | `0.8421` | Highest cosine similarity score |
| `X-EdgeRoute-Cost-Saved-USD` | `0.042300` | Estimated USD saved vs. `defaultModel` |
| `X-EdgeRoute-Cost-Saved-Percent` | `100%` | Percentage of cost saved |
| `X-EdgeRoute-Latency-Routing`| `0.12ms` | Microseconds elapsed for classification |
| `X-RateLimit-Limit` | `100` | Allowed requests in rate limit window |
| `X-RateLimit-Remaining` | `99` | Remaining requests in current window |
| `X-RateLimit-Reset` | `1724912400` | Epoch timestamp when the rate limit quota resets |

---

## 🔒 Security, Authentication & BYOK (Bring Your Own Key)

### 1. Proxy Authentication & Protection
- **Bearer & API Key Authentication**: Protect `/v1/*` endpoints using `auth.apiKeys` or custom `auth.validator`. Constant-time comparison prevents timing side-channel attacks.
- **Credential Isolation**: Client proxy tokens are securely isolated and never forwarded as LLM API keys upstream.
- **Sliding-Window Rate Limiting**: Mitigate DoS attacks and runaway costs via `rateLimit.maxRequests`.
- **CORS & Payload Guards**: Configure allowed origins and reject oversized request bodies via `security.maxBodySize`.

### 2. Multi-Provider BYOK Header Mapping
When using client-managed API keys across multiple routed providers:

| Provider | Supported BYOK Header |
| :--- | :--- |
| **OpenAI** | `x-openai-api-key` \| `x-provider-api-key` \| `Authorization: Bearer <key>` |
| **Anthropic** | `x-anthropic-api-key` \| `x-api-key` \| `x-provider-api-key` |
| **Google Gemini** | `x-goog-api-key` \| `x-gemini-api-key` \| `x-provider-api-key` |
| **Groq** | `x-groq-api-key` \| `x-provider-api-key` |

---

## 🗄️ Distributed Caching Across Multi-Instance Environments

For serverless edge deployments (Cloudflare Workers, Vercel Edge, AWS Lambda, Kubernetes pods), utilize distributed cache stores:

```typescript
import { UpstashRedisCacheStore } from '@edgeroute/core';

export default defineConfig({
  defaultModel: 'gpt-5.6-sol',
  cache: {
    enabled: true,
    threshold: 0.95,
    store: new UpstashRedisCacheStore({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      prefix: 'edgeroute:cache:',
    }),
  },
  routes: [/* ... */],
});
```

---

## 🧪 Testing & Verification

```bash
# Run Vitest test suite
npm test

# Run TypeScript type check
npm run typecheck

# Build ESM & CJS distribution bundles
npm run build
```

---

## 📄 License

MIT © [EdgeRoute Authors](https://github.com/edgeroute/edgeroute)
