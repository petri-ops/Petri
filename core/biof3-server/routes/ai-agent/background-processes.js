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
 *
 * BLOCK-78 P2-④ — workspaceKind 路由（补项，BLOCK-76 P1 直跑后 ssh 项目
 * 后台进程在服务器、本地内存表失明）：list/log 全部改走路由版工具——
 * ssh 项目读 ssh surface 注册表（远端 detached + 节点日志；状态为懒探针
 * 语义，精确存活以 process_status 单查 ps_pid 为准），local 项目本地表
 * 原语义零改动。日志子路由对 ssh 扁平契约做 process 包裹归一。
 */

const {
  tool_process_list: processList,
  tool_process_status: processStatus,
} = require('../../agent-tools/workspace-tools');

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
        const result = await processList({}, ctx);
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
          // not_found / process_not_found = 跨会话越权或应用重启失效，对客户端表现为 404
          const notFound = result && (result.error === 'not_found' || result.error === 'process_not_found');
          return res.status(notFound ? 404 : 500).json({
            status: 'error',
            error: (result && (result.message || result.error)) || '查询失败',
          });
        }
        // 本地契约包裹 {process}；ssh surface 扁平契约（{ok,id,status,logTail,...}）归一包裹
        const process = (result && result.process) || (result && result.ok ? result : null);
        return res.json({ status: 'ok', process });
      } catch (error) {
        return res.status(500).json({ status: 'error', error: (error && error.message) || '查询失败' });
      }
    });
  },
};
