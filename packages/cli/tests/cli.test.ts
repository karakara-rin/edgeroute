import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SemanticClassifier,
  defineConfig,
  HashEmbeddingProvider,
} from '@edgeroute/core';
import {
  initCommand,
  buildEmbeddingsCommand,
  evalCommand,
  loadDataset,
  parseThresholdRange,
  formatMarkdownReport,
  type NormalizedDatasetPrompt,
} from '../src/index.js';

describe('@edgeroute/cli Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeroute-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initCommand', () => {
    it('should generate a starter router.config.ts file', async () => {
      const generatedPath = await initCommand({ cwd: tmpDir });
      expect(fs.existsSync(generatedPath)).toBe(true);
      const content = fs.readFileSync(generatedPath, 'utf-8');
      expect(content).toContain('defineConfig');
      expect(content).toContain('simple-tasks');
    });

    it('should respect force flag when overwriting existing config', async () => {
      const initialPath = path.join(tmpDir, 'router.config.ts');
      fs.writeFileSync(initialPath, '// custom original content', 'utf-8');

      // Without force
      await initCommand({ cwd: tmpDir, force: false });
      expect(fs.readFileSync(initialPath, 'utf-8')).toBe('// custom original content');

      // With force
      await initCommand({ cwd: tmpDir, force: true });
      expect(fs.readFileSync(initialPath, 'utf-8')).toContain('defineConfig');
    });
  });

  describe('buildEmbeddingsCommand', () => {
    it('should pre-compile offline embeddings to router.embeddings.json', async () => {
      const configPath = path.join(tmpDir, 'router.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultModel: 'gpt-4o',
          embedding: { provider: 'hash' },
          routes: [
            {
              name: 'translate-route',
              targetModel: 'gpt-4o-mini',
              threshold: 0.8,
              examples: [
                'Translate this sentence to French',
                'How do you say good morning in Spanish',
              ],
            },
            {
              name: 'code-route',
              targetModel: 'gpt-4o',
              threshold: 0.85,
              examples: ['Write a binary search algorithm in Rust'],
            },
          ],
        }),
        'utf-8',
      );

      const outputPath = path.join(tmpDir, 'router.embeddings.json');
      const result = await buildEmbeddingsCommand({
        config: configPath,
        output: outputPath,
        cwd: tmpDir,
      });

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(result.embeddings.length).toBe(3);
      expect(result.dimensions).toBe(256);
      expect(result.provider).toBe('hash');
      expect(result.embeddings[0]!.route).toBe('translate-route');
      expect(result.embeddings[0]!.vector.length).toBe(256);

      // Verify that SemanticClassifier can boot with precomputed vectors without recalculating
      const config = defineConfig({
        defaultModel: 'gpt-4o',
        precomputedEmbeddings: result,
        routes: [
          {
            name: 'translate-route',
            targetModel: 'gpt-4o-mini',
            threshold: 0.7,
            examples: [
              'Translate this sentence to French',
              'How do you say good morning in Spanish',
            ],
          },
        ],
      });

      const provider = new HashEmbeddingProvider();
      const classifier = new SemanticClassifier(config, provider);
      await classifier.initialize();

      const classification = await classifier.classify('Translate this sentence to French');
      expect(classification.matchedRoute).toBe('translate-route');
      expect(classification.path).toBe('semantic-path');
    });

    it('should output TypeScript code when target path ends with .ts', async () => {
      const configPath = path.join(tmpDir, 'router.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          defaultModel: 'gpt-4o',
          embedding: { provider: 'hash' },
          routes: [
            {
              name: 'simple',
              targetModel: 'gpt-4o-mini',
              examples: ['Hello world'],
            },
          ],
        }),
        'utf-8',
      );

      const outputPath = path.join(tmpDir, 'router.embeddings.ts');
      await buildEmbeddingsCommand({
        config: configPath,
        output: outputPath,
        cwd: tmpDir,
      });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('export const routerEmbeddings');
    });
  });

  describe('datasetLoader', () => {
    it('should load JSONL prompt datasets correctly', async () => {
      const datasetPath = path.join(tmpDir, 'data.jsonl');
      const lines = [
        JSON.stringify({ id: 'p1', prompt: 'Hello', difficulty: 'simple', inputTokens: 5, outputTokens: 10 }),
        JSON.stringify({ id: 'p2', prompt: 'Implement distributed consensus in Raft', difficulty: 'hard', inputTokens: 50, outputTokens: 200 }),
      ];
      fs.writeFileSync(datasetPath, lines.join('\n'), 'utf-8');

      const loaded = await loadDataset(datasetPath, tmpDir);
      expect(loaded.length).toBe(2);
      expect(loaded[0]!.id).toBe('p1');
      expect(loaded[0]!.expectedDifficulty).toBe('simple');
      expect(loaded[1]!.expectedDifficulty).toBe('hard');
    });

    it('should load CSV datasets correctly', async () => {
      const csvPath = path.join(tmpDir, 'data.csv');
      const csvContent = `id,prompt,category,difficulty,inputTokens,outputTokens
csv-1,"How are you?",chat,simple,10,20
csv-2,"Write an OS kernel in C",coding,hard,40,150`;
      fs.writeFileSync(csvPath, csvContent, 'utf-8');

      const loaded = await loadDataset(csvPath, tmpDir);
      expect(loaded.length).toBe(2);
      expect(loaded[0]!.prompt).toBe('How are you?');
      expect(loaded[0]!.expectedDifficulty).toBe('simple');
      expect(loaded[1]!.expectedDifficulty).toBe('hard');
    });
  });

  describe('evalCommand and Auto-Tuning', () => {
    it('should parse threshold range parameters correctly', () => {
      const parsed = parseThresholdRange('0.6:0.9:0.05');
      expect(parsed.min).toBe(0.6);
      expect(parsed.max).toBe(0.9);
      expect(parsed.step).toBe(0.05);

      const defaultParsed = parseThresholdRange(undefined);
      expect(defaultParsed.min).toBe(0.5);
      expect(defaultParsed.max).toBe(0.95);
    });

    it('should execute baseline evaluation simulation on standard dataset', async () => {
      const outReport = path.join(tmpDir, 'eval-report.md');
      const result = await evalCommand({
        cwd: tmpDir,
        threshold: 0.6,
        output: outReport,
      });

      expect(result.report.totalPrompts).toBeGreaterThan(0);
      expect(result.report.costs.savedUSD).toBeGreaterThanOrEqual(0);
      expect(result.report.accuracy.accuracyPercentage).toBeGreaterThan(0);
      expect(fs.existsSync(outReport)).toBe(true);

      const reportMd = fs.readFileSync(outReport, 'utf-8');
      expect(reportMd).toContain('EdgeRoute Evaluation & Tuning Report');
      expect(reportMd).toContain('Net Cost Savings');
    });

    it('should run threshold sweep auto-tuning and find optimal threshold', async () => {
      const result = await evalCommand({
        cwd: tmpDir,
        tune: true,
        thresholdRange: '0.4:0.8:0.1',
      });

      expect(result.sweepPoints).toBeDefined();
      expect(result.sweepPoints!.length).toBe(5);
      expect(result.recommendedThreshold).toBeDefined();
      expect(result.recommendedThreshold).toBeGreaterThanOrEqual(0.4);
      expect(result.recommendedThreshold).toBeLessThanOrEqual(0.8);
    });
  });
});
