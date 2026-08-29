import { Command } from 'commander';
import { buildEmbeddingsCommand } from './commands/build-embeddings.js';
import { devCommand } from './commands/dev.js';
import { evalCommand } from './commands/eval.js';
import { initCommand } from './commands/init.js';
import { testCommand } from './commands/test.js';

export * from './commands/build-embeddings.js';
export * from './commands/dev.js';
export * from './commands/eval.js';
export * from './commands/init.js';
export * from './commands/test.js';
export * from './presets/index.js';
export * from './report.js';
export * from './utils/config-loader.js';
export * from './utils/dataset-loader.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('edgeroute')
    .description('EdgeRoute CLI — Offline Vector Pre-compiler & Routing Evaluation Engine')
    .version('0.1.0');

  // Command: dev
  program
    .command('dev')
    .description('Start local EdgeRoute proxy server with real-time colored request feedback')
    .option('-c, --config <path>', 'Path to router.config.ts or config file')
    .option('-p, --port <number>', 'Port to listen on (default: 3000)')
    .option('-h, --host <host>', 'Host address to bind to (default: 0.0.0.0)')
    .action(async (options) => {
      try {
        await devCommand(options);
      } catch (err: any) {
        console.error(`Error starting dev server: ${err.message}`);
        process.exit(1);
      }
    });

  // Command: build-embeddings
  program
    .command('build-embeddings')
    .description('Pre-compute route example vectors offline to eliminate edge cold starts')
    .option('-c, --config <path>', 'Path to router.config.ts or config file')
    .option('-o, --output <path>', 'Output JSON/TS file path (default: router.embeddings.json)')
    .option('-p, --provider <name>', 'Override embedding provider (hash | transformers | openai)')
    .option('-m, --model <name>', 'Override embedding model name')
    .action(async (options) => {
      try {
        await buildEmbeddingsCommand(options);
      } catch (err: any) {
        console.error(`Error building embeddings: ${err.message}`);
        process.exit(1);
      }
    });

  // Command: eval
  program
    .command('eval')
    .description('Replay prompt datasets through router to calculate cost savings and tune thresholds')
    .option('-d, --dataset <path>', 'Path to prompt dataset (.jsonl, .json, or .csv)')
    .option('-c, --config <path>', 'Path to router.config.ts or config file')
    .option('-t, --threshold <number>', 'Specific complexity/semantic threshold to evaluate', parseFloat)
    .option('--tune', 'Auto-tune and sweep threshold range to find optimal cost/accuracy balance')
    .option('--threshold-range <min:max:step>', 'Threshold sweep range (default: 0.5:0.95:0.05)')
    .option('-o, --output <path>', 'Output report file path (.md or .json)')
    .option('-f, --format <type>', 'Output format (table | json | markdown)', 'table')
    .option('--target-model <model>', 'Target lightweight model to test')
    .option('--default-model <model>', 'Default/frontier model to test')
    .action(async (options) => {
      try {
        await evalCommand(options);
      } catch (err: any) {
        console.error(`Error running evaluation: ${err.message}`);
        process.exit(1);
      }
    });

  // Command: init
  program
    .command('init')
    .description('Scaffold a new starter router.config.ts and .env.example file')
    .option('-p, --preset <name>', 'Select configuration preset (cost-saver | coding-agent | minimal-cache-only)')
    .option('-y, --yes', 'Skip interactive prompt and use default cost-saver preset')
    .option('-o, --output <path>', 'Output config file path (default: router.config.ts)')
    .option('--env-output <path>', 'Output environment template file path (default: .env.example)')
    .option('-f, --force', 'Overwrite existing config and env files if present')
    .action(async (options) => {
      try {
        await initCommand(options);
      } catch (err: any) {
        console.error(`Error initializing config: ${err.message}`);
        process.exit(1);
      }
    });

  // Command: test
  program
    .command('test <prompt>')
    .description('Test prompt routing decisions, candidate scores, and cost estimates offline')
    .option('-c, --config <path>', 'Path to router.config.ts or config file')
    .option('-v, --verbose', 'Show detailed candidate route scores, token estimations, and complexity analysis')
    .option('--json', 'Output result in structured JSON format')
    .action(async (prompt, options) => {
      try {
        await testCommand(prompt, options);
      } catch (err: any) {
        console.error(`Error testing prompt routing: ${err.message}`);
        process.exit(1);
      }
    });

  return program;
}

// Only execute CLI automatically if run as the main entry point
const normalizedEntry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (
  normalizedEntry.endsWith('/dist/index.js') ||
  normalizedEntry.endsWith('/src/index.ts') ||
  normalizedEntry.endsWith('/edgeroute') ||
  normalizedEntry.endsWith('index.js')
) {
  const program = createProgram();
  program.parse(process.argv);
}

