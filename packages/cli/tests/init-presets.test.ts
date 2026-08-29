import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initCommand,
  getPreset,
  PRESETS,
  type PresetName,
} from '../src/index.js';
import { loadConfig } from '../src/utils/config-loader.js';

describe('EdgeRoute init Preset Selection Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeroute-init-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should list all required presets: cost-saver, coding-agent, minimal-cache-only', () => {
    const keys = Object.keys(PRESETS);
    expect(keys).toContain('cost-saver');
    expect(keys).toContain('coding-agent');
    expect(keys).toContain('minimal-cache-only');
  });

  describe('Default (cost-saver) preset generation', () => {
    it('should generate valid cost-saver router.config.ts and .env.example', async () => {
      const generatedPath = await initCommand({ cwd: tmpDir, yes: true });
      expect(fs.existsSync(generatedPath)).toBe(true);

      const configContent = fs.readFileSync(generatedPath, 'utf-8');
      expect(configContent).toContain('defaultModel: \'gpt-4o\'');
      expect(configContent).toContain('threshold: 0.92');
      expect(configContent).toContain('simple-tasks');
      expect(configContent).toContain('gpt-4o-mini');
      expect(configContent).toContain('claude-3-5-haiku-20241022');

      const envPath = path.join(tmpDir, '.env.example');
      expect(fs.existsSync(envPath)).toBe(true);
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).toContain('OPENAI_API_KEY');
      expect(envContent).toContain('ANTHROPIC_API_KEY');
    });

    it('should be valid evaluate-able config through loadConfig utility', async () => {
      await initCommand({ cwd: tmpDir, preset: 'cost-saver' });
      const loaded = await loadConfig(path.join(tmpDir, 'router.config.ts'), tmpDir);

      expect(loaded.defaultModel).toBe('gpt-4o');
      expect(loaded.cache?.enabled).toBe(true);
      expect(loaded.cache?.threshold).toBe(0.92);
      expect(loaded.routes).toHaveLength(2);
      expect(loaded.routes[0]?.name).toBe('simple-tasks');
      expect(loaded.routes[0]?.targetModel).toBe('gpt-4o-mini');
    });
  });

  describe('coding-agent preset generation', () => {
    it('should generate valid coding-agent configuration with groq and claude sonnet', async () => {
      const targetFile = await initCommand({
        cwd: tmpDir,
        preset: 'coding-agent',
      });
      expect(fs.existsSync(targetFile)).toBe(true);

      const configContent = fs.readFileSync(targetFile, 'utf-8');
      expect(configContent).toContain('defaultModel: \'claude-3-5-sonnet-20241022\'');
      expect(configContent).toContain('groq/llama-3.3-70b-versatile');
      expect(configContent).toContain('threshold: 0.95');

      const envPath = path.join(tmpDir, '.env.example');
      expect(fs.existsSync(envPath)).toBe(true);
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).toContain('ANTHROPIC_API_KEY');
      expect(envContent).toContain('GROQ_API_KEY');

      const loaded = await loadConfig(targetFile, tmpDir);
      expect(loaded.defaultModel).toBe('claude-3-5-sonnet-20241022');
      expect(loaded.routes.some((r) => r.targetModel === 'groq/llama-3.3-70b-versatile')).toBe(true);
      expect(loaded.cache?.threshold).toBe(0.95);
    });
  });

  describe('minimal-cache-only preset generation', () => {
    it('should generate valid minimal-cache-only configuration with empty routes', async () => {
      const targetFile = await initCommand({
        cwd: tmpDir,
        preset: 'minimal-cache-only',
      });
      expect(fs.existsSync(targetFile)).toBe(true);

      const configContent = fs.readFileSync(targetFile, 'utf-8');
      expect(configContent).toContain('routes: []');
      expect(configContent).toContain('threshold: 0.92');

      const envPath = path.join(tmpDir, '.env.example');
      expect(fs.existsSync(envPath)).toBe(true);
      const envContent = fs.readFileSync(envPath, 'utf-8');
      expect(envContent).toContain('OPENAI_API_KEY');

      const loaded = await loadConfig(targetFile, tmpDir);
      expect(loaded.defaultModel).toBe('gpt-4o');
      expect(loaded.cache?.enabled).toBe(true);
      expect(loaded.routes).toHaveLength(0);
    });
  });

  describe('Edge cases and flag controls', () => {
    it('should throw when unknown preset name is provided', () => {
      expect(() => getPreset('non-existent-preset')).toThrow(/Unknown preset/);
    });

    it('should honor custom output paths for both config and env files', async () => {
      const customConfig = path.join(tmpDir, 'custom.config.ts');
      const customEnv = path.join(tmpDir, '.env.custom');

      await initCommand({
        cwd: tmpDir,
        preset: 'coding-agent',
        output: customConfig,
        envOutput: customEnv,
      });

      expect(fs.existsSync(customConfig)).toBe(true);
      expect(fs.existsSync(customEnv)).toBe(true);
    });

    it('should not overwrite existing config or env files without force flag', async () => {
      const configPath = path.join(tmpDir, 'router.config.ts');
      const envPath = path.join(tmpDir, '.env.example');

      fs.writeFileSync(configPath, '// preexisting config', 'utf-8');
      fs.writeFileSync(envPath, '# preexisting env', 'utf-8');

      await initCommand({
        cwd: tmpDir,
        preset: 'coding-agent',
        force: false,
      });

      expect(fs.readFileSync(configPath, 'utf-8')).toBe('// preexisting config');
      expect(fs.readFileSync(envPath, 'utf-8')).toBe('# preexisting env');

      // With force: true
      await initCommand({
        cwd: tmpDir,
        preset: 'coding-agent',
        force: true,
      });

      expect(fs.readFileSync(configPath, 'utf-8')).toContain('claude-3-5-sonnet');
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('GROQ_API_KEY');
    });
  });
});
