---
title: "Cloudflare Workers上で動く爆速LLMルーターOSS「EdgeRoute」を作った話（$0運用・セマンティックキャッシュ・AIフル活用開発記）"
emoji: "⚡"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["cloudflare", "llm", "openai", "typescript", "oss"]
published: true
---

## はじめに：まずは完成したものを見てほしい

LLMを使ったアプリケーションを開発・運用していると、必ずぶち当たる3大問題があります。

1. **APIコストが高すぎる**（すべてのリクエストをGPT-5.6 SolやClaude Sonnet 5などの最高峰推論モデルに投げて破産しそうになる）
2. **レスポンスが遅い**（簡単な処理でもLLMの推論待ちで数秒かかる）
3. **レートリミット（429エラー）でアプリが止まる**

これらの課題を解決するために、Cloudflare Workers上で**月額$0・遅延0ms台**で動くLLMルーティング＆セマンティックキャッシュOSS **「EdgeRoute」** を開発しました！

https://github.com/karakara-rin/edgeroute

```typescript
// 既存のOpenAIクライアントのbaseURLを変えるだけ！
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://your-edgeroute.workers.dev/v1', // EdgeRouteに向ける
});

// 簡単な挨拶・定型文 → 超高速・格安モデルへ自動ルーティング (またはキャッシュから0.3ms/$0返却)
// 複雑なコーディング・推論 → 最強モデルへルーティング
const res = await client.chat.completions.create({
  model: 'gpt-5.6-sol', // EdgeRouteが裏でよしなに最適化！
  messages: [{ role: 'user', content: 'こんにちは！' }],
});
```

この記事では、
- **なぜこのOSSを作ろうとしたのか？**
- **「最初はあまりAIを使わずに開発しよう」としていたのに、結局AIをフル活用することになったリアルな開発裏話**
- **触って実感した「Cloudflareのエッジエコシステム」の圧倒的なすごさ**
- **（まだまだ未完成なので）フィードバック＆Contributor大募集！**

について紹介します。

---

## 1. なぜ「EdgeRoute」を作ろうとしたのか？

### LLMルーターはPython製ばかりで「重い・エッジで動かない」

「プロンプトの内容に応じて、**爆速・軽量なコスト最適化モデル（Gemini 3.7 Flash、GPT-5.6 Luna、Claude Haiku 4.5、Groq上のLlama 3.3など）** と、**複雑なアーキテクチャ設計や推論に強いフラグシップモデル（Claude Sonnet 5 / Opus 5、GPT-5.6 Sol、o1 / o3-miniなど）** を自動で賢く振り分けたい」という需要は非常に大きいです。

しかし、既存のLLM Routerライブラリの多くは**Python製**でした。
- Dockerコンテナを常時起動する必要がある（毎月サーバー代がかかる）
- サーバーレスで動かすとコールドスタートが数秒かかる
- ルーティング処理自体のオーバーヘッドでレイテンシを損する

```
【ユーザー】 ──(遠いサーバーへの往復)──> 【重いPythonプロキシ】 ──> 【各社LLM API】
```

**「ルーターのために毎月サーバー代を払いたくないし、コールドスタートも0にしてユーザー最寄りのエッジ（Cloudflare Workers）で0ms台で裁きたい」**

そう考え、**TypeScript native × エッジファースト（Cloudflare Workers / Bun / Node.js）** で動く超軽量プロキシをゼロから設計することにしました。

---

## 2. 「最初はAIを使わないつもりだった」のに、結局めっちゃ使った開発裏話

開発初期、ちょっとした心変わりがありました。

「たまにはアルゴリズムやプロトコル仕様を自分の手でガッツリ書いて、エンジニアとしての基礎体力を試してみよう」と、**最初はAIを極力縛ってコーディング**を始めたのです。

……が、すぐに現実の壁にぶつかりました。

### 直面した泥臭い課題たち

1. **マルチプロバイダーのSSEストリーミング仕様の微妙な差異**  
   OpenAI互換プロキシを作るには、Server-Sent Events（SSE）のチャンクを各プロバイダー（Anthropic Messages API、Google Gemini、Groq）からリアルタイムに変換する必要があります。Anthropic独自のイベント形式やGeminiの仕様差をハンドリングしてテストを書くのは、想像を絶する泥臭さでした。
2. **Cloudflare Workersのランタイム制約**  
   Node.jsなら動く標準APIや外部ライブラリが、Cloudflare Workers（V8 Isolate）環境では動かないケースが多発。

### そしてAIを解禁した結果……

```
「これは素直にAIの力を借りた方が絶対に良いものができる！」
```

AI（ペアプロ）を本格投入したところ、
- 各プロバイダーのSSEストリーミングを統一OpenAIフォーマットに落とし込む変換レイヤー
- Cloudflare WorkersとNode.js両対応のRuntime判定とPolyfill
- コサイン類似度（Vector Math）のインメモリ高速計算
- エッジケースを網羅するテストケース群

が**驚異的なスピードで組み上がっていきました。**

:::message
**【実感したこと】**
プロトコル変換や型定義の差異を意地で手書きするよりも、AIを「設計の壁打ち相手 兼 超優秀なペアプログラマー」としてフル活用することで、コードの堅牢性も開発スピードも桁違いに高まりました。
:::

---

## 3. 作ったOSS「EdgeRoute」のアーキテクチャ

EdgeRouteは、レイテンシとコストを極限まで削る設計になっています。

