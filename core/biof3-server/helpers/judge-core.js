/**
 * helpers/judge-core.js — BLOCK-119 P0 输出评判门内核（canonical 单源，CJS）。
 *
 * 契约红线（plan docs/block-119-output-judge-harness-plan.md §1/§2）：
 *  - 多维一包：fit（score 0-4 五级契合度）必出；faithful（noul）仅当提供 reference 才出题与
 *    门控（无锚定泛判=fluency bias，只观测不门控）；goal_N 按目标清单逐条 noul。
 *  - 三态路由：任一门控维度 fail 区 → ESCALATE；任一 retry 区（无 fail）→ RETRY；否则 PASS；
 *    全部维度 observe-only → observe（不门控）。
 *  - 降级 fail-open：决策失败/低置信 → 放行（PASS + degraded 标注 + reason），永不 throw。
 *  - 门控值全部来自注册表（decision-thresholds 'output-judge'，per-model 解析）；缺键维度
 *    =observe-only——校准过才有门控，无证据不门控。
 *  - 单源纪律：scripts/lib/harness/judge-core.mjs 是本文件的 ESM 薄壳（校准/CLI 复用同形）。
 */
'use strict';

const decisionApi = require('./decision-api');
const { configForPoint } = require('./decision-thresholds');

/** fit 五级量表（score 题型 criteria，级号 0-4；answer.score=Σ级号×概率）。 */
const FIT_RUBRIC = [
  '0 完全答非所问：输出与请求的主题或意图无关',
  '1 主体偏移：仅少量内容对题，主体答了别的问题',
  '2 部分对题：对题但缺失请求的主要部分，或混入大量无关内容',
  '3 基本契合：对题且覆盖主要意图，存在明显但非致命的缺口或冗余',
  '4 完全契合：精确对题、覆盖请求全部意图、无编造无冗余',
];

/** 请求组装（单源：校准与运行时同形）。 */
function buildJudgeRequest({ output, request, reference = '', goals = [] }) {
  const state = [
    `【请求】${String(request).slice(0, 800)}`,
    reference ? `【参考材料（判忠实性的唯一依据）】${String(reference).slice(0, 1200)}` : '',
    `【待评输出】${String(output).slice(0, 1500)}`,
  ].filter(Boolean).join('\n\n');
  const questions = {
    fit: {
      type: 'score',
      criteria: FIT_RUBRIC,
      instructions: '评估【待评输出】对【请求】的契合度（0=完全答非所问 … 4=完全契合）。以请求明示的意图为准，不因文采加分。',
    },
  };
  if (reference) {
    questions.faithful = {
      type: 'noul',
      instructions: '【待评输出】中的事实性内容是否全部可由【请求】与【参考材料】支持（没有编造、没有无依据的具体数字/引用/声明）？不确定按否。',
    };
  }
  goals.forEach((goal, i) => {
    questions[`goal_${i}`] = {
      type: 'noul',
      instructions: `目标 ${i + 1} 是否已达成：「${String(goal).slice(0, 200)}」？以【待评输出】可核对的内容为准，宣称达成但无内容支撑按否。`,
    };
  });
  return { state, questions };
}

/** 解析每维度状态：pass/retry/fail/observe。gates 缺键=observe-only。 */
function parseDimensionStatuses(answers, gates) {
  const statuses = {};
  const fit = answers && answers.fit;
  if (fit && typeof fit.score === 'number') {
    const g = gates || {};
    if (typeof g.fitPass === 'number' && typeof g.fitRetry === 'number') {
      statuses.fit = { value: fit.score, status: fit.score >= g.fitPass ? 'pass' : fit.score >= g.fitRetry ? 'retry' : 'fail', gates: { pass: g.fitPass, retry: g.fitRetry } };
    } else {
      statuses.fit = { value: fit.score, status: 'observe', gates: null };
    }
  }
  const faithful = answers && answers.faithful;
  if (faithful && typeof faithful.noul === 'number') {
    const g = (gates && typeof gates.faithfulPass === 'number') ? gates.faithfulPass : null;
    statuses.faithful = g == null
      ? { value: faithful.noul, status: 'observe', gates: null }
      : { value: faithful.noul, status: faithful.noul >= g ? 'pass' : 'fail', gates: { pass: g } };
  }
  const goalStatuses = [];
  for (const key of Object.keys(answers || {})) {
    if (!key.startsWith('goal_')) continue;
    const a = answers[key];
    if (!a || typeof a.noul !== 'number') continue;
    const g = (gates && typeof gates.goalPass === 'number') ? gates.goalPass : null;
    goalStatuses.push({
      goalIndex: Number(key.slice(5)),
      value: a.noul,
      status: g == null ? 'observe' : (a.noul >= g ? 'pass' : 'fail'),
      gates: g == null ? null : { pass: g },
    });
  }
  if (goalStatuses.length) statuses.goals = goalStatuses;
  return statuses;
}

