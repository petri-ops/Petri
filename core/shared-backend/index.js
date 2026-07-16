/**
 * shared-backend/index.js — barrel 导出 + 注入口
 *
 * 让 `require('shared-backend')` 真正可用（CLAUDE.md 声称的 barrel 之前不存在，
 * 断点1 补上）。同时聚合各子模块的 configure 注入点，调用方只需一次：
 *
 *   require('shared-backend').configure({
 *     getConfig: () => require('./config'),
 *     recordAiUsage: require('./helpers/ai-usage').recordAiUsage,
 *   });
 *
 * 斩断 shared-backend 对 r-server/py-server 的反向 require（分仓前置）。
 */

const configHelper = require('./config-helper');
const aiUsageHelper = require('./ai-usage-helper');
const init = require('./init');

// configure 聚合：转发给 config-helper + ai-usage-helper
function configure(provider) {
  if (!provider) return;
  if (provider.getConfig) configHelper.configure({ getConfig: provider.getConfig });
  if (provider.recordAiUsage) aiUsageHelper.configure({ recordAiUsage: provider.recordAiUsage });
}

module.exports = {
  configure,
  initSharedBackend: init.initSharedBackend,
  // 子模块直接导出（调用方可按需 require）
  logger: require('./logger'),
  errorLog: require('./error-log'),
  pathSafe: require('./path-safe'),
  executionContext: require('./execution-context'),
  agentWorkflow: require('./agent-workflow'),
  executors: require('./executors'),
  storage: require('./storage'),
  llmProviders: require('./llm-providers'),
  // config-helper 也暴露（执行器/storage 内部改读它，Step 2）
  configHelper,
  aiUsageHelper,
};
