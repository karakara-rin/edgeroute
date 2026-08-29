import pc from 'picocolors';
import {
  createEmbeddingProvider,
  SemanticClassifier,
  estimateTokens,
  compareRoutingCost,
  cosineSimilarity,
  matchesFastPath,
  type EdgeRouteConfig,
  type RouteDefinition,
  type ClassificationResult,
  type EmbeddingProvider,
  type CostSavingsComparison,
} from '@edgeroute/core';
import { loadConfig } from '../utils/config-loader.js';

export interface TestCommandOptions {
  config?: string;
  verbose?: boolean;
  json?: boolean;
  cwd?: string;
}

export interface CandidateRouteScore {
  name: string;
  targetModel: string;
  provider?: string;
  threshold: number;
  score?: number;
  matched: boolean;
  matchType: 'rule' | 'semantic' | 'complexity' | 'none';
  matchedDetail?: string;
}

export interface RouteTestResult {
  prompt: string;
  decision: 'fast-path' | 'semantic-path' | 'complexity-path' | 'fallback';
  decisionLabel: string;
  matchedRoute: string;
  targetModel: string;
  provider: string;
  score: number;
  threshold?: number;
  latencyMs: number;
  matchedPatternOrExample?: string;
  cost: {
    inputTokens: number;
    estimatedOutputTokens: number;
    targetCostUSD: number;
    defaultCostUSD: number;
    savingsUSD: number;
    savingsPercentage: number;
  };
  complexity?: {
    score: number;
    features: Record<string, number>;
  };
  allRoutes?: CandidateRouteScore[];
}

