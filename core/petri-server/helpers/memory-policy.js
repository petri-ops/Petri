'use strict';

/**
 * helpers/memory-policy.js — 记忆与压缩策略落点（BLOCK-205 / runlist W6）。
 *
 * 为什么要有它：这些数原本是**模块常量**（`conversation-compaction.js:20-25`、
 * `memory-vectors.js:64-68`、`memory-lifecycle.js:17-18`）——改一个数要改代码发版本，
 * 而且没有任何"当前生效值"的出口。收进注册表族 `memory-policy` 后：
 *  ① 形状/边界在 `shared-config`（`memory-policy` 族），本模块只做落点与生效值装配；
 *  ② **默认值逐字等于原常量**（`DEFAULTS`）⇒ 未配置 = 零行为变化（基线测冻结）；
 *  ③ `effectiveSnapshot()` 给出"生效值 + 来源（file/default）"，让"改了到底生效没有"可见。
 *
 * 嵌入/提取模型**不可写**：模型 id 与向量维度绑定（`EMBEDDING_DIM=1024`），
 * 单方面换模型会让已存向量全部失效——所以注册表里它是 `owner:'code'`，
 * 写侧会以 read-only 拒绝，本模块只把它读出来用于快照与调用。
 */

const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'memory-policy';
const FILENAME = 'memory-policy.json';

/** 与接线前的模块常量逐字相同（改这里 = 行为变更，基线测会红）。 */
const DEFAULTS = Object.freeze({
  compactionTriggerTokens: 12_000,
  compactionMinMessages: 24,
  compactionKeepRecent: 12,
  compactionSummaryBudgetChars: 60_000,
  memoryTopK: 3,
  memoryThreshold: 0.55,
  memoryMaxChars: 1_500,
  autoFactTtlDays: 90,
  decayBatchLimit: 200,
  embeddingModel: 'text-embedding-v3',
});

const KEYS = Object.freeze(Object.keys(DEFAULTS));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const diagnostic = (code, keyPath, message) => ({ code, family: FAMILY, path: keyPath, message });

function policyFilePath() {
  return dataPaths.dataFile(FILENAME);
}

function entryFor(key) {
  return schema.findKeyEntry(`memoryPolicy.${key}`);
}

/** 读磁盘上真正写了的值（只含有且合法的键）+ 诊断。 */
function readStored() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(policyFilePath(), 'utf8'));
  } catch {
    return { values: {}, diagnostics: [] };
  }
  if (!isPlainObject(parsed)) return { values: {}, diagnostics: [] };
  const values = {};
  const diagnostics = [];
  for (const [key, raw] of Object.entries(parsed)) {
    if (!KEYS.includes(key)) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, key, `未注册的配置键 ${key}（读侧忽略，写侧拒绝）`));
      continue;
    }
    const check = schema.validateValue(entryFor(key), raw);
    if (!check.ok) {
      diagnostics.push(diagnostic(check.code, key, check.message));
      continue;
    }
    values[key] = check.normalized;
  }
  return { values, diagnostics };
}

/** 生效值（file 覆盖 default，逐键）。 */
function effective() {
  const { values } = readStored();
  return { ...DEFAULTS, ...values };
}

/**
 * 生效值 + 来源快照（"改了生效没有"的出口）。
 * @returns {{values:object, sources:Record<string,'file'|'default'>, path:string}}
 */
function effectiveSnapshot() {
  const { values } = readStored();
  const sources = Object.fromEntries(KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(values, key) ? 'file' : 'default']));
  return { values: { ...DEFAULTS, ...values }, sources, path: policyFilePath() };
}

/** 压缩侧的四项（`conversation-compaction` 消费）。 */
function compactionSettings() {
  const values = effective();
  return {
    triggerTokens: values.compactionTriggerTokens,
    minMessages: values.compactionMinMessages,
    keepRecent: values.compactionKeepRecent,
    summaryBudgetChars: values.compactionSummaryBudgetChars,
  };
}

/** 记忆检索侧（`memory-vectors` 消费）。 */
function memorySettings() {
  const values = effective();
  return {
    topK: values.memoryTopK,
    threshold: values.memoryThreshold,
    maxChars: values.memoryMaxChars,
    embeddingModel: values.embeddingModel,
  };
}

/** 生命周期侧（`memory-lifecycle` 消费）。 */
function lifecycleSettings() {
  const values = effective();
  return {
    autoFactTtlMs: values.autoFactTtlDays * 24 * 60 * 60 * 1000,
    decayBatchLimit: values.decayBatchLimit,
  };
}

/** 纯校验（不落盘；config-transfer 的导入前全量校验复用同一份规则）。 */
function validatePatch(patch) {
  if (!isPlainObject(patch)) {
    return [diagnostic(schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '', '补丁必须是对象')];
  }
  const diagnostics = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!KEYS.includes(key)) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, key, `未注册的配置键 ${key}，拒绝写入`));
      continue;
    }
    if (raw === null) continue; // 清键语义
    const entry = entryFor(key);
    if (!entry.mutable) {
      diagnostics.push(diagnostic(schema.DIAGNOSTIC_CODES.READ_ONLY, key, `${entry.key} 由代码侧绑定（模型与向量维度），用户不可写`));
      continue;
    }
    const check = schema.validateValue(entry, raw);
    if (!check.ok) diagnostics.push(diagnostic(check.code, key, check.message));
  }
  return diagnostics;
}

/**
 * 写整份（合并覆盖；`null` 表示清该键回落默认）。
 * @returns {{ok:boolean, diagnostics:Array}}
 */
function writeStore(patch) {
  const diagnostics = validatePatch(patch);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const next = { ...readStored().values };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === null) {
      delete next[key];
      continue;
    }
    next[key] = schema.validateValue(entryFor(key), raw).normalized;
  }
  fs.mkdirSync(path.dirname(policyFilePath()), { recursive: true });
  fs.writeFileSync(policyFilePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { ok: true, diagnostics: [] };
}

/** 按区重置：清空文件即"全部回落默认"。 */
function resetMemoryPolicy() {
  try {
    fs.rmSync(policyFilePath(), { force: true });
  } catch { /* 目录不可写：保持现状 */ }
  return { ok: true, diagnostics: [] };
}

module.exports = {
  FAMILY,
  DEFAULTS,
  KEYS,
  policyFilePath,
  readStored,
  effective,
  effectiveSnapshot,
  compactionSettings,
  memorySettings,
  lifecycleSettings,
  writeStore,
  validatePatch,
  resetMemoryPolicy,
};
