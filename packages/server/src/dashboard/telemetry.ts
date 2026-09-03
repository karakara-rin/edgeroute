import type { RouteLogEvent } from '../types.js';

export type DashboardLogEvent = RouteLogEvent;

export interface DashboardStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  totalSavedUSD: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  routesBreakdown: Record<
    string,
    { count: number; savedUSD: number; targetModel: string }
  >;
  modelsBreakdown: Record<string, { count: number; provider: string }>;
  providersBreakdown: Record<string, number>;
  recentRequests: DashboardLogEvent[];
}

export class DashboardTelemetryStore {
  private maxRecent: number;
  private recent: DashboardLogEvent[] = [];
  private totalRequests = 0;
  private cacheHits = 0;
  private totalSavedUSD = 0;
  private latencies: number[] = [];
  private routesMap: Map<
    string,
    { count: number; savedUSD: number; targetModel: string }
  > = new Map();
  private modelsMap: Map<string, { count: number; provider: string }> =
    new Map();
  private providersMap: Map<string, number> = new Map();

  constructor(maxRecent = 100) {
    this.maxRecent = maxRecent;
  }

  public recordRequest(event: DashboardLogEvent): void {
    const timestamp = event.timestamp ?? Date.now();
    const id =
      event.id ??
      `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

    const normalizedEvent: DashboardLogEvent = {
      ...event,
      id,
      timestamp,
    };

    this.totalRequests++;
    this.latencies.push(event.durationMs);
    if (this.latencies.length > 500) {
      this.latencies.shift();
    }

    if (event.fromCache) {
      this.cacheHits++;
    }

    if (event.savedCostUSD && event.savedCostUSD > 0) {
      this.totalSavedUSD += event.savedCostUSD;
    }

    // Route breakdown
    const routeKey = event.matchedRoute || 'default';
    const existingRoute = this.routesMap.get(routeKey) || {
      count: 0,
      savedUSD: 0,
      targetModel: event.targetModel || 'unknown',
    };
    existingRoute.count++;
    if (event.savedCostUSD) existingRoute.savedUSD += event.savedCostUSD;
    if (event.targetModel) existingRoute.targetModel = event.targetModel;
    this.routesMap.set(routeKey, existingRoute);

    // Model breakdown
    if (event.targetModel) {
      const existingModel = this.modelsMap.get(event.targetModel) || {
        count: 0,
        provider: event.provider || 'openai',
      };
      existingModel.count++;
      if (event.provider) existingModel.provider = event.provider;
      this.modelsMap.set(event.targetModel, existingModel);
    }

    // Provider breakdown
    if (event.provider) {
      this.providersMap.set(
        event.provider,
        (this.providersMap.get(event.provider) || 0) + 1,
      );
    }

    // Recent requests buffer
    this.recent.unshift(normalizedEvent);
    if (this.recent.length > this.maxRecent) {
      this.recent.pop();
    }
  }

  public getStats(): DashboardStats {
    const cacheMisses = this.totalRequests - this.cacheHits;
    const cacheHitRate =
      this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0;

    let avgLatency = 0;
    let p95Latency = 0;

    if (this.latencies.length > 0) {
      const sum = this.latencies.reduce((acc, val) => acc + val, 0);
      avgLatency = sum / this.latencies.length;

      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      p95Latency = sorted[p95Index] ?? sorted[sorted.length - 1];
    }

    const routesBreakdown: Record<
      string,
      { count: number; savedUSD: number; targetModel: string }
    > = {};
    for (const [key, value] of this.routesMap.entries()) {
      routesBreakdown[key] = { ...value };
    }

    const modelsBreakdown: Record<
      string,
      { count: number; provider: string }
    > = {};
    for (const [key, value] of this.modelsMap.entries()) {
      modelsBreakdown[key] = { ...value };
    }

    const providersBreakdown: Record<string, number> = {};
    for (const [key, value] of this.providersMap.entries()) {
      providersBreakdown[key] = value;
    }

    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheMisses,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      totalSavedUSD: Math.round(this.totalSavedUSD * 10000) / 10000,
      averageLatencyMs: Math.round(avgLatency * 100) / 100,
      p95LatencyMs: Math.round(p95Latency * 100) / 100,
      routesBreakdown,
      modelsBreakdown,
      providersBreakdown,
      recentRequests: [...this.recent],
    };
  }

  public clear(): void {
    this.recent = [];
    this.totalRequests = 0;
    this.cacheHits = 0;
    this.totalSavedUSD = 0;
    this.latencies = [];
    this.routesMap.clear();
    this.modelsMap.clear();
    this.providersMap.clear();
  }
}

export const globalDashboardTelemetry = new DashboardTelemetryStore();
