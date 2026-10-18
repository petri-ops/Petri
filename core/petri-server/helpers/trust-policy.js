'use strict';

/**
 * helpers/trust-policy.js — 项目信任级落点（BLOCK-207 / runlist W7b）。
 *
 * 语义边界（写在这里防止后来者把它做成第二套权限系统）：
 *  · 信任**不是**判定器：四档判定（`agent-tool-policy`）、审批链、用户规则层一字不动；
 *  · 它只在 `agent-runner` 构造 `accessMode` 时充当**天花板**，且**只能收紧**；
 *  · `untrusted` 的语义是"不许动工作区"——`read`/`plan` 保留（看与规划不是写入风险），
 *    `workspace-write`/`full` 一律降到 `read`。
 *
 * 三条现状纪律：
 *  ① 默认 `inherit` = 零行为变化（不配置就不干预任何项目）；
 *  ② 读侧宽容（坏文件=无策略）；写侧整份消毒（未知 level/重名/未知字段拒绝）；
 *  ③ **信任变更写追加式审计** `trust-audit.jsonl`（from/to/actor/at）——敏感项留痕。
 */

const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'trust-policy';
const FILENAME = 'trust-policy.json';
const AUDIT_FILENAME = 'trust-audit.jsonl';
const VERSION = 1;
const DEFAULT_LEVEL = 'inherit';
const LEVELS = Object.freeze(['inherit', 'trusted', 'untrusted']);

/** 四档从宽到严的序（仅用于天花板判断，不复制判定逻辑）。 */
const ACCESS_MODES = Object.freeze(['read', 'plan', 'workspace-write', 'full']);
const MUTATING_MODES = new Set(['workspace-write', 'full']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const diagnostic = (code, keyPath, message) => ({ code, family: FAMILY, path: keyPath, message });

function policyFilePath() {
  return dataPaths.dataFile(FILENAME);
}

function auditFilePath() {
  return dataPaths.dataFile(AUDIT_FILENAME);
}

/** 读整份（宽容）。 */
function readStore() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(policyFilePath(), 'utf8'));
  } catch {
    return { version: VERSION, defaultLevel: DEFAULT_LEVEL, projects: [] };
  }
  if (!isPlainObject(parsed)) return { version: VERSION, defaultLevel: DEFAULT_LEVEL, projects: [] };
  const levelEntry = schema.findKeyEntry('trustPolicy.defaultLevel');
  const levelCheck = schema.validateValue(levelEntry, parsed.defaultLevel);
  const projects = [];
  const seen = new Set();
  for (const raw of Array.isArray(parsed.projects) ? parsed.projects : []) {
    const { item } = schema.sanitizeItem(FAMILY, raw);
    // 信任项必须同时有 project 与 level：只剩 project 的条目是"半条"，留着会让
    // levelForProject 返回 undefined（读侧宁可不认这条，也不返回一个空档位）
    if (!item || !item.project || !item.level || seen.has(item.project)) continue;
    seen.add(item.project);
    projects.push(item);
  }
  return {
    version: VERSION,
    defaultLevel: levelCheck.ok ? levelCheck.normalized : DEFAULT_LEVEL,
    projects,
  };
}

/** 纯校验（写面与 config-transfer 导入共用）。 */
function validateStore(next) {
  if (!isPlainObject(next)) return [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '内容必须是对象')];
  const diagnostics = [];
  if (next.defaultLevel !== undefined) {
    const check = schema.validateValue(schema.findKeyEntry('trustPolicy.defaultLevel'), next.defaultLevel);
    if (!check.ok) diagnostics.push(diagnostic(check.code, 'defaultLevel', check.message));
  }
  if (!Array.isArray(next.projects)) {
    diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, 'projects', 'projects 必须是数组'));
    return diagnostics;
  }
  const seen = new Set();
  next.projects.forEach((raw, index) => {
    const { item, diagnostics: entryDiagnostics } = schema.sanitizeItem(FAMILY, raw);
    if (!item || !item.project) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, `projects[${index}]`, '每条信任项必须带 project'));
      return;
    }
    if (!item.level) {
      // 缺 level 时 sanitizeItem 不会报错（它只校验"出现了的字段"），但信任项没有 level = 无意义
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, `projects[${index}].level`, '每条信任项必须带 level'));
      return;
    }
    if (seen.has(item.project)) diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.NOT_ALLOWED, item.project, `重复的项目 ${item.project}`));
    seen.add(item.project);
    for (const d of entryDiagnostics) diagnostics.push({ ...d, path: `projects[${index}].${d.path}` });
  });
  return diagnostics;
}

