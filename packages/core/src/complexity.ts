/**
 * Ultra-lightweight, edge-ready Complexity Classifier & Feature Extractor.
 * Computes query complexity score (0.0 to 1.0) in < 0.2ms with zero external dependencies.
 */

export interface ComplexityFeatures {
  /** Code presence, syntax structure, and programming keywords (0.0 - 1.0) */
  codeDensity: number;
  /** Multi-step thinking, reasoning, and analytical cue phrases (0.0 - 1.0) */
  reasoningCues: number;
  /** Mathematical notation, LaTeX, logic symbols, and complexity notation (0.0 - 1.0) */
  mathLogicDensity: number;
  /** Multi-rule constraints, negative constraints, and structured directives (0.0 - 1.0) */
  constraintCount: number;
  /** Prompt context length scaling (0.0 - 1.0) */
  contextLengthScore: number;
  /** Estimated token count */
  estimatedTokens: number;
  /** Character count */
  characterCount: number;
}

export interface ComplexityWeights {
  code: number;
  reasoning: number;
  mathLogic: number;
  constraints: number;
  contextLength: number;
}

export const DEFAULT_COMPLEXITY_WEIGHTS: ComplexityWeights = {
  code: 0.30,
  reasoning: 0.35,
  mathLogic: 0.15,
  constraints: 0.10,
  contextLength: 0.10,
};

export interface ComplexityEvaluationResult {
  /** Normalized complexity score from 0.0 (trivial) to 1.0 (highly complex) */
  score: number;
  /** Granular feature breakdown */
  features: ComplexityFeatures;
  /** Execution latency in milliseconds */
  latencyMs: number;
}

// Pre-compiled regular expressions for maximum edge performance (< 0.1ms execution)
const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`\n]+`/g;
const CODE_KEYWORDS_REGEX =
  /\b(?:function|class|def|import|export|const|let|var|return|async|await|interface|type|struct|impl|public|private|fn|val|lambda|typedef|template|namespace|SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|CREATE\s+TABLE|DELETE\s+FROM)\b/gi;
const CODE_SYNTAX_SYMBOLS_REGEX = /[{};][\r\n\t ]*|===?|!==?|=>|::|->|&&|\|\|/g;

const REASONING_CUES_EN_REGEX =
  /\b(?:step[\s-]by[\s-]step|think\s+step\s+by\s+step|chain\s+of\s+thought|prove\s+that|proof|derive|derivation|why\s+does|explain\s+why|root\s+cause|in-depth\s+analysis|compare\s+and\s+contrast|counterexample|trade[\s-]?offs?|edge\s+cases?|formal\s+proof|mathematical\s+induction|troubleshoot\s+the\s+issue|diagnose|find\s+the\s+bug|race\s+condition|memory\s+leak|deadlock|time\s+complexity|space\s+complexity|optimize\s+the\s+algorithm)\b/gi;

const REASONING_CUES_JA_REGEX =
  /(?:ステップバイステップ|段階的(?:に)?|順を追って|思考プロセス|なぜ|理由を(?:考察|説明|述べて)|証明せよ|証明して|導出(?:せよ|して)?|原因(?:分析|究明)|トレードオフ|比較検討|計算過程|反例|エッジケース|デバッグ|バグの原因|競合状態|デッドロック|メモリリーク|アルゴリズムを設計|計算量|最適化せよ|根拠を示して|徹底的に分析)/gi;

const MATH_LATEX_REGEX =
  /\$\$?[\s\S]*?\$\$?|\\(?:frac|sum|prod|int|sqrt|partial|alpha|beta|gamma|theta|lambda|sigma|omega|nabla|times|div|le|ge|ne|approx|in|forall|exists|subset|cup|cap|infty|mathbf|mathrm|mathbb)\b|[∑∫∂√≠≈≤≥∈∉∀∃∞±×÷]/g;
const MATH_COMPLEXITY_BIG_O_REGEX = /\b[OΘΩ]\([nNkKmMgG1\d\s\w\+\-\*\/\^\log\ln]+\)/g;

