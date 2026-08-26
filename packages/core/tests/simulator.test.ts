import { describe, it, expect } from 'vitest';
import {
  evaluateComplexityRouting,
  STANDARD_COMPLEXITY_DATASET,
} from '../src/simulator.js';
import { DEFAULT_MODEL_PRICING } from '../src/cost.js';

describe('Complexity Routing Simulator & Benchmark', () => {
  it('should run benchmark simulation and achieve > 60% cost reduction with high accuracy', () => {
    const report = evaluateComplexityRouting(STANDARD_COMPLEXITY_DATASET, {
      targetModel: 'gemini-3.7-flash',
      defaultModel: 'gpt-5.6-sol',
      complexityThreshold: 0.55,
    });

    expect(report.totalPrompts).toBe(STANDARD_COMPLEXITY_DATASET.length);
    expect(report.distribution.targetModelCount).toBeGreaterThan(0);
    expect(report.distribution.defaultModelCount).toBeGreaterThan(0);

    // Accuracy test: simple queries go to gemini-3.7-flash, hard queries go to gpt-5.6-sol
    expect(report.accuracy.accuracyPercentage).toBeGreaterThanOrEqual(85);

    // Cost savings verification
    expect(report.costs.hypotheticalDefaultCostUSD).toBeGreaterThan(report.costs.actualCostUSD);
    expect(report.costs.savingsPercentage).toBeGreaterThan(60);

    // Latency benchmark (< 0.5ms per query)
    expect(report.latency.avgMs).toBeLessThan(0.5);

    // Inspect individual items
    const simpleItem = report.itemResults.find((i) => i.id === 'simple-01');
    expect(simpleItem?.selectedModel).toBe('gemini-3.7-flash');
    expect(simpleItem?.isFrontierModel).toBe(false);

    const hardItem = report.itemResults.find((i) => i.id === 'hard-01');
    expect(hardItem?.selectedModel).toBe('gpt-5.6-sol');
    expect(hardItem?.isFrontierModel).toBe(true);
  });

  it('should reflect threshold changes in model distribution and savings', () => {
    // Aggressive low threshold: routes more queries to frontier model
    const strictReport = evaluateComplexityRouting(STANDARD_COMPLEXITY_DATASET, {
      targetModel: 'gpt-5.6-luna',
      defaultModel: 'claude-sonnet-5',
      complexityThreshold: 0.3,
    });

    // Relaxed high threshold: routes more queries to lightweight model
    const relaxedReport = evaluateComplexityRouting(STANDARD_COMPLEXITY_DATASET, {
      targetModel: 'gpt-5.6-luna',
      defaultModel: 'claude-sonnet-5',
      complexityThreshold: 0.8,
    });

    expect(relaxedReport.distribution.targetModelPercentage).toBeGreaterThan(
      strictReport.distribution.targetModelPercentage,
    );
    expect(relaxedReport.costs.savingsPercentage).toBeGreaterThan(
      strictReport.costs.savingsPercentage,
    );
  });

  it('should support Claude Sonnet 5 vs GPT-5.6 Luna routing with custom pricing', () => {
    const report = evaluateComplexityRouting(STANDARD_COMPLEXITY_DATASET, {
      targetModel: 'gpt-5.6-luna',
      defaultModel: 'claude-sonnet-5',
      complexityThreshold: 0.55,
      customPricing: DEFAULT_MODEL_PRICING,
    });

    expect(report.costs.savedUSD).toBeGreaterThan(0);
    expect(report.costs.savingsPercentage).toBeGreaterThan(50);
  });
});
