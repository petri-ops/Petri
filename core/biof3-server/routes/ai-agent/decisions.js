/**
 * routes/ai-agent/decisions.js — BLOCK-116 W2 决策观测面（只读聚合）。
 *
 * GET /api/ai/decisions/summary?days=7 → 按接点聚合：调用量/均延迟/降级率/最近时间。
 * 数据源=decision_log（helpers/decision-log.js summarizeDecisions）；DB 不可用诚实返回
 * available:false，不伪造空统计。
 */
'use strict';

const decisionLog = require('../../helpers/decision-log');

module.exports = {
  register(app) {
    app.get('/api/ai/decisions/summary', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
      const summary = await decisionLog.summarizeDecisions({ days });
      if (summary === null) {
        return res.json({ status: 'ok', available: false, days });
      }
      res.json({ status: 'ok', available: true, days, points: summary });
    });
  },
};
