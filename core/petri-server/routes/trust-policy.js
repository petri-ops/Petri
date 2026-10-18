/**
 * routes/trust-policy.js — 项目信任级读写面（BLOCK-207 / W7b）。
 *
 * v1 无设置页（漂移门 NO_UI_FAMILIES 登记）。写侧整份化验（未知 level/重名/未知字段
 * → 400 + diagnostics），**变更落 trust-audit.jsonl**（敏感项留痕）。
 * 边界：这里只改"天花板"，不碰四档判定/审批/用户规则。
 */

'use strict';

const express = require('express');
const trustPolicy = require('../helpers/trust-policy');

function registerTrustPolicyRoutes(app) {
  app.get('/api/trust/policy', (_req, res) => {
    const store = trustPolicy.readStore();
    res.json({
      status: 'ok',
      defaultLevel: store.defaultLevel,
      projects: store.projects,
      levels: [...trustPolicy.LEVELS],
      auditPath: trustPolicy.auditFilePath(),
    });
  });

  app.put('/api/trust/policy', express.json(), (req, res) => {
    const saved = trustPolicy.writeStore(req.body || {});
    if (!saved.ok) {
      return res.status(400).json({ status: 'error', error: 'trust_policy_rejected', diagnostics: saved.diagnostics });
    }
    return res.json({ status: 'ok', defaultLevel: saved.store.defaultLevel, projects: saved.store.projects, audited: saved.audited });
  });
}

module.exports = { registerTrustPolicyRoutes };
