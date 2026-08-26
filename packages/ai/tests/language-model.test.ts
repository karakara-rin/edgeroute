import { describe, expect, it, vi } from 'vitest';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1GenerateResult,
  LanguageModelV1StreamPart,
  LanguageModelV1StreamResult,
} from '@ai-sdk/provider';
import { generateText, streamText } from 'ai';
import { edgeroute, createEdgeRoute, EdgeRouteLanguageModel } from '../src/index.js';

function createMockModel(modelId: string, responseText = `Response from ${modelId}`): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'mock-provider',
    modelId,
    defaultObjectGenerationMode: 'tool',
    supportsImageUrls: true,
    supportsStructuredOutputs: true,
    async doGenerate(options: LanguageModelV1CallOptions): Promise<LanguageModelV1GenerateResult> {
      return {
        text: `${responseText}: ${typeof options.prompt === 'string' ? options.prompt : JSON.stringify(options.prompt)}`,
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
        },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
        response: {
          id: `gen-${Date.now()}`,
          timestamp: new Date(),
          modelId,
          headers: { 'x-upstream-provider': 'mock' },
        },
      };
    },
    async doStream(options: LanguageModelV1CallOptions): Promise<LanguageModelV1StreamResult> {
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'response-metadata',
            id: `stream-${Date.now()}`,
            modelId,
            headers: { 'x-upstream-stream': 'mock' },
          });
          controller.enqueue({
            type: 'text-delta',
            textDelta: responseText,
          });
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: {
              promptTokens: 15,
              completionTokens: 25,
            },
          });
          controller.close();
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    },
  };
}

