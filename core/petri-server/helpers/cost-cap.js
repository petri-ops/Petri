'use strict';

/**
 * helpers/cost-cap.js — 任务级成本上限（BLOCK-176 CP-18）。
 *
 * 语义：ai-settings.json `costCapCny`（任务累计成本上限，¥，env
 * PETRI_TASK_COST_CAP_CNY 覆盖优先）配置后，agent loop 每轮收尾查询该任务
 * 在 ai_usage 的累计成本；累计 ≥ 上限 → { exceeded: true }，loop 走既有
 * finalization 停机（「成本预算已用尽」诚实收尾叙事，不虚报完成）。
 * - 上限未配置 = 不熔断（现状零行为变化）；
 * - 金额为估算口径（AI_PRICING，cost_status=partial 语境）；
 * - 查询/解析失败 fail-open（不因观测面故障停任务）。
 * - **BLOCK-199 P0 措辞更正**：超限后的收尾是"发事件 + 注入停止指令的 system 提示"，
 *   loop 内没有强制 break/return（见 loop-orchestrator.js:685-698）——原标题「硬熔断」
 *   名不副实，真硬中止已登记为候选（plan docs/block-199-config-schema-service-plan.md §0.2）。
 */

// BLOCK-199 P2 — 形状与优先级接配置 schema 单源（金额数值语义不变：>0、两位小数）。
const { findKeyEntry, validateValue, resolve: resolveConfigLayers } = require('../../packages/shared-config/config-schema.js');

const CAP_ENTRY = findKeyEntry('cost.capCny');
const CAP_FAMILY = 'cost-cap';

function sanitizeCostCapCny(raw) {
  const check = validateValue(CAP_ENTRY, raw);
  return check.ok ? check.normalized : null;
}

/** 从 ai-settings 对象提取 costCapCny（env 覆盖优先——胜负关系由 schema 的 cost-cap 族声明）。 */
function resolveCostCapCny(settings, env) {
  const picked = resolveConfigLayers(CAP_FAMILY, {
    env: sanitizeCostCapCny(env && env.PETRI_TASK_COST_CAP_CNY),
    file: sanitizeCostCapCny(settings && typeof settings === 'object' ? settings.costCapCny : null),
  });
  return picked.value;
}

/**
 * 判定任务是否超成本上限（纯函数）。
 * @returns {{ exceeded: boolean, spentCny: number, capCny: number|null }}
 */
function isCostCapExceeded({ capCny, spentCny }) {
  const cap = Number(capCny) || 0;
  const spent = Number(spentCny) || 0;
  return { exceeded: cap > 0 && spent >= cap, spentCny: spent, capCny: cap };
}

module.exports = { sanitizeCostCapCny, resolveCostCapCny, isCostCapExceeded };
