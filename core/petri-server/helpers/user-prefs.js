'use strict';

/**
 * helpers/user-prefs.js — 多端用户偏好（主题/字号/强调色）落点单源（BLOCK-203 W4a P2）。
 *
 * 从 `routes/user-prefs.js` 抽出来的理由（不是洁癖）：配置全景导出/重置（BLOCK-201）与
 * `config:doctor` 需要一个**可被别的模块 require 的 store**，而路由文件只该做 HTTP 翻译。
 * 其他族（feature-flags / keymap / network / runtime）早就是 `helpers/<family>.js` 持 store、
 * `routes/<family>.js` 做翻译——本模块把 user-prefs 归到同一形态，不新建第二套。
 *
 * 三条现状语义**逐字保留**（改它们属行为变更，须单独裁决）：
 *  ① 落点 = `<dataDir>/user-prefs.json`，文件名与位置不变（4 条 data root 回落链的合一是 W4b）；
 *  ② 读侧宽容：文件缺失/JSON 损坏/未知键/非法值一律不抛，回落默认；
 *  ③ 写侧消毒：枚举域外**丢键**、`fontScale` **钳位**到域内（5 → 1.4）、`fontScale === 1` 不落盘
 *     （1 = "没改过"而不是"用户选了 1"，历史行为）。
 *
 * 新增的只有一件事：**未知键 fail-closed**。此前 `sanitize` 静默丢掉未注册键，写侧于是永远
 * 发现不了"你在写一个不存在的键"——这正是 BLOCK-199 §0.2 那族缺陷的共同形状。
 * 形状真相在 `core/packages/shared-config/config-schema.js` 的 `user-prefs` 族，本模块不复制域值。
 */

const fs = require('fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'user-prefs';
const FILENAME = 'user-prefs.json';

const lookup = (family, storagePath) => schema.findEntryByPath(family, storagePath);

/** 钳位边界取注册表声明，不在这里抄第二份数字（history: "曾漏 blue" 就是两份集合各自维护的下场）。 */
const FONT_SCALE_ENTRY = schema.findKeyEntry('userPrefs.fontScale');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(code, keyPath, message) {
  return { code, path: keyPath, family: FAMILY, message };
}

/** 落点文件绝对路径（W4b 之前**不许**换位置，见文件头 ①）。 */
function prefsFile(dataDir) {
  return path.join(dataDir, FILENAME);
}

/**
 * 落点目录：BLOCK-203 W4b P1 起由 `shared-backend/data-paths` 统一解析
 * （此前是本模块手写的第四条链，两个 env 都没设时会落到 `cwd/data`）。
 * 行为变更只有这一处，且用 `legacyDirs()` 做只读兼容：旧文件照读、不迁、不删。
 */
function resolveDataDir() {
  return dataPaths.resolveDataDir();
}

/** 历史落点目录（只读兼容；不删旧文件）。 */
function legacyDirs() {
  return dataPaths.legacyDataDirs();
}

function clampFontScale(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(FONT_SCALE_ENTRY.domain.max, Math.max(FONT_SCALE_ENTRY.domain.min, n));
}

/**
 * 单键归一化 = 现状消毒语义 + 注册表校验合成一次。
 * @returns {{value?:*, diagnostic?:object}} `value` 存在=可落盘；`diagnostic` 存在=被钳位或丢弃
 */
function normalizeEntry(keyPath, raw) {
  if (keyPath === 'fontScale') {
    const clamped = clampFontScale(raw);
    if (clamped === null) return { diagnostic: diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, keyPath, 'fontScale 需要有限数值，已丢弃该键') };
    const check = schema.validateValue(FONT_SCALE_ENTRY, clamped);
    if (!check.ok) return { diagnostic: diagnostic(check.code, keyPath, check.message) };
    if (check.normalized !== Number(raw)) {
      return { value: check.normalized, diagnostic: diagnostic(schema.DIAGNOSTIC_CODES.OUT_OF_RANGE, keyPath, `fontScale 已钳位到 ${check.normalized}`) };
    }
    return { value: check.normalized };
  }
  const check = schema.validateValue(lookup(FAMILY, keyPath), raw);
  if (!check.ok) return { diagnostic: diagnostic(check.code, keyPath, check.message) };
  return { value: check.normalized };
}

