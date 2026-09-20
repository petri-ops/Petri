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

const BUDGET_SCHEMA = 'gewu/startup-perf-budget.v2';

/**
 * v2 形态：`platforms: { win32: { medians, basis }, darwin: {...} }`。
 * 为什么按平台分档：启动各段绝对值强依赖机器与系统（本包实测 win32 与 Mac 不可比），
 * 用单套数字会让另一端「假红」或「假绿」——两端必须各自建基线。
 */
function resolvePlatformBudget(raw, platform, source = '<budget>') {
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: 预算必须是对象`);
  if (raw.schema !== BUDGET_SCHEMA) throw new Error(`${source}: schema 不符（期望 ${BUDGET_SCHEMA}）`);
  if (!raw.platforms || typeof raw.platforms !== 'object') throw new Error(`${source}: 缺 platforms 段`);
  const entry = raw.platforms[platform];
  if (!entry) {
    throw new Error(
      `${source}: 无 ${platform} 平台基线（不得跨平台套用数字）。` +
      ` 建法：在该机跑 npm run verify -- block101-startup-timeline 采 5 样本，` +
      ` 取各段中位数 ×1.10 写入 platforms.${platform}.medians，并在 basis 记 capturedAt/head/projectCount。`
    );
  }
  return parseBudget({ schema: BUDGET_SCHEMA, medians: entry.medians, basis: entry.basis }, `${source}(${platform})`);
}

function parseBudget(raw, source = '<budget>') {
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: 预算必须是对象`);
  if (raw.schema !== BUDGET_SCHEMA) throw new Error(`${source}: schema 不符（期望 ${BUDGET_SCHEMA}）`);
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

/** 棘轮方向核查（对某一平台的 medians 比较）：new 相对 old 不得放宽（缺段视为放宽）。 */
function assertBudgetNotWidened(oldMedians, newMedians, source = 'startup-perf-budget') {
  const a = parseBudget({ schema: BUDGET_SCHEMA, medians: oldMedians }, `${source}(旧)`);
  const b = parseBudget({ schema: BUDGET_SCHEMA, medians: newMedians }, `${source}(新)`);
  const widened = STAGES.filter((s) => b[s] > a[s]);
  if (widened.length) {
    const detail = widened.map((s) => `${s}: ${a[s]}→${b[s]}`).join(', ');
    throw new Error(`${source} 棘轮只许收缩，以下上限被放宽：${detail}`);
  }
  return { tightened: STAGES.filter((s) => b[s] < a[s]) };
}

module.exports = { STAGES, BUDGET_SCHEMA, resolvePlatformBudget, parseBudget, evaluateBudget, assertBudgetNotWidened };
