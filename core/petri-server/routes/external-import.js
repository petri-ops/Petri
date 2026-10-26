/**
 * routes/external-import.js — 外部 Agent 配置导入（BLOCK-209 预览 + BLOCK-264 应用面）。
 *
 *   POST /api/import/external-agent/preview  — 永不写盘、永不联网（BLOCK-209）
 *   POST /api/import/external-agent/apply    — BLOCK-264（C-35）：服务端重推导 patch →
 *        selectedKeys 过滤 → schema 校验 → 先存前值快照 → 白名单族单键合并写 →
 *        审计 jsonl（applyId/前值/后值）；凭据键结构性不存在于 patch，另做防御性拒绝
 *   POST /api/import/external-agent/rollback — BLOCK-264：按 applyId 还原前值（校验后写），
 *        审计回滚条目；重复回滚 409
 *
 * 红线：apply 永不信任客户端提交的 patch（只收 source+content+selectedKeys，服务端重推导）；
 * 未知族/未知键 fail-closed 400；写面只走 KEY_WRITERS 白名单。
 */

'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const importer = require('../../shared-backend/external-agent-import');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths');

const MAX_CONTENT_CHARS = 200_000;
const AUDIT_MAX_BYTES = 1024 * 1024;

/** 单键写面白名单：族 → 读/写整个覆盖层 store（合并单键后整写）。 */
function buildKeyWriters() {
  const runtimePolicy = require('../helpers/runtime-policy');
  return {
    runtime: {
      read: () => runtimePolicy.readStore(),
      write: (store) => runtimePolicy.writeStore(store),
    },
  };
}

function auditPath() {
  return dataPaths.dataFile('import-audit.jsonl');
}

function appendAudit(entry) {
  const file = auditPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const stat = fs.statSync(file);
      if (stat.size > AUDIT_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch { /* 首次写入 */ }
    let line = JSON.stringify(entry);
    if (Buffer.byteLength(line, 'utf8') > 4096) {
      line = JSON.stringify({ ...entry, applied: undefined, previous: undefined, restored: undefined, truncated: true });
    }
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false }; // 审计写失败不阻断已落盘的配置写，但回滚不可用会被如实标记
  }
}