/** 原子写：临时文件 + rename（既有写法保留，避免半写文件）。 */
function persist(dataDir, prefs) {
  fs.mkdirSync(path.dirname(prefsFile(dataDir)), { recursive: true });
  const tmp = `${prefsFile(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, prefsFile(dataDir));
  return prefs;
}

/**
 * 读偏好 + 诊断（读侧只报告不拒：旧文件里的未知键不得炸启动）。
 * @returns {{prefs:object, diagnostics:Array}}
 */
function readPrefsWithDiagnostics(dataDir, legacyOverride) {
  const dir = dataDir || resolveDataDir();
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(prefsFile(dir), 'utf8'));
  } catch {
    // 历史落点只读兼容（BLOCK-203 W4b P1）：新位置没文件时回落到旧目录读，不迁不改。
    // **只在调用方没显式指定目录时**——否则隔离实例（测试/多用户）会读到别人的 cwd/data。
    for (const legacy of legacyOverride || (dataDir ? [] : legacyDirs())) {
      try {
        parsed = JSON.parse(fs.readFileSync(prefsFile(legacy), 'utf8'));
        break;
      } catch { /* 继续找下一个 */ }
    }
    if (!parsed) return { prefs: {}, diagnostics: [] };
  }
  if (!isPlainObject(parsed)) return { prefs: {}, diagnostics: [] };
  const prefs = {};
  const diagnostics = [];
  for (const [keyPath, raw] of Object.entries(parsed)) {
    if (!lookup(FAMILY, keyPath)) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, keyPath, `未注册的配置键 ${keyPath}（读侧忽略）`));
      continue;
    }
    const normalized = normalizeEntry(keyPath, raw);
    if (normalized.diagnostic) diagnostics.push(normalized.diagnostic);
    if (normalized.value === undefined) continue;
    if (keyPath === 'fontScale' && normalized.value === 1) continue;
    prefs[keyPath] = normalized.value;
  }
  return { prefs, diagnostics };
}

/** 读偏好（宽容版；值已消毒）。 */
function readPrefs(dataDir) {
  return readPrefsWithDiagnostics(dataDir).prefs;
}

/**
 * 写偏好（合并覆盖，含清键/丢键语义）。
 * @returns {{ok:boolean, prefs:object, diagnostics:Array}} `ok:false` 时**整批未落盘**
 */
function writePrefs(dataDir, patch) {
  const dir = dataDir || resolveDataDir();
  const prev = readPrefs(dir);
  if (!isPlainObject(patch)) {
    return { ok: false, prefs: prev, diagnostics: [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '写入补丁必须是对象')] };
  }
  const rejected = [];
  const diagnostics = [];
  const next = { ...prev };
  for (const [keyPath, raw] of Object.entries(patch)) {
    const entry = lookup(FAMILY, keyPath);
    if (!entry) {
      rejected.push(diagnostic(schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, keyPath, `未注册的配置键 ${keyPath}，拒绝写入`));
      continue;
    }
    if (raw === null) continue; // 现状：null 视为未提供，不改键（不是"删键"）
    const normalized = normalizeEntry(keyPath, raw);
    if (normalized.diagnostic) diagnostics.push(normalized.diagnostic);
    if (normalized.value === undefined) continue;
    if (keyPath === 'fontScale' && normalized.value === 1) {
      delete next.fontScale;
      continue;
    }
    next[keyPath] = normalized.value;
  }
  if (rejected.length > 0) {
    // 未知键 = 写不进：整批不落盘，让"你写的键不存在"在调用侧可见（此前是静默丢弃）
    return { ok: false, prefs: prev, diagnostics: rejected };
  }
  return { ok: true, prefs: persist(dir, next), diagnostics };
}

/**
 * 整文件替换（供 config-transfer 的「按区重置」用：只清覆盖层 → 回落默认）。
 * 与 `writePrefs` 的区别是**不合并**，且只接受已注册键。
 */
function writeStore(dataDir, next) {
  const dir = dataDir || resolveDataDir();
  const safe = isPlainObject(next) ? next : {};
  const out = {};
  for (const [keyPath, raw] of Object.entries(safe)) {
    if (!lookup(FAMILY, keyPath) || raw === null) continue;
    const normalized = normalizeEntry(keyPath, raw);
    if (normalized.value === undefined) continue;
    if (keyPath === 'fontScale' && normalized.value === 1) continue;
    out[keyPath] = normalized.value;
  }
  return persist(dir, out);
}

function resetPrefs(dataDir) {
  return writeStore(dataDir, {});
}

module.exports = {
  resolveDataDir,
  legacyDirs,
  readPrefs,
  readPrefsWithDiagnostics,
  writePrefs,
  resetPrefs,
};
