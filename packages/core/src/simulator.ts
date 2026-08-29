import { ComplexityScorer, type ComplexityEvaluationResult } from './complexity.js';
import { calculateTokenCost, compareRoutingCost } from './cost.js';
import type { ModelPricing } from './types.js';

export type ComplexityDifficultyLevel = 'simple' | 'medium' | 'hard';

export interface ComplexityBenchmarkPrompt {
  id: string;
  category: 'chat' | 'coding' | 'reasoning' | 'math' | 'translation' | 'data-processing';
  expectedDifficulty: ComplexityDifficultyLevel;
  prompt: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface SimulationItemResult {
  id: string;
  category: string;
  expectedDifficulty: ComplexityDifficultyLevel;
  evaluation: ComplexityEvaluationResult;
  selectedModel: string;
  isFrontierModel: boolean;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  hypotheticalDefaultCostUSD: number;
  savedUSD: number;
  correctlyRouted: boolean;
}

export interface ComplexitySimulationReport {
  totalPrompts: number;
  distribution: {
    targetModelCount: number;
    targetModelPercentage: number;
    defaultModelCount: number;
    defaultModelPercentage: number;
  };
  latency: {
    avgMs: number;
    p95Ms: number;
    maxMs: number;
  };
  costs: {
    actualCostUSD: number;
    hypotheticalDefaultCostUSD: number;
    savedUSD: number;
    savingsPercentage: number;
  };
  accuracy: {
    correctRoutingCount: number;
    accuracyPercentage: number;
  };
  itemResults: SimulationItemResult[];
}

export interface ComplexitySimulationOptions {
  targetModel?: string;
  defaultModel?: string;
  complexityThreshold?: number;
  customPricing?: Record<string, ModelPricing>;
  scorer?: ComplexityScorer;
}

export const STANDARD_COMPLEXITY_DATASET: ComplexityBenchmarkPrompt[] = [
  // High-frequency Simple category (75% of realistic web/API traffic)
  {
    id: 'simple-01',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt: 'こんにちは！今日の天気を教えてください。',
    estimatedInputTokens: 25,
    estimatedOutputTokens: 60,
  },
  {
    id: 'simple-02',
    category: 'translation',
    expectedDifficulty: 'simple',
    prompt: 'Translate "Good morning, how are you today?" into Spanish.',
    estimatedInputTokens: 20,
    estimatedOutputTokens: 30,
  },
  {
    id: 'simple-03',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt: 'Tell me a lighthearted programming joke.',
    estimatedInputTokens: 15,
    estimatedOutputTokens: 50,
  },
  {
    id: 'simple-04',
    category: 'data-processing',
    expectedDifficulty: 'simple',
    prompt: 'Format this list into a clean Markdown bulleted list: Apple, Banana, Orange, Grape.',
    estimatedInputTokens: 30,
    estimatedOutputTokens: 40,
  },
  {
    id: 'simple-05',
    category: 'translation',
    expectedDifficulty: 'simple',
    prompt: '次の文章を英語に翻訳してください：「明日の会議は10時からです」',
    estimatedInputTokens: 30,
    estimatedOutputTokens: 30,
  },
  {
    id: 'simple-06',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt: 'Can you write a polite 2-sentence email thanking a client for their time?',
    estimatedInputTokens: 35,
    estimatedOutputTokens: 70,
  },
  {
    id: 'simple-07',
    category: 'data-processing',
    expectedDifficulty: 'simple',
    prompt: 'Convert these dates from YYYY-MM-DD to DD/MM/YYYY: 2026-01-15, 2026-08-26, 2026-12-31.',
    estimatedInputTokens: 45,
    estimatedOutputTokens: 50,
  },
  {
    id: 'simple-08',
    category: 'translation',
    expectedDifficulty: 'simple',
    prompt: 'Translate "Thank you for your assistance" into German, French, and Japanese.',
    estimatedInputTokens: 30,
    estimatedOutputTokens: 60,
  },
  {
    id: 'simple-09',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt: 'Give me 3 synonyms for the word "innovative".',
    estimatedInputTokens: 20,
    estimatedOutputTokens: 40,
  },
  {
    id: 'simple-10',
    category: 'data-processing',
    expectedDifficulty: 'simple',
    prompt: 'Remove duplicate words from this list: cat, dog, bird, cat, fish, dog.',
    estimatedInputTokens: 35,
    estimatedOutputTokens: 40,
  },
  {
    id: 'simple-11',
    category: 'data-processing',
    expectedDifficulty: 'simple',
    prompt:
      'Classify the sentiment of this review as POSITIVE, NEGATIVE, or NEUTRAL: "The interface is very intuitive and fast!"',
    estimatedInputTokens: 30,
    estimatedOutputTokens: 10,
  },
  {
    id: 'simple-12',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt:
      'Summarize this in one sentence: Cloudflare Workers is a serverless execution environment that allows you to run code close to your users.',
    estimatedInputTokens: 35,
    estimatedOutputTokens: 25,
  },
  {
    id: 'simple-13',
    category: 'data-processing',
    expectedDifficulty: 'simple',
    prompt: 'Fix grammar: "She dont like coffee because its to bitter."',
    estimatedInputTokens: 20,
    estimatedOutputTokens: 20,
  },
  {
    id: 'simple-14',
    category: 'chat',
    expectedDifficulty: 'simple',
    prompt: 'Generate 5 headline ideas for a tech newsletter about TypeScript and edge computing.',
    estimatedInputTokens: 25,
    estimatedOutputTokens: 60,
  },
  {
    id: 'simple-15',
    category: 'translation',
    expectedDifficulty: 'simple',
    prompt: 'Translate to Japanese: "Welcome to our platform, please check your inbox for verification."',
    estimatedInputTokens: 25,
    estimatedOutputTokens: 30,
  },

  // Medium category (Refactoring functions, structured extraction, straightforward explanations)
  {
    id: 'medium-01',
    category: 'coding',
    expectedDifficulty: 'medium',
    prompt: `Refactor this JavaScript function to use async/await and add error handling:
\`\`\`javascript
function fetchData(url) {
  return fetch(url).then(res => res.json());
}
\`\`\``,
    estimatedInputTokens: 60,
    estimatedOutputTokens: 120,
  },
  {
    id: 'medium-02',
    category: 'data-processing',
    expectedDifficulty: 'medium',
    prompt:
      'Extract user information (Name, Email, Age) from this text and return strictly valid JSON: "John Doe is a 29 year old engineer reaching out from john@example.com".',
    estimatedInputTokens: 65,
    estimatedOutputTokens: 80,
  },
  {
    id: 'medium-03',
    category: 'coding',
    expectedDifficulty: 'medium',
    prompt: 'Write a TypeScript regular expression to validate E.164 international phone numbers with explanation.',
    estimatedInputTokens: 45,
    estimatedOutputTokens: 150,
  },

  // Hard category (Deep multi-step algorithmic reasoning, formal proofs, concurrency deadlock debugging)
  {
    id: 'hard-01',
    category: 'coding',
    expectedDifficulty: 'hard',
    prompt: `Analyze the following Rust asynchronous code for race conditions and potential deadlocks under high concurrency. Explain the root cause step by step, provide a formal fix using tokio synchronization primitives, and analyze time/space complexity:
\`\`\`rust
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

struct Database {
    cache: RwLock<HashMap<String, String>>,
    writer_lock: Mutex<()>,
}

impl Database {
    async fn update(&self, key: String, val: String) {
        let _guard = self.writer_lock.lock().await;
        let mut map = self.cache.write().await;
        map.insert(key, val);
    }
}
\`\`\``,
    estimatedInputTokens: 180,
    estimatedOutputTokens: 450,
  },
  {
    id: 'hard-02',
    category: 'math',
    expectedDifficulty: 'hard',
    prompt:
      'Prove by mathematical induction that for all integers $n \\ge 1$, $\\sum_{k=1}^n k^3 = \\left(\\frac{n(n+1)}{2}\\right)^2$. Write down every step of the base case and inductive step with rigorous LaTeX mathematical notation.',
    estimatedInputTokens: 110,
    estimatedOutputTokens: 400,
  },
];

/**
 * Runs a full simulation over a dataset to benchmark routing accuracy, latency, and cost savings.
 */
export function evaluateComplexityRouting(
  dataset: ComplexityBenchmarkPrompt[] = STANDARD_COMPLEXITY_DATASET,
  options: ComplexitySimulationOptions = {},
): ComplexitySimulationReport {
  const targetModel = options.targetModel || 'gemini-3.7-flash';
  const defaultModel = options.defaultModel || 'gpt-5.6-sol';
  const threshold = options.complexityThreshold ?? 0.55;
  const scorer = options.scorer || new ComplexityScorer();

  const itemResults: SimulationItemResult[] = [];
  const latencies: number[] = [];

  let targetModelCount = 0;
  let defaultModelCount = 0;
  let totalActualCostUSD = 0;
  let totalHypotheticalDefaultCostUSD = 0;
  let correctRoutingCount = 0;
  // Micro warm-up for V8 JIT compiler
  scorer.evaluate('warmup init');

  for (const item of dataset) {
    const evalResult = scorer.evaluate(item.prompt);
    latencies.push(evalResult.latencyMs);

    const isComplex = evalResult.score >= threshold;
    const selectedModel = isComplex ? defaultModel : targetModel;

    if (isComplex) {
      defaultModelCount++;
    } else {
      targetModelCount++;
    }

    const actualCostUSD = calculateTokenCost(
      selectedModel,
      item.estimatedInputTokens,
      item.estimatedOutputTokens,
      options.customPricing,
    );
    const hypotheticalDefaultCostUSD = calculateTokenCost(
      defaultModel,
      item.estimatedInputTokens,
      item.estimatedOutputTokens,
      options.customPricing,
    );
    const savedUSD = Math.max(0, hypotheticalDefaultCostUSD - actualCostUSD);

    totalActualCostUSD += actualCostUSD;
    totalHypotheticalDefaultCostUSD += hypotheticalDefaultCostUSD;

    // Check routing appropriateness:
    // Simple -> targetModel (correct)
    // Hard -> defaultModel (correct)
    // Medium -> either is acceptable (usually target or default based on score)
    let correctlyRouted = false;
    if (item.expectedDifficulty === 'simple') {
      correctlyRouted = !isComplex;
    } else if (item.expectedDifficulty === 'hard') {
      correctlyRouted = isComplex;
    } else {
      // For medium tasks, both are considered valid routing decisions
      correctlyRouted = true;
    }

    if (correctlyRouted) {
      correctRoutingCount++;
    }

    itemResults.push({
      id: item.id,
      category: item.category,
      expectedDifficulty: item.expectedDifficulty,
      evaluation: evalResult,
      selectedModel,
      isFrontierModel: isComplex,
      inputTokens: item.estimatedInputTokens,
      outputTokens: item.estimatedOutputTokens,
      costUSD: Number(actualCostUSD.toFixed(6)),
      hypotheticalDefaultCostUSD: Number(hypotheticalDefaultCostUSD.toFixed(6)),
      savedUSD: Number(savedUSD.toFixed(6)),
      correctlyRouted,
    });
  }

  latencies.sort((a, b) => a - b);
  const avgMs =
    latencies.length > 0
      ? Number((latencies.reduce((acc, v) => acc + v, 0) / latencies.length).toFixed(3))
      : 0;
  const p95Idx = Math.floor(latencies.length * 0.95);
  const p95Ms = latencies[p95Idx] ?? (latencies[latencies.length - 1] || 0);
  const maxMs = latencies[latencies.length - 1] || 0;

  const totalPrompts = dataset.length;
  const savedUSD = Math.max(0, totalHypotheticalDefaultCostUSD - totalActualCostUSD);
  const savingsPercentage =
    totalHypotheticalDefaultCostUSD > 0
      ? Number(((savedUSD / totalHypotheticalDefaultCostUSD) * 100).toFixed(2))
      : 0;

  return {
    totalPrompts,
    distribution: {
      targetModelCount,
      targetModelPercentage: Number(((targetModelCount / totalPrompts) * 100).toFixed(1)),
      defaultModelCount,
      defaultModelPercentage: Number(((defaultModelCount / totalPrompts) * 100).toFixed(1)),
    },
    latency: {
      avgMs,
      p95Ms: Number(p95Ms.toFixed(3)),
      maxMs: Number(maxMs.toFixed(3)),
    },
    costs: {
      actualCostUSD: Number(totalActualCostUSD.toFixed(6)),
      hypotheticalDefaultCostUSD: Number(totalHypotheticalDefaultCostUSD.toFixed(6)),
      savedUSD: Number(savedUSD.toFixed(6)),
      savingsPercentage,
    },
    accuracy: {
      correctRoutingCount,
      accuracyPercentage: Number(((correctRoutingCount / totalPrompts) * 100).toFixed(1)),
    },
    itemResults,
  };
}

export const runComplexitySimulation = evaluateComplexityRouting;

