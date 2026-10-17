'use strict';

/**
 * shared-backend/skill-prefs.js — 技能治理偏好与审计（BLOCK-177）。
 *
 * 单源：<userData>/skills-prefs.json（disabled 映射）+ append-only
 * <userData>/skills-prefs-audit.jsonl（治理动作留痕）。userData 口径与
 * skill-registry.getInstalledSkillsDir 同约定（PETRI_USER_DATA_DIR 优先 / ~/.petri 回退）。
 *
 * 治理语义（来源决定）：
 *  - 内置（built-in）技能：停用/启用——不物理删除（应用资产，更新会被带回）。
 *    停用 = agent 面（discover/get/索引块/执行）不可见不可执行；管理面（Skills 页）
 *    保留行并附 disabled 旗标置灰展示。再次获取 = 重新启用，零网络。
 *  - 已导入（installed）技能：卸载（registry.uninstallImportedSkill 单源）+
 *    从记录的 sourceDir 重装。卸载/重装同样落审计。
 *
 * 读面每次落盘重读（无缓存；两进程（主进程/后端）低频写，文件即真相）。
 * 写面 fail-closed：目录不存在则创建；JSON 损坏视为无偏好（审计文件不受影响）。
 *
 * BLOCK-203 W4a P3（runlist W4a）：形状真相搬进 `core/packages/shared-config/config-schema.js`
 * 的 `skills-prefs` 族，本模块只保留"落点 + 治理语义"：
 *  · `disabled.<id> = { at, reason? }`（**不是布尔映射**）、`uninstalledSources.<id> = { sourceDir, at }`；
 *  · 读侧宽容：条目形状不对就**丢该条**（不让一条脏记录把整份偏好打成空），并可产出诊断；
 *  · 写侧：非法条目**不落盘**（sanitize 后再写），skill id 非法直接拒绝（`invalid_skill_id`）——
 *    因为点路径登记要求 id 不含 `.`，否则 `disabled.<id>.at` 会寻址失败变成"未知键"假警报。
 *  · 写入面是 IPC（`skills:set-disabled`）不是 HTTP，故不适用漂移门的 400 规则（见该门的
 *    `NON_HTTP_WRITE_FAMILIES` 登记）。
 */

const fs = require('fs');
const path = require('path');
const schema = require('../packages/shared-config/config-schema.js');
const dataPaths = require('./data-paths.js');

const PREFS_VERSION = 1;
const FAMILY = 'skills-prefs';
/**
 * 技能 id 的**落点安全约束**（不是 id 语义真相——真相在 skill-registry）。
 * 点路径 `disabled.<id>.at` 依赖 id 不含 `.`；含空白/斜杠的 id 也不该进盘。
 */
const SKILL_ID_RE = /^[A-Za-z0-9_-]+$/;

const lookup = (family, storagePath) => schema.findEntryByPath(family, storagePath);

/**
 * BLOCK-203 W4b P1 — 用户态根走 `shared-backend/data-paths` 的 `resolveUserStateDir()`。
 * **路径语义不变**（PETRI_USER_DATA_DIR → ~/.petri）：这是"用户态"根，不是应用数据根；
 * 把技能账本搬进 Documents 属于用户数据迁移，须单独裁决（plan §10 落点表已登记归属）。
 */
function getUserDataBaseDir() {
  return dataPaths.resolveUserStateDir();
}

function getPrefsFilePath() {
  return path.join(getUserDataBaseDir(), 'skills-prefs.json');
}

function getAuditFilePath() {
  return path.join(getUserDataBaseDir(), 'skills-prefs-audit.jsonl');
}

/** 空偏好（保持结构：version + disabled 恒在，uninstalledSources 按需）。 */
function emptyPrefs() {
  return { version: PREFS_VERSION, disabled: {} };
}

/**
 * 形状校验 + 消毒（纯函数，测试直打；config-transfer 与 doctor 共用）。
 * 语义：**丢条目而不是丢整份文件**——一条脏记录不该让用户所有技能治理状态消失。
 * @returns {{prefs:{version:number, disabled:object, uninstalledSources?:object}, diagnostics:Array}}
 */
