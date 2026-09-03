/**
 * Route registry — central mount point for all modular API routes.
 * Order matters: registered before legacy server.js endpoints, so
 * Express first-match-wins gives priority to modular versions.
 *
 * 每个路由模块独立 try/catch，一个失败不影响其他路由注册。
 */

module.exports = async function registerRoutes(app) {
  const routes = [
    ['Health', () => {
      const db = require('../db').getDatabase();
      const version = require('../package.json').version;
      app.get('/api/health', (_req, res) => {
        let dbOk = false;
        try {
          dbOk = Boolean(db.prepare('SELECT 1').get());
        } catch {}
        res.json({ status: 'ok', timestamp: new Date().toISOString(), version, db_ok: dbOk });
      });
    }],
    // Web-only 路由已移除（desktop 前端/copilot 不调用）：ai-report、ai-review、
    // analytics、admin-ops、admin-compute、admin-users、observability。
    // G0-RS-P4R baseline capture; self-disables unless BIOF3_PERF_PROBE=1.
    ['Perf probe', () => require('./perf-probe')(app)],
    ['AI conversations', () => require('./ai-conversations')(app)],
    ['AI memory', () => require('./ai-memory')(app)],
    ['AI admin', () => require('./ai-admin')(app)],
    ['AI plans', () => require('./ai-plans')(app)],
    ['AI misc', () => require('./ai-misc')(app)],
    ['AI legacy', () => require('./ai-legacy')(app)],
    ['AI progress', () => require('./ai-progress')(app)],
    ['Data CRUD', () => { app.use('/api/data', require('../api-data')); }],
    ['Files', () => require('./files')(app)],
    // Must precede Harness: harness.js retains the legacy
    // GET /api/loop/:loopRunId catch-all, which would otherwise swallow
    // /runs, /session-summary, /iterations, /recovery, etc.
    ['AI Loop API', () => require('./ai-loop').registerAiLoopRoutes(app)],
    ['Harness', () => require('./harness')(app)],
    ['Tools', () => require('./tools')(app)],
    ['Result Studio', () => require('./result-studio')(app)],
    ['Feedback', () => require('./feedback')(app)],
    ['AI chat', () => require('./ai-chat')(app)],
    ['AI agent', () => require('./ai-agent')(app)],
    ['AI settings', () => require('./ai-settings-api').registerAiSettingsRoutes(app)],
  ];

  for (const [name, fn] of routes) {
    try {
      await fn();
    } catch (e) {
      console.warn(`[routes] ${name} failed: ${e && e.message}`);
    }
  }
};
