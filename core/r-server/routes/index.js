/**
 * Route registry — central mount point for all modular API routes.
 * Order matters: registered before legacy server.js endpoints, so
 * Express first-match-wins gives priority to modular versions.
 *
 * 每个路由模块独立 try/catch，一个失败不影响其他路由注册。
 */

module.exports = async function registerRoutes(app) {
  const routes = [
    // Web-only 路由已移除（desktop 前端/copilot 不调用）：ai-report、ai-review、
    // analytics、admin-ops、admin-compute、admin-users、observability。
    ['AI conversations', () => require('./ai-conversations')(app)],
    ['AI memory', () => require('./ai-memory')(app)],
    ['AI admin', () => require('./ai-admin')(app)],
    ['AI plans', () => require('./ai-plans')(app)],
    ['AI misc', () => require('./ai-misc')(app)],
    ['AI legacy', () => require('./ai-legacy')(app)],
    ['AI progress', () => require('./ai-progress')(app)],
    ['Data CRUD', () => { app.use('/api/data', require('../api-data')); }],
    ['Files', () => require('./files')(app)],
    ['Harness', () => require('./harness')(app)],
    ['Tools', () => require('./tools')(app)],
    ['Feedback', () => require('./feedback')(app)],
    ['AI chat', () => require('./ai-chat')(app)],
    ['AI agent', () => require('./ai-agent')(app)],
    ['AI settings', () => require('./ai-settings-api').registerAiSettingsRoutes(app)],
    ['R compute', () => require('./r-compute').registerRCompute(app)],
  ];

  for (const [name, fn] of routes) {
    try {
      await fn();
    } catch (e) {
      console.warn(`[routes] ${name} failed: ${e && e.message}`);
    }
  }
};
