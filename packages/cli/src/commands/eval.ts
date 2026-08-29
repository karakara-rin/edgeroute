import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import {
  runComplexitySimulation,
  type ComplexityBenchmarkPrompt,
  type ComplexitySimulationReport,
} from '@edgeroute/core';
import { loadConfig } from '../utils/config-loader.js';
import { loadDataset, type NormalizedDatasetPrompt } from '../utils/dataset-loader.js';
import {
  formatMarkdownReport,
  formatTerminalReport,
  formatTerminalSweep,
  type SweepPoint,
} from '../report.js';

export interface EvalOptions {
  dataset?: string;
  config?: string;
  tune?: boolean;
  thresholdRange?: string; // "min:max:step", e.g. "0.5:0.95:0.05"
  threshold?: number;
  targetModel?: string;
  defaultModel?: string;
  output?: string;
  format?: 'table' | 'json' | 'markdown';
  cwd?: string;
}

export function parseThresholdRange(rangeStr?: string): { min: number; max: number; step: number } {
  if (!rangeStr) {
    return { min: 0.5, max: 0.95, step: 0.05 };
  }
  const parts = rangeStr.split(':').map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((p) => isNaN(p))) {
    return { min: 0.5, max: 0.95, step: 0.05 };
  }
  return { min: parts[0]!, max: parts[1]!, step: parts[2]! };
}

export async function evalCommand(options: EvalOptions): Promise<{
  report: ComplexitySimulationReport;
  sweepPoints?: SweepPoint[];
  recommendedThreshold?: number;
}> {
  const cwd = options.cwd ?? process.cwd();
  console.log(pc.bold(pc.cyan('⚡ EdgeRoute: Running Evaluation & Simulation...')));

  const config = await loadConfig(options.config, cwd);
  const rawDataset = await loadDataset(options.dataset, cwd);

  const dataset: ComplexityBenchmarkPrompt[] = rawDataset.map((d) => ({
    id: d.id,
    prompt: d.prompt,
    category: (['chat', 'coding', 'reasoning', 'math', 'translation', 'data-processing'].includes(d.category)
      ? d.category
      : 'chat') as any,
    expectedDifficulty: d.expectedDifficulty ?? 'simple',
    estimatedInputTokens: d.estimatedInputTokens,
    estimatedOutputTokens: d.estimatedOutputTokens,
  }));

  const targetModel =
    options.targetModel ??
    (config.routes.length > 0 ? config.routes[0]!.targetModel : 'gpt-4o-mini');
  const defaultModel = options.defaultModel ?? config.defaultModel;

  const currentThreshold =
    options.threshold !== undefined
      ? options.threshold
      : config.complexityThreshold ?? 0.6;

  // Single baseline simulation
  const baselineReport = runComplexitySimulation(dataset, {
    targetModel,
    defaultModel,
    complexityThreshold: currentThreshold,
    customPricing: config.customPricing,
  });

  let sweepPoints: SweepPoint[] | undefined;
  let recommendedThreshold: number | undefined;

  if (options.tune || options.thresholdRange) {
    const { min, max, step } = parseThresholdRange(options.thresholdRange);
    sweepPoints = [];

    for (let th = min; th <= max + 0.0001; th += step) {
      const roundedTh = Number(th.toFixed(3));
      const rep = runComplexitySimulation(dataset, {
        targetModel,
        defaultModel,
        complexityThreshold: roundedTh,
        customPricing: config.customPricing,
      });

      sweepPoints.push({
        threshold: roundedTh,
        routedToTargetPercentage: rep.distribution.targetModelPercentage,
        accuracyPercentage: rep.accuracy.accuracyPercentage,
        savedUSD: rep.costs.savedUSD,
        savingsPercentage: rep.costs.savingsPercentage,
        avgLatencyMs: rep.latency.avgMs,
        p95LatencyMs: rep.latency.p95Ms,
      });
    }

    // Recommendation logic: find highest savings with accuracy >= 90%, or highest accuracy
    const highAccuracyPoints = sweepPoints.filter((pt) => pt.accuracyPercentage >= 90);
    if (highAccuracyPoints.length > 0) {
      const best = highAccuracyPoints.reduce((prev, curr) =>
        curr.savingsPercentage > prev.savingsPercentage ? curr : prev,
      );
      recommendedThreshold = best.threshold;
    } else {
      const best = sweepPoints.reduce((prev, curr) =>
        curr.accuracyPercentage > prev.accuracyPercentage ? curr : prev,
      );
      recommendedThreshold = best.threshold;
    }
  }

  // Format and Output
  if (sweepPoints && recommendedThreshold !== undefined) {
    console.log(formatTerminalSweep(sweepPoints, recommendedThreshold));
  } else {
    console.log(
      formatTerminalReport(
        baselineReport,
        `EdgeRoute Evaluation Report (Threshold: ${currentThreshold.toFixed(2)})`,
      ),
    );
  }

  if (options.output) {
    const outputPath = path.resolve(cwd, options.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (outputPath.endsWith('.json') || options.format === 'json') {
      fs.writeFileSync(
        outputPath,
        JSON.stringify({ baselineReport, sweepPoints, recommendedThreshold }, null, 2),
        'utf-8',
      );
    } else {
      const mdContent = formatMarkdownReport(baselineReport, sweepPoints, recommendedThreshold);
      fs.writeFileSync(outputPath, mdContent, 'utf-8');
    }
    console.log(`📄 Saved simulation report to: ${pc.bold(path.relative(cwd, outputPath) || path.basename(outputPath))}\n`);
  }

  return {
    report: baselineReport,
    sweepPoints,
    recommendedThreshold,
  };
}
