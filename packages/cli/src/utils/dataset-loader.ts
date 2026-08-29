import fs from 'node:fs';
import path from 'node:path';
import {
  STANDARD_COMPLEXITY_DATASET,
  type ComplexityBenchmarkPrompt,
  type ComplexityDifficultyLevel,
} from '@edgeroute/core';

export interface NormalizedDatasetPrompt {
  id: string;
  prompt: string;
  category: string;
  expectedDifficulty?: ComplexityDifficultyLevel;
  expectedRoute?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentValue += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(currentValue.trim());
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  values.push(currentValue.trim());
  return values;
}

export async function loadDataset(datasetPath?: string, cwd: string = process.cwd()): Promise<NormalizedDatasetPrompt[]> {
  if (!datasetPath) {
    return STANDARD_COMPLEXITY_DATASET.map((p) => ({
      id: p.id,
      prompt: p.prompt,
      category: p.category,
      expectedDifficulty: p.expectedDifficulty,
      estimatedInputTokens: p.estimatedInputTokens,
      estimatedOutputTokens: p.estimatedOutputTokens,
    }));
  }

  const resolved = path.resolve(cwd, datasetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Dataset file not found at: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');

  if (resolved.endsWith('.jsonl')) {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((line, idx) => {
      const parsed = JSON.parse(line);
      return {
        id: parsed.id ?? `prompt-${idx + 1}`,
        prompt: parsed.prompt ?? parsed.text ?? parsed.input ?? '',
        category: parsed.category ?? 'general',
        expectedDifficulty: parsed.expectedDifficulty ?? parsed.difficulty,
        expectedRoute: parsed.expectedRoute ?? parsed.route,
        estimatedInputTokens: Number(parsed.inputTokens ?? parsed.estimatedInputTokens ?? Math.max(1, Math.ceil((parsed.prompt?.length ?? 10) / 4))),
        estimatedOutputTokens: Number(parsed.outputTokens ?? parsed.estimatedOutputTokens ?? 60),
      };
    });
  }

  if (resolved.endsWith('.json')) {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item, idx) => ({
      id: item.id ?? `prompt-${idx + 1}`,
      prompt: item.prompt ?? item.text ?? item.input ?? '',
      category: item.category ?? 'general',
      expectedDifficulty: item.expectedDifficulty ?? item.difficulty,
      expectedRoute: item.expectedRoute ?? item.route,
      estimatedInputTokens: Number(item.inputTokens ?? item.estimatedInputTokens ?? Math.max(1, Math.ceil((item.prompt?.length ?? 10) / 4))),
      estimatedOutputTokens: Number(item.outputTokens ?? item.estimatedOutputTokens ?? 60),
    }));
  }

  if (resolved.endsWith('.csv')) {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    const promptIdx = headers.findIndex((h) => h === 'prompt' || h === 'text' || h === 'input');
    const idIdx = headers.findIndex((h) => h === 'id' || h === 'name');
    const categoryIdx = headers.findIndex((h) => h === 'category');
    const diffIdx = headers.findIndex((h) => h === 'difficulty' || h === 'expecteddifficulty');
    const routeIdx = headers.findIndex((h) => h === 'route' || h === 'expectedroute');
    const inTokensIdx = headers.findIndex((h) => h === 'inputtokens' || h === 'estimatedinputtokens');
    const outTokensIdx = headers.findIndex((h) => h === 'outputtokens' || h === 'estimatedoutputtokens');

    return lines.slice(1).map((line, rowIdx) => {
      const cols = parseCSVLine(line);
      const prompt = promptIdx >= 0 ? cols[promptIdx] ?? '' : cols[0] ?? '';
      const id = idIdx >= 0 ? cols[idIdx] ?? `prompt-${rowIdx + 1}` : `prompt-${rowIdx + 1}`;
      const category = categoryIdx >= 0 ? cols[categoryIdx] ?? 'general' : 'general';
      const expectedDifficulty = diffIdx >= 0 ? (cols[diffIdx] as ComplexityDifficultyLevel) : undefined;
      const expectedRoute = routeIdx >= 0 ? cols[routeIdx] : undefined;
      const estimatedInputTokens = inTokensIdx >= 0 && cols[inTokensIdx] ? Number(cols[inTokensIdx]) : Math.max(1, Math.ceil(prompt.length / 4));
      const estimatedOutputTokens = outTokensIdx >= 0 && cols[outTokensIdx] ? Number(cols[outTokensIdx]) : 60;

      return {
        id,
        prompt,
        category,
        expectedDifficulty,
        expectedRoute,
        estimatedInputTokens,
        estimatedOutputTokens,
      };
    });
  }

  throw new Error(`Unsupported dataset format: ${datasetPath}. Please use .jsonl, .json, or .csv`);
}
