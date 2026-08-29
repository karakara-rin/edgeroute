import pc from 'picocolors';
import type { ComplexitySimulationReport } from '@edgeroute/core';

export interface SweepPoint {
  threshold: number;
  routedToTargetPercentage: number;
  accuracyPercentage: number;
  savedUSD: number;
  savingsPercentage: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export function formatTerminalReport(report: ComplexitySimulationReport, title: string = 'EdgeRoute Simulation Report'): string {
  const lines: string[] = [];
  const divider = pc.dim('─'.repeat(65));

  lines.push('');
  lines.push(pc.bold(pc.cyan(`⚡ ${title}`)));
  lines.push(divider);

  // Summary counts
  lines.push(`${pc.bold('Dataset Prompts:')}     ${pc.white(report.totalPrompts.toString())}`);
  lines.push(
    `${pc.bold('Routing Distribution:')} ${pc.green(`${report.distribution.targetModelPercentage}%`)} Small/Target (${report.distribution.targetModelCount}) | ${pc.yellow(`${report.distribution.defaultModelPercentage}%`)} Default/Frontier (${report.distribution.defaultModelCount})`,
  );
  lines.push(
    `${pc.bold('Routing Accuracy:')}     ${report.accuracy.accuracyPercentage >= 90 ? pc.green(pc.bold(`${report.accuracy.accuracyPercentage}%`)) : pc.yellow(`${report.accuracy.accuracyPercentage}%`)} (${report.accuracy.correctRoutingCount}/${report.totalPrompts} optimal decisions)`,
  );

  lines.push(divider);

  // Cost Savings
  lines.push(pc.bold(pc.magenta('💰 Cost & Financial Telemetry')));
  lines.push(
    `  • Actual Incurred:       ${pc.white(`$${report.costs.actualCostUSD.toFixed(6)}`)}`,
  );
  lines.push(
    `  • Baseline (100% Large): ${pc.dim(`$${report.costs.hypotheticalDefaultCostUSD.toFixed(6)}`)}`,
  );
  lines.push(
    `  • Net Cost Saved:        ${pc.bold(pc.green(`$${report.costs.savedUSD.toFixed(6)}`))} (${pc.bold(pc.green(`${report.costs.savingsPercentage}%`))})`,
  );

  lines.push(divider);

  // Latency
  lines.push(pc.bold(pc.blue('⚡ Routing Classification Latency')));
  lines.push(
    `  • Avg: ${pc.cyan(`${report.latency.avgMs}ms`)}   • p95: ${pc.cyan(`${report.latency.p95Ms}ms`)}   • Max: ${pc.dim(`${report.latency.maxMs}ms`)}`,
  );
  lines.push(divider);

  return lines.join('\n');
}

export function formatTerminalSweep(points: SweepPoint[], recommendedThreshold: number): string {
  const lines: string[] = [];
  const divider = pc.dim('─'.repeat(80));

  lines.push('');
  lines.push(pc.bold(pc.cyan('⚡ EdgeRoute Threshold Sweep & Auto-Tuning Results')));
  lines.push(divider);
  lines.push(
    `${'Threshold'.padEnd(12)} | ${'Target %'.padEnd(10)} | ${'Accuracy'.padEnd(10)} | ${'Cost Saved ($)'.padEnd(16)} | ${'Savings %'.padEnd(11)} | ${'p95 (ms)'}`,
  );
  lines.push(divider);

  for (const pt of points) {
    const isRecommended = Math.abs(pt.threshold - recommendedThreshold) < 0.001;
    const thresholdStr = pt.threshold.toFixed(2);
    const targetPctStr = `${pt.routedToTargetPercentage.toFixed(1)}%`;
    const accStr = `${pt.accuracyPercentage.toFixed(1)}%`;
    const savedStr = `$${pt.savedUSD.toFixed(6)}`;
    const savePctStr = `${pt.savingsPercentage.toFixed(1)}%`;
    const p95Str = `${pt.p95LatencyMs.toFixed(3)}ms`;

    const row = `${thresholdStr.padEnd(12)} | ${targetPctStr.padEnd(10)} | ${accStr.padEnd(10)} | ${savedStr.padEnd(16)} | ${savePctStr.padEnd(11)} | ${p95Str}`;

    if (isRecommended) {
      lines.push(pc.bold(pc.green(`👉 ${row}  (Recommended)`)));
    } else {
      lines.push(`   ${row}`);
    }
  }

  lines.push(divider);
  lines.push(
    pc.bold(
      pc.green(
        `🎯 Recommended Optimal Threshold: ${pc.underline(recommendedThreshold.toFixed(2))} (Balances maximum cost savings with >= 90% routing accuracy)`,
      ),
    ),
  );
  lines.push('');

  return lines.join('\n');
}

export function formatMarkdownReport(
  report: ComplexitySimulationReport,
  sweepPoints?: SweepPoint[],
  recommendedThreshold?: number,
): string {
  const lines: string[] = [];
  lines.push('# EdgeRoute Evaluation & Tuning Report');
  lines.push('');
  lines.push(`**Generated at**: ${new Date().toISOString()}`);
  lines.push(`**Total Benchmark Prompts**: ${report.totalPrompts}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| :--- | :--- |');
  lines.push(`| **Routing Distribution (Target / Default)** | ${report.distribution.targetModelPercentage}% / ${report.distribution.defaultModelPercentage}% |`);
  lines.push(`| **Routing Decision Accuracy** | ${report.accuracy.accuracyPercentage}% (${report.accuracy.correctRoutingCount}/${report.totalPrompts}) |`);
  lines.push(`| **Baseline Cost (100% Frontier)** | $${report.costs.hypotheticalDefaultCostUSD.toFixed(6)} |`);
  lines.push(`| **EdgeRoute Actual Cost** | $${report.costs.actualCostUSD.toFixed(6)} |`);
  lines.push(`| **Net Cost Savings** | **$${report.costs.savedUSD.toFixed(6)} (${report.costs.savingsPercentage}%)** |`);
  lines.push(`| **Routing Latency (Avg / p95)** | ${report.latency.avgMs}ms / ${report.latency.p95Ms}ms |`);
  lines.push('');

  if (sweepPoints && sweepPoints.length > 0) {
    lines.push('## Threshold Sweep Simulation');
    lines.push('');
    if (recommendedThreshold !== undefined) {
      lines.push(`> **Optimal Threshold**: \`${recommendedThreshold.toFixed(2)}\` delivers optimal cost reduction while preserving routing accuracy.`);
      lines.push('');
    }
    lines.push('| Threshold | Target Model % | Accuracy | Cost Saved ($) | Savings % | p95 Latency |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const pt of sweepPoints) {
      const isRec = recommendedThreshold !== undefined && Math.abs(pt.threshold - recommendedThreshold) < 0.001;
      const recMark = isRec ? ' ⭐ **(Optimal)**' : '';
      lines.push(
        `| \`${pt.threshold.toFixed(2)}\`${recMark} | ${pt.routedToTargetPercentage.toFixed(1)}% | ${pt.accuracyPercentage.toFixed(1)}% | $${pt.savedUSD.toFixed(6)} | ${pt.savingsPercentage.toFixed(1)}% | ${pt.p95LatencyMs.toFixed(3)}ms |`,
      );
    }
    lines.push('');
  }

  lines.push('## Category Breakdown & Sample Decisions');
  lines.push('');
  lines.push('| ID | Category | Expected | Dispatched Model | Correct? | Cost Saved ($) |');
  lines.push('| :--- | :--- | :--- | :--- | :---: | :--- |');
  for (const item of report.itemResults.slice(0, 15)) {
    lines.push(
      `| \`${item.id}\` | ${item.category} | ${item.expectedDifficulty} | \`${item.selectedModel}\` | ${item.correctlyRouted ? '✅' : '⚠️'} | $${item.savedUSD.toFixed(6)} |`,
    );
  }
  if (report.itemResults.length > 15) {
    lines.push(`| ... | *and ${report.itemResults.length - 15} more items* | | | | |`);
  }
  lines.push('');

  return lines.join('\n');
}
