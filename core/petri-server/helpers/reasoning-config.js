'use strict';

/**
 * helpers/reasoning-config.js — 推理档位配置面（BLOCK-200 P2）。
 *
 * 把此前硬编码在 `core/shared-backend/llm-providers/thinking-level.js:38/41/44/73-85`
 * 的三件事变成注册表声明 + 设置页可编辑：默认档位、Anthropic high 档预算、逐协议档位映射。
 *
 * 三条纪律：
 *  1. **形状问 shared-config 注册表**（族 `reasoning`），**协议合法集问 reasoning-defaults**
 *     （`allowedTokens(protocol)`）——注册表只能表达"串的形状"，跨协议错配（给 openai 配
 *     `thinking:enabled`）必须在这里拒，否则写进去就是一个上游 400。
 *  2. **映射数值不复制**：默认表在 `reasoning-defaults.js` 一处，本模块只做"文件覆盖 ⊕ 默认"。
 *  3. **写盘经 `ai-settings.saveReasoningSection`**（同文件只有一个写入者），校验不过一律
 *     `config_value_rejected` + 结构化 diagnostics（路由映射 400），不静默丢键。
 */

const {
  findKeyEntry,
  findEntryByPath,
  validateValue,
  commitGuard,
} = require('../../packages/shared-config/config-schema.js');
const {
  THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  ANTHROPIC_HIGH_BUDGET_TOKENS,
  DEFAULT_MAPPING,
  mergeMapping,
  isKnownProtocol,
  allowedTokens,
  isAllowedToken,
} = require('../../packages/shared-config/reasoning-defaults.js');
const thinkingLevel = require('../../shared-backend/llm-providers/thinking-level.js');
const aiSettings = require('./ai-settings.js');

const FAMILY = 'reasoning';
const SCALAR_KEYS = ['defaultLevel', 'anthropicHighBudgetTokens'];

function lookup(family, storagePath) {
  return findEntryByPath(family, storagePath);
}

function storedReasoning() {
  const settings = aiSettings.getAiSettings() || {};
  const section = settings && typeof settings.reasoning === 'object' && settings.reasoning ? settings.reasoning : {};
  return section;
}

/** 生效值 = 文件覆盖（仅取合法项）⊕ 出厂默认。非法项回落默认并由调用侧诊断报出。 */
function effectiveReasoning() {
  const section = storedReasoning();
  const defaultLevel = THINKING_LEVELS.includes(section.defaultLevel) ? section.defaultLevel : DEFAULT_THINKING_LEVEL;
  const budget = Number.isFinite(section.anthropicHighBudgetTokens) && section.anthropicHighBudgetTokens >= 1024
    ? Math.floor(section.anthropicHighBudgetTokens)
    : ANTHROPIC_HIGH_BUDGET_TOKENS;
  return { defaultLevel, anthropicHighBudgetTokens: budget, mapping: mergeMapping(section.mapping) };
}

/**
 * 读并把覆盖层注入映射点（依赖反转：下层不反向 require 上层，沿用
 * `core/packages/shared-copilot/api-inject.ts` 的先例）。gateway 侧不需要知道设置面存在。
 */
function getReasoningRuntime() {
  const runtime = effectiveReasoning();
  thinkingLevel.applyThinkingOverrides({
    defaultLevel: runtime.defaultLevel,
    anthropicHighBudgetTokens: runtime.anthropicHighBudgetTokens,
    mapping: runtime.mapping,
  });
  return runtime;
}

/** 设置面投影：生效值 + 出厂值 + 每协议允许令牌（UI 据此只能选合法项，不猜参数名）。 */
function getReasoningSnapshot() {
  const effective = getReasoningRuntime();
  const protocols = {};
  for (const protocol of Object.keys(DEFAULT_MAPPING)) {
    protocols[protocol] = {
      allowed: allowedTokens(protocol).slice(),
      tiers: Object.fromEntries(THINKING_LEVELS.map((tier) => [tier, {
        effective: effective.mapping[protocol][tier],
        default: DEFAULT_MAPPING[protocol][tier],
      }])),
    };
  }
  return {
    levels: THINKING_LEVELS.slice(),
    effective: {
      defaultLevel: effective.defaultLevel,
      anthropicHighBudgetTokens: effective.anthropicHighBudgetTokens,
    },
    factory: {
      defaultLevel: DEFAULT_THINKING_LEVEL,
      anthropicHighBudgetTokens: ANTHROPIC_HIGH_BUDGET_TOKENS,
    },
    protocols,
  };
}

/** 把 `{protocol:{tier:token}}` 摊成注册表存储路径；null 值保留（=清该项回默认）。 */
function flattenMappingPatch(mapping) {
  const flat = {};
  for (const [protocol, tiers] of Object.entries(mapping || {})) {
    if (!tiers || typeof tiers !== 'object') continue;
    for (const [tier, token] of Object.entries(tiers)) {
      flat[`mapping.${protocol}.${tier}`] = token;
    }
  }
  return flat;
}