/** 追加式审计（best-effort：写审计失败不改写操作结果，但要留痕到控制台）。 */
function appendAudit(entries, actor) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(auditFilePath()), { recursive: true });
    const at = new Date().toISOString();
    const lines = entries.map((e) => JSON.stringify({ at, actor: actor || 'user', ...e })).join('\n');
    fs.appendFileSync(auditFilePath(), `${lines}\n`, 'utf8');
  } catch (error) {
    console.warn('[trust-policy] 审计写入失败（未回滚信任变更）：', error && error.message ? error.message : error);
  }
}

/** 写整份（先校验，再落盘，最后差异审计）。 */
function writeStore(next, options = {}) {
  const diagnostics = validateStore(next);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const before = readStore();
  const projects = [];
  const seen = new Set();
  for (const raw of next.projects) {
    const { item } = schema.sanitizeItem(FAMILY, raw);
    if (!item || !item.project || seen.has(item.project)) continue;
    seen.add(item.project);
    projects.push(item);
  }
  const store = {
    version: VERSION,
    defaultLevel: next.defaultLevel === undefined ? before.defaultLevel : next.defaultLevel,
    projects,
  };
  fs.mkdirSync(path.dirname(policyFilePath()), { recursive: true });
  fs.writeFileSync(policyFilePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');

  const changes = [];
  if (before.defaultLevel !== store.defaultLevel) {
    changes.push({ what: 'defaultLevel', from: before.defaultLevel, to: store.defaultLevel });
  }
  const beforeMap = new Map(before.projects.map((p) => [p.project, p.level]));
  const afterMap = new Map(store.projects.map((p) => [p.project, p.level]));
  for (const [project, level] of afterMap) {
    if (beforeMap.get(project) !== level) changes.push({ what: 'project', project, from: beforeMap.get(project) || null, to: level });
  }
  for (const [project, level] of beforeMap) {
    if (!afterMap.has(project)) changes.push({ what: 'project', project, from: level, to: null });
  }
  appendAudit(changes, options.actor);
  return { ok: true, diagnostics: [], store, audited: changes.length };
}

/** 某项目的生效信任级（未配置 → defaultLevel）。 */
function levelForProject(projectId, store = readStore()) {
  const id = typeof projectId === 'string' ? projectId : '';
  if (id) {
    const hit = store.projects.find((entry) => entry.project === id);
    if (hit) return hit.level;
  }
  return store.defaultLevel;
}

/**
 * 信任天花板（**只能收紧**）：
 *  - inherit / trusted → 原样返回；
 *  - untrusted → 写/执行档（workspace-write / full）降到 `read`；read/plan 保留。
 * 未知档位原样返回（上游本来就会把未知值塌缩成 full；此处不替它改语义）。
 */
function applyTrustCeiling(accessMode, level) {
  const mode = typeof accessMode === 'string' ? accessMode : '';
  if (level !== 'untrusted') return mode;
  return MUTATING_MODES.has(mode) ? 'read' : mode;
}

/** 按区重置（config-transfer 用）。 */
function resetTrustPolicy() {
  try {
    fs.rmSync(policyFilePath(), { force: true });
  } catch { /* 目录不可写：保持现状 */ }
  return { ok: true, diagnostics: [] };
}

module.exports = {
  FAMILY,
  DEFAULT_LEVEL,
  LEVELS,
  ACCESS_MODES,
  policyFilePath,
  auditFilePath,
  readStore,
  writeStore,
  validateStore,
  levelForProject,
  applyTrustCeiling,
  resetTrustPolicy,
};
