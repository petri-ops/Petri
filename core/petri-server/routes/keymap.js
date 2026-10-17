/**
 * routes/keymap.js — 应用级命令键位 REST 面（BLOCK-200 P0-1/P3）。
 *
 * GET /api/keymap → 生效覆盖层 + 读侧诊断（未知命令 id／坏组合点名，不拒启动）
 * PUT /api/keymap → { bindings: { <commandId>: 'Mod+K' | null } }，`null`=解绑
 *   写侧一律过注册表守卫：未知命令 id／非法组合 → **400 + 结构化 diagnostics**
 *   （与 `/api/ai/generation-defaults` 同一出口形状；"静默丢键"在本仓已是历史行为）。
 */

const express = require('express');
const keymap = require('../helpers/keymap');

module.exports = function mountKeymap(app) {
  app.get('/api/keymap', (req, res) => {
    try {
      res.json({ status: 'ok', ...keymap.getKeymapSnapshot() });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.put('/api/keymap', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const patch = req.body && req.body.bindings;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return res.status(400).json({
          status: 'error',
          error: 'config_value_rejected',
          diagnostics: [{ code: 'type-mismatch', family: 'keymap', path: 'bindings', message: 'bindings 必须是 { 命令id: 组合串|null } 对象' }],
        });
      }
      const result = keymap.setKeymapBindings(patch);
      res.json({ status: 'ok', bindings: result.bindings, diagnostics: result.diagnostics });
    } catch (e) {
      if (e.message === 'config_value_rejected') {
        return res.status(400).json({ status: 'error', error: e.message, diagnostics: e.diagnostics || [] });
      }
      res.status(500).json({ status: 'error', error: e.message });
    }
  });
};
