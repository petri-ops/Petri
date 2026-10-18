/**
 * routes/external-import.js — 外部 Agent 配置导入**预览**（BLOCK-209 / W7d）。
 *
 * 只有 POST /api/import/external-agent/preview：**永不写盘、永不联网**，
 * 返回 { patch, credentialsDetected, unsupported, notes, diagnostics }。
 * 真正的"应用"需要逐键确认 + 回滚 + 审计，属 reopen。
 */

'use strict';

const express = require('express');
const importer = require('../../shared-backend/external-agent-import');
const schema = require('../../packages/shared-config/config-schema.js');

const MAX_CONTENT_CHARS = 200_000;

function registerExternalImportRoutes(app) {
  app.post('/api/import/external-agent/preview', express.json({ limit: '256kb' }), (req, res) => {
    const body = req.body || {};
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim()) {
      return res.status(400).json({ status: 'error', error: 'content_required', diagnostics: [{ code: 'content_required', path: '', message: 'content 不能为空' }] });
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return res.status(400).json({ status: 'error', error: 'content_too_large', diagnostics: [{ code: 'content_too_large', path: '', message: `配置超过 ${MAX_CONTENT_CHARS} 字符` }] });
    }
    const mapped = importer.mapToPetri({ source: body.source, content, schema });
    if (!mapped.ok) {
      return res.status(400).json({ status: 'error', error: 'unparsable_config', diagnostics: mapped.diagnostics });
    }
    return res.json({ status: 'ok', ...mapped, dryRun: true, wrote: false });
  });
}

module.exports = { registerExternalImportRoutes, MAX_CONTENT_CHARS };
