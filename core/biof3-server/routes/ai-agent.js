/**
 * routes/ai-agent.js — POST /api/ai/agent (multi-turn tool-calling agent)
 *
 * Migrated from server.js. AGENT_TOOLS_v1.
 *
 * PHASE 2.2b: thin facade — delegates to ai-agent/index subdomains.
 * Original 1222-line module.exports body下沉到 5 个子域：
 *   chat.js     — POST /api/ai/agent (task 模式 + legacy SSE handler)
 *   context.js  — POST /api/ai/agent/task/:taskId/cancel
 *   events.js   — GET  /api/ai/agent/task/:taskId (SSE 订阅)
 *   tools.js    — 占位（无独立端点）
 *   index.js    — facade 注册中心
 *
 * BLOCK-105 §7 Batch-3：拆分后本文件遗留整套未被引用的导入（20+ require）与两份
 * 已被 ai-agent/chat.js（嵌套同名函数）与 loop-orchestrator.js 接管的死辅助函数
 * （_buildResultCardFromRunTool / _pushUniqueResultCard），本轮清零；注册行为逐字不变。
 */

// PHASE 2.2b: thin facade — delegates to ai-agent/index subdomains
const _aiAgent = require('./ai-agent/index');

module.exports = function registerAiAgentRoute(app) {
  _aiAgent.register(app);
};