/** 协议合法集校验（注册表形状之外的第二道：跨协议错配）。 */
function guardProtocolTokens(patch) {
  const diagnostics = [];
  for (const [path, value] of Object.entries(patch)) {
    if (!path.startsWith('mapping.')) continue;
    if (value === null) continue;
    const [, protocol, tier] = path.split('.');
    if (!isKnownProtocol(protocol)) {
      diagnostics.push({ code: 'unknown-key', family: FAMILY, path, message: `未知协议 ${protocol}（映射表里没有的协议不发参，配它无意义）` });
      continue;
    }
    if (!THINKING_LEVELS.includes(tier)) {
      diagnostics.push({ code: 'not-allowed', family: FAMILY, path, message: `未知档位 ${tier}（只认 ${THINKING_LEVELS.join('/')}）` });
      continue;
    }
    if (!isAllowedToken(protocol, value)) {
      diagnostics.push({ code: 'not-allowed', family: FAMILY, path, message: `${protocol} 不接受 ${value}（允许 ${allowedTokens(protocol).join('/')}）` });
    }
  }
  return diagnostics;
}

/**
 * 写侧：接受 `{ defaultLevel?, anthropicHighBudgetTokens?, mapping?: {protocol:{tier:token|null}} }`。
 * 任一校验不过 → 抛 `config_value_rejected`（带 diagnostics），**整批不落盘**。
 */
function saveReasoning(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const err = new Error('config_value_rejected');
    err.code = 'config_value_rejected';
    err.diagnostics = [{ code: 'type-mismatch', family: FAMILY, path: '', message: '写入补丁必须是对象' }];
    throw err;
  }
  // 顶层键**全量交给注册表判**（不是只挑已知键）：只挑已知键就等于把未知键静默丢掉，
  // 那正是 BLOCK-199 立项要消灭的行为。`mapping` 是容器，摊成逐协议/逐档位路径后再判。
  const flat = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'mapping') {
      if (value && (typeof value !== 'object' || Array.isArray(value))) {
        flat['mapping'] = value; // 容器形状不对，交给注册表按未知键拒（不猜意图）
        continue;
      }
      Object.assign(flat, flattenMappingPatch(value));
      continue;
    }
    flat[key] = value;
  }

  const guard = commitGuard(FAMILY, flat, lookup);
  const diagnostics = [...guard.diagnostics, ...guardProtocolTokens(flat)];
  if (diagnostics.length > 0) {
    const err = new Error('config_value_rejected');
    err.code = 'config_value_rejected';
    err.diagnostics = diagnostics;
    throw err;
  }

  const section = { ...storedReasoning() };
  for (const key of SCALAR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(flat, key)) continue;
    if (flat[key] === null) delete section[key];
    else section[key] = guard.normalized[key];
  }
  if (Object.keys(patch.mapping || {}).length > 0) {
    const mapping = { ...(section.mapping && typeof section.mapping === 'object' ? section.mapping : {}) };
    for (const [path, value] of Object.entries(flattenMappingPatch(patch.mapping))) {
      const [, protocol, tier] = path.split('.');
      mapping[protocol] = { ...(mapping[protocol] || {}) };
      if (value === null) delete mapping[protocol][tier];
      else mapping[protocol][tier] = value;
    }
    section.mapping = mapping;
  }
  aiSettings.saveReasoningSection(section);
  return getReasoningSnapshot();
}

/** 供 `config:doctor` 用：盘上已有但形状/合法集不过的项（读侧只报告不拒）。 */
function diagnoseStoredReasoning() {
  const section = storedReasoning();
  const diagnostics = [];
  const levelEntry = findKeyEntry('reasoning.defaultLevel');
  if (section.defaultLevel !== undefined) {
    const check = validateValue(levelEntry, section.defaultLevel);
    if (!check.ok) diagnostics.push({ code: check.code, family: FAMILY, path: 'defaultLevel', message: check.message });
  }
  const budgetEntry = findKeyEntry('reasoning.anthropicHighBudgetTokens');
  if (section.anthropicHighBudgetTokens !== undefined) {
    const check = validateValue(budgetEntry, section.anthropicHighBudgetTokens);
    if (!check.ok) diagnostics.push({ code: check.code, family: FAMILY, path: 'anthropicHighBudgetTokens', message: check.message });
  }
  diagnostics.push(...guardProtocolTokens(flattenMappingPatch(section.mapping)));
  return diagnostics;
}

module.exports = {
  FAMILY,
  getReasoningRuntime,
  getReasoningSnapshot,
  saveReasoning,
  diagnoseStoredReasoning,
  effectiveReasoning,
};
