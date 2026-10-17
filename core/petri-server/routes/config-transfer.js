'use strict';

/**
 * routes/config-transfer.js — 设置全景导出 / 导入 / 按区重置（BLOCK-201 W2）。
 *
 *  GET  /api/config/export        → 版本化信封（用户覆盖层 + 排除清单 + env 遮蔽报告）
 *  POST /api/config/import        → 信封；先全量校验后落盘，任一错误 400 + diagnostics（零写入）
 *  POST /api/config/reset         → { families: string[] }；只清覆盖层回落默认，不删用户数据
 *
 * 与 `/api/keymap`、`/api/ai/generation-defaults` 同一出口形状：拒绝=400 + 结构化 diagnostics，
 * 不冒 500、不静默。凭据不在任何一族的形状里，本路由不接触凭据存储（D-2）。
 */

const express = require('express');
const transfer = require('../helpers/config-transfer');

module.exports = function mountConfigTransfer(app) {
  app.get('/api/config/export', (req, res) => {
    try {
      return res.json({ status: 'ok', config: transfer.exportConfig() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.post('/api/config/import', express.json({ limit: '512kb' }), (req, res) => {
    try {
      const result = transfer.importConfig(req.body);
      if (!result.ok) {
        return res.status(400).json({ status: 'error', error: 'config_import_rejected', applied: result.applied, diagnostics: result.diagnostics });
      }
      return res.json({ status: 'ok', applied: result.applied, diagnostics: [] });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.post('/api/config/reset', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const families = req.body && req.body.families;
      const result = transfer.resetConfigFamilies(families);
      if (!result.ok) {
        return res.status(400).json({ status: 'error', error: 'config_reset_rejected', diagnostics: result.diagnostics });
      }
      return res.json({ status: 'ok', reset: result.reset, diagnostics: [] });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });
};