function sanitizePrefs(raw) {
  const prefs = emptyPrefs();
  const diagnostics = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { prefs, diagnostics };

  const versionEntry = schema.findKeyEntry('skills.version');
  const versionCheck = schema.validateValue(versionEntry, raw.version);
  if (versionCheck.ok) prefs.version = versionCheck.normalized;
  else if (raw.version !== undefined) {
    diagnostics.push({ code: versionCheck.code, path: 'version', family: FAMILY, message: 'version 非法，按当前版本重写' });
  }

  for (const [id, entry] of Object.entries(raw.disabled && typeof raw.disabled === 'object' ? raw.disabled : {})) {
    if (!SKILL_ID_RE.test(id)) {
      diagnostics.push({ code: schema.DIAGNOSTIC_CODES.NOT_ALLOWED, path: `disabled.${id}`, family: FAMILY, message: `技能 id 非法（含点/空白/斜杠或为空）：${id}` });
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push({ code: schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, path: `disabled.${id}`, family: FAMILY, message: `disabled.${id} 必须是对象 { at, reason? }` });
      continue;
    }
    const atCheck = schema.validateValue(lookup(FAMILY, `disabled.${id}.at`), entry.at);
    if (!atCheck.ok) {
      diagnostics.push({ code: atCheck.code, path: `disabled.${id}.at`, family: FAMILY, message: `disabled.${id}.at 非法（应是时间戳字符串）` });
      continue;
    }
    const out = { at: atCheck.normalized };
    if (entry.reason !== undefined) {
      const reasonCheck = schema.validateValue(lookup(FAMILY, `disabled.${id}.reason`), entry.reason);
      if (reasonCheck.ok) out.reason = reasonCheck.normalized;
      else diagnostics.push({ code: reasonCheck.code, path: `disabled.${id}.reason`, family: FAMILY, message: `disabled.${id}.reason 非法，已丢弃` });
    }
    prefs.disabled[id] = out;
  }

  const sources = raw.uninstalledSources;
  if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
    const kept = {};
    for (const [id, entry] of Object.entries(sources)) {
      if (!SKILL_ID_RE.test(id)) {
        diagnostics.push({ code: schema.DIAGNOSTIC_CODES.NOT_ALLOWED, path: `uninstalledSources.${id}`, family: FAMILY, message: `技能 id 非法：${id}` });
        continue;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        diagnostics.push({ code: schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, path: `uninstalledSources.${id}`, family: FAMILY, message: `uninstalledSources.${id} 必须是对象 { sourceDir, at }` });
        continue;
      }
      const dirCheck = schema.validateValue(lookup(FAMILY, `uninstalledSources.${id}.sourceDir`), entry.sourceDir);
      if (!dirCheck.ok) {
        diagnostics.push({ code: dirCheck.code, path: `uninstalledSources.${id}.sourceDir`, family: FAMILY, message: 'sourceDir 非法（应是字符串），条目已丢弃' });
        continue;
      }
      const out = { sourceDir: dirCheck.normalized };
      const atCheck = schema.validateValue(lookup(FAMILY, `uninstalledSources.${id}.at`), entry.at);
      if (atCheck.ok) out.at = atCheck.normalized;
      kept[id] = out;
    }
    // 空账本不落进读结果：否则"导出→导入→再导出"会因为凭空多出的 `uninstalledSources: {}` 而失去幂等
    if (Object.keys(kept).length > 0) prefs.uninstalledSources = kept;
  }

  // 未注册的顶层键：读侧丢弃并报告（旧文件不迁可读，但不让它继续存活到下一次写入）
  for (const key of Object.keys(raw)) {
    if (key === 'version' || key === 'disabled' || key === 'uninstalledSources') continue;
    diagnostics.push({ code: schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, path: key, family: FAMILY, message: `未注册的配置键 ${key}（读侧忽略，写侧丢弃）` });
  }
  return { prefs, diagnostics };
}

/** 读偏好（损坏/缺失=空偏好；不抛）。逐条消毒，脏条目丢弃但不连坐整份文件。 */
function loadPrefs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getPrefsFilePath(), 'utf8'));
    return sanitizePrefs(parsed).prefs;
  } catch {
    return emptyPrefs();
  }
}

/** 校验（诊断数组；config-transfer 的导入前全量校验用）。 */
function validatePrefs(raw) {
  return sanitizePrefs(raw).diagnostics;
}

/** 写偏好（先消毒再落盘：脏条目写不进）。 */
function savePrefs(prefs) {
  const sanitized = sanitizePrefs(prefs).prefs;
  const file = getPrefsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
}

