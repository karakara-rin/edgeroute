# EdgeRoute on Cloudflare Workers

Production-ready Cloudflare Workers deployment of EdgeRoute with **Cloudflare Workers KV distributed semantic caching**, multi-provider routing (OpenAI, Anthropic, Gemini, Groq), and OpenAI API drop-in compatibility.

## 🚀 Key Highlights

- **Edge-Native Zero-Cold-Start**: Runs directly on Cloudflare Workers with < 1ms routing decision latency.
- **Distributed Semantic Cache via KV**: Instant cache hits ($0 API cost, 0ms upstream latency) shared across 300+ global Cloudflare edge locations.
- **Universal OpenAI Proxy**: Works out-of-the-box with any OpenAI-compatible client, LangChain, Vercel AI SDK, or LlamaIndex.

## 🛠️ Quick Setup & Local Development

### 1. Create KV Namespace (Optional for Cache)

```bash
npx wrangler kv namespace create CACHE_KV
```

Copy the generated `id` into `wrangler.jsonc`.

### 2. Run Local Development Server

```bash
npm run dev
# Starts local worker on http://localhost:8787
```

### 3. Test with Curl / OpenAI SDK

```bash
# Test Fast-path routing to GPT-4o-mini
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hi there!"}]
  }'
```

### 4. Deploy to Cloudflare

```bash
npm run deploy
```
