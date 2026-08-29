import { extractContentText } from '@edgeroute/core';
import type { ChatCompletionMessage } from '../types.js';

/**
 * Extracts the primary user prompt text from OpenAI messages array.
 */
export function extractUserPrompt(messages: ChatCompletionMessage[]): string {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user') {
      return extractContentText(msg.content);
    }
  }

  // Fallback: extract last message content
  const last = messages[messages.length - 1]!;
  return (
    extractContentText(last.content) ||
    (typeof last.content === 'string'
      ? last.content
      : JSON.stringify(last.content ?? ''))
  );
}

/**
 * Extracts a contextual prompt string from OpenAI messages array.
 * If the conversation is a single user message with no system prompt, returns the plain user prompt.
 * If multi-turn history or system/developer messages exist, formats full context with roles
 * to prevent semantic cache collisions between different conversation contexts.
 */
export function extractPromptContext(messages: ChatCompletionMessage[]): string {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  // Simple single user turn with no prior context or system prompt
  if (
    messages.length === 1 &&
    (messages[0]?.role === 'user' || !messages[0]?.role)
  ) {
    return extractContentText(messages[0]?.content);
  }

  // Multi-turn or system-prompt enriched conversation: include roles and contents
  const parts: string[] = [];
  for (const msg of messages) {
    const role = msg.role || 'user';
    let text = extractContentText(msg.content);
    if (!text && msg.content) {
      text =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
    }

    if (
      msg.tool_calls &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0
    ) {
      const toolCallSummary = JSON.stringify(msg.tool_calls);
      text = text ? `${text}\n${toolCallSummary}` : toolCallSummary;
    }

    if (text) {
      parts.push(`[${role}] ${text}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : extractUserPrompt(messages);
}