/** 三态聚合：fail>retry>pass；全部 observe=observe（不门控）。 */
function aggregateVerdict(statuses) {
  const all = Object.values(statuses)
    .flatMap((s) => (Array.isArray(s) ? s : [s]))
    .filter((s) => s && s.status && s.status !== 'observe');
  if (all.length === 0) return 'observe';
  if (all.some((s) => s.status === 'fail')) return 'ESCALATE';
  if (all.some((s) => s.status === 'retry')) return 'RETRY';
  return 'PASS';
}

/** RETRY/ESCALATE 提示词材料：未过维度的判词（供带判词重写）。 */
function retryHints(statuses, goals = []) {
  const hints = [];
  if (statuses.fit && statuses.fit.status !== 'pass' && statuses.fit.status !== 'observe') {
    hints.push(`契合度不足（fit=${statuses.fit.value}，需 ≥${statuses.fit.gates ? statuses.fit.gates.pass : '?'}）：请紧扣请求的原始意图重新作答，只覆盖请求所问。`);
  }
  if (statuses.faithful && statuses.faithful.status === 'fail') {
    hints.push(`存在无依据内容（faithful=${statuses.faithful.value}）：请只使用请求与参考材料可支持的内容，移除任何编造的具体数字、引用或声明。`);
  }
  for (const g of (statuses.goals || [])) {
    if (g.status !== 'fail') continue;
    const label = goals[g.goalIndex] != null ? String(goals[g.goalIndex]).slice(0, 80) : `目标 ${g.goalIndex + 1}`;
    hints.push(`目标未达成：「${label}」——请补齐该目标的实质内容（宣称达成必须有可核对的输出支撑）。`);
  }
  return hints;
}

/**
 * 评判门主入口。永不 throw；降级=fail-open 放行。
 * @param {object} args { output, request, reference?, goals?, overrides?, metaPoint? }
 * @returns {verdict: 'PASS'|'RETRY'|'ESCALATE'|'observe', degraded, reason, model, statuses, hints}
 */
async function judgeOutput({ output, request, reference = '', goals = [], overrides = {}, metaPoint = 'output-judge' }) {
  const { state, questions } = buildJudgeRequest({ output, request, reference, goals });
  const gatesConfig = configForPoint('output-judge', null);
  const gates = (gatesConfig && gatesConfig.gates) || {};
  const outcome = await decisionApi.askDecision({
    state,
    questions,
    overrides,
    meta: { point: metaPoint, threshold: typeof gates.fitPass === 'number' ? gates.fitPass : null },
  });
  if (!outcome.ok) {
    return { verdict: 'PASS', degraded: true, reason: outcome.reason, model: null, statuses: {}, hints: [], note: '评判降级=fail-open 放行' };
  }
  const statuses = parseDimensionStatuses(outcome.answers, gates);
  const verdict = aggregateVerdict(statuses);
  return {
    verdict,
    degraded: false,
    reason: null,
    model: outcome.model,
    statuses,
    hints: verdict === 'RETRY' || verdict === 'ESCALATE' ? retryHints(statuses, goals) : [],
  };
}

module.exports = {
  FIT_RUBRIC,
  buildJudgeRequest,
  parseDimensionStatuses,
  aggregateVerdict,
  retryHints,
  judgeOutput,
};
