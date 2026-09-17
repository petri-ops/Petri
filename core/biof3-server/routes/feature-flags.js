/**
 * routes/feature-flags.js — 灰度功能开关 REST 面（设置页投影 + 写入）
 *
 * GET  /api/feature-flags → 三开关快照（enabled/envOverride/stored/default/label/description）
 * POST /api/feature-flags → { key, enabled } 写持久化选择（env 强制覆盖时返回 409 诚实拒绝）
 */

const express = require('express');
const featureFlags = require('../helpers/feature-flags');

module.exports = function mountFeatureFlags(app) {
  app.get('/api/feature-flags', (req, res) => {
    try {
      const flags = featureFlags.getFlagsSnapshot(process.env);
      res.json({ status: 'ok', flags });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.post('/api/feature-flags', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const key = req.body && req.body.key;
      const enabled = req.body && req.body.enabled;
      const meta = featureFlags.FLAG_META[key];
      if (!meta) return res.status(400).json({ status: 'error', error: `feature_flag_unknown:${key}` });
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ status: 'error', error: 'feature_flag_value_invalid' });
      }
      // env 强制覆盖时写持久化是误导（解析结果不变）→ 诚实拒绝并指明覆盖来源
      const snapshot = featureFlags.getFlagsSnapshot(process.env);
      if (snapshot[key] && snapshot[key].envOverride != null) {
        return res.status(409).json({
          status: 'error',
          error: `feature_flag_env_locked:${meta.env}（环境变量正在强制覆盖该开关，清除环境变量后方可经设置页切换）`,
        });
      }
      featureFlags.setFlag(key, enabled);
      res.json({ status: 'ok', flags: featureFlags.getFlagsSnapshot(process.env) });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });
};
