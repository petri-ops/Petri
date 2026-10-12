'use strict';

/**
 * helpers/cost-cap.js — 任务级成本硬熔断（BLOCK-176 CP-18）。
 *
 * 语义：ai-settings.json `costCapCny`（任务累计成本上限，¥，env
 * PETRI_TASK_COST_CAP_CNY 覆盖优先）配置后，agent loop 每轮收尾查询该任务
 * 在 ai_usage 的累计成本；累计 ≥ 上限 → { exceeded: true }，loop 走既有
 * finalization 停机（「成本预算已用尽」诚实收尾叙事，不虚报完成）。
 * - 上限未配置 = 不熔断（现状零行为变化）；
 * - 金额为估算口径（AI_PRICING，cost_status=partial 语境）；
 * - 查询/解析失败 fail-open（不因观测面故障停任务）。
 */

function sanitizeCostCapCny(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** 从 ai-settings 对象提取 costCapCny（env 覆盖优先）。 */
function resolveCostCapCny(settings, env) {
  const envRaw = env && env.PETRI_TASK_COST_CAP_CNY;
  const envCap = sanitizeCostCapCny(envRaw);
  if (envCap != null) return envCap;
  return settings && typeof settings === 'object' ? sanitizeCostCapCny(settings.costCapCny) : null;
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
