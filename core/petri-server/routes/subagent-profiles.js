/**
 * routes/subagent-profiles.js — 子智能体 profile 的读写面（BLOCK-206 / runlist W7a）。
 *
 * v1 无设置页（漂移门按 NO_UI_FAMILIES 登记）：GET/PUT 是唯一写面，
 * 写侧整份化验（未知字段/域外值/重名/default 悬空 → 400 + 结构化 diagnostics）。
 * **不是权限系统**：profile 只提供派发缺省（role/model/并发收紧），不改 policy/审批。
 */

'use strict';

const express = require('express');
const profiles = require('../helpers/subagent-profile');

function registerSubagentProfileRoutes(app) {
  app.get('/api/subagent/profiles', (_req, res) => {
    const store = profiles.readStore();
    res.json({ status: 'ok', default: store.default, profiles: store.profiles });
  });

  app.put('/api/subagent/profiles', express.json(), (req, res) => {
    const body = req.body || {};
    const diagnostics = profiles.validateStore(body);
    if (diagnostics.length > 0) {
      return res.status(400).json({ status: 'error', error: 'subagent_profile_rejected', diagnostics });
    }
    const saved = profiles.writeStore(body);
    if (!saved.ok) {
      return res.status(400).json({ status: 'error', error: 'subagent_profile_rejected', diagnostics: saved.diagnostics });
    }
    const store = profiles.readStore();
    return res.json({ status: 'ok', default: store.default, profiles: store.profiles });
  });
}

module.exports = { registerSubagentProfileRoutes };
