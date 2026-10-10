'use strict';

/**
 * routes/ai-agent/conversation-changes.js — BLOCK-40 P1
 *
 * 会话改动权威清单只读水合端点。数据源是 tasks.files_changed_json
 *（agent-runner 终态时由 task_events 回放聚合写入，含 UI-273 iteration/tool 归属）：
 *   GET /api/ai/agent/conversation-changes?conversationId=X
 *     → 跨任务按 path 合并的清单（新任务覆盖旧任务同路径）：
 *       [{ path, status, iteration, tool, lastChangedAt }]
 *
 * 用途：前端 conversationChangesStore reload 后水合，恢复历史会话
 *「本会话改动」精确归属（BLOCK-31 观察项收尾）。
 *
 * 纪律：严格只读（无写路径/无文件系统访问）；conversationId 白名单校验；
 * 无任务返回诚实空清单；0 新依赖。
 */

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function register(app) {
  app.get('/api/ai/agent/conversation-changes', (req, res) => {
    const conversationId = req.query && req.query.conversationId;
    if (!conversationId || typeof conversationId !== 'string'
        || !CONVERSATION_ID_RE.test(conversationId)) {
      return res.status(400).json({ error: 'invalid_conversation_id' });
    }
    try {
      // 延迟 require 避免与 agent-task-store 的模块初始化顺序耦合。
      const agentTaskStore = require('../../agent-task-store');
      const changes = agentTaskStore.listConversationChanges(conversationId);
      return res.json({ conversationId, changes });
    } catch (err) {
      return res.status(500).json({
        error: 'conversation_changes_query_failed',
        message: err && err.message ? err.message : String(err),
      });
    }
  });
}

module.exports = { register };