function readAuditEntries() {
  try {
    return fs.readFileSync(auditPath(), 'utf8')
      .trimEnd().split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const CREDENTIAL_KEY_RE = /(api[_-]?key|apikey|token|secret|password|passwd|credential)/i;

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

  app.post('/api/import/external-agent/apply', express.json({ limit: '256kb' }), (req, res) => {
    const body = req.body || {};
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim()) return res.status(400).json({ status: 'error', error: 'content_required' });
    const selected = Array.isArray(body.selectedKeys) ? body.selectedKeys.map(String) : null;

    // 服务端重推导（红线：不信任客户端 patch）
    const mapped = importer.mapToPetri({ source: body.source, content, schema });
    if (!mapped.ok) return res.status(400).json({ status: 'error', error: 'unparsable_config', diagnostics: mapped.diagnostics });

    const patchKeys = Object.keys(mapped.patch || {});
    const targetKeys = selected ? patchKeys.filter((k) => selected.includes(k)) : patchKeys;
    if (selected) {
      const unknown = selected.filter((k) => !patchKeys.includes(k));
      if (unknown.length > 0) {
        return res.status(400).json({ status: 'error', error: 'unknown_key', unknownKeys: unknown.slice(0, 20) });
      }
    }
    if (targetKeys.some((k) => CREDENTIAL_KEY_RE.test(k))) {
      return res.status(400).json({ status: 'error', error: 'credential_key_rejected' });
    }
    if (targetKeys.length === 0) {
      return res.json({ status: 'ok', appliedKeys: [], applyId: null, note: '没有可应用的键（可映射键为空或未选中）' });
    }

    const writers = buildKeyWriters();
    // 逐键校验 + 前值快照（全部通过才写——先校验后落盘）
    const plan = [];
    const storeCache = new Map();
    for (const key of targetKeys) {
      const sep = key.indexOf('::');
      const family = sep > 0 ? key.slice(0, sep) : '';
      const configPath = sep > 0 ? key.slice(sep + 2) : '';
      const writer = writers[family];
      if (!writer || !configPath) {
        return res.status(400).json({ status: 'error', error: 'family_not_writable', key, message: `族 ${family || '(空)'} 不在可写白名单` });
      }
      const entry = schema.findEntryByPath(family, configPath);
      if (!entry) {
        return res.status(400).json({ status: 'error', error: 'unknown_key', key });
      }
      const checked = schema.validateValue(entry, mapped.patch[key]);
      if (!checked || checked.ok !== true) {
        return res.status(400).json({ status: 'error', error: 'value_invalid', key, diagnostics: [{ code: (checked && checked.code) || 'invalid', path: key, message: (checked && checked.message) || '' }] });
      }
      if (!storeCache.has(family)) storeCache.set(family, writer.read());
      const store = storeCache.get(family);
      plan.push({ key, family, configPath, normalized: checked.normalized, previous: Object.prototype.hasOwnProperty.call(store, configPath) ? store[configPath] : null });
    }

    // 落盘（同批逐键合并写；中途失败如实回传已写键）
    const applied = [];
    try {
      const byFamily = new Map();
      for (const item of plan) {
        if (!byFamily.has(item.family)) byFamily.set(item.family, writers[item.family].read());
        byFamily.get(item.family)[item.configPath] = item.normalized;
        applied.push(item.key);
      }
      for (const [family, store] of byFamily) writers[family].write(store);
    } catch (error) {
      return res.status(500).json({ status: 'error', error: 'apply_write_failed', appliedKeys: applied, message: String(error && error.message || error) });
    }

    const applyId = `imp-${crypto.randomUUID()}`;
    const auditOk = appendAudit({
      at: new Date().toISOString(),
      kind: 'apply',
      applyId,
      source: body.source || null,
      applied: plan.map((p) => ({ key: p.key, value: p.normalized })),
      previous: plan.map((p) => ({ key: p.key, value: p.previous })),
    });
    return res.json({ status: 'ok', appliedKeys: applied, applyId, rollbackAvailable: auditOk.ok, dryRun: false, wrote: true });
  });

  app.post('/api/import/external-agent/rollback', express.json({ limit: '32kb' }), (req, res) => {
    const applyId = String((req.body || {}).applyId || '').trim();
    if (!applyId) return res.status(400).json({ status: 'error', error: 'apply_id_required' });
    const entries = readAuditEntries();
    // append-only 审计：回滚状态由 rollback 条目存在性判定（不改写原 apply 行）
    const rolledBack = new Set(entries.filter((e) => e.kind === 'rollback' && e.applyId === applyId).map((e) => e.applyId));
    const target = rolledBack.has(applyId) ? null : entries.find((e) => e.kind === 'apply' && e.applyId === applyId);
    if (!target) {
      const exists = entries.some((e) => e.applyId === applyId);
      return res.status(exists ? 409 : 404).json({ status: 'error', error: exists ? 'already_rolled_back' : 'apply_not_found' });
    }
    const writers = buildKeyWriters();
    const restored = [];
    try {
      const byFamily = new Map();
      for (const item of target.previous || []) {
        const sep = item.key.indexOf('::');
        const family = sep > 0 ? item.key.slice(0, sep) : '';
        const configPath = sep > 0 ? item.key.slice(sep + 2) : '';
        const writer = writers[family];
        if (!writer) continue;
        const entry = schema.findEntryByPath(family, configPath);
        if (!entry) continue;
        if (item.value === null) {
          if (!byFamily.has(family)) byFamily.set(family, writer.read());
          delete byFamily.get(family)[configPath];
        } else {
          const checked = schema.validateValue(entry, item.value);
          if (!checked || checked.ok !== true) continue; // 前值已不合法（schema 演进）→ 跳过该键如实登记
          if (!byFamily.has(family)) byFamily.set(family, writer.read());
          byFamily.get(family)[configPath] = checked.normalized;
        }
        restored.push(item.key);
      }
      for (const [family, store] of byFamily) writers[family].write(store);
    } catch (error) {
      return res.status(500).json({ status: 'error', error: 'rollback_write_failed', restoredKeys: restored, message: String(error && error.message || error) });
    }
    appendAudit({ at: new Date().toISOString(), kind: 'rollback', applyId, restored });
    return res.json({ status: 'ok', applyId, restoredKeys: restored });
  });
}

module.exports = { registerExternalImportRoutes, MAX_CONTENT_CHARS, _internals: { buildKeyWriters, appendAudit, readAuditEntries } };
