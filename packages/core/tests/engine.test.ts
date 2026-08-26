import { describe, it, expect, vi } from 'vitest';
import {
  EdgeRouteEngine,
  type EdgeRouteConfig,
  type RouteCaller,
} from '../src/index.js';

describe('EdgeRouteEngine (Core Orchestrator)', () => {
  const config: EdgeRouteConfig = {
    defaultModel: 'gpt-4o',
    routes: [
      {
        name: 'simple-tasks',
        targetModel: 'gpt-4o-mini',
        threshold: 0.6,
        rules: {
          patterns: [/^(hello|hi|こんにちは)/i],
        },
        examples: [
          'Fix typos in this sentence',
          'Summarize the following text briefly',
        ],
      },
    ],
    embedding: {
      provider: 'local',
    },
    cache: {
      enabled: true,
      threshold: 0.9,
    },
  };

  it('should orchestrate fast-path rule routing and generate telemetry headers', async () => {
    const engine = new EdgeRouteEngine(config);
    await engine.initialize();

    const mockCaller: RouteCaller = vi.fn().mockResolvedValue({
      response: { id: 'mock-1', choices: [{ message: { content: 'Hi there!' } }] },
      ok: true,
      status: 200,
      actualModel: 'gpt-4o-mini',
      actualProvider: 'openai',
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });

    const result = await engine.execute(
      { prompt: 'Hello world!' },
      mockCaller,
    );

    expect(result.fromCache).toBe(false);
    expect(result.classification.matchedRoute).toBe('simple-tasks');
    expect(result.actualModel).toBe('gpt-4o-mini');
    expect(result.retriedWithFallback).toBe(false);
    expect(result.headers['X-EdgeRoute-Matched-Route']).toBe('simple-tasks');
    expect(result.headers['X-EdgeRoute-Target-Model']).toBe('gpt-4o-mini');
    expect(result.headers['X-EdgeRoute-Path']).toBe('fast-path');
    expect(result.headers['X-EdgeRoute-Cost-Saved-USD']).toBeDefined();
    expect(mockCaller).toHaveBeenCalledWith('gpt-4o-mini', undefined);
  });

  it('should fallback retry to defaultModel when primary routed model returns 429', async () => {
    const engine = new EdgeRouteEngine(config);
    await engine.initialize();

    let calls = 0;
    const mockCaller: RouteCaller = vi.fn().mockImplementation(async (model) => {
      calls++;
      if (model === 'gpt-4o-mini') {
        return {
          response: { error: 'Rate limited' },
          ok: false,
          status: 429,
          actualModel: 'gpt-4o-mini',
        };
      }
      return {
        response: { choices: [{ message: { content: 'Fallback response' } }] },
        ok: true,
        status: 200,
        actualModel: 'gpt-4o',
        actualProvider: 'openai',
      };
    });

    const result = await engine.execute(
      { prompt: 'Hello world!' },
      mockCaller,
    );

    expect(calls).toBe(2);
    expect(result.retriedWithFallback).toBe(true);
    expect(result.actualModel).toBe('gpt-4o');
    expect(result.headers['X-EdgeRoute-Path']).toBe('fallback-retry');
  });

  it('should return cache hit when identical prompt is queried twice', async () => {
    const engine = new EdgeRouteEngine(config);
    await engine.initialize();

    const mockCaller: RouteCaller = vi.fn().mockResolvedValue({
      response: { id: 'chatcmpl-cached', choices: [{ message: { content: 'Cached result' } }] },
      ok: true,
      status: 200,
      actualModel: 'gpt-4o-mini',
      actualProvider: 'openai',
      usage: { prompt_tokens: 15, completion_tokens: 15, total_tokens: 30 },
    });

    // 1st request -> MISS and saves to cache
    const res1 = await engine.execute(
      { prompt: 'Tell me a unique fact about penguins' },
      mockCaller,
    );
    expect(res1.fromCache).toBe(false);

    // Wait microtask for cache save
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request -> HIT
    const res2 = await engine.execute(
      { prompt: 'Tell me a unique fact about penguins' },
      mockCaller,
    );

    expect(res2.fromCache).toBe(true);
    expect(res2.cacheStatus).toBe('HIT');
    expect(res2.headers['X-EdgeRoute-Cache']).toBe('HIT');
    expect(res2.headers['X-EdgeRoute-Cost-Saved-USD']).toBeDefined();
    // mockCaller should not be called again
    expect(mockCaller).toHaveBeenCalledTimes(1);
  });
});
