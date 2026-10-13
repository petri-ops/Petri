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
 */

const fs = require('fs');
const path = require('path');

const PREFS_VERSION = 1;

function getUserDataBaseDir() {
  if (process.env.PETRI_USER_DATA_DIR) return process.env.PETRI_USER_DATA_DIR;
  const os = require('os');
  return path.join(os.homedir(), '.petri');
}

function getPrefsFilePath() {
  return path.join(getUserDataBaseDir(), 'skills-prefs.json');
}

function getAuditFilePath() {
  return path.join(getUserDataBaseDir(), 'skills-prefs-audit.jsonl');
}

/** 读偏好（损坏/缺失=空偏好；不抛）。 */
function loadPrefs() {
  try {
    const raw = fs.readFileSync(getPrefsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.disabled && typeof parsed.disabled === 'object') {
      return parsed;
    }
  } catch { /* 缺失/损坏 = 空偏好 */ }
  return { version: PREFS_VERSION, disabled: {} };
}

function savePrefs(prefs) {
  const file = getPrefsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
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
  appendAudit,
  readAuditTail,
  isSkillDisabled,
  setSkillDisabled,
  recordUninstalledSource,
  getUninstalledSource,
  annotateDisabled,
  filterDisabled,
};
