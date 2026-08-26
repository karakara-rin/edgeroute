import { describe, it, expect } from 'vitest';
import { calculateTokenCost, compareRoutingCost } from '../src/cost.js';

describe('calculateTokenCost', () => {
  it('should calculate accurate cost for gpt-4o-mini', () => {
    // 10,000 input tokens ($0.15 / 1M) -> $0.0015
    // 2,000 output tokens ($0.60 / 1M) -> $0.0012
    // Total = $0.0027
    const cost = calculateTokenCost('gpt-4o-mini', 10_000, 2_000);
    expect(cost).toBeCloseTo(0.0027, 5);
  });

  it('should calculate accurate cost for gpt-4o', () => {
    // 10,000 input tokens ($2.50 / 1M) -> $0.025
    // 2,000 output tokens ($10.00 / 1M) -> $0.020
    // Total = $0.045
    const cost = calculateTokenCost('gpt-4o', 10_000, 2_000);
    expect(cost).toBeCloseTo(0.045, 5);
  });
});

describe('compareRoutingCost', () => {
  it('should correctly calculate cost savings when routing to gpt-4o-mini vs gpt-4o', () => {
    const comparison = compareRoutingCost('gpt-4o-mini', 'gpt-4o', 10_000, 2_000);
    expect(comparison.actualCostUSD).toBeCloseTo(0.0027, 4);
    expect(comparison.hypotheticalDefaultCostUSD).toBeCloseTo(0.045, 4);
    expect(comparison.savingsUSD).toBeCloseTo(0.0423, 4);
    expect(comparison.savingsPercentage).toBeGreaterThan(90); // ~94% savings
  });
});
