'use strict';

/**
 * BLOCK-70 P2 控制面 — 移动端批准决定（轻控制的批准半边）。
 *
 * D3 单一真相：进程内直调既有内部函数 db.ackToolJob（对标 BLOCK-49
 * spawn-agent-tools 直调先例，不经 HTTP 自调用）；与桌面确认卡
 * `POST /api/ai/run-tool-ack/:token`（routes/ai-legacy.js）走同一函数、
 * 同一 scope 校验——权限不放大（D4）。
 *
 * 发消息与取消直接复用挂载的既有路由模块（chat.js / context.js），
 * 本文件只补桌面面没有等价 REST 的缺口：无。批准桌面已有 REST，但
 * ai-legacy 模块不宜整体挂上移动实例，故此处按同一契约开窄口。
 */

function registerMobileControl(app) {
  app.post('/m/api/approvals/:token/decide', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // 与桌面 REST 同一契约：scope 两键必须显式提供（值可为 null）。
    if (!Object.prototype.hasOwnProperty.call(body, 'projectId')
        || !Object.prototype.hasOwnProperty.call(body, 'conversationId')) {
      res.status(400).json({ ok: false, error: 'approval_scope_required', message: '缺少批准范围（projectId/conversationId）' });
      return;
    }
    const approve = body.approve !== false;
    const projectId = typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null;
    const conversationId = typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;
    const userId = req.user && req.user.id;
    // 惰性 require：db 单例绑定 BIOF3_DB_PATH，保持与宿主进程一致。
    // Request scope is an expectation only; persisted Job identity is immutable.
    const job = require('../db').ackToolJob(String(req.params.token || ''), approve, {
      userId,
      projectId,
      conversationId,
    });
    if (!job) {
      res.status(404).json({ ok: false, error: 'token_not_found', message: '批准令牌不存在或范围不匹配' });
      return;
    }
    res.json({ ok: true, ackStatus: job.ack_status, toolJobId: job.id });
  });
}

module.exports = { registerMobileControl };