```mermaid
flowchart TD
    Client[Client App / OpenAI SDK] -->|POST /v1/chat/completions| Proxy[EdgeRoute Hono Proxy]
    
    subgraph Semantic Cache Layer
        Proxy --> CacheCheck{Semantic Cache Hit?}
        CacheCheck -- Hit (Cosine Sim >= 0.95) --> ReturnCache[⚡ 0.3ms / $0 キャッシュ即返却]
    end

    subgraph Core Routing Engine
        CacheCheck -- Miss --> FastPath{Tier 1: Fast-Path Match?}
        FastPath -- Match (0.00ms) --> TargetModel[Target Model]
        
        FastPath -- No Match --> VectorCalc[Tier 2: ベクトル計算]
        VectorCalc --> CosineSim[コサイン類似度 判定 (< 0.5ms)]
        CosineSim --> ThresholdCheck{類似度 >= しきい値?}
        ThresholdCheck -- Yes --> TargetModel
        ThresholdCheck -- No --> DefaultModel[Default Model: gpt-5.6-sol / claude-sonnet-5]
    end

    TargetModel --> Dispatcher{Provider Adapter}
    DefaultModel --> Dispatcher

    Dispatcher -->|OpenAI / Anthropic / Gemini / Groq| LLM[各社 LLM API]
    LLM --> Return[レスポンス返却 + 削減コスト等の独自ヘッダー]
    Return --> Client
```

### 主な機能
- ⚡ **2段階（2-Tier）ハイブリッドルーティング**:
  - **Tier 1 (Fast-Path: 0.00ms)**: 正規表現や文字数制限で瞬時にマッチ判定。
  - **Tier 2 (Semantic-Path: < 0.5ms)**: 事前計算されたルートベクトルとのインメモリコサイン類似度で判定。
- 🚀 **サブミリ秒セマンティックキャッシュ（APIコスト $0）**:  
  過去の類似プロンプトをエッジ上で判定。類似度0.95以上の場合は、上流LLMを呼ばずに**0.3ms・コスト$0**でキャッシュからSSEストリーミング返却。
- 🛡️ **クロスプロバイダー自動フェイルオーバー**:  
  GroqやGeminiがレートリミット（429）や障害（5xx）を起こした際、自動的にOpenAIやAnthropicなど別プロバイダーへフォールバック。
- 📊 **削減コストのリアルタイム可視化**:  
  レスポンスヘッダーに節約できたコスト（USD）やキャッシュ状況を透過的に付与。

---

## 4. Cloudflareのエッジスタックがマジで異次元だった

今回EdgeRouteをCloudflare Workersに対応させてみて、**「Cloudflareエコシステムの凶悪な強さ」** を改めて実感しました。

### ① Workers AI（エッジ上で動く無料の埋め込みモデル）
セマンティックルーティングにはテキストの埋め込み（Embedding）が必要です。
通常はOpenAIのEmbedding APIを呼ぶ必要がありますが、それだと「ルーティングするために外部APIのRTT（100ms〜）を待つ」という本末転倒な事態になります。

Cloudflare Workersなら、**Workers AIの `bge-small-en-v1.5` が無料枠内でエッジ上で直接動き、外部API呼び出しの遅延ゼロでベクトル化**できます。

### ② Cloudflare KV（超高速な分散キャッシュ）
セマンティックキャッシュの保存先としてCloudflare KVを指定するだけで、世界中のエッジノードでキャッシュが共有・高速ヒットします。

### ③ これらが「$0（無料枠）」で動く驚異
- **Cloudflare Workers**: 1日10万リクエストまで無料
- **Workers AI**: 毎日無料クォータあり
- **Cloudflare KV**: 無料枠あり

個人開発や小〜中規模サービスなら、**インフラ費用$0で世界中に分散したインテリジェントLLMプロキシ**が手に入ります。

---

## 5. 【大募集】まだまだ未完成なので、フィードバック＆Contributorを募集しています！

EdgeRouteはコア機能（ルーティング、セマンティックキャッシュ、プロバイダー連携、CLI）が動き始めたばかりで、**まだまだ荒削りな部分や改善したいアイデアがたくさんある発展途上のOSS**です。

### ぜひ使ってみて、ご意見をください！

```bash
# CLIで手軽にルーティングをテストできます
npx @edgeroute/cli test "JSONのフォーマットを整形して"

# ローカルでプロキシサーバーを起動
npx @edgeroute/cli dev
```

- 「こういうルーティングルールが欲しい」
- 「このプロバイダー（Mistral, Ollama, Bedrockなど）にも対応してほしい」
- 「実際に動かしてみたらここで詰まった」

など、どんな些細なことでも構いません。Issuesやディスカッションでフィードバックをいただけるとめちゃくちゃ励みになります！

### Contributorも大歓迎です！ 🤝
- 新しいLLMプロバイダーのアダプター実装
- ドキュメント・サンプルの拡充
- Webダッシュボードやメトリクス可視化の強化
- バグ修正やパフォーマンス改善

「ちょっとPR出してみようかな」という方、大歓迎です！ぜひ気軽にリポジトリを覗いてみてください。

👉 **GitHub**: [https://github.com/karakara-rin/edgeroute](https://github.com/karakara-rin/edgeroute)

少しでも「面白い！」「応援したい！」と思っていただけたら、GitHubで **⭐（Star）** を押していただけると飛び跳ねて喜びます！

最後まで読んでいただきありがとうございました！
