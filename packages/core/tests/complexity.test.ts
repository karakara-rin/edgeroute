import { describe, it, expect } from 'vitest';
import {
  extractComplexityFeatures,
  calculateComplexityScore,
  ComplexityScorer,
} from '../src/complexity.js';
import { ComplexityClassifier } from '../src/classifier.js';
import type { EdgeRouteConfig } from '../src/types.js';

describe('extractComplexityFeatures & calculateComplexityScore', () => {
  it('should extract low complexity features for simple conversational queries', () => {
    const prompt = 'Hello! How are you today?';
    const features = extractComplexityFeatures(prompt);

    expect(features.codeDensity).toBeLessThan(0.2);
    expect(features.reasoningCues).toBe(0);
    expect(features.mathLogicDensity).toBe(0);
    expect(features.constraintCount).toBe(0);
    expect(features.characterCount).toBe(prompt.length);

    const score = calculateComplexityScore(features);
    expect(score).toBeLessThan(0.25);
  });

  it('should detect code blocks and programming keywords accurately', () => {
    const prompt = `Can you review this code?
\`\`\`typescript
interface User {
  id: string;
  name: string;
}

export async function getUser(id: string): Promise<User> {
  const res = await fetch(\`/api/users/\${id}\`);
  return res.json();
}
\`\`\``;
    const features = extractComplexityFeatures(prompt);
    expect(features.codeDensity).toBeGreaterThanOrEqual(0.6);

    const score = calculateComplexityScore(features);
    expect(score).toBeGreaterThan(0.35);
  });

  it('should detect multi-step reasoning and analytical cues in English and Japanese', () => {
    const promptEn =
      'Please analyze the root cause of this memory leak step by step and compare and contrast the tradeoffs of each fix.';
    const featuresEn = extractComplexityFeatures(promptEn);
    expect(featuresEn.reasoningCues).toBeGreaterThan(0.5);

    const promptJa =
      'この不具合の原因分析を行い、ステップバイステップで理由を考察し、最適なアルゴリズムを設計してください。';
    const featuresJa = extractComplexityFeatures(promptJa);
    expect(featuresJa.reasoningCues).toBeGreaterThan(0.5);
  });

  it('should detect mathematical LaTeX syntax and Big-O complexity notation', () => {
    const prompt =
      'Prove that the algorithm has $O(n \\log n)$ time complexity and solve $\\sum_{k=1}^n \\frac{1}{k^2} = \\frac{\\pi^2}{6}$.';
    const features = extractComplexityFeatures(prompt);
    expect(features.mathLogicDensity).toBeGreaterThan(0.5);

    const score = calculateComplexityScore(features);
    expect(score).toBeGreaterThan(0.35);
  });

  it('should score high for multi-layered hard reasoning prompts', () => {
    const hardPrompt = `Analyze the distributed consensus failure mode under Byzantine fault conditions:
1. 厳格に証明論理と図式推論ステップを示すこと
2. ビザンチン障害との違いを明確に対比すること
3. $O(N)$ メッセージ複雑度の導出過程を含めること
ステップバイステップで理由を考察しながら、徹底的に分析してください。
\`\`\`rust
pub async fn handle_vote(term: u64) -> Result<(), Error> {
  // deadlock check
}
\`\`\``;
    const features = extractComplexityFeatures(hardPrompt);
    const score = calculateComplexityScore(features);

    expect(features.codeDensity).toBeGreaterThan(0.4);
    expect(features.reasoningCues).toBeGreaterThan(0.5);
    expect(features.mathLogicDensity).toBeGreaterThan(0.4);
    expect(features.constraintCount).toBeGreaterThan(0.4);
    expect(score).toBeGreaterThan(0.65);
  });
});

describe('ComplexityScorer performance & latency', () => {
  it('should evaluate queries within < 0.5ms on average (Edge Performance)', () => {
    const scorer = new ComplexityScorer();
    const testPrompts = [
      'Hello world',
      'Translate this to French: The weather is sunny',
      'Explain the difference between useEffect and useLayoutEffect in React with examples',
      'Write a multi-threaded web server in C++ using epoll and non-blocking sockets with formal $O(1)$ dispatch proof',
    ];

    const latencies: number[] = [];

    // Warm-up run
    for (const p of testPrompts) {
      scorer.evaluate(p);
    }

    // Benchmark 100 runs
    for (let i = 0; i < 100; i++) {
      for (const p of testPrompts) {
        const start = performance.now();
        scorer.evaluate(p);
        latencies.push(performance.now() - start);
      }
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    expect(avgLatency).toBeLessThan(0.5);
  });

  it('should efficiently process very large prompts without CPU blocking', () => {
    const scorer = new ComplexityScorer();
    // 20,000 character prompt
    const largePrompt = `Please analyze the system performance.\n` + 'Some normal context sentence repeated.\n'.repeat(500);

    const start = performance.now();
    const result = scorer.evaluate(largePrompt);
    const duration = performance.now() - start;

    expect(result.features.characterCount).toBe(largePrompt.length);
    expect(result.features.estimatedTokens).toBeGreaterThan(4500);
    // Bounded scan ensures execution is well under 2ms even on 20k char text
    expect(duration).toBeLessThan(5);
  });
});

describe('ComplexityClassifier Dynamic Routing', () => {
  const config: EdgeRouteConfig = {
    defaultModel: 'gpt-5.6-sol',
    complexityThreshold: 0.55,
    routes: [
      {
        name: 'lightweight-fast',
        targetModel: 'gemini-3.7-flash',
        complexityThreshold: 0.55,
      },
    ],
  };

  const classifier = new ComplexityClassifier(config);

  it('should route simple prompt to gemini-3.7-flash', () => {
    const result = classifier.classify('Hello, please tell me a short joke!');
    expect(result.targetModel).toBe('gemini-3.7-flash');
    expect(result.matchedRoute).toBe('lightweight-fast');
    expect(result.path).toBe('complexity-path');
    expect(result.complexityScore).toBeLessThan(0.55);
  });

  it('should route high-complexity reasoning prompt to gpt-5.6-sol (frontier defaultModel)', () => {
    const complexPrompt = `Explain step by step with mathematical induction why $\\sum_{k=1}^n k = \\frac{n(n+1)}{2}$.
Must adhere strictly to:
1. Base case proof
2. Inductive step with $O(1)$ arithmetic explanation
3. Counterexample analysis for negative integers`;

    const result = classifier.classify(complexPrompt);
    expect(result.targetModel).toBe('gpt-5.6-sol');
    expect(result.matchedRoute).toBe('default');
    expect(result.path).toBe('fallback');
    expect(result.complexityScore).toBeGreaterThanOrEqual(0.55);
  });
});
