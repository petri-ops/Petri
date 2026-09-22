/**
 * routes/ai-agent/decisions.js — BLOCK-116 W2 决策观测面（只读聚合）。
 *
 * GET /api/ai/decisions/summary?days=7 → 按接点聚合：调用量/均延迟/降级率/最近时间。
 * 数据源=decision_log（helpers/decision-log.js summarizeDecisions）；DB 不可用诚实返回
 * available:false，不伪造空统计。
 */
'use strict';

const express = require('express');

const decisionLog = require('../../helpers/decision-log');
const decisionConfig = require('../../helpers/decision-config');

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

    // BLOCK-116 P3 — 最近决策逐条回放（观测面增量；point 可选过滤）
    app.get('/api/ai/decisions/recent', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const recent = await decisionLog.recentDecisions({
        limit: req.query.limit,
        point: typeof req.query.point === 'string' && req.query.point ? req.query.point : undefined,
      });
      if (recent === null) {
        return res.json({ status: 'ok', available: false, decisions: [] });
      }
      res.json({ status: 'ok', available: true, decisions: recent });
    });

    // BLOCK-116 P4 — 决策配置面（GET 全量；PUT 单接点 enabled/threshold）
    app.get('/api/ai/decisions/config', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ status: 'error', error: '未登录' });
      res.json({ status: 'ok', points: decisionConfig.getAllPointConfigs() });
    });

    app.put('/api/ai/decisions/config/:point', express.json({ limit: '8kb' }), async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ status: 'error', error: '未登录' });
      try {
        const updated = decisionConfig.setPointConfig(req.params.point, req.body || {});
        if (!updated) return res.status(404).json({ status: 'error', error: 'unknown_point' });
        res.json({ status: 'ok', point: updated });
      } catch (e) {
        res.status(400).json({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    });
  },
};
