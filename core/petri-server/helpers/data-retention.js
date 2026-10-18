'use strict';

/**
 * helpers/data-retention.js — 历史留存与归档（BLOCK-210 / runlist W7e）。
 *
 * 三条硬约束（也是验收条款）：
 *  ① **默认零行为变化**：`historyDays=0` / `archiveDir=''` / `maxBytesPerDir=0` ⇒ 不删、不移、不归档；
 *  ② **删除是显式动作**：`applyRetention` 默认 `dryRun:true`，且删除还必须显式 `allowDelete:true`；
 *  ③ **规划是纯函数**：`planRetention({entries, config, now})` 只做分类，不碰文件系统（便于离线断言）。
 *
 * 目录一律走 W4b 的 `shared-backend/data-paths`（不许在这里再写 env 回落链）。
 */

const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'data-retention';
const FILENAME = 'data-retention.json';
const AUDIT_FILENAME = 'retention-audit.jsonl';
const DEFAULTS = Object.freeze({ historyDays: 0, archiveDir: '', maxBytesPerDir: 0 });
const KEYS = Object.freeze(Object.keys(DEFAULTS));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const diagnostic = (code, keyPath, message) => ({ code, family: FAMILY, path: keyPath, message });

function configFilePath() {
  return dataPaths.dataFile(FILENAME);
}

function auditFilePath() {
  return dataPaths.dataFile(AUDIT_FILENAME);
}

function entryFor(key) {
  return schema.findKeyEntry(`retention.${key}`);
}

/** 读（宽容：坏文件/非法值回落默认）。 */
function readStore() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'));
  } catch {
    return { ...DEFAULTS };
  }
  if (!isPlainObject(parsed)) return { ...DEFAULTS };
  const out = { ...DEFAULTS };
  for (const key of KEYS) {
    if (parsed[key] === undefined) continue;
    const check = schema.validateValue(entryFor(key), parsed[key]);
    if (check.ok) out[key] = check.normalized;
  }
  return out;
}

/** 纯校验（写面与 transfer 共用）。 */
function validatePatch(patch) {
  if (!isPlainObject(patch)) return [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '补丁必须是对象')];
  const diagnostics = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!KEYS.includes(key)) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, key, `未注册的配置键 ${key}`));
      continue;
    }
    if (raw === null) continue;
    const check = schema.validateValue(entryFor(key), raw);
    if (!check.ok) diagnostics.push(diagnostic(check.code, key, check.message));
  }
  return diagnostics;
}

/** 写（合并；整批校验通过才落盘）。 */
function writeStore(patch, options = {}) {
  const diagnostics = validatePatch(patch);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const next = { ...readStore() };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === null) { next[key] = DEFAULTS[key]; continue; }
    next[key] = schema.validateValue(entryFor(key), raw).normalized;
  }
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
  fs.writeFileSync(configFilePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  appendAudit([{ what: 'config', patch, actor: options.actor || 'user' }]);
  return { ok: true, diagnostics: [], store: next };
}

function appendAudit(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(auditFilePath()), { recursive: true });
    const at = new Date().toISOString();
    fs.appendFileSync(auditFilePath(), `${entries.map((e) => JSON.stringify({ at, ...e })).join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('[data-retention] 审计写入失败：', error && error.message ? error.message : error);
  }
}

/**
 * **纯函数**规划：把候选清单分成 keep / archive / expired。
 * @param {{entries:Array<{path:string, size?:number, mtimeMs?:number}>, config?:object, now?:number}} input
 */
function planRetention({ entries, config = readStore(), now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const keep = [];
  const archive = [];
  const expired = [];
  const historyDays = Number(config.historyDays) || 0;
  const cutoff = historyDays > 0 ? now - historyDays * 24 * 60 * 60 * 1000 : null;
  const maxBytes = Number(config.maxBytesPerDir) || 0;

  for (const entry of list) {
    const age = typeof entry.mtimeMs === 'number' ? entry.mtimeMs : null;
    if (cutoff !== null && age !== null && age < cutoff) {
      // 过期项：配了归档目录就归档，否则进 expired（是否真删由 apply 的 allowDelete 决定）
      if (String(config.archiveDir || '').trim()) archive.push(entry);
      else expired.push(entry);
      continue;
    }
    keep.push(entry);
  }

  // 目录总量上限：按最新优先保留，其余进 expired（同样不直接删）
  let keptBytes = keep.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
  if (maxBytes > 0 && keptBytes > maxBytes) {
    const sorted = [...keep].sort((a, b) => (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0));
    keep.length = 0;
    keptBytes = 0;
    for (const entry of sorted) {
      const size = Number(entry.size) || 0;
      if (keptBytes + size <= maxBytes) {
        keep.push(entry);
        keptBytes += size;
      } else {
        expired.push(entry);
      }
    }
  }

  const bytesOf = (arr) => arr.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
  return {
    keep,
    archive,
    expired,
    totals: {
      count: list.length,
      keepCount: keep.length,
      archiveCount: archive.length,
      expiredCount: expired.length,
      keepBytes: bytesOf(keep),
      reclaimableBytes: bytesOf(archive) + bytesOf(expired),
    },
  };
}

/**
 * 执行规划（默认 dryRun；删除必须显式 allowDelete）。
 * 注意：本 v1 只**返回计划与动作**，归档/删除的真实文件操作由调用方在显式窗口内执行
 * （见 plan §reopen：真实搬迁/清理需一次性窗口 + 备份）。
 */
function applyRetention({ entries, dryRun = true, allowDelete = false, config = readStore() } = {}) {
  const plan = planRetention({ entries, config });
  const actions = [];
  if (!dryRun) {
    for (const entry of plan.archive) actions.push({ action: 'archive', path: entry.path });
    if (allowDelete) {
      for (const entry of plan.expired) actions.push({ action: 'delete', path: entry.path });
    }
    appendAudit([{ what: 'apply', dryRun: false, allowDelete, actions }]);
  }
  return {
    dryRun,
    allowDelete,
    plan,
    actions,
    ...(dryRun ? {} : { configured: { ...config } }),
  };
}

/** 按区重置（config-transfer 用）。 */
function resetRetention() {
  try {
    fs.rmSync(configFilePath(), { force: true });
  } catch { /* 目录不可写：保持现状 */ }
  return { ok: true, diagnostics: [] };
}

module.exports = {
  FAMILY,
  DEFAULTS,
  KEYS,
  configFilePath,
  auditFilePath,
  readStore,
  validatePatch,
  writeStore,
  planRetention,
  applyRetention,
  resetRetention,
};
