/**
 * routes/ai-legacy.js — small AI compatibility/support endpoints.
 *
 * These routes are platform-owned but remain mounted from the historical
 * petri-server route registry during the gradual backend structure convergence.
 */
const express = require('express');

const {ackActToken} = require('../agent-tools');
const dbMod = require('../db');

module.exports = function mountAiLegacy(app) {
  // BLOCK-339 P1 — `/api/ai/interpret`（marker→细胞类型等域解读）**退役**：
  // 全仓零活消费者（前端明确注释「不接遗留 /api/ai/interpret 模板」），域能力待领域包侧
  // 重建（plan reopen）。此处前置 410 先命中，下方旧实现保留仅作迁移参考、不再可达；
  // act-ack / run-tool-ack 两个治理端点不受影响。
  app.post('/api/ai/interpret', (_req, res) => {
    res.status(410).json({
      status: 'error',
      error: 'interpret_retired',
      message: '该遗留解读端点已退役；结果解读请走 result_summary 或已安装领域包声明的结果面。',
    });
  });


  app.post('/api/ai/act-ack/:token', express.json({limit:'8kb'}), (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status: 'error', error: '未授权'});
    const ok = ackActToken(req.params.token, req.body || {ok: true});
    res.json({status: 'ok', acknowledged: ok});
  });

  // TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 强制确认 ack 路由。
  // 前端确认卡用户点"开始/取消"后 POST 这里，后端落 ack_status=approved/rejected。
  // agent 下次重调 run_tool(ackToken) 时读到 approved 才续跑。
  app.post('/api/ai/run-tool-ack/:token', express.json({limit:'8kb'}), (req, res) => {
    const userId = req.user && (req.user.id || req.user.userId);
    if (!userId) return res.status(401).json({status: 'error', error: '未授权'});
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Object.prototype.hasOwnProperty.call(body, 'projectId')
        || !Object.prototype.hasOwnProperty.call(body, 'conversationId')) {
      return res.status(400).json({status: 'error', error: 'approval_scope_required'});
    }
    const approve = body.approve !== false;
    const projectId = typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null;
    const conversationId = typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;
    // Request scope is an expectation only; persisted Job identity is immutable.
    const job = dbMod.ackToolJob(req.params.token, approve, { userId, projectId, conversationId });
    if (!job) return res.status(404).json({status: 'error', error: 'token_not_found'});
    res.json({status: 'ok', ackStatus: job.ack_status, toolJobId: job.id});
  });

};