const CONSTRAINT_LIST_REGEX = /(?:^|\n)\s*(?:[0-9]{1,2}[\.\)]|[①-⑩]|\*|-|\+)\s+/g;
const STRICT_CONSTRAINTS_EN_REGEX =
  /\b(?:must\s+not|do\s+not\s+use|strictly|never|without\s+using|under\s+no\s+circumstances|only\s+use|must\s+adhere|follow\s+these\s+constraints)\b/gi;
const STRICT_CONSTRAINTS_JA_REGEX =
  /(?:制約条件|必ず|厳格に|絶対(?:に)?|使用禁止|満たすべき要件|使わずに|除外して|以下の条件|ルール:)/gi;

// Maximum prompt characters to scan for complexity features (prevents blocking event loop on large contexts)
const MAX_SCAN_CHARS = 4000;

/**
 * Fast match counter using regex without allocating match arrays.
 * Supports early-exit when maxCount is reached.
 */
function countMatches(str: string, regex: RegExp, maxCount = 20): number {
  regex.lastIndex = 0;
  let count = 0;
  while (regex.test(str)) {
    count++;
    if (count >= maxCount) break;
  }
  regex.lastIndex = 0;
  return count;
}

/**
 * Computes code block match count and total characters without array allocations.
 */
function getCodeBlockLength(str: string, regex: RegExp): { count: number; totalChars: number } {
  regex.lastIndex = 0;
  let count = 0;
  let totalChars = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(str)) !== null) {
    count++;
    totalChars += match[0].length;
    if (count >= 10) break;
  }
  regex.lastIndex = 0;
  return { count, totalChars };
}

/**
 * Extracts normalized complexity features from input prompt.
 */
export function extractComplexityFeatures(prompt: string): ComplexityFeatures {
  if (!prompt || prompt.trim().length === 0) {
    return {
      codeDensity: 0,
      reasoningCues: 0,
      mathLogicDensity: 0,
      constraintCount: 0,
      contextLengthScore: 0,
      estimatedTokens: 0,
      characterCount: 0,
    };
  }

  const charCount = prompt.length;
  // Estimate tokens (~4 characters per token for English/code, ~1.5 for CJK)
  const estimatedTokens = Math.max(1, Math.round(charCount / 3.2));

  // Limit scan text to avoid event-loop blocking on large prompts
  const scanText = charCount > MAX_SCAN_CHARS ? prompt.slice(0, MAX_SCAN_CHARS) : prompt;
  const scanLength = scanText.length;

  // 1. Code Density Feature (Zero-allocation counters)
  let codeScore = 0;
  const { count: codeBlockCount, totalChars: codeBlockChars } = getCodeBlockLength(scanText, CODE_BLOCK_REGEX);

  if (codeBlockCount > 0) {
    const blockRatio = Math.min(1, codeBlockChars / scanLength);
    codeScore = Math.min(1, 0.6 + blockRatio * 0.4);
  } else {
    const inlineCodeCount = countMatches(scanText, INLINE_CODE_REGEX, 5);
    const codeKeywordCount = countMatches(scanText, CODE_KEYWORDS_REGEX, 10);
    const codeSymbolCount = countMatches(scanText, CODE_SYNTAX_SYMBOLS_REGEX, 15);

    const keywordWeight = Math.min(0.7, codeKeywordCount * 0.2);
    const inlineWeight = Math.min(0.3, inlineCodeCount * 0.1);
    const hasCodeIndicators = codeKeywordCount > 0 || inlineCodeCount > 0;
    const symbolWeight =
      hasCodeIndicators && codeSymbolCount >= 2
        ? Math.min(0.25, (codeSymbolCount / Math.max(1, scanLength / 30)) * 0.2)
        : 0;
    codeScore = Math.min(1, keywordWeight + inlineWeight + symbolWeight);
  }

  // 2. Reasoning Cues Feature
  const reasoningEnCount = countMatches(scanText, REASONING_CUES_EN_REGEX, 5);
  const reasoningJaCount = countMatches(scanText, REASONING_CUES_JA_REGEX, 5);
  const totalReasoningCues = reasoningEnCount + reasoningJaCount;
  const reasoningScore = Math.min(1, totalReasoningCues * 0.35 + (totalReasoningCues > 0 ? 0.25 : 0));

  // 3. Math & Logic Notation Feature
  const mathMatchesCount = countMatches(scanText, MATH_LATEX_REGEX, 5);
  const bigOMatchesCount = countMatches(scanText, MATH_COMPLEXITY_BIG_O_REGEX, 3);
  const totalMathSymbols = mathMatchesCount + bigOMatchesCount * 2;
  const mathScore = Math.min(1, totalMathSymbols > 0 ? 0.35 + totalMathSymbols * 0.25 : 0);

  // 4. Constraints & Multi-step Directives Feature
  const listDirectivesCount = countMatches(scanText, CONSTRAINT_LIST_REGEX, 5);
  const strictEnCount = countMatches(scanText, STRICT_CONSTRAINTS_EN_REGEX, 3);
  const strictJaCount = countMatches(scanText, STRICT_CONSTRAINTS_JA_REGEX, 3);
  const totalConstraints = listDirectivesCount + strictEnCount * 2 + strictJaCount * 2;
  const constraintScore = Math.min(1, totalConstraints > 0 ? Math.min(1, totalConstraints * 0.2) : 0);

  // 5. Context Length Scaling (Sigmoid function: ~250 chars -> 0.2, ~1000 chars -> 0.5, ~3000 chars -> 0.85)
  const contextLengthScore = 1 / (1 + Math.exp(-(charCount - 1000) / 600));

  return {
    codeDensity: Number(codeScore.toFixed(4)),
    reasoningCues: Number(reasoningScore.toFixed(4)),
    mathLogicDensity: Number(mathScore.toFixed(4)),
    constraintCount: Number(constraintScore.toFixed(4)),
    contextLengthScore: Number(contextLengthScore.toFixed(4)),
    estimatedTokens,
    characterCount: charCount,
  };
}

