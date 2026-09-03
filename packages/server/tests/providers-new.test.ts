import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectProvider,
  OllamaAdapter,
  DeepSeekAdapter,
  AzureOpenAIAdapter,
} from '../src/providers/index.js';
import type { EdgeRouteConfig } from '@edgeroute/core';

describe('New Providers: Ollama, DeepSeek, Azure', () => {
  const mockConfig: EdgeRouteConfig = {
    defaultModel: 'gpt-4o',
    routes: [],
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
      },
      deepseek: {
        apiKey: 'sk-deepseek-test-key',
      },
      azure: {
        resourceName: 'test-resource',
        deploymentName: 'gpt-4o-deploy',
        apiVersion: '2024-08-01-preview',
        apiKey: 'azure-secret-key',
      },
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectProvider', () => {
    it('should detect Ollama models', () => {
      expect(detectProvider('ollama/llama3.2')).toBe('ollama');
      expect(detectProvider('ollama-qwen2.5')).toBe('ollama');
    });

    it('should detect DeepSeek official models', () => {
      expect(detectProvider('deepseek-chat')).toBe('deepseek');
      expect(detectProvider('deepseek-reasoner')).toBe('deepseek');
      expect(detectProvider('deepseek-v3')).toBe('deepseek');
      expect(detectProvider('deepseek-r1')).toBe('deepseek');
      expect(detectProvider('deepseek/custom-model')).toBe('deepseek');
      // distill models on groq
      expect(detectProvider('deepseek-r1-distill-llama-70b')).toBe('groq');
    });

    it('should detect Azure models', () => {
      expect(detectProvider('azure/gpt-4o')).toBe('azure');
      expect(detectProvider('azure/custom-deploy')).toBe('azure');
    });

    it('should honor explicit provider', () => {
      expect(detectProvider('some-random-model', 'ollama')).toBe('ollama');
      expect(detectProvider('some-random-model', 'deepseek')).toBe('deepseek');
      expect(detectProvider('some-random-model', 'azure')).toBe('azure');
    });
  });

  describe('OllamaAdapter', () => {
    it('should forward request to Ollama endpoint and strip ollama/ prefix', async () => {
      const adapter = new OllamaAdapter();
      let capturedUrl = '';
      let capturedBody: any = null;

      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const response = await adapter.execute({
        model: 'ollama/llama3.2:latest',
        body: { messages: [{ role: 'user', content: 'Hi' }] },
        clientHeaders: new Headers(),
        config: mockConfig,
      });

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions');
      expect(capturedBody.model).toBe('llama3.2:latest');
    });
  });

  describe('DeepSeekAdapter', () => {
    it('should forward request to DeepSeek API with Authorization header', async () => {
      const adapter = new DeepSeekAdapter();
      let capturedUrl = '';
      let capturedHeaders: any = null;
      let capturedBody: any = null;

      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const response = await adapter.execute({
        model: 'deepseek-chat',
        body: { messages: [{ role: 'user', content: 'Hello DeepSeek' }] },
        clientHeaders: new Headers(),
        config: mockConfig,
      });

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(capturedHeaders['Authorization']).toBe('Bearer sk-deepseek-test-key');
      expect(capturedBody.model).toBe('deepseek-chat');
    });
  });

  describe('AzureOpenAIAdapter', () => {
    it('should construct correct Azure endpoint and api-key header', async () => {
      const adapter = new AzureOpenAIAdapter();
      let capturedUrl = '';
      let capturedHeaders: any = null;

      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = init.headers;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const response = await adapter.execute({
        model: 'azure/gpt-4o-deploy',
        body: { messages: [{ role: 'user', content: 'Hello Azure' }] },
        clientHeaders: new Headers(),
        config: mockConfig,
      });

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe(
        'https://test-resource.openai.azure.com/openai/deployments/gpt-4o-deploy/chat/completions?api-version=2024-08-01-preview',
      );
      expect(capturedHeaders['api-key']).toBe('azure-secret-key');
    });
  });
});
