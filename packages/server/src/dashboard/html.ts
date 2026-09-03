import type { EdgeRouteConfig } from '@edgeroute/core';

export function renderDashboardHtml(config: EdgeRouteConfig): string {
  const routesJson = JSON.stringify(
    config.routes.map((r) => ({
      name: r.name,
      targetModel: r.targetModel,
      threshold: r.threshold,
      hasRules: Boolean(r.rules),
      examplesCount: r.examples?.length || 0,
    })),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeRoute Control Plane</title>
  <style>
    :root {
      --bg: #090d14;
      --card-bg: #0f172a;
      --card-border: #1e293b;
      --card-border-hover: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --blue: #3b82f6;
      --blue-muted: rgba(59, 130, 246, 0.12);
      --green: #10b981;
      --green-muted: rgba(16, 185, 129, 0.12);
      --amber: #f59e0b;
      --amber-muted: rgba(245, 158, 11, 0.12);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      min-height: 100vh;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1280px; margin: 0 auto; }
    
    /* Top Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .brand-wrap { display: flex; align-items: baseline; gap: 12px; }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #fff;
    }
    .version-tag {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--text-dim);
      background: #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .brand-desc { font-size: 0.8rem; color: var(--text-muted); }
    .header-controls { display: flex; align-items: center; gap: 12px; }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--green);
      background: var(--green-muted);
      border: 1px solid rgba(16, 185, 129, 0.2);
      padding: 3px 8px;
      border-radius: 4px;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
    .btn {
      background: #1e293b;
      border: 1px solid var(--card-border-hover);
      color: var(--text);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: #334155; }
    .btn-primary {
      background: #2563eb;
      border-color: #3b82f6;
      color: #fff;
    }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Metric Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px 18px;
    }
    .card-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .card-value {
      font-family: var(--mono);
      font-size: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .card-footer {
      font-family: var(--mono);
      font-size: 0.725rem;
      color: var(--text-dim);
      margin-top: 4px;
    }
    .val-green { color: var(--green); }
    .val-blue { color: var(--blue); }

    /* Two-column layout */
    .split-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 900px) {
      .split-grid { grid-template-columns: 1fr; }
    }

    .section-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-sub {
      font-size: 0.75rem;
      color: var(--text-dim);
      font-weight: normal;
    }

    /* Simulator Input & Result */
    .simulator-form textarea {
      width: 100%;
      background: #090d14;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 10px 12px;
      color: var(--text);
      font-family: var(--sans);
      font-size: 0.85rem;
      resize: vertical;
      min-height: 72px;
      margin-bottom: 10px;
      outline: none;
    }
    .simulator-form textarea:focus { border-color: var(--blue); }
    .simulator-actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }
    .sim-result-box {
      background: #090d14;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 12px;
      display: none;
    }
    .sim-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.8rem;
    }
    .sim-row:last-child { border-bottom: none; }
    .sim-key { color: var(--text-muted); }
    .sim-val { font-family: var(--mono); font-weight: 500; }

    /* Configuration key-values */
    .config-list { font-size: 0.8rem; }
    .config-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .config-item:last-child { border-bottom: none; }
    .config-key { color: var(--text-muted); }
    .config-val { font-family: var(--mono); font-weight: 500; }

    /* Progress bars */
    .route-bar-wrap { margin-top: 14px; }
    .route-bar-item { margin-bottom: 10px; }
    .route-bar-header {
      display: flex;
      justify-content: space-between;
      font-family: var(--mono);
      font-size: 0.75rem;
      margin-bottom: 4px;
    }
    .route-bar-track {
      width: 100%;
      height: 6px;
      background: #1e293b;
      border-radius: 3px;
      overflow: hidden;
    }
    .route-bar-fill {
      height: 100%;
      background: var(--blue);
      border-radius: 3px;
    }

    /* Table */
    .table-wrap { overflow-x: auto; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.775rem; }
    th {
      text-align: left;
      padding: 8px 12px;
      color: var(--text-dim);
      font-weight: 600;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid var(--card-border);
      background: rgba(15, 23, 42, 0.5);
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-family: var(--mono);
    }
    tr:hover td { background: rgba(255, 255, 255, 0.015); }
    .pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-family: var(--mono);
    }
    .pill-hit { background: var(--green-muted); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.2); }
    .pill-miss { background: #1e293b; color: var(--text-muted); }
    .pill-route { background: var(--blue-muted); color: var(--blue); }
    .status-ok { color: var(--green); }
    .status-err { color: var(--amber); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="brand-wrap">
          <span class="brand-title">EdgeRoute Control Plane</span>
          <span class="version-tag">v0.1.0</span>
        </div>
        <div class="brand-desc">Edge Inference Proxy & Routing Telemetry</div>
      </div>
      <div class="header-controls">
        <span class="status-indicator"><span class="status-dot"></span> Active</span>
        <button id="refreshBtn" class="btn">Refresh</button>
        <button id="resetBtn" class="btn" title="Reset telemetry metrics">Reset</button>
      </div>
    </header>

    <!-- Metrics -->
    <div class="metrics-grid">
      <div class="card">
        <div class="card-label">Cache Hit Ratio</div>
        <div class="card-value val-green" id="hitRateVal">0.0%</div>
        <div class="card-footer" id="cacheRatioSub">0 hits / 0 total requests</div>
      </div>
      <div class="card">
        <div class="card-label">Est. Cost Savings</div>
        <div class="card-value val-blue" id="costSavedVal">$0.0000</div>
        <div class="card-footer">vs. defaultModel fallback</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Proxy Overhead</div>
        <div class="card-value" id="avgLatencyVal">0.00ms</div>
        <div class="card-footer" id="p95LatencySub">p95: 0.00ms</div>
      </div>
      <div class="card">
        <div class="card-label">Total Requests</div>
        <div class="card-value" id="totalRequestsVal">0</div>
        <div class="card-footer">processed across runtimes</div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="split-grid">
      <!-- Route Simulator -->
      <div class="card">
        <div class="section-title">
          <span>Route Simulator</span>
          <span class="section-sub">Dry-run evaluation</span>
        </div>
        <div class="simulator-form">
          <textarea id="promptInput" placeholder="Enter test prompt (e.g., 'Summarize this customer feedback')..."></textarea>
          <div class="simulator-actions">
            <button id="testPromptBtn" class="btn btn-primary">Evaluate Route</button>
          </div>
        </div>

        <div id="testResultBox" class="sim-result-box">
          <div class="sim-row">
            <span class="sim-key">Matched Route</span>
            <span class="sim-val" id="resRoute">-</span>
          </div>
          <div class="sim-row">
            <span class="sim-key">Target Model</span>
            <span class="sim-val" id="resModel">-</span>
          </div>
          <div class="sim-row">
            <span class="sim-key">Evaluation Tier</span>
            <span class="sim-val" id="resTier">-</span>
          </div>
          <div class="sim-row">
            <span class="sim-key">Similarity Score</span>
            <span class="sim-val" id="resScore">-</span>
          </div>
          <div class="sim-row">
            <span class="sim-key">Est. Savings</span>
            <span class="sim-val val-green" id="resSavings">-</span>
          </div>
        </div>
      </div>

      <!-- System Config & Traffic Distribution -->
      <div class="card">
        <div class="section-title">
          <span>Configuration</span>
        </div>
        <div class="config-list">
          <div class="config-item">
            <span class="config-key">Default Model</span>
            <span class="config-val">${config.defaultModel}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Configured Routes</span>
            <span class="config-val">${config.routes.length}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Semantic Cache</span>
            <span class="config-val">${config.cache?.enabled !== false ? 'Enabled (' + (config.cache?.threshold ?? 0.95) + ')' : 'Disabled'}</span>
          </div>
          <div class="config-item">
            <span class="config-key">Rate Limit</span>
            <span class="config-val">${config.rateLimit ? config.rateLimit.maxRequests + ' req / ' + Math.round((config.rateLimit.windowMs || 60000) / 1000) + 's' : 'Disabled'}</span>
          </div>
        </div>

        <div class="section-title" style="margin-top: 20px;">
          <span>Route Traffic</span>
        </div>
        <div id="routesBreakdownContainer" class="route-bar-wrap">
          <p style="font-size: 0.75rem; color: var(--text-dim); font-family: var(--mono);">No requests recorded yet.</p>
        </div>
      </div>
    </div>

    <!-- Request Log -->
    <div class="card">
      <div class="section-title">
        <span>Request Log</span>
        <span class="section-sub" id="lastUpdated">Updated just now</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Route</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Cache</th>
              <th>Duration</th>
              <th>Est. Savings</th>
            </tr>
          </thead>
          <tbody id="logsTableBody">
            <tr>
              <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">
                No proxy requests recorded yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function fetchStats() {
      try {
        const res = await fetch('/api/dashboard/stats');
        if (!res.ok) return;
        const data = await res.json();
        updateDashboard(data);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    }

    function updateDashboard(data) {
      document.getElementById('hitRateVal').textContent = data.cacheHitRate + '%';
      document.getElementById('cacheRatioSub').textContent = data.cacheHits + ' hits / ' + data.totalRequests + ' total requests';
      document.getElementById('costSavedVal').textContent = '$' + data.totalSavedUSD.toFixed(4);
      document.getElementById('avgLatencyVal').textContent = data.averageLatencyMs.toFixed(2) + 'ms';
      document.getElementById('p95LatencySub').textContent = 'p95: ' + data.p95LatencyMs.toFixed(2) + 'ms';
      document.getElementById('totalRequestsVal').textContent = data.totalRequests.toLocaleString();

      const rbContainer = document.getElementById('routesBreakdownContainer');
      const routeKeys = Object.keys(data.routesBreakdown || {});
      if (routeKeys.length === 0) {
        rbContainer.innerHTML = '<p style="font-size: 0.75rem; color: var(--text-dim); font-family: var(--mono);">No requests recorded yet.</p>';
      } else {
        let html = '';
        routeKeys.forEach(key => {
          const item = data.routesBreakdown[key];
          const pct = data.totalRequests > 0 ? Math.round((item.count / data.totalRequests) * 100) : 0;
          html += \`
            <div class="route-bar-item">
              <div class="route-bar-header">
                <span>\${key} (\${item.targetModel})</span>
                <span>\${item.count} (\${pct}%)</span>
              </div>
              <div class="route-bar-track">
                <div class="route-bar-fill" style="width: \${pct}%"></div>
              </div>
            </div>
          \`;
        });
        rbContainer.innerHTML = html;
      }

      const tbody = document.getElementById('logsTableBody');
      if (data.recentRequests && data.recentRequests.length > 0) {
        tbody.innerHTML = data.recentRequests.map(req => {
          const timeStr = new Date(req.timestamp || Date.now()).toLocaleTimeString();
          const cacheBadge = req.fromCache
            ? '<span class="pill pill-hit">HIT ' + (req.cacheLatencyMs || 0).toFixed(1) + 'ms</span>'
            : '<span class="pill pill-miss">MISS</span>';
          const savedStr = req.savedCostUSD && req.savedCostUSD > 0
            ? '<span class="val-green">+$' + req.savedCostUSD.toFixed(5) + '</span>'
            : '$0.00000';
          const statusClass = req.status >= 200 && req.status < 300 ? 'status-ok' : 'status-err';

          return \`
            <tr>
              <td style="color: var(--text-dim);">\${timeStr}</td>
              <td class="\${statusClass}">\${req.status}</td>
              <td><span class="pill pill-route">\${req.matchedRoute || 'default'}</span></td>
              <td>\${req.targetModel || '-'}</td>
              <td>\${req.provider || 'openai'}</td>
              <td>\${cacheBadge}</td>
              <td>\${(req.durationMs || 0).toFixed(2)}ms</td>
              <td>\${savedStr}</td>
            </tr>
          \`;
        }).join('');
      }
      document.getElementById('lastUpdated').textContent = 'Updated at ' + new Date().toLocaleTimeString();
    }

    document.getElementById('testPromptBtn').addEventListener('click', async () => {
      const prompt = document.getElementById('promptInput').value.trim();
      if (!prompt) return;

      const btn = document.getElementById('testPromptBtn');
      btn.textContent = 'Evaluating...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/dashboard/test-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });

        if (res.ok) {
          const data = await res.json();
          document.getElementById('testResultBox').style.display = 'block';
          document.getElementById('resRoute').textContent = data.matchedRoute;
          document.getElementById('resModel').textContent = data.targetModel;
          document.getElementById('resTier').textContent = data.tier;
          document.getElementById('resScore').textContent = data.score ? data.score.toFixed(3) : 'N/A';
          document.getElementById('resSavings').textContent = data.estimatedSavingsPercent
            ? data.estimatedSavingsPercent + '% vs ' + data.defaultModel
            : '0%';
        }
      } catch (err) {
        console.error('Evaluation failed:', err);
      } finally {
        btn.textContent = 'Evaluate Route';
        btn.disabled = false;
      }
    });

    document.getElementById('refreshBtn').addEventListener('click', fetchStats);
    document.getElementById('resetBtn').addEventListener('click', async () => {
      if (!confirm('Reset all telemetry metrics to zero?')) return;
      try {
        await fetch('/api/dashboard/reset', { method: 'POST' });
        fetchStats();
      } catch (err) {
        console.error('Reset failed:', err);
      }
    });

    fetchStats();
    setInterval(fetchStats, 3000);
  </script>
</body>
</html>
`;
}
