import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testCommand, createProgram } from '../src/index.js';

describe('edgeroute test Command Suite', () => {
  let tmpDir: string;
  let customConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeroute-test-cmd-'));
    customConfigPath = path.join(tmpDir, 'router.config.ts');

    fs.writeFileSync(
      customConfigPath,
      `import { defineConfig } from '@edgeroute/core';

export default defineConfig({
  defaultModel: 'gpt-4o',
  embedding: { provider: 'hash' },
  routes: [
    {
      name: 'fast-greeting',
      targetModel: 'gpt-4o-mini',
      threshold: 0.8,
      rules: {
        patterns: [/^(hello|hi|hey|こんにちは)/i],
      },
      examples: ['Hello there', 'Hi friend'],
    },
    {
      name: 'translate-tasks',
      targetModel: 'claude-3-5-haiku-20241022',
      provider: 'anthropic',
      threshold: 0.75,
      examples: [
        'Translate this sentence into French: The weather is beautiful today.',
        'How do you translate this English paragraph to Spanish?',
      ],
    },
    {
      name: 'code-generation',
      targetModel: 'claude-3-7-sonnet',
      threshold: 0.85,
      examples: [
        'Write a distributed raft consensus algorithm in Rust with tests',
        'Implement a custom memory allocator in C++ with concurrency safety',
      ],
    },
    {
      name: 'low-complexity-tasks',
      targetModel: 'gemini-3.5-flash-lite',
      provider: 'gemini',
      threshold: 0.99,
      complexityThreshold: 0.15,
      examples: [],
    },
  ],
});
`,
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should match Tier 1 (Fast-Path Rule) when regex matches', async () => {
    const result = await testCommand('Hello, what time is it?', {
      config: customConfigPath,
      cwd: tmpDir,
    });

    expect(result.decision).toBe('fast-path');
    expect(result.decisionLabel).toBe('Tier 1 (Fast-Path Rule)');
    expect(result.matchedRoute).toBe('fast-greeting');
    expect(result.targetModel).toBe('gpt-4o-mini');
    expect(result.score).toBe(1.0);
    expect(result.cost.savingsUSD).toBeGreaterThanOrEqual(0);
    expect(result.cost.savingsPercentage).toBeGreaterThan(0);
  });

  it('should match Tier 2 (Semantic Match) when vector similarity matches route examples', async () => {
    const result = await testCommand(
      'Translate this sentence into French: The weather is beautiful today.',
      {
        config: customConfigPath,
        cwd: tmpDir,
      },
    );

    expect(result.decision).toBe('semantic-path');
    expect(result.decisionLabel).toBe('Tier 2 (Semantic Match)');
    expect(result.matchedRoute).toBe('translate-tasks');
    expect(result.targetModel).toBe('claude-3-5-haiku-20241022');
    expect(result.provider).toBe('anthropic');
    expect(result.score).toBeGreaterThanOrEqual(0.75);
    expect(result.matchedPatternOrExample).toContain('Translate this sentence into French');
  });

  it('should match Tier 2 (Complexity Match) when prompt is simple and matches route complexityThreshold', async () => {
    const result = await testCommand('Check text', {
      config: customConfigPath,
      cwd: tmpDir,
    });

    expect(result.decision).toBe('complexity-path');
    expect(result.decisionLabel).toBe('Tier 2 (Complexity Match)');
    expect(result.matchedRoute).toBe('low-complexity-tasks');
    expect(result.targetModel).toBe('gemini-3.5-flash-lite');
    expect(result.provider).toBe('gemini');
    expect(result.complexity?.score).toBeLessThanOrEqual(0.15);
  });

  it('should fallback to Tier 3 (Default Fallback) when query does not match any route', async () => {
    const result = await testCommand(
      'A completely complex query with deep philosophical analysis and multi-step reasoning about why the universe exists with formal proof and edge cases',
      {
        config: customConfigPath,
        cwd: tmpDir,
      },
    );

    expect(result.decision).toBe('fallback');
    expect(result.decisionLabel).toBe('Tier 3 (Default Fallback)');
    expect(result.matchedRoute).toBe('default');
    expect(result.targetModel).toBe('gpt-4o');
    expect(result.cost.savingsPercentage).toBe(0);
  });

  it('should output structured JSON format when --json is passed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await testCommand('Hello world', {
      config: customConfigPath,
      cwd: tmpDir,
      json: true,
    });

    expect(logSpy).toHaveBeenCalled();
    const loggedStr = logSpy.mock.calls[0]![0];
    const parsed = JSON.parse(loggedStr);

    expect(parsed.prompt).toBe('Hello world');
    expect(parsed.decision).toBe('fast-path');
    expect(parsed.matchedRoute).toBe('fast-greeting');
    expect(parsed.targetModel).toBe('gpt-4o-mini');
    expect(parsed.cost).toBeDefined();
    expect(parsed.cost.inputTokens).toBeGreaterThan(0);
    expect(parsed.cost.targetCostUSD).toBeDefined();
  });

  it('should include candidate route evaluation list when --verbose is passed', async () => {
    const result = await testCommand('Hello there', {
      config: customConfigPath,
      cwd: tmpDir,
      verbose: true,
    });

    expect(result.allRoutes).toBeDefined();
    expect(result.allRoutes!.length).toBe(4);

    const greetingRoute = result.allRoutes!.find((r) => r.name === 'fast-greeting');
    expect(greetingRoute).toBeDefined();
    expect(greetingRoute!.matched).toBe(true);
    expect(greetingRoute!.matchType).toBe('rule');

    const translateRoute = result.allRoutes!.find((r) => r.name === 'translate-tasks');
    expect(translateRoute).toBeDefined();
    expect(translateRoute!.matched).toBe(false);
  });

  it('should run via Commander CLI createProgram instance', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'edgeroute',
      'test',
      'Hello from Commander CLI',
      '-c',
      customConfigPath,
      '--json',
    ]);

    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls[0]![0];
    const parsed = JSON.parse(logged);
    expect(parsed.prompt).toBe('Hello from Commander CLI');
    expect(parsed.matchedRoute).toBe('fast-greeting');
  });
});