describe('@edgeroute/ai LanguageModelV1 Adapter', () => {
  const gptMini = createMockModel('gpt-4o-mini', 'Fast response');
  const claudeSonnet = createMockModel('claude-3-5-sonnet', 'Deep reasoning');

  it('should initialize and implement LanguageModelV1 specification', () => {
    const model = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [],
      models: { 'gpt-4o-mini': gptMini },
    });

    expect(model.specificationVersion).toBe('v1');
    expect(model.provider).toBe('edgeroute');
    expect(model).toBeInstanceOf(EdgeRouteLanguageModel);
  });

  it('should route via fast-path rules and inject providerMetadata & headers in doGenerate', async () => {
    const onRouteMatched = vi.fn();
    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [
        {
          name: 'complex-code',
          targetModel: 'claude-3-5-sonnet',
          rules: {
            minCharacters: 50,
            patterns: ['refactor', 'architecture'],
          },
        },
        {
          name: 'simple-qa',
          targetModel: 'gpt-4o-mini',
          rules: {
            maxCharacters: 20,
          },
        },
      ],
      models: {
        'gpt-4o-mini': gptMini,
        'claude-3-5-sonnet': claudeSonnet,
      },
      onRouteMatched,
    });

    // 1. Test short prompt -> simple-qa (gpt-4o-mini)
    const result1 = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(result1.text).toContain('Fast response');
    expect(result1.rawResponse?.headers?.['x-edgeroute-matched-route']).toBe('simple-qa');
    expect(result1.rawResponse?.headers?.['x-edgeroute-target-model']).toBe('gpt-4o-mini');
    expect(result1.rawResponse?.headers?.['x-edgeroute-path']).toBe('fast-path');
    expect(result1.providerMetadata?.edgeroute).toMatchObject({
      matchedRoute: 'simple-qa',
      targetModel: 'gpt-4o-mini',
      routingPath: 'fast-path',
      cacheHit: false,
    });
    expect(onRouteMatched).toHaveBeenCalledTimes(1);

    // 2. Test keyword pattern -> complex-code (claude-3-5-sonnet)
    const result2 = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Please refactor this enterprise architecture module for me' }],
        },
      ],
    });

    expect(result2.text).toContain('Deep reasoning');
    expect(result2.rawResponse?.headers?.['x-edgeroute-matched-route']).toBe('complex-code');
    expect(result2.rawResponse?.headers?.['x-edgeroute-target-model']).toBe('claude-3-5-sonnet');
    expect(result2.providerMetadata?.edgeroute).toMatchObject({
      matchedRoute: 'complex-code',
      targetModel: 'claude-3-5-sonnet',
      routingPath: 'fast-path',
      cacheHit: false,
    });
  });

  it('should work seamlessly with AI SDK generateText', async () => {
    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [
        {
          name: 'code-help',
          targetModel: 'claude-3-5-sonnet',
          rules: { patterns: ['typescript'] },
        },
      ],
      models: {
        'gpt-4o-mini': gptMini,
        'claude-3-5-sonnet': claudeSonnet,
      },
    });

    const { text, response } = await generateText({
      model: router,
      prompt: 'Write typescript code for an adapter',
    });

    expect(text).toContain('Deep reasoning');
    expect(response.headers?.['x-edgeroute-target-model']).toBe('claude-3-5-sonnet');
    expect(response.headers?.['x-edgeroute-matched-route']).toBe('code-help');
  });

  it('should stream text and emit metadata via doStream and AI SDK streamText', async () => {
    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [
        {
          name: 'deep-thinking',
          targetModel: 'claude-3-5-sonnet',
          rules: { patterns: ['analyze'] },
        },
      ],
      models: {
        'gpt-4o-mini': gptMini,
        'claude-3-5-sonnet': claudeSonnet,
      },
    });

    const streamResult = await streamText({
      model: router,
      prompt: 'Please analyze this system',
    });

    let fullText = '';
    for await (const chunk of streamResult.textStream) {
      fullText += chunk;
    }

    expect(fullText).toBe('Deep reasoning');
    const metadata = await streamResult.providerMetadata;
    expect(metadata?.edgeroute).toMatchObject({
      matchedRoute: 'deep-thinking',
      targetModel: 'claude-3-5-sonnet',
      routingPath: 'fast-path',
      cacheHit: false,
    });
  });

  it('should support semantic cache hit on repeated doGenerate and doStream', async () => {
    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [],
      cache: {
        enabled: true,
        threshold: 0.95,
        maxEntries: 100,
      },
      models: {
        'gpt-4o-mini': gptMini,
      },
    });

    const prompt = 'What is the capital of France?';

    // 1st call: Cache MISS, stores response
    const res1 = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    expect(res1.rawResponse?.headers?.['x-edgeroute-cache']).toBe('MISS');

    // 2nd call: Cache HIT
    const res2 = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    expect(res2.rawResponse?.headers?.['x-edgeroute-cache']).toBe('HIT');
    expect(res2.providerMetadata?.edgeroute).toMatchObject({
      matchedRoute: 'cache',
      targetModel: 'cache',
      routingPath: 'cache',
      cacheHit: true,
    });

    // 3rd call via doStream: Cache HIT
    const streamRes = await router.doStream({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });

    const reader = streamRes.stream.getReader();
    const parts: LanguageModelV1StreamPart[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parts.push(value);
    }

    const finishPart = parts.find((p) => p.type === 'finish') as any;
    expect(finishPart?.providerMetadata?.edgeroute?.cacheHit).toBe(true);
  });

  it('should route via semantic vector similarity when fast-path rules do not match', async () => {
    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      routes: [
        {
          name: 'distributed-systems',
          targetModel: 'claude-3-5-sonnet',
          threshold: 0.6,
          examples: [
            'Write a distributed lock algorithm using Redis in Rust',
            'Implement a Raft consensus algorithm in Go',
          ],
        },
      ],
      models: {
        'gpt-4o-mini': gptMini,
        'claude-3-5-sonnet': claudeSonnet,
      },
    });

    const result = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Write a distributed lock algorithm with Redis in Rust' }] }],
    });

    expect(result.text).toContain('Deep reasoning');
    expect(result.rawResponse?.headers?.['x-edgeroute-matched-route']).toBe('distributed-systems');
    expect(result.rawResponse?.headers?.['x-edgeroute-target-model']).toBe('claude-3-5-sonnet');
    expect(result.rawResponse?.headers?.['x-edgeroute-path']).toBe('semantic-path');
  });

  it('should throw clear error when target model is not provided in models dictionary', async () => {
    const router = edgeroute({
      defaultModel: 'unregistered-model',
      routes: [],
      models: {},
    });

    await expect(
      router.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
    ).rejects.toThrow(/No LanguageModelV1 instance registered for target model "unregistered-model"/);
  });

  it('should automatically failover to defaultModel when routed target model throws downstream error', async () => {
    const errorModel: LanguageModelV1 = {
      specificationVersion: 'v1',
      provider: 'mock-error-provider',
      modelId: 'error-prone-model',
      defaultObjectGenerationMode: 'tool',
      supportsImageUrls: true,
      supportsStructuredOutputs: true,
      async doGenerate() {
        throw new Error('Downstream 429 Rate Limit Exceeded');
      },
      async doStream() {
        throw new Error('Downstream 503 Service Unavailable');
      },
    };

    const router = edgeroute({
      defaultModel: 'gpt-4o-mini',
      maxRetries: 1,
      routes: [
        {
          name: 'error-route',
          targetModel: 'error-prone-model',
          rules: { patterns: ['trigger-failover'] },
        },
      ],
      models: {
        'error-prone-model': errorModel,
        'gpt-4o-mini': gptMini,
      },
    });

    const result = await router.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'trigger-failover prompt' }] }],
    });

    expect(result.text).toContain('Fast response');
    expect(result.rawResponse?.headers?.['x-edgeroute-target-model']).toBe('gpt-4o-mini');
    expect(result.rawResponse?.headers?.['x-edgeroute-fallback-triggered']).toBe('true');
  });

  it('should support structured outputs via AI SDK generateObject', async () => {
    const jsonModel: LanguageModelV1 = {
      specificationVersion: 'v1',
      provider: 'mock-json-provider',
      modelId: 'json-model',
      defaultObjectGenerationMode: 'json',
      supportsImageUrls: true,
      supportsStructuredOutputs: true,
      async doGenerate() {
        return {
          text: JSON.stringify({ category: 'support', priority: 'high' }),
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 15 },
          rawCall: { rawPrompt: '...', rawSettings: {} },
        };
      },
      async doStream() {
        throw new Error('Not implemented');
      },
    };

    const router = edgeroute({
      defaultModel: 'json-model',
      routes: [],
      models: {
        'json-model': jsonModel,
      },
    });

    const result = await router.doGenerate({
      inputFormat: 'messages',
      mode: {
        type: 'object-json',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            priority: { type: 'string' },
          },
          required: ['category', 'priority'],
        },
      },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Classify this ticket' }] }],
    });

    const parsed = JSON.parse(result.text!);
    expect(parsed).toEqual({ category: 'support', priority: 'high' });
    expect(result.rawResponse?.headers?.['x-edgeroute-target-model']).toBe('json-model');
  });

  it('should support createEdgeRoute factory helper', () => {
    const provider = createEdgeRoute({
      defaultModel: 'gpt-4o-mini',
      routes: [],
      models: {
        'gpt-4o-mini': gptMini,
      },
    });

    const modelInstance = provider();
    expect(modelInstance.modelId).toContain('gpt-4o-mini');
    const customInstance = provider('claude-3-5-sonnet');
    expect(customInstance.modelId).toContain('claude-3-5-sonnet');
  });
});
