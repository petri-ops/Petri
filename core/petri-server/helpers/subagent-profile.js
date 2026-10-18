'use strict';

/**
 * helpers/subagent-profile.js — 子智能体 profile 落点（BLOCK-206 / runlist W7a）。
 *
 * profile = **一次声明一组派发缺省值**（role / model / 并发收紧 / 汇报门继承），
 * 不是权限系统：policy、审批链、四档判定一概不碰；并发只能比 `runtime` 族的上限**更严**。
 *
 * 落点 `<dataDir>/subagent-profiles.json`（目录走 W4b 的 `data-paths`）：
 * `{ version, default: '<name>|""', profiles: [{ name, role?, model?, concurrency?, reportGuard? }] }`
 *
 * 三条现状纪律：
 *  ① 未配置 = 零行为变化（`spawn_agent` 不传 `profile` 时完全走原路径）；
 *  ② 未知 profile 名 **fail-closed**（与 `agentRoles.resolveRoleOrError` 同语义）；
 *  ③ 读侧宽容（坏文件=空），写侧整份消毒（未知字段/非法值/重名一律拒绝）。
 */

const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'subagent-profile';
const FILENAME = 'subagent-profiles.json';
const VERSION = 1;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const diagnostic = (code, keyPath, message) => ({ code, family: FAMILY, path: keyPath, message });

function profileFilePath() {
  return dataPaths.dataFile(FILENAME);
}

/** 单条 profile 消毒（未知字段只产诊断，不静默落盘）。 */
function sanitizeProfile(raw) {
  const { item, diagnostics } = schema.sanitizeItem(FAMILY, raw);
  return { item: item && item.name ? item : null, diagnostics };
}

/** 读整份（宽容）。 */
function readStore() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(profileFilePath(), 'utf8'));
  } catch {
    return { version: VERSION, default: '', profiles: [] };
  }
  if (!isPlainObject(parsed)) return { version: VERSION, default: '', profiles: [] };
  const profiles = [];
  const seen = new Set();
  for (const raw of Array.isArray(parsed.profiles) ? parsed.profiles : []) {
    const { item } = sanitizeProfile(raw);
    if (!item || seen.has(item.name)) continue; // 坏条目/重名只丢该条
    seen.add(item.name);
    profiles.push(item);
  }
  const defaultName = typeof parsed.default === 'string' ? parsed.default : '';
  return { version: VERSION, default: defaultName, profiles };
}

/** 写整份（先消毒；任一条目不合法 ⇒ 整批不落盘）。 */
function writeStore(next) {
  if (!isPlainObject(next)) {
    return { ok: false, diagnostics: [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '写入内容必须是对象')] };
  }
  const diagnostics = [];
  const profiles = [];
  const seen = new Set();
  for (const raw of Array.isArray(next.profiles) ? next.profiles : []) {
    const { item, diagnostics: entryDiagnostics } = sanitizeProfile(raw);
    if (!item) {
      diagnostics.push(...(entryDiagnostics.length ? entryDiagnostics : [diagnostic('type-mismatch', '', '每条 profile 必须带 name')]));
      continue;
    }
    if (seen.has(item.name)) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.NOT_ALLOWED, item.name, `重复的 profile 名 ${item.name}`));
      continue;
    }
    // 条目内的字段问题（未知字段/域外值）同样要能拦住整批写入
    diagnostics.push(...entryDiagnostics);
    seen.add(item.name);
    profiles.push(item);
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const defaultName = typeof next.default === 'string' ? next.default : '';
  if (defaultName && !seen.has(defaultName)) {
    diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.NOT_ALLOWED, 'default', `default 指向不存在的 profile ${defaultName}`));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const store = { version: VERSION, default: defaultName, profiles };
  fs.mkdirSync(path.dirname(profileFilePath()), { recursive: true });
  fs.writeFileSync(profileFilePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return { ok: true, diagnostics: [] };
}

/**
 * 解析 profile 名（未知 fail-closed）。
 * @returns {{ok:true, profile:object}|{ok:false, error:string, message:string}}
 */
function resolveProfile(name) {
  const wanted = typeof name === 'string' ? name.trim() : '';
  if (!wanted) return { ok: false, error: 'profile_name_required', message: 'profile 名不能为空' };
  const hit = readStore().profiles.find((entry) => entry.name === wanted);
  if (!hit) return { ok: false, error: 'unknown_profile', message: `未知的子智能体 profile：${wanted}` };
  return { ok: true, profile: hit };
}

/**
 * profile 的并发只能**收紧** runtime 上限：`min(runtime, profile)`，永不放宽。
 * 纯函数、无依赖：`spawn_agent` 与契约测共用同一份实现（"只能更严"这条性质被机械钉住）。
 */
function effectiveSpawnConcurrency(runtimeLimit, profile) {
  const runtime = Number(runtimeLimit);
  const fromProfile = profile && profile.concurrency !== undefined ? Number(profile.concurrency) : null;
  if (!Number.isFinite(runtime)) return fromProfile;
  if (fromProfile === null || !Number.isFinite(fromProfile)) return runtime;
  return Math.min(runtime, fromProfile);
}

/** 全部 profile（只读视图）。 */
function listProfiles() {
  return readStore().profiles;
}

/** 按区重置（config-transfer 用）。 */
function resetProfiles() {
  try {
    fs.rmSync(profileFilePath(), { force: true });
  } catch { /* 目录不可写：保持现状 */ }
  return { ok: true, diagnostics: [] };
}

/** 纯校验（config-transfer 导入前用）。 */
function validateStore(next) {
  if (!isPlainObject(next)) return [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '内容必须是对象')];
  const diagnostics = [];
  const seen = new Set();
  if (!Array.isArray(next.profiles)) {
    diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, 'profiles', 'profiles 必须是数组'));
    return diagnostics;
  }
  for (const raw of next.profiles) {
    const { item, diagnostics: entryDiagnostics } = sanitizeProfile(raw);
    if (!item) {
      diagnostics.push(...(entryDiagnostics.length ? entryDiagnostics : [diagnostic('type-mismatch', '', '每条 profile 必须带 name')]));
      continue;
    }
    if (seen.has(item.name)) diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.NOT_ALLOWED, item.name, `重复的 profile 名 ${item.name}`));
    seen.add(item.name);
    for (const d of entryDiagnostics) diagnostics.push(d);
  }
  if (typeof next.default === 'string' && next.default && !seen.has(next.default)) {
    diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.NOT_ALLOWED, 'default', `default 指向不存在的 profile ${next.default}`));
  }
  return diagnostics;
}

module.exports = {
  FAMILY,
  profileFilePath,
  readStore,
  writeStore,
  resolveProfile,
  effectiveSpawnConcurrency,
  listProfiles,
  resetProfiles,
  validateStore,
};
