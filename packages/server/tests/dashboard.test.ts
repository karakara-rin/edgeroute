import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DashboardTelemetryStore,
  globalDashboardTelemetry,
} from '../src/dashboard/telemetry.js';
import { createRouterRoutes } from '../src/routes.js';
import { EdgeRouteEngine, defineConfig } from '@edgeroute/core';

describe('Web Control Plane Dashboard & Telemetry', () => {
  beforeEach(() => {
    globalDashboardTelemetry.clear();
  });

  describe('DashboardTelemetryStore', () => {
    it('should accurately calculate hit rate, savings, and latencies', () => {
      const store = new DashboardTelemetryStore();

      store.recordRequest({
        method: 'POST',
        path: '/v1/chat/completions',
        status: 200,
        durationMs: 10,
        fromCache: true,
        cacheLatencyMs: 0.5,
        matchedRoute: 'greeting',
        targetModel: 'gpt-4o-mini',
        savedCostUSD: 0.005,
      });

      store.recordRequest({
        method: 'POST',
        path: '/v1/chat/completions',
        status: 200,
        durationMs: 30,
        fromCache: false,
        matchedRoute: 'coding',
        targetModel: 'claude-3-5-sonnet',
        savedCostUSD: 0.002,
      });

      const stats = store.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.cacheHitRate).toBe(50);
      expect(stats.totalSavedUSD).toBe(0.007);
      expect(stats.averageLatencyMs).toBe(20);
      expect(stats.routesBreakdown['greeting'].count).toBe(1);
      expect(stats.routesBreakdown['coding'].count).toBe(1);
      expect(stats.recentRequests.length).toBe(2);
    });
  });

  describe('Dashboard HTTP Endpoints', () => {
    const config = defineConfig({
      defaultModel: 'gpt-4o',
      routes: [
        {
          name: 'greeting',
          targetModel: 'gpt-4o-mini',
          rules: { patterns: [/^(hi|hello)/i] },
        },
      ],
      embedding: { provider: 'hash' },
    });

    it('should serve HTML dashboard at GET /dashboard', async () => {
      const engine = new EdgeRouteEngine(config);
      await engine.initialize();
      const app = createRouterRoutes(config, engine);

      const res = await app.request('/dashboard');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('EdgeRoute Control Plane');
      expect(text).toContain('Route Simulator');
    });

    it('should return metrics JSON at GET /api/dashboard/stats', async () => {
      const engine = new EdgeRouteEngine(config);
      await engine.initialize();
      const app = createRouterRoutes(config, engine);

      globalDashboardTelemetry.recordRequest({
        method: 'POST',
        path: '/v1/chat/completions',
        status: 200,
        durationMs: 1.2,
        matchedRoute: 'greeting',
        targetModel: 'gpt-4o-mini',
        savedCostUSD: 0.001,
      });

      const res = await app.request('/api/dashboard/stats');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalRequests).toBe(1);
      expect(data.routesBreakdown.greeting.count).toBe(1);
    });

    it('should test prompt routing via POST /api/dashboard/test-prompt', async () => {
      const engine = new EdgeRouteEngine(config);
      await engine.initialize();
      const app = createRouterRoutes(config, engine);

      const res = await app.request('/api/dashboard/test-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello world' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matchedRoute).toBe('greeting');
      expect(data.targetModel).toBe('gpt-4o-mini');
      expect(data.tier).toBe('fast-path');
      expect(data.estimatedSavingsPercent).toBeGreaterThan(0);
    });

    it('should clear telemetry metrics via POST /api/dashboard/reset', async () => {
      const engine = new EdgeRouteEngine(config);
      await engine.initialize();
      const app = createRouterRoutes(config, engine);

      globalDashboardTelemetry.recordRequest({
        method: 'POST',
        path: '/v1/chat/completions',
        status: 200,
        durationMs: 1.2,
      });

      expect(globalDashboardTelemetry.getStats().totalRequests).toBe(1);

      const resetRes = await app.request('/api/dashboard/reset', { method: 'POST' });
      expect(resetRes.status).toBe(200);
      expect(globalDashboardTelemetry.getStats().totalRequests).toBe(0);
    });
  });
});
