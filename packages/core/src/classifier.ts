import { ComplexityScorer } from './complexity.js';
import type { Vector, EmbeddingProvider } from './embeddings/types.js';
import type {
  ClassificationResult,
  EdgeRouteConfig,
  FastPathRules,
  PrecomputedEmbeddingEntry,
  PrecomputedEmbeddings,
  RouteDefinition,
} from './types.js';

export interface RouteVectorCache {
  route: RouteDefinition;
  exampleVectors: { text: string; vector: Vector }[];
}

/**
 * Calculates cosine similarity between two normalized or raw numerical vectors.
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Evaluates Tier 1 Fast-Path rules (regex, character bounds, complexity bounds).
 */
export function matchesFastPath(
  text: string,
  rules?: FastPathRules,
  complexityScore?: number,
): { matched: boolean; pattern?: string } {
  if (!rules) return { matched: false };

  const charCount = text.length;
  if (rules.minCharacters !== undefined && charCount < rules.minCharacters) {
    return { matched: false };
  }
  if (rules.maxCharacters !== undefined && charCount > rules.maxCharacters) {
    return { matched: false };
  }

  if (complexityScore !== undefined) {
    if (rules.minComplexity !== undefined && complexityScore < rules.minComplexity) {
      return { matched: false };
    }
    if (rules.maxComplexity !== undefined && complexityScore > rules.maxComplexity) {
      return { matched: false };
    }
  }

  if (rules.patterns && rules.patterns.length > 0) {
    let lowerText: string | null = null;
    for (const pattern of rules.patterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(text)) {
          return { matched: true, pattern: pattern.toString() };
        }
      } else if (typeof pattern === 'string') {
        if (lowerText === null) {
          lowerText = text.toLowerCase();
        }
        if (lowerText.includes(pattern.toLowerCase())) {
          return { matched: true, pattern };
        }
      }
    }
    return { matched: false };
  }

  // If rules exist with only bounds and they satisfied them
  return { matched: true, pattern: `bounds [chars:${charCount}]` };
}

/**
 * Standalone Complexity Router / Classifier.
 */
export class ComplexityClassifier {
  private readonly config: EdgeRouteConfig;
  private readonly scorer: ComplexityScorer;

  constructor(config: EdgeRouteConfig) {
    this.config = config;
    this.scorer = new ComplexityScorer(config.complexityWeights);
  }

  public classify(prompt: string): ClassificationResult {
    if (this.config.routes.length === 0) {
      return {
        targetModel: this.config.defaultModel,
        matchedRoute: 'default',
        path: 'fallback',
        score: 0.0,
        latencyMs: 0,
      };
    }

    const start = performance.now();
    const evalResult = this.scorer.evaluate(prompt);
    const globalThreshold = this.config.complexityThreshold ?? 0.6;

    // 1. Fast-path check
    for (const route of this.config.routes) {
      if (route.rules) {
        const match = matchesFastPath(prompt, route.rules, evalResult.score);
        if (match.matched) {
          const latencyMs = Number((performance.now() - start).toFixed(2));
          return {
            targetModel: route.targetModel,
            matchedRoute: route.name,
            path: 'fast-path',
            score: 1.0,
            complexityScore: evalResult.score,
            complexityFeatures: evalResult.features,
            latencyMs,
            matchedPatternOrExample: match.pattern,
          };
        }
      }
    }

    // 2. Check route-level complexity thresholds
    for (const route of this.config.routes) {
      if (route.complexityThreshold !== undefined) {
        if (evalResult.score <= route.complexityThreshold) {
          const latencyMs = Number((performance.now() - start).toFixed(2));
          return {
            targetModel: route.targetModel,
            matchedRoute: route.name,
            path: 'complexity-path',
            score: evalResult.score,
            complexityScore: evalResult.score,
            complexityFeatures: evalResult.features,
            latencyMs,
            matchedPatternOrExample: `complexity <= ${route.complexityThreshold}`,
          };
        }
      }
    }

    // 3. Evaluate against global complexity threshold
    const latencyMs = Number((performance.now() - start).toFixed(2));
    if (evalResult.score < globalThreshold && this.config.routes.length > 0) {
      const targetRoute = this.config.routes[0]!;
      return {
        targetModel: targetRoute.targetModel,
        matchedRoute: targetRoute.name,
        path: 'complexity-path',
        score: evalResult.score,
        complexityScore: evalResult.score,
        complexityFeatures: evalResult.features,
        latencyMs,
        matchedPatternOrExample: `complexity ${evalResult.score} < threshold ${globalThreshold}`,
      };
    }

    // 4. Default / Frontier model fallback for high complexity queries
    return {
      targetModel: this.config.defaultModel,
      matchedRoute: 'default',
      path: 'fallback',
      score: evalResult.score,
      complexityScore: evalResult.score,
      complexityFeatures: evalResult.features,
      latencyMs,
      matchedPatternOrExample: `complexity ${evalResult.score} >= threshold ${globalThreshold}`,
    };
  }
}

/**
 * Main Hybrid Classifier supporting Rules, Semantic Vectors, and Complexity Scoring.
 */
export class SemanticClassifier {
  private readonly config: EdgeRouteConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly complexityScorer: ComplexityScorer;
  private readonly complexityClassifier: ComplexityClassifier;
  private vectorCache: RouteVectorCache[] = [];

