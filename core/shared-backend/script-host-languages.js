'use strict';

/**
 * Script-host language registry (BLOCK-83 D10：脚本工具宿主的语言扩展点).
 *
 * 契约（D12 词表纪律）：语言是**数据**而非核心分支——每个语言描述符声明
 * 脚本扩展名、人类可读标签、解释器命令名与运行时探测键；宿主按描述符取用，
 * 不再在核心硬编码 `lang === 'r' ? ... : ...`。
 *
 * 归属：本注册表是「插座」留在核心；具体语言档案（含 R 运行时/包解析）在
 * P4 随领域包交付——届时 R 档案由包注册，核心去除内置 R 依赖。
 * 当前内置 r / python 两档为**过渡事实**（与既有行为逐字一致）。
 */

const LANGUAGES = new Map();

function registerScriptLanguage(def) {
  if (!def || typeof def !== 'object') throw new Error('script_language_definition_required');
  if (typeof def.id !== 'string' || !def.id.trim()) throw new Error('script_language_id_required');
  if (typeof def.scriptExtension !== 'string' || !def.scriptExtension) throw new Error('script_language_extension_required');
  const frozen = Object.freeze({
    id: def.id,
    label: typeof def.label === 'string' ? def.label : def.id,
    scriptExtension: def.scriptExtension,
    command: typeof def.command === 'string' ? def.command : def.id,
    runtimeKey: typeof def.runtimeKey === 'string' ? def.runtimeKey : def.id,
  });
  const previous = LANGUAGES.get(frozen.id) || null;
  LANGUAGES.set(frozen.id, frozen);
  return previous;
}

function unregisterScriptLanguage(id) {
  return LANGUAGES.delete(id);
}

function getScriptLanguage(id) {
  return LANGUAGES.get(id) || null;
}

function listScriptLanguages() {
  return [...LANGUAGES.keys()];
}

/**
 * 脚本文件扩展名。未知语言与历史行为一致回落 'py'（原 `lang === 'r' ? 'R' : 'py'`）。
 */
function scriptExtensionFor(lang) {
  const profile = getScriptLanguage(lang);
  return profile ? profile.scriptExtension : 'py';
}

/** 人类可读语言标签。未知语言回显原值（原 `... : lang || ''`）。 */
function interpreterLabel(lang) {
  const profile = getScriptLanguage(lang);
  if (profile) return profile.label;
  return lang || '';
}

/** 运行时缺失提示里使用的命令名（原三档：Rscript / python / 可执行文件）。 */
function missingRuntimeCommandName(lang) {
  const profile = getScriptLanguage(lang);
  return profile ? profile.command : '可执行文件';
}

/** 运行时探测键（供 runtimeReady 判定，原 {r, python} 形状）。 */
function runtimeKeyFor(lang) {
  const profile = getScriptLanguage(lang);
  return profile ? profile.runtimeKey : (lang || null);
}

// 过渡内置档案（P4 起 R 档案随领域包注册，核心仅保留解释器无关机制）。
registerScriptLanguage({ id: 'r', label: 'R', scriptExtension: 'R', command: 'Rscript', runtimeKey: 'r' });
registerScriptLanguage({ id: 'python', label: 'Python', scriptExtension: 'py', command: 'python', runtimeKey: 'python' });

module.exports = {
  registerScriptLanguage,
  unregisterScriptLanguage,
  getScriptLanguage,
  listScriptLanguages,
  scriptExtensionFor,
  interpreterLabel,
  missingRuntimeCommandName,
  runtimeKeyFor,
};
