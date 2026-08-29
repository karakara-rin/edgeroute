# EdgeRoute on Cloudflare Workers ($0/mo Edge Deployment)

Production-ready Cloudflare Workers deployment of EdgeRoute with **Cloudflare Workers AI for $0 neural embeddings**, **Cloudflare KV distributed semantic caching**, multi-provider routing (OpenAI, Anthropic, Gemini, Groq), and OpenAI API drop-in compatibility.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karakara-rin/edgeroute/tree/main/examples/cloudflare-workers)

---

## 🚀 Key Highlights & $0 Architecture

- **$0 Infrastructure Cost**: 100,000 requests/day free on Cloudflare Workers Free Tier.
- **$0 True Neural Embeddings**: Runs `@cf/baai/bge-small-en-v1.5` on Cloudflare Workers AI with 0 API cost.
- **$0 Sub-Millisecond Semantic Cache**: Instant cache hits served via Cloudflare KV across 300+ global edge locations.
- **Universal Drop-in OpenAI Proxy**: Works out-of-the-box with any OpenAI SDK, Vercel AI SDK, LangChain, or LlamaIndex.

---

## ⚡️ 3-Step Deployment Guide ($0 Total Cost)

### Step 1: Clone & Create KV Namespace

```bash
# Clone and enter the example directory
cd examples/cloudflare-workers
npm install

# Create a Cloudflare KV namespace for distributed caching
npx wrangler kv namespace create CACHE_KV
```

Copy the generated `id` and paste it into `wrangler.jsonc`:
```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE_KV",
    "id": "<YOUR_GENERATED_KV_ID>"
  }
]
```

### Step 2: Set Secret API Keys

Configure your upstream LLM provider API keys securely as Cloudflare Secrets:

```bash
# Set OpenAI API Key
npx wrangler secret put OPENAI_API_KEY

# Set Anthropic API Key (optional)
npx wrangler secret put ANTHROPIC_API_KEY

# Set Google Gemini API Key (optional)
npx wrangler secret put GEMINI_API_KEY

# Set Groq API Key (optional)
npx wrangler secret put GROQ_API_KEY
```

### Step 3: Deploy to Cloudflare Workers

```bash
npm run deploy
```

Your EdgeRoute proxy is now live worldwide at `https://edgeroute-worker.<your-subdomain>.workers.dev`!

---

## 🧪 Testing Your Deployed Proxy

### 1. Health Check & Diagnostics

```bash
curl https://edgeroute-worker.<your-subdomain>.workers.dev/health
# Response: {"status":"ok","runtime":"cloudflare-workers","edgeNative":true,"workersAi":true,"kvCache":true}
```

### 2. OpenAI SDK Integration

Simply point your `baseURL` to your Cloudflare Worker URL:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'any-dummy-string', // Handled securely by Cloudflare Worker secrets
  baseURL: 'https://edgeroute-worker.<your-subdomain>.workers.dev/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o', // EdgeRoute will dynamically route to gpt-4o-mini or claude-sonnet based on complexity
  messages: [{ role: 'user', content: 'Explain quantum computing in one short sentence.' }],
});

console.log(response.choices[0].message.content);
```

### 3. Curl Test

```bash
curl https://edgeroute-worker.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hi there!"}]
  }'
```

