'use strict';

/**
 * routes/plugin-lifecycle-audit.js — QODER-L6 插件生命周期/权限审计统一（2026-11-23）。
 *
 * GET  /api/harness/plugin-audit        — 只读统一投影（trust-audit.jsonl + 本模块 JSONL），
 *      投影只供展示，不承载信任真源、不随配置导出。
 * POST /api/harness/plugin-audit/append — 追加一条审计事件（经 P1 formatAuditEvent 脱敏）。
 * 红线：不读写 mcp-oauth/凭据、不改 guard-ack/信任写 handler、不覆盖既有 JSONL。
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseAuditLines, formatAuditEvent, projectUnifiedAudit } = require('../../shared-backend/plugin-lifecycle-audit');
const dataPaths = require('../../shared-backend/data-paths');

const AUDIT_FILE = 'plugin-lifecycle-audit.jsonl';
const TRUST_AUDIT_FILE = 'trust-audit.jsonl';

function auditPath() {
  return path.join(dataPaths.resolveDataDir(), AUDIT_FILE);
}
function readLines(file) {
  try { return fs.readFileSync(path.join(dataPaths.resolveDataDir(), file), 'utf8'); } catch { return ''; }
}

module.exports = function registerPluginLifecycleAuditRoutes(app) {
  app.get('/api/harness/plugin-audit', (_req, res) => {
    try {
      const unified = projectUnifiedAudit([
        { lines: readLines(TRUST_AUDIT_FILE) },
        { lines: readLines(AUDIT_FILE) },
      ]);
      return res.json({ ok: true, ...unified });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error && error.message || error).slice(0, 200) });
    }
  });

  app.post('/api/harness/plugin-audit/append', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const line = formatAuditEvent({ ...body, at: new Date().toISOString() });
    if (!line) return res.status(400).json({ ok: false, error: 'invalid_event' });
    try {
      fs.mkdirSync(path.dirname(auditPath()), { recursive: true });
      fs.appendFileSync(auditPath(), `${line}\n`, 'utf8');
      return res.json({ ok: true, appended: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error && error.message || error).slice(0, 200) });
    }
  });
};

// 暴露路径供测试/清理（不写信任真源）
module.exports.auditPath = auditPath;
module.exports.parseAuditLines = parseAuditLines;
