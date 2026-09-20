'use strict';
/**
 * scripts/lib/startup-perf-budget.cjs — BLOCK-106 P0 启动性能预算门禁（纯函数，可单测）
 *
 * 存在理由：BLOCK-101 建了 timeline 仪表但无阈值断言，12 天里六段齐涨无人报红；
 * 门禁化必须是可离线验证的纯函数（不依赖 Electron/CDP），否则「门禁是否空转」不可证明。
 * 棘轮语义：预算只许收缩；任何段的上限被调大即 assertBudgetNotWidened 抛错。
 */
const STAGES = [
  'mainReady',
  'preload',
  'domContentLoaded',
  'firstPaint',
  'windowShown',
  'didFinishLoad',
  'dataReady',
];

function parseBudget(raw, source = '<budget>') {
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: 预算必须是对象`);
  if (raw.schema !== 'gewu/startup-perf-budget.v1') throw new Error(`${source}: schema 不符（期望 gewu/startup-perf-budget.v1）`);
  const medians = raw.medians;
  if (!medians || typeof medians !== 'object') throw new Error(`${source}: 缺 medians 段`);
  for (const stage of STAGES) {
    const v = medians[stage];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`${source}: medians.${stage} 必须是正数毫秒上限（实得 ${JSON.stringify(v)}）`);
    }
  }
  const unknown = Object.keys(medians).filter((k) => !STAGES.includes(k));
  if (unknown.length) throw new Error(`${source}: medians 含未知段 ${unknown.join(', ')}`);
  return medians;
}

/**
 * 用采样摘要对账预算。summary 段形态 = { median, min, max, n } | null。
 * 缺失段算违反：门禁不接受「这一项没采到」当作通过。
 */
function evaluateBudget(summary, medians) {
  const violations = [];
  const checked = [];
  for (const stage of STAGES) {
    const ceiling = medians[stage];
    const stat = summary && summary[stage];
    const median = stat && typeof stat.median === 'number' ? stat.median : null;
    if (median === null) {
      violations.push({ stage, reason: 'measured_missing', ceilingMs: ceiling });
      continue;
    }
    checked.push({ stage, medianMs: median, ceilingMs: ceiling, headroomMs: Math.round(ceiling - median) });
    if (median > ceiling) {
      violations.push({
        stage,
        reason: 'median_over_budget',
        medianMs: median,
        ceilingMs: ceiling,
        overPct: Math.round(((median - ceiling) / ceiling) * 1000) / 10,
      });
    }
  }
  return { pass: violations.length === 0, checked, violations };
}

/** 棘轮方向核查：new 相对 old 不得放宽（缺段视为放宽）。 */
function assertBudgetNotWidened(oldRaw, newRaw, source = 'startup-perf-budget') {
  const oldM = parseBudget(oldRaw, `${source}(旧)`);
  const newM = parseBudget(newRaw, `${source}(新)`);
  const widened = STAGES.filter((s) => newM[s] > oldM[s]);
  if (widened.length) {
    const detail = widened.map((s) => `${s}: ${oldM[s]}→${newM[s]}`).join(', ');
    throw new Error(`${source} 棘轮只许收缩，以下上限被放宽：${detail}`);
  }
  return { tightened: STAGES.filter((s) => newM[s] < oldM[s]) };
}

module.exports = { STAGES, parseBudget, evaluateBudget, assertBudgetNotWidened };
