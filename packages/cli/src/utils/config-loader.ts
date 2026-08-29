import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type EdgeRouteConfig, defineConfig } from '@edgeroute/core';

export async function loadConfig(configPath?: string, cwd: string = process.cwd()): Promise<EdgeRouteConfig> {
  const candidatePaths = configPath
    ? [path.resolve(cwd, configPath)]
    : [
        path.resolve(cwd, 'router.config.ts'),
        path.resolve(cwd, 'router.config.js'),
        path.resolve(cwd, 'router.config.mjs'),
        path.resolve(cwd, 'router.config.json'),
        path.resolve(cwd, 'edgeroute.config.ts'),
        path.resolve(cwd, 'edgeroute.config.js'),
        path.resolve(cwd, 'edgeroute.config.json'),
      ];

  let foundPath: string | null = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    if (configPath) {
      throw new Error(`Configuration file not found at: ${configPath}`);
    }
    // Return standard default config
    return defineConfig({
      defaultModel: 'gpt-4o',
      routes: [
        {
          name: 'simple-tasks',
          targetModel: 'gpt-4o-mini',
          threshold: 0.78,
          rules: {
            maxCharacters: 200,
            patterns: [/^(hello|hi|hey|こんにちは)/i, /^(translate|summarize)/i],
          },
          examples: [
            'Fix spelling and grammar in this sentence',
            'Convert this JSON data to CSV format',
            'Summarize this paragraph in 3 bullet points',
            'Tell me a short joke',
          ],
        },
      ],
    });
  }

  if (foundPath.endsWith('.json')) {
    const raw = fs.readFileSync(foundPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return defineConfig(parsed);
  }

  try {
    const fileUrl = pathToFileURL(foundPath).href;
    const mod = await import(fileUrl);
    const rawConfig = mod.default ?? mod.config ?? mod;
    return defineConfig(rawConfig);
  } catch (directErr: any) {
    if (foundPath.endsWith('.ts')) {
      try {
        const rawCode = fs.readFileSync(foundPath, 'utf-8');
        // Transpile TypeScript code to ESM in-memory
        const { default: ts } = await import('typescript');
        const transpiled = ts.transpileModule(rawCode, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        const dataUri = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
        const mod = await import(dataUri);
        const rawConfig = mod.default ?? mod.config ?? mod;
        return defineConfig(rawConfig);
      } catch (tsErr: any) {
        throw new Error(
          `Failed to parse TypeScript configuration file at "${foundPath}": ${tsErr.message || directErr.message}`,
        );
      }
    }
    throw new Error(`Failed to load configuration file at "${foundPath}": ${directErr.message}`);
  }
}
