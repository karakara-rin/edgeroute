import type { ModelPricing } from './types.js';

/**
 * Standard default pricing dictionary ($ per 1 Million tokens).
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI Latest (GPT-5.6 Series & Current)
  'gpt-5.6-sol': { inputPerMillion: 4.0, outputPerMillion: 20.0 },
  'gpt-5.6-terra': { inputPerMillion: 1.0, outputPerMillion: 4.0 },
  'gpt-5.6-luna': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-5.6-cyber': { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-2024-08-06': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4o-mini-2024-07-18': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10.0, outputPerMillion: 30.0 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  'o1': { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  'o1-preview': { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  'o1-mini': { inputPerMillion: 3.0, outputPerMillion: 12.0 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // Anthropic Latest (Claude 5 & Claude 4.5/3.7/3.5)
  'claude-fable-5': { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  'claude-opus-5': { inputPerMillion: 4.0, outputPerMillion: 20.0 },
  'claude-sonnet-5': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-sonnet-latest': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'claude-3-5-haiku-latest': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'claude-3-haiku-20240307': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'claude-3-opus-20240229': { inputPerMillion: 15.0, outputPerMillion: 75.0 },

  // Google Gemini Latest (Gemini 3.x & 2.5/1.5 Series)
  'gemini-3.7-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gemini-3.6-flash': { inputPerMillion: 0.125, outputPerMillion: 0.5 },
  'gemini-3.5-flash-lite': { inputPerMillion: 0.05, outputPerMillion: 0.2 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-2.0-flash-exp': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-1.5-flash-8b': { inputPerMillion: 0.0375, outputPerMillion: 0.15 },

  // Groq LPUs (Fast LPU Inference)
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  'llama-3.2-11b-vision-preview': { inputPerMillion: 0.18, outputPerMillion: 0.18 },
  'llama-3.2-3b-preview': { inputPerMillion: 0.06, outputPerMillion: 0.06 },
  'llama-3.2-1b-preview': { inputPerMillion: 0.04, outputPerMillion: 0.04 },
  'mixtral-8x7b-32768': { inputPerMillion: 0.24, outputPerMillion: 0.24 },
  'deepseek-r1-distill-llama-70b': { inputPerMillion: 0.59, outputPerMillion: 0.79 },

  // Cloudflare Workers AI
  '@cf/meta/llama-3.3-70b-instruct': { inputPerMillion: 0.35, outputPerMillion: 0.75 },
  '@cf/meta/llama-3.1-8b-instruct': { inputPerMillion: 0.05, outputPerMillion: 0.10 },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { inputPerMillion: 0.40, outputPerMillion: 0.80 },
  '@cf/mistral/mistral-7b-instruct-v0.2': { inputPerMillion: 0.05, outputPerMillion: 0.10 },
};

/**
 * Calculates token cost in USD for a given model and token counts.
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customPricing?: Record<string, ModelPricing>,
): number {
  const pricing =
    customPricing?.[model] ||
    DEFAULT_MODEL_PRICING[model] || {
      inputPerMillion: 1.0,
      outputPerMillion: 2.0,
    };

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}

export interface CostSavingsComparison {
  actualModel: string;
  defaultModel: string;
  actualCostUSD: number;
  hypotheticalDefaultCostUSD: number;
  savingsUSD: number;
  savingsPercentage: number;
}

/**
 * Calculates the cost savings of routing to actualModel versus defaultModel.
 */
export function compareRoutingCost(
  actualModel: string,
  defaultModel: string,
  inputTokens: number,
  outputTokens: number,
  customPricing?: Record<string, ModelPricing>,
): CostSavingsComparison {
  const actualCostUSD = calculateTokenCost(actualModel, inputTokens, outputTokens, customPricing);
  const hypotheticalDefaultCostUSD = calculateTokenCost(
    defaultModel,
    inputTokens,
    outputTokens,
    customPricing,
  );

  const savingsUSD = Math.max(0, hypotheticalDefaultCostUSD - actualCostUSD);
  const savingsPercentage =
    hypotheticalDefaultCostUSD > 0
      ? Number(((savingsUSD / hypotheticalDefaultCostUSD) * 100).toFixed(2))
      : 0;

  return {
    actualModel,
    defaultModel,
    actualCostUSD: Number(actualCostUSD.toFixed(6)),
    hypotheticalDefaultCostUSD: Number(hypotheticalDefaultCostUSD.toFixed(6)),
    savingsUSD: Number(savingsUSD.toFixed(6)),
    savingsPercentage,
  };
}
