/**
 * Lightweight, multilingual-aware token estimation utilities for LLM prompts and completions.
 */

export interface MessageLike {
  role?: string;
  content?: string | Array<{ type?: string; text?: string; [key: string]: unknown }> | null;
  name?: string;
  tool_calls?: unknown[];
  [key: string]: unknown;
}

/**
 * Estimates token count for a text string, taking into account CJK (Japanese, Chinese, Korean)
 * and multibyte characters where 1 character typically consumes more tokens than in ASCII English.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 0;
  if (text.length === 0) return 0;

  let asciiChars = 0;
  let cjkChars = 0;
  let otherMultibyteChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ASCII range (0 - 127)
    if (code <= 127) {
      asciiChars++;
    }
    // CJK Radicals, Hiragana, Katakana, CJK Unified Ideographs, Hangul, Fullwidth Forms
    else if (
      (code >= 0x2e80 && code <= 0x2fdf) || // CJK Radicals
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ideographs Extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xff00 && code <= 0xffef)    // Halfwidth and Fullwidth Forms
    ) {
      cjkChars++;
    } else {
      // Emojis, Cyrillic, Arabic, Accents, etc.
      otherMultibyteChars++;
    }
  }

  // English/ASCII: ~4 chars per token (0.25 tokens/char)
  // CJK characters: ~1.2 tokens per char (in modern BPE tokenizers like cl100k_base / o200k_base)
  // Other multibyte/emojis: ~1.5 - 2 tokens per char
  const estimated =
    asciiChars * 0.25 +
    cjkChars * 1.25 +
    otherMultibyteChars * 1.5;

  return Math.max(1, Math.ceil(estimated));
}

/**
 * Extracts plain text from a message content field (string or content parts array).
 */
export function extractContentText(
  content: string | Array<{ type?: string; text?: string; [key: string]: unknown }> | null | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  }
  return '';
}

/**
 * Estimates prompt token count for an array of chat messages, including ChatML per-message formatting overhead.
 */
export function estimateMessagesTokens(messages: MessageLike[] | null | undefined): number {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return 0;
  }

  let totalTokens = 3; // Priming overhead (e.g. <|im_start|>assistant)

  for (const message of messages) {
    // Each message has ~3 tokens overhead (<|im_start|>{role}\n...<|im_end|>\n)
    totalTokens += 3;

    if (message.role) {
      totalTokens += estimateTokens(message.role);
    }
    if (message.name) {
      totalTokens += estimateTokens(message.name) + 1; // name formatting
    }

    const text = extractContentText(message.content);
    if (text) {
      totalTokens += estimateTokens(text);
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      totalTokens += estimateTokens(JSON.stringify(message.tool_calls));
    }
  }

  return totalTokens;
}
