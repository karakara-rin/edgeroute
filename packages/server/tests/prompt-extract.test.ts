import { describe, it, expect } from 'vitest';
import {
  extractUserPrompt,
  extractPromptContext,
  type ChatCompletionMessage,
} from '../src/index.js';

describe('Prompt Extraction Utilities', () => {
  describe('extractUserPrompt', () => {
    it('should return empty string for empty array or invalid input', () => {
      expect(extractUserPrompt([])).toBe('');
      expect(extractUserPrompt(null as any)).toBe('');
    });

    it('should extract text from single user message', () => {
      const messages: ChatCompletionMessage[] = [
        { role: 'user', content: 'What is WebAssembly?' },
      ];
      expect(extractUserPrompt(messages)).toBe('What is WebAssembly?');
    });

    it('should find the last user message in multi-turn conversation', () => {
      const messages: ChatCompletionMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi! How can I help?' },
        { role: 'user', content: 'Explain quantum computing in simple terms' },
      ];
      expect(extractUserPrompt(messages)).toBe(
        'Explain quantum computing in simple terms',
      );
    });

    it('should handle multi-part content array', () => {
      const messages: ChatCompletionMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image' },
            { type: 'text', text: 'summarize the findings.' },
          ],
        },
      ];
      expect(extractUserPrompt(messages)).toBe(
        'Analyze this image\nsummarize the findings.',
      );
    });

    it('should fallback to last message content when no user message is present', () => {
      const messages: ChatCompletionMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
      ];
      expect(extractUserPrompt(messages)).toBe('You are a helpful assistant');
    });
  });

  describe('extractPromptContext', () => {
    it('should return empty string for empty input', () => {
      expect(extractPromptContext([])).toBe('');
    });

    it('should return plain text for single user message with no system prompt', () => {
      const messages: ChatCompletionMessage[] = [
        { role: 'user', content: 'Translate to Japanese: Hello world' },
      ];
      expect(extractPromptContext(messages)).toBe(
        'Translate to Japanese: Hello world',
      );
    });

    it('should format role-tagged context for multi-turn conversations', () => {
      const messages: ChatCompletionMessage[] = [
        { role: 'system', content: 'You are a code reviewer.' },
        { role: 'user', content: 'Can you review this pull request?' },
        { role: 'assistant', content: 'Sure, please share the code.' },
        { role: 'user', content: 'Here is the diff.' },
      ];
      const context = extractPromptContext(messages);
      expect(context).toContain('[system] You are a code reviewer.');
      expect(context).toContain('[user] Can you review this pull request?');
      expect(context).toContain('[assistant] Sure, please share the code.');
      expect(context).toContain('[user] Here is the diff.');
    });

    it('should format tool calls in context', () => {
      const messages: ChatCompletionMessage[] = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"Tokyo"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          name: 'get_weather',
          content: '{"temp":22,"condition":"sunny"}',
        },
      ];
      const context = extractPromptContext(messages);
      expect(context).toContain('get_weather');
      expect(context).toContain('Tokyo');
      expect(context).toContain('[tool] {"temp":22,"condition":"sunny"}');
    });
  });
});