  constructor(config: EdgeRouteConfig, embeddingProvider: EmbeddingProvider) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.complexityScorer = new ComplexityScorer(config.complexityWeights);
    this.complexityClassifier = new ComplexityClassifier(config);
  }

  /**
   * Initializes and caches the embedding vectors for all route examples in memory.
   * If precomputedEmbeddings are provided, vector calculation is completely skipped.
   */
  public async initialize(
    precomputed?: PrecomputedEmbeddings | PrecomputedEmbeddingEntry[],
  ): Promise<void> {
    const rawPrecomputed = precomputed ?? this.config.precomputedEmbeddings;
    const precomputedList: PrecomputedEmbeddingEntry[] = rawPrecomputed
      ? Array.isArray(rawPrecomputed)
        ? rawPrecomputed
        : rawPrecomputed.embeddings ?? []
      : [];

    const precomputedMap = new Map<string, { text: string; vector: Vector }[]>();
    for (const item of precomputedList) {
      if (!precomputedMap.has(item.route)) {
        precomputedMap.set(item.route, []);
      }
      precomputedMap.get(item.route)!.push({
        text: item.text,
        vector: item.vector,
      });
    }

    const cache: RouteVectorCache[] = [];

    for (const route of this.config.routes) {
      const preloaded = precomputedMap.get(route.name);
      if (preloaded && preloaded.length > 0) {
        cache.push({ route, exampleVectors: preloaded });
      } else if (route.examples && route.examples.length > 0) {
        const vectors = await this.embeddingProvider.embedBatch(route.examples);
        const exampleVectors = route.examples.map((text, idx) => ({
          text,
          vector: vectors[idx]!,
        }));
        cache.push({ route, exampleVectors });
      } else {
        cache.push({ route, exampleVectors: [] });
      }
    }

    this.vectorCache = cache;
  }

  /**
   * Classifies an input prompt through Fast-path -> Semantic/Complexity -> Fallback default.
   */
  public async classify(prompt: string): Promise<ClassificationResult> {
    if (this.config.routes.length === 0) {
      return {
        targetModel: this.config.defaultModel,
        matchedRoute: 'default',
        path: 'fallback',
        score: 0.0,
        latencyMs: 0,
      };
    }

    const start = performance.now();
    const strategy = this.config.routingStrategy ?? 'hybrid';

    // 1. Pure Complexity Strategy shortcut
    if (strategy === 'complexity') {
      return this.complexityClassifier.classify(prompt);
    }

    // Calculate complexity features (< 0.2ms overhead)
    const complexityEval = this.complexityScorer.evaluate(prompt);

    // 2. Fast-path Rule Matching (Regex, length, complexity bounds)
    for (const route of this.config.routes) {
      if (route.rules) {
        const match = matchesFastPath(prompt, route.rules, complexityEval.score);
        if (match.matched) {
          const latencyMs = Number((performance.now() - start).toFixed(2));
          return {
            targetModel: route.targetModel,
            matchedRoute: route.name,
            path: 'fast-path',
            score: 1.0,
            complexityScore: complexityEval.score,
            complexityFeatures: complexityEval.features,
            latencyMs,
            matchedPatternOrExample: match.pattern,
          };
        }
      }
    }

    // 3. Semantic Vector Cosine Similarity (only if route examples exist)
    const hasExampleVectors = this.vectorCache.some((item) => item.exampleVectors.length > 0);
    if (hasExampleVectors) {
      const promptVector = await this.embeddingProvider.embed(prompt);

      let bestMatch: {
        route: RouteDefinition;
        score: number;
        example: string;
      } | null = null;

      for (const item of this.vectorCache) {
        for (const ex of item.exampleVectors) {
          const score = cosineSimilarity(promptVector, ex.vector);
          if (score >= item.route.threshold) {
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = {
                route: item.route,
                score,
                example: ex.text,
              };
            }
          }
        }
      }

      if (bestMatch) {
        const latencyMs = Number((performance.now() - start).toFixed(2));
        return {
          targetModel: bestMatch.route.targetModel,
          matchedRoute: bestMatch.route.name,
          path: 'semantic-path',
          score: Number(bestMatch.score.toFixed(4)),
          complexityScore: complexityEval.score,
          complexityFeatures: complexityEval.features,
          latencyMs,
          matchedPatternOrExample: bestMatch.example,
        };
      }
    }

    // 4. Hybrid Complexity Route Match (if route explicitly defines complexityThreshold)
    if (strategy === 'hybrid') {
      for (const route of this.config.routes) {
        if (
          route.complexityThreshold !== undefined &&
          complexityEval.score <= route.complexityThreshold
        ) {
          const latencyMs = Number((performance.now() - start).toFixed(2));
          return {
            targetModel: route.targetModel,
            matchedRoute: route.name,
            path: 'complexity-path',
            score: complexityEval.score,
            complexityScore: complexityEval.score,
            complexityFeatures: complexityEval.features,
            latencyMs,
            matchedPatternOrExample: `complexity <= ${route.complexityThreshold}`,
          };
        }
      }
    }

    // 5. Fallback Default Model
    const latencyMs = Number((performance.now() - start).toFixed(2));
    return {
      targetModel: this.config.defaultModel,
      matchedRoute: 'default',
      path: 'fallback',
      score: 0.0,
      complexityScore: complexityEval.score,
      complexityFeatures: complexityEval.features,
      latencyMs,
    };
  }
}