/** 治理动作审计（append-only jsonl；写失败不抛——审计面故障不阻塞治理动作本身）。 */
function appendAudit(action, skillId, detail) {
  try {
    const file = getAuditFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      action,
      skillId: String(skillId || ''),
      ...(detail && typeof detail === 'object' ? { detail } : {}),
    });
    fs.appendFileSync(file, line + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读取审计尾部（管理/排查面；默认最近 200 行）。 */
function readAuditTail(limit = 200) {
  try {
    const raw = fs.readFileSync(getAuditFilePath(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch {
    return [];
  }
}

/** BLOCK-177 — 卸载时留存来源目录（卸载会删 installed manifest 条目，来源记录挪进 prefs 供重装）。 */
function recordUninstalledSource(skillId, sourceDir) {
  if (!skillId || typeof skillId !== 'string' || !sourceDir || typeof sourceDir !== 'string') {
    return { ok: false, error: 'invalid_args' };
  }
  if (!SKILL_ID_RE.test(skillId)) {
    return { ok: false, error: 'invalid_skill_id' };
  }
  const prefs = loadPrefs();
  prefs.uninstalledSources = prefs.uninstalledSources && typeof prefs.uninstalledSources === 'object' ? prefs.uninstalledSources : {};
  prefs.uninstalledSources[skillId] = { sourceDir, at: new Date().toISOString() };
  savePrefs(prefs);
  return { ok: true };
}

/** 读取卸载留存来源（无记录 = null）。 */
function getUninstalledSource(skillId) {
  const prefs = loadPrefs();
  const entry = prefs.uninstalledSources && prefs.uninstalledSources[skillId];
  return entry && entry.sourceDir ? entry.sourceDir : null;
}

/**
 * 导入合并（config-transfer 用）：两个账本**按 id 合并**，不删文件里未出现的键
 * （与导出信封的"合并覆盖"语义一致）。脏条目在 `savePrefs` 里被消毒掉。
 */
function importPrefs(body) {
  const current = loadPrefs();
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const next = {
    ...current,
    ...patch,
    disabled: { ...(current.disabled || {}), ...(patch.disabled || {}) },
  };
  const sources = { ...(current.uninstalledSources || {}), ...(patch.uninstalledSources || {}) };
  // 空账本不落盘（导出→导入→再导出必须逐字节等价；凭空长出 `uninstalledSources: {}` 就不等价）
  if (Object.keys(sources).length > 0) next.uninstalledSources = sources;
  else delete next.uninstalledSources;
  savePrefs(next);
  return next;
}

/**
 * 按区重置（config-transfer 用）：只清**用户治理覆盖层**（disabled），
 * **保留 uninstalledSources**——那是"重装入口"的指针，清掉等于把已卸载技能的来源弄丢。
 */
function resetPrefs() {
  const prefs = loadPrefs();
  const next = emptyPrefs();
  if (prefs.uninstalledSources && Object.keys(prefs.uninstalledSources).length > 0) {
    next.uninstalledSources = prefs.uninstalledSources;
  }
  savePrefs(next);
  return next;
}

/** 指定技能当前是否被停用。 */
function isSkillDisabled(skillId) {
  if (!skillId || typeof skillId !== 'string') return false;
  const prefs = loadPrefs();
  return Boolean(prefs.disabled[skillId]);
}

/** 停用/启用某技能（幂等；写审计）。返回 { ok, disabled }。 */
function setSkillDisabled(skillId, disabled, reason) {
  if (!skillId || typeof skillId !== 'string') {
    return { ok: false, error: 'skill_id_required' };
  }
  // 点路径 `disabled.<id>.at` 要求 id 不含 `.`；含空白/斜杠的 id 也不该进盘（否则会变成"未知键"假警报）
  if (!SKILL_ID_RE.test(skillId)) {
    return { ok: false, error: 'invalid_skill_id' };
  }
  const prefs = loadPrefs();
  if (disabled) {
    // 真幂等：已在停用登记中则保持原条目（不覆盖最初 at/reason）；显式给 reason 时更新 reason
    const existing = prefs.disabled[skillId];
    if (!existing) {
      prefs.disabled[skillId] = { at: new Date().toISOString(), ...(reason ? { reason: String(reason).slice(0, 200) } : {}) };
    } else if (reason) {
      prefs.disabled[skillId] = { ...existing, reason: String(reason).slice(0, 200) };
    }
  } else {
    delete prefs.disabled[skillId];
    if (!Object.keys(prefs.disabled).length && prefs.version === PREFS_VERSION) {
      // 空偏好保持结构（version 保留），不删文件——幂等且可读
    }
  }
  savePrefs(prefs);
  appendAudit(disabled ? 'disable' : 'enable', skillId, reason ? { reason: String(reason).slice(0, 200) } : undefined);
  return { ok: true, disabled: Boolean(disabled) };
}

/**
 * 给技能行附加 disabled 旗标（纯函数，测试直打）。
 * 管理视图：不过滤，只打标（Skills 页置灰展示）。
 */
function annotateDisabled(skills) {
  const prefs = loadPrefs();
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    ...skill,
    disabled: Boolean(skill && skill.id && prefs.disabled[skill.id]),
  }));
}

/**
 * 过滤停用技能（纯函数，测试直打）。
 * agent 面/执行面：停用件整体不可见不可执行。
 */
function filterDisabled(skills) {
  const prefs = loadPrefs();
  return (Array.isArray(skills) ? skills : []).filter((skill) => !(skill && skill.id && prefs.disabled[skill.id]));
}

module.exports = {
  PREFS_VERSION,
  getUserDataBaseDir,
  getPrefsFilePath,
  getAuditFilePath,
  loadPrefs,
  sanitizePrefs,
  validatePrefs,
  importPrefs,
  resetPrefs,
  appendAudit,
  readAuditTail,
  isSkillDisabled,
  setSkillDisabled,
  recordUninstalledSource,
  getUninstalledSource,
  annotateDisabled,
  filterDisabled,
};
