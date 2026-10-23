'use strict';

/**
 * routes/ai-agent/trajectory.js — BLOCK-248（Q3）执行轨迹只读端点。
 *
 *   GET /api/ai/agent/trajectory?conversationId=&taskId=&afterSeq=&limit=
 *
 * 语义：
 *  - 默认按会话取**最近一条主任务**（子代理任务由各自 taskId 显式取，不混入）；
 *  - 只读 `task_events`，分页上限 500，命中上限给 `truncated`；
 *  - `recordedOnly: true` 常驻：只显示已记录事件，不推断未上报的耗时/正文；
 *  - 鉴权：会话 owner + 任务 user_id 双校验（跨用户 403）。
 *
 * 分类/摘要/统计单源在 helpers/trajectory-events.js；本文件只做 HTTP 外壳。
 */

const db = require('../../db').getAsyncDatabase();
const agentTaskStore = require('../../agent-task-store');
const {
  resolveTrajectoryQuery,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../../helpers/trajectory-events');

module.exports = {
  register(app) {
    app.get('/api/ai/agent/trajectory', async (req, res) => {
      const userId = req.user && req.user.id;
      try {
        const result = await resolveTrajectoryQuery({
          store: agentTaskStore,
          db,
          userId,
          conversationId: req.query.conversationId,
          taskId: req.query.taskId,
          afterSeq: req.query.afterSeq,
          beforeSeq: req.query.beforeSeq,
          limit: req.query.limit,
        });
        if (!result.ok) {
          return res.status(result.status || 400).json({ ok: false, error: result.error });
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          ...result,
          limits: { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT },
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: 'trajectory_failed',
          message: String((error && error.message) || error),
        });
      }
    });
  },
};
