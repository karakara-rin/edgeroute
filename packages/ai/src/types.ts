import type {
  LanguageModelV1,
} from '@ai-sdk/provider';
import type {
  ClassificationResult,
  CostSavingsComparison,
  EdgeRouteConfigInput,
  RouteMatchPath,
} from '@edgeroute/core';

export interface EdgeRouteMetadata {
  matchedRoute: string;
  targetModel: string;
  routingPath: RouteMatchPath | 'cache';
  score: number;
  complexityScore?: number;
  latencyMs: number;
  cacheHit: boolean;
  costSavings?: {
    actualModel: string;
    defaultModel: string;
    actualCostUSD: number;
    hypotheticalDefaultCostUSD: number;
    savingsUSD: number;
    savingsPercentage: number;
  };
  [key: string]: unknown;
}

export interface EdgeRouteAIConfig extends EdgeRouteConfigInput {
  /**
   * Explicit map of model ID / targetModel string to Vercel AI SDK LanguageModelV1 instances.
   * e.g. { 'claude-sonnet-5': anthropic('claude-3-5-sonnet-20241022'), 'gpt-5.6-luna': openai('gpt-4o-mini') }
   */
  models?: Record<string, LanguageModelV1>;

  /**
   * Optional lifecycle hook executed immediately when a route is matched.
   */
  onRouteMatched?: (
    result: ClassificationResult,
    costSavings?: CostSavingsComparison,
  ) => void;

  /**
   * Optional custom model resolver function if a model ID is not found in the `models` dictionary.
   */
  resolveModel?: (modelId: string) => LanguageModelV1 | Promise<LanguageModelV1>;
}