export async function testCommand(
  prompt: string,
  options: TestCommandOptions = {},
): Promise<RouteTestResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(options.config, cwd);

  const providerOrPromise = createEmbeddingProvider(config);
  const provider: EmbeddingProvider =
    providerOrPromise instanceof Promise ? await providerOrPromise : providerOrPromise;

  const classifier = new SemanticClassifier(config, provider);
  await classifier.initialize();

  const classification = await classifier.classify(prompt);

  const matchedRouteDef = config.routes.find((r) => r.name === classification.matchedRoute);
  const targetModel = classification.targetModel;
  const defaultModel = config.defaultModel;
  const targetProvider = matchedRouteDef?.provider ?? 'openai';

  let decisionLabel = 'Tier 3 (Default Fallback)';
  if (classification.path === 'fast-path') {
    decisionLabel = 'Tier 1 (Fast-Path Rule)';
  } else if (classification.path === 'semantic-path') {
    decisionLabel = 'Tier 2 (Semantic Match)';
  } else if (classification.path === 'complexity-path') {
    decisionLabel = 'Tier 2 (Complexity Match)';
  }

  // Token & Cost estimation
  const inputTokens = estimateTokens(prompt);
  const estimatedOutputTokens = Math.max(50, Math.round(inputTokens * 1.5));
  const costSavings = compareRoutingCost(
    targetModel,
    defaultModel,
    inputTokens,
    estimatedOutputTokens,
    config.customPricing,
  );

  // Evaluate candidate routes for detailed telemetry / verbose reporting
  let promptVector: number[] | null = null;
  const candidateRoutes: CandidateRouteScore[] = [];

  for (const route of config.routes) {
    const isMatched = route.name === classification.matchedRoute;
    let matchType: 'rule' | 'semantic' | 'complexity' | 'none' = 'none';
    let bestScore: number | undefined;
    let detail: string | undefined;

    // Check fast-path rule
    if (route.rules) {
      const fp = matchesFastPath(prompt, route.rules, classification.complexityScore);
      if (fp.matched) {
        matchType = 'rule';
        bestScore = 1.0;
        detail = fp.pattern;
      }
    }

    // Check semantic examples if not matched by rule
    if (matchType === 'none' && route.examples && route.examples.length > 0) {
      if (!promptVector) {
        promptVector = await provider.embed(prompt);
      }
      const exampleVectors = await provider.embedBatch(route.examples);
      let highestScore = -1;
      let highestExample = '';

      for (let i = 0; i < route.examples.length; i++) {
        const sim = cosineSimilarity(promptVector, exampleVectors[i]!);
        if (sim > highestScore) {
          highestScore = sim;
          highestExample = route.examples[i]!;
        }
      }

      bestScore = Number(highestScore.toFixed(4));
      if (highestScore >= route.threshold) {
        matchType = 'semantic';
        detail = highestExample;
      } else {
        detail = `Closest: "${highestExample}" (Score: ${bestScore})`;
      }
    }

    // Check route-level complexity
    if (
      matchType === 'none' &&
      route.complexityThreshold !== undefined &&
      classification.complexityScore !== undefined
    ) {
      bestScore = classification.complexityScore;
      if (classification.complexityScore <= route.complexityThreshold) {
        matchType = 'complexity';
        detail = `complexity ${classification.complexityScore} <= threshold ${route.complexityThreshold}`;
      }
    }

    candidateRoutes.push({
      name: route.name,
      targetModel: route.targetModel,
      provider: route.provider,
      threshold: route.threshold,
      score: bestScore,
      matched: isMatched,
      matchType,
      matchedDetail: detail,
    });
  }

  const result: RouteTestResult = {
    prompt,
    decision: classification.path,
    decisionLabel,
    matchedRoute: classification.matchedRoute,
    targetModel,
    provider: targetProvider,
    score: classification.score,
    threshold: matchedRouteDef?.threshold,
    latencyMs: classification.latencyMs,
    matchedPatternOrExample: classification.matchedPatternOrExample,
    cost: {
      inputTokens,
      estimatedOutputTokens,
      targetCostUSD: costSavings.actualCostUSD,
      defaultCostUSD: costSavings.hypotheticalDefaultCostUSD,
      savingsUSD: costSavings.savingsUSD,
      savingsPercentage: costSavings.savingsPercentage,
    },
    complexity: classification.complexityScore !== undefined ? {
      score: classification.complexityScore,
      features: classification.complexityFeatures as any,
    } : undefined,
    allRoutes: candidateRoutes,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Terminal human-readable formatted output
  console.log(pc.bold(pc.cyan(`\n⚡ Routing Decision for: "${pc.white(prompt)}"`)));
  console.log(pc.dim('──────────────────────────────────────────────────'));

  const decisionColor =
    result.decision === 'fast-path'
      ? pc.green
      : result.decision === 'semantic-path'
        ? pc.blue
        : result.decision === 'complexity-path'
          ? pc.magenta
          : pc.yellow;

  console.log(`• ${pc.bold('Decision:')}   ${decisionColor(pc.bold(result.decisionLabel))}`);

  if (result.matchedRoute !== 'default') {
    const thresholdText =
      result.threshold !== undefined ? `, Threshold: ${result.threshold.toFixed(2)}` : '';
    console.log(
      `• ${pc.bold('Matched:')}    "${pc.green(result.matchedRoute)}" (Score: ${pc.bold(result.score.toFixed(3))}${thresholdText})`,
    );
  } else {
    console.log(`• ${pc.bold('Matched:')}    ${pc.yellow('"default"')} (No route matched threshold)`);
  }

  console.log(
    `• ${pc.bold('Target:')}     ${pc.bold(pc.cyan(result.targetModel))} (Provider: ${pc.dim(result.provider)})`,
  );

  const savedColor = result.cost.savingsPercentage > 0 ? pc.green : pc.dim;
  console.log(
    `• ${pc.bold('Cost Est.:')}  $${result.cost.targetCostUSD.toFixed(5)} (Default: $${result.cost.defaultCostUSD.toFixed(5)} -> ${savedColor(`Saved ${result.cost.savingsPercentage.toFixed(1)}%`)})`,
  );

  console.log(
    `• ${pc.bold('Latency:')}    ${pc.bold(`${result.latencyMs.toFixed(2)}ms`)} (${pc.dim('Local vector math')})`,
  );

  if (result.matchedPatternOrExample) {
    console.log(`• ${pc.bold('Trigger:')}    ${pc.dim(result.matchedPatternOrExample)}`);
  }

  if (options.verbose) {
    console.log(pc.dim('\n──────────────── Candidate Route Evaluation ────────────────'));
    for (const r of candidateRoutes) {
      const matchBadge = r.matched
        ? pc.green(pc.bold('✔ MATCHED'))
        : pc.dim('✖ NO-MATCH');
      const scoreStr = r.score !== undefined ? r.score.toFixed(3) : 'N/A';
      console.log(
        `  ${matchBadge} ${pc.bold(r.name)} [Target: ${pc.cyan(r.targetModel)}] (Score: ${scoreStr} / Threshold: ${r.threshold.toFixed(2)})`,
      );
      if (r.matchedDetail) {
        console.log(`    ${pc.dim(`↳ ${r.matchedDetail}`)}`);
      }
    }

    if (result.complexity) {
      console.log(pc.dim('\n──────────────── Complexity Analysis ───────────────────────'));
      console.log(`  • Complexity Score: ${pc.bold(result.complexity.score.toFixed(3))}`);
      if (result.complexity.features) {
        const f = result.complexity.features;
        console.log(
          `  • Features: Code: ${f.codeDensity ?? 0} | Reasoning: ${f.reasoningCues ?? 0} | Math: ${f.mathLogicDensity ?? 0} | Constraints: ${f.constraintCount ?? 0}`,
        );
      }
    }

    console.log(pc.dim('\n──────────────── Token & Cost Telemetry ─────────────────────'));
    console.log(
      `  • Estimated Tokens: Input: ${result.cost.inputTokens} tokens | Output: ~${result.cost.estimatedOutputTokens} tokens`,
    );
    console.log(
      `  • Target Model Cost:  $${result.cost.targetCostUSD.toFixed(6)}`,
    );
    console.log(
      `  • Default Model Cost: $${result.cost.defaultCostUSD.toFixed(6)}`,
    );
    console.log(
      `  • Net Savings:        $${result.cost.savingsUSD.toFixed(6)} (${result.cost.savingsPercentage.toFixed(1)}%)`,
    );
  }

  console.log('');
  return result;
}
