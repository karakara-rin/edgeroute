import pc from 'picocolors';

export interface ServerLoggerOptions {
  /**
   * Explicitly enable or disable rich logging.
   * If not specified, automatically disables in test environments (NODE_ENV=test / VITEST)
   * unless EDGEROUTE_LOG=true is set.
   */
  enabled?: boolean;
  /**
   * Custom output writer (defaults to console.log).
   */
  writer?: (message: string) => void;
}

export interface RouteLogEvent {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  fromCache?: boolean;
  cacheLatencyMs?: number;
  matchedRoute?: string;
  targetModel?: string;
  defaultModel?: string;
  savedCostUSD?: number;
  retriedWithFallback?: boolean;
  primaryModelError?: string | number;
}

export class ServerLogger {
  private enabled: boolean;
  private writer: (message: string) => void;

  constructor(options: ServerLoggerOptions = {}) {
    this.writer = options.writer ?? console.log;

    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    } else if (process.env.EDGEROUTE_LOG === 'true' || process.env.EDGEROUTE_LOG === 'verbose') {
      this.enabled = true;
    } else if (
      process.env.EDGEROUTE_LOG === 'silent' ||
      process.env.EDGEROUTE_LOG === 'false' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true'
    ) {
      this.enabled = false;
    } else {
      this.enabled = true;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public formatStatus(status: number): string {
    if (status >= 200 && status < 300) {
      return pc.green(pc.bold(status.toString()));
    }
    if (status >= 400 && status < 500) {
      return pc.yellow(pc.bold(status.toString()));
    }
    if (status >= 500) {
      return pc.red(pc.bold(status.toString()));
    }
    return pc.white(pc.bold(status.toString()));
  }

  public formatSavedUSD(amount: number): string {
    const formatted = amount >= 0.01 ? amount.toFixed(4) : amount.toFixed(amount < 0.0001 ? 6 : 4);
    return pc.green(pc.bold(`$${formatted}`));
  }

  public formatCacheHit(cacheLatencyMs: number = 0, savedCostUSD: number = 0): string {
    const latencyStr = `${cacheLatencyMs.toFixed(1)}ms`;
    const badge = pc.cyan(pc.bold(`[HIT ⚡ ${latencyStr}]`));
    const savedStr = this.formatSavedUSD(savedCostUSD);
    return `${badge} (Semantic Cache Hit, Saved ${savedStr})`;
  }

  public formatRoute(
    matchedRoute: string,
    targetModel: string,
    defaultModel?: string,
    savedCostUSD?: number,
  ): string {
    const badge = pc.magenta(pc.bold('[ROUTE 🎯]'));
    const routeName = pc.cyan(`"${matchedRoute}"`);
    const modelName = pc.bold(targetModel);

    let savingsInfo = '';
    if (savedCostUSD && savedCostUSD > 0 && defaultModel && targetModel !== defaultModel) {
      savingsInfo = ` (Saved ${this.formatSavedUSD(savedCostUSD)} vs ${pc.dim(defaultModel)})`;
    }

    return `${badge} Matched ${routeName} -> ${modelName}${savingsInfo}`;
  }

  public formatFallback(
    primaryReason: string | number = 429,
    defaultModel: string = 'gpt-4o',
  ): string {
    const badge = pc.yellow(pc.bold('[FALLBACK 🛡️]'));
    return `${badge} Primary model ${pc.yellow(primaryReason.toString())} -> Fallback to defaultModel (${pc.bold(defaultModel)})`;
  }

  /**
   * Logs a complete request lifecycle event with badges and colorized telemetry.
   */
  public logRequest(event: RouteLogEvent): void {
    if (!this.enabled) return;

    const timeStr = pc.dim(new Date().toLocaleTimeString());
    const methodStr = pc.bold(event.method.toUpperCase());
    const pathStr = event.path;
    const statusStr = this.formatStatus(event.status);
    const durationStr = pc.dim(`(${event.durationMs.toFixed(1)}ms)`);

    const headerLine = `${timeStr} ${methodStr} ${pathStr} ${statusStr} ${durationStr}`;
    const detailLines: string[] = [];

    if (event.retriedWithFallback) {
      detailLines.push(
        `  ${this.formatFallback(event.primaryModelError || 429, event.defaultModel || 'gpt-4o')}`,
      );
    }

    if (event.fromCache) {
      detailLines.push(
        `  ${this.formatCacheHit(event.cacheLatencyMs ?? 0, event.savedCostUSD ?? 0)}`,
      );
    } else if (event.matchedRoute && event.targetModel) {
      detailLines.push(
        `  ${this.formatRoute(
          event.matchedRoute,
          event.targetModel,
          event.defaultModel,
          event.savedCostUSD,
        )}`,
      );
    }

    this.writer(`${headerLine}${detailLines.length > 0 ? `\n${detailLines.join('\n')}` : ''}`);
  }
}