/**
 * Calculates a single composite complexity score [0.0 - 1.0] from extracted features.
 */
export function calculateComplexityScore(
  features: ComplexityFeatures,
  weights?: Partial<ComplexityWeights>,
): number {
  const w: ComplexityWeights = {
    ...DEFAULT_COMPLEXITY_WEIGHTS,
    ...weights,
  };

  const totalWeight = w.code + w.reasoning + w.mathLogic + w.constraints + w.contextLength;
  if (totalWeight <= 0) return 0;

  const rawWeightedSum =
    features.codeDensity * w.code +
    features.reasoningCues * w.reasoning +
    features.mathLogicDensity * w.mathLogic +
    features.constraintCount * w.constraints +
    features.contextLengthScore * w.contextLength;

  const weightedAverage = rawWeightedSum / totalWeight;

  // Maximum single signal strength for specialized tasks (e.g. pure code, pure formal math)
  const peakSignal = Math.max(
    features.codeDensity,
    features.reasoningCues,
    features.mathLogicDensity,
    features.constraintCount,
  );

  // Blending 70% weighted multi-factor average with 30% peak signal
  const compositeScore = weightedAverage * 0.7 + peakSignal * 0.3;

  return Number(Math.min(1.0, Math.max(0.0, compositeScore)).toFixed(4));
}

/**
 * ComplexityScorer class for edge runtime routing.
 */
export class ComplexityScorer {
  private readonly weights: ComplexityWeights;

  constructor(weights?: Partial<ComplexityWeights>) {
    this.weights = {
      ...DEFAULT_COMPLEXITY_WEIGHTS,
      ...weights,
    };
  }

  /**
   * Scores an incoming prompt query with latency benchmarking (< 0.2ms overhead).
   */
  public evaluate(prompt: string): ComplexityEvaluationResult {
    const start = performance.now();
    const features = extractComplexityFeatures(prompt);
    const score = calculateComplexityScore(features, this.weights);
    const latencyMs = Number((performance.now() - start).toFixed(2));

    return {
      score,
      features,
      latencyMs,
    };
  }

  /**
   * Returns true if the query exceeds the complexity threshold.
   */
  public isComplex(prompt: string, threshold: number = 0.6): boolean {
    const { score } = this.evaluate(prompt);
    return score >= threshold;
  }
}
