import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  extractContentText,
} from '../src/tokens.js';

describe('Token Estimation Utilities', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty or invalid text', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('estimates English ASCII text accurately (~4 chars/token)', () => {
      const text = 'Hello world, this is a test.';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThanOrEqual(5);
      expect(tokens).toBeLessThanOrEqual(10);
    });

    it('estimates Japanese / CJK text realistically (higher tokens per char than ASCII)', () => {
      const jpText = 'こんにちは、世界。これはテストです。';
      const jpTokens = estimateTokens(jpText);
      const enText = 'Hello world, this is a test.';
      const enTokens = estimateTokens(enText);

      // Japanese has 18 chars, ASCII has 28 chars.
      // But in Japanese, 18 characters should produce ~20-25 tokens, whereas in ASCII 28 chars produces ~7 tokens.
      expect(jpTokens).toBeGreaterThan(enTokens);
      expect(jpTokens).toBeGreaterThanOrEqual(18);
    });

    it('handles mixed English and Japanese text', () => {
      const mixed = 'TypeScriptで書かれたEdgeRouteのテストです。';
      const tokens = estimateTokens(mixed);
      expect(tokens).toBeGreaterThan(15);
    });

    it('handles emojis and special multibyte characters', () => {
      const emojiText = '🚀🔥🎉✨';
      const tokens = estimateTokens(emojiText);
      expect(tokens).toBeGreaterThanOrEqual(4);
    });
  });

  describe('extractContentText', () => {
    it('handles string content', () => {
      expect(extractContentText('hello')).toBe('hello');
    });

    it('handles content parts array', () => {
      const parts = [
        { type: 'text', text: 'Part 1' },
        { type: 'image_url', image_url: { url: 'http://...' } },
        { type: 'text', text: 'Part 2' },
      ];
      expect(extractContentText(parts)).toBe('Part 1\nPart 2');
    });

    it('handles null/undefined/empty content', () => {
      expect(extractContentText(null)).toBe('');
      expect(extractContentText(undefined)).toBe('');
      expect(extractContentText([])).toBe('');
    });
  });

  describe('estimateMessagesTokens', () => {
    it('calculates total prompt tokens including ChatML overhead', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ];

      const tokens = estimateMessagesTokens(messages);
      // system msg (~7 tokens + 3 overhead) + user msg (~2 tokens + 3 overhead) + priming (3) = ~18 tokens
      expect(tokens).toBeGreaterThanOrEqual(15);
      expect(tokens).toBeLessThanOrEqual(25);
    });

    it('estimates tokens with tool_calls present', () => {
      const messages = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
            },
          ],
        },
      ];

      const tokens = estimateMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(10);
    });
  });
});
