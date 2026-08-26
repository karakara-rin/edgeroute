import type { LanguageModelV1Prompt } from '@ai-sdk/provider';

/**
 * Extracts the primary user prompt text from AI SDK LanguageModelV1Prompt for routing & cache lookup.
 */
export function extractPromptText(prompt: LanguageModelV1Prompt): string {
  if (!prompt || !Array.isArray(prompt) || prompt.length === 0) {
    return '';
  }

  // Iterate backwards to find the last user message
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i]!;
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as any).text === 'string')
          .map((p) => p.text);
        if (textParts.length > 0) {
          return textParts.join('\n');
        }
      }
    }
  }

  // Fallback: search backwards for any message with text content
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i]!;
    if (typeof msg.content === 'string') {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as any).text === 'string')
        .map((p) => p.text);
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
  }

  return '';
}
