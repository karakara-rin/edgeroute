/**
 * Cross-Provider Parameter Sanitizer & Schema Normalizer.
 *
 * When routing requests dynamically from OpenAI SDK / client apps to third-party providers
 * (e.g. Google Gemini, Groq, Ollama), downstream endpoints can return 400 Bad Request
 * if OpenAI-specific parameters or unsupported schema properties are present.
 *
 * This utility safely normalizes parameters with zero runtime dependencies.
 */

export interface SanitizerOptions {
  /**
   * Map modern `max_completion_tokens` to `max_tokens` and remove `max_completion_tokens`
   * for providers that do not recognize it yet.
   * Default: true
   */
  mapMaxCompletionTokens?: boolean;

  /**
   * Strip OpenAI-specific proprietary flags (store, metadata, service_tier, prediction, modalities, audio, user).
   * Default: true
   */
  stripOpenAIExclusiveFields?: boolean;

  /**
   * Strip `strict` from tool functions and response formats (causes 400 on Gemini/Groq/Ollama).
   * Default: true
   */
  stripToolStrict?: boolean;

  /**
   * Clean unsupported JSON schema fields ($schema, etc.) from tool parameters.
   * Default: true
   */
  sanitizeToolParameters?: boolean;

  /**
   * Remove `parallel_tool_calls` if unsupported by target provider.
   * Default: false
   */
  stripParallelToolCalls?: boolean;

  /**
   * Additional top-level keys to strip from the payload.
   */
  customStripKeys?: string[];
}

export const DEFAULT_SANITIZER_OPTIONS: Readonly<SanitizerOptions> = Object.freeze({
  mapMaxCompletionTokens: true,
  stripOpenAIExclusiveFields: true,
  stripToolStrict: true,
  sanitizeToolParameters: true,
  stripParallelToolCalls: false,
});

const DEFAULT_OPENAI_EXCLUSIVE_FIELDS = [
  'store',
  'metadata',
  'service_tier',
  'prediction',
  'modalities',
  'audio',
] as const;

/**
 * Recursively removes specific keys (e.g. `$schema`) from a JSON schema object.
 */
function cleanSchemaObject(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') {
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = cleanSchemaObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return cleanSchemaObject(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Normalizes an outgoing OpenAI-compatible request payload for third-party providers.
 */
export function sanitizeOpenAICompatiblePayload(
  payload: Record<string, unknown>,
  options: SanitizerOptions = {},
): Record<string, unknown> {
  const {
    mapMaxCompletionTokens = true,
    stripOpenAIExclusiveFields = true,
    stripToolStrict = true,
    sanitizeToolParameters = true,
    stripParallelToolCalls = false,
    customStripKeys = [],
  } = options;

  const result: Record<string, unknown> = { ...payload };

  // 1. Normalize max_completion_tokens -> max_tokens
  if (mapMaxCompletionTokens) {
    if (
      result.max_completion_tokens !== undefined &&
      result.max_tokens === undefined
    ) {
      result.max_tokens = result.max_completion_tokens;
    }
    delete result.max_completion_tokens;
  }

  // 2. Strip OpenAI-exclusive fields
  if (stripOpenAIExclusiveFields) {
    for (const field of DEFAULT_OPENAI_EXCLUSIVE_FIELDS) {
      delete result[field];
    }
  }

  // 3. Custom keys to strip
  if (customStripKeys.length > 0) {
    for (const key of customStripKeys) {
      delete result[key];
    }
  }

  // 4. Strip parallel_tool_calls if requested
  if (stripParallelToolCalls) {
    delete result.parallel_tool_calls;
  }

  // 5. Sanitize tools & function schemas
  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map((tool) => {
      if (!tool || typeof tool !== 'object') return tool;

      const toolObj = { ...(tool as Record<string, unknown>) };

      if (toolObj.type === 'function' && toolObj.function && typeof toolObj.function === 'object') {
        const fnObj = { ...(toolObj.function as Record<string, unknown>) };

        if (stripToolStrict) {
          delete fnObj.strict;
        }

        if (
          sanitizeToolParameters &&
          fnObj.parameters &&
          typeof fnObj.parameters === 'object' &&
          !Array.isArray(fnObj.parameters)
        ) {
          fnObj.parameters = cleanSchemaObject(
            fnObj.parameters as Record<string, unknown>,
          );
        }

        toolObj.function = fnObj;
      }

      return toolObj;
    });
  }

  // 6. Sanitize response_format (e.g. if strict is present on json_schema)
  if (
    stripToolStrict &&
    result.response_format &&
    typeof result.response_format === 'object'
  ) {
    const rf = { ...(result.response_format as Record<string, unknown>) };
    if (rf.type === 'json_schema' && rf.json_schema && typeof rf.json_schema === 'object') {
      const js = { ...(rf.json_schema as Record<string, unknown>) };
      delete js.strict;
      rf.json_schema = js;
      result.response_format = rf;
    }
  }

  return result;
}
