'use strict';

/**
 * routes/ai-agent/cost-cap.js — 任务级成本硬熔断子域（BLOCK-176 CP-18）。
 *
 * GET  /api/ai/agent/cost-cap    — 读当前生效上限（ai-settings costCapCny，env 覆盖优先）
 * PUT  /api/ai/agent/cost-cap    — 写上限（¥ 正数；0=清除回内置无熔断）
 *
 * 消费面：agent-runner 每轮收尾查 ai_usage 任务累计成本（conversation 维度），
 * ≥上限走既有 finalization 停机（诚实收尾叙事，不虚报完成）。设置面=用量节输入。
 */

const express = require('express');
const { getAiSettings, saveAiSettings } = require('../../helpers/ai-settings');
const { resolveCostCapCny } = require('../../helpers/cost-cap');

module.exports = {
  register(app) {
    app.get('/api/ai/agent/cost-cap', (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      try {
        const capCny = resolveCostCapCny(getAiSettings(), process.env);
        return res.json({ ok: true, capCny: capCny || 0 });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'read_failed', message: e && e.message ? e.message : String(e) });
      }
    });

    app.put('/api/ai/agent/cost-cap', express.json(), (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      const raw = Number(req.body && req.body.capCny);
      const cap = raw > 0 ? Math.round(raw * 100) / 100 : 0;
      try {
        const settings = getAiSettings();
        saveAiSettings({ ...settings, costCapCny: cap });
        return res.json({ ok: true, capCny: cap });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'save_failed', message: e && e.message ? e.message : String(e) });
      }
    });
  },
};
