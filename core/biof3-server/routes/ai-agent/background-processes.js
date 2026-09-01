'use strict';

/**
 * routes/ai-agent/background-processes.js — BLOCK-34 P3
 *
 * 后台进程浮窗的只读查询端点。数据源是 workspace-tools.js 的内存
 * backgroundProcesses 表（per conversation/sessionKey 隔离），0 新持久化：
 *   GET /api/ai/agent/background-processes?conversationId=X&projectId=Y
 *     → { ok, count, processes: [...] }（每项含状态/命令/日志尾部摘要）
 *   GET /api/ai/agent/background-processes/:processId/log?conversationId=X&bytes=N
 *     → { ok, process: { ..., logTail, logTruncated, logSizeBytes } }
 *
 * 会话隔离复用 processStatus 的 sessionKey 语义：A 会话进程对 B 会话不可见。
 */

const { tool_process_status: processStatus } = require('../../agent-tools/workspace-tools');

function resolveContext(req) {
  return {
    conversationId: String((req.query && req.query.conversationId) || '').trim() || null,
    projectId: String((req.query && req.query.projectId) || '').trim() || null,
    userId: req.user && req.user.id,
  };
}

module.exports = {
  register(app) {
    app.get('/api/ai/agent/background-processes', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const ctx = resolveContext(req);
      if (!ctx.conversationId) {
        return res.status(400).json({ status: 'error', error: 'conversationId 不能为空' });
      }
      try {
        const result = await processStatus({}, ctx);
        if (!result || result.ok !== true) {
          return res.status(500).json({ status: 'error', error: (result && result.error) || '查询失败' });
        }
        return res.json({ status: 'ok', ...result });
      } catch (error) {
        return res.status(500).json({ status: 'error', error: (error && error.message) || '查询失败' });
      }
    });

    app.get('/api/ai/agent/background-processes/:processId/log', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const ctx = resolveContext(req);
      if (!ctx.conversationId) {
        return res.status(400).json({ status: 'error', error: 'conversationId 不能为空' });
      }
      const processId = String(req.params.processId || '').trim();
      if (!processId) {
        return res.status(400).json({ status: 'error', error: 'processId 不能为空' });
      }
      const bytes = parseInt(req.query.bytes, 10);
      try {
        const result = await processStatus(
          { processId, ...(Number.isFinite(bytes) ? { logTailBytes: bytes } : {}) },
          ctx
        );
        if (!result || result.ok !== true) {
          // not_found = 跨会话越权或应用重启失效，对客户端表现为 404
          const notFound = result && result.error === 'not_found';
          return res.status(notFound ? 404 : 500).json({
            status: 'error',
            error: (result && (result.message || result.error)) || '查询失败',
          });
        }
        return res.json({ status: 'ok', process: result.process });
      } catch (error) {
        return res.status(500).json({ status: 'error', error: (error && error.message) || '查询失败' });
      }
    });
  },
};
