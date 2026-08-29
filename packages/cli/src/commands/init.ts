import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import pc from 'picocolors';
import { PRESETS, getPreset, type PresetDefinition, type PresetName } from '../presets/index.js';

export interface InitOptions {
  force?: boolean;
  output?: string;
  envOutput?: string;
  cwd?: string;
  preset?: string;
  yes?: boolean;
}

export interface InitResult {
  configPath: string;
  envPath: string;
  preset: PresetDefinition;
}

async function promptPresetSelection(): Promise<PresetDefinition> {
  const presetKeys = Object.keys(PRESETS) as PresetName[];
  console.log(pc.bold('\n✨ Select a starter preset configuration for EdgeRoute:'));
  
  presetKeys.forEach((key, index) => {
    const preset = PRESETS[key]!;
    const isDefault = key === 'cost-saver';
    const tag = isDefault ? pc.green(' (default)') : '';
    console.log(`  ${pc.cyan(`[${index + 1}]`)} ${pc.bold(preset.name)}${tag}`);
    console.log(`      ${pc.dim(preset.description)}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`\nEnter choice (1-${presetKeys.length}, default: 1): `);
    const trimmed = answer.trim();
    if (!trimmed) {
      return PRESETS['cost-saver']!;
    }
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= presetKeys.length) {
      const selectedKey = presetKeys[num - 1]!;
      return PRESETS[selectedKey]!;
    }
    // Also accept preset ID matching
    if (PRESETS[trimmed]) {
      return PRESETS[trimmed]!;
    }
    console.log(pc.yellow(`Invalid selection "${answer}", using default "cost-saver"`));
    return PRESETS['cost-saver']!;
  } finally {
    rl.close();
  }
}

export async function initCommand(options: InitOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const targetConfig = path.resolve(cwd, options.output ?? 'router.config.ts');
  const targetEnv = path.resolve(cwd, options.envOutput ?? '.env.example');

  let selectedPreset: PresetDefinition;

  if (options.preset) {
    selectedPreset = getPreset(options.preset);
  } else if (!options.yes && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    selectedPreset = await promptPresetSelection();
  } else {
    selectedPreset = PRESETS['cost-saver']!;
  }

  // 1. Write router.config.ts
  const configExists = fs.existsSync(targetConfig);
  if (configExists && !options.force) {
    console.log(pc.yellow(`⚠️  Configuration file already exists at ${path.basename(targetConfig)} (use --force to overwrite)`));
  } else {
    fs.writeFileSync(targetConfig, selectedPreset.configContent, 'utf-8');
    const relConfig = path.relative(cwd, targetConfig) || path.basename(targetConfig);
    console.log(pc.green(pc.bold(`✔ Created ${selectedPreset.name} config at ${pc.underline(relConfig)}`)));
  }

  // 2. Write .env.example
  const envExists = fs.existsSync(targetEnv);
  if (envExists && !options.force) {
    console.log(pc.dim(`ℹ️  Environment template already exists at ${path.basename(targetEnv)} (skipping)`));
  } else {
    fs.writeFileSync(targetEnv, selectedPreset.envExampleContent, 'utf-8');
    const relEnv = path.relative(cwd, targetEnv) || path.basename(targetEnv);
    console.log(pc.green(pc.bold(`✔ Created environment template at ${pc.underline(relEnv)}`)));
  }

  console.log('');
  console.log(pc.cyan('Next steps:'));
  console.log(`  1. Copy ${pc.bold('.env.example')} to ${pc.bold('.env')} and configure your API keys.`);
  console.log(`  2. Test prompt routing: ${pc.bold('npx edgeroute test "Your sample prompt"')}`);
  console.log(`  3. Start dev proxy server: ${pc.bold('npx edgeroute dev')}`);
  console.log('');

  return targetConfig;
}
