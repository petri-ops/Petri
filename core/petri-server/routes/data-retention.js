/**
 * routes/data-retention.js — 留存/归档配置 + 迁移计划预览（BLOCK-210 / W7e）。
 *
 * 三个端点，全部**不执行搬迁、不删文件**：
 *   GET  /api/data/retention           读配置
 *   PUT  /api/data/retention           写配置（400 + diagnostics）
 *   POST /api/data/migration/plan      只返回迁移计划（步骤/备份/回退/阻塞项）
 */

'use strict';

const express = require('express');
const retention = require('../helpers/data-retention');
const migration = require('../helpers/data-dir-migration');

function registerDataRetentionRoutes(app) {
  app.get('/api/data/retention', (_req, res) => {
    res.json({ status: 'ok', config: retention.readStore(), defaults: { ...retention.DEFAULTS } });
  });

  app.put('/api/data/retention', express.json(), (req, res) => {
    const saved = retention.writeStore(req.body || {});
    if (!saved.ok) {
      return res.status(400).json({ status: 'error', error: 'retention_rejected', diagnostics: saved.diagnostics });
    }
    return res.json({ status: 'ok', config: saved.store });
  });

  app.post('/api/data/migration/plan', express.json(), (req, res) => {
    const body = req.body || {};
    const plan = migration.planMigration({ from: body.from, to: body.to });
    // 计划本身永远 200（阻塞项是"能不能做"的信息，不是请求错误）；缺参数才 400
    if (!body.from || !body.to) {
      return res.status(400).json({ status: 'error', error: 'from_to_required', plan });
    }
    return res.json({ status: 'ok', plan, executed: false });
  });
}

module.exports = { registerDataRetentionRoutes };
