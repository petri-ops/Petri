'use strict';
/**
 * scripts/lib/evals-judge.mjs — BLOCK-194 LLM-as-judge real 模式（评测 v2 第六切片）。
 *
 * 骨架决定（P0 实码勘察）：**本包不新建 judge**。出题、算分、三态路由、邻域 k=3 中位数复核、
 * fail-open 降级全在 BLOCK-119 的 canonical 单源 `core/petri-server/helpers/judge-core.js`
 * （ESM 薄壳 ./harness/judge-core.mjs）；门控阈值与校准证据留在 decision-thresholds 的
 * 'output-judge' 注册表里（本层不复制键名不复制数值，改键必先重校准是既有红线）。
 * 本模块只补评测侧缺的三件事：
 *   ①把一次真模型运行的答卷**投影成一条质量读数**（judge 依赖注入，正文只存活内存）；
 *   ②读数的 **fail-closed 门**——judge-core 的 fail-open 语义（调用失败→PASS+degraded）
 *     是给运行时「宁可不拦」用的，评测侧照搬就变成**没测到也算过**，故 degraded/observe
 *     在本层一律不绿；
 *   ③读数棘轮：只比 verdict **不比 fit 数值**——被评判的正文每次真模型生成都不同，
 *     拿分数差判红必然假红（单次读数内的抖动已由 judge-core 邻域复核消化）。
 * 纯函数 + 零网络（judge 由调用方注入；默认实现=供给单源装载的 judge-supply）。
 */
import { makeSuppliedJudge } from './harness/judge-supply.mjs';

const defaultJudge = makeSuppliedJudge();

/** 读数的非绿原因清单（fail-closed：新出现的 verdict 取值一律落红，不静默放行）。 */
const GREEN_VERDICTS = new Set(['PASS']);
/** 质量严重度序（棘轮用）：PASS < RETRY < ESCALATE；越往后越差。 */
export const VERDICT_RANK = { PASS: 0, RETRY: 1, ESCALATE: 2 };

/**
 * 读数门**拆成两层**（实机证据逼出来的语义，见 plan §0.1）：
 *  · `invalid`＝测量本身不成立（降级/未测量/无门控读数/零读数/未知取值）→ 必须红；
 *  · `gaps`＝测到了、但判词落在非达标区（RETRY/ESCALATE）→ **如实记录为质量缺口**，
 *    由棘轮守住不得后退（VERDICT_RANK），而不是把命令变成永久红。
 * 理由：一条结构性红的命令会让"红"失去可执行含义（破窗门），而质量缺口本身是要被追踪的
 * **发现**，不是工具故障。两层都不静默：gaps 在 stdout 逐条 ✖，并写进报告 judge.gaps。
 */
export function judgeGate(readings) {
  const list = Array.isArray(readings) ? readings : [];
  const invalid = [];
  const gaps = [];
  if (list.length === 0) {
    invalid.push({ id: '(suite)', why: '无任何质量读数（fail-closed：--judge 未产读数不得算绿）' });
    return { ok: false, invalid, gaps };
  }
  for (const r of list) {
    const id = (r && r.id) || '(unknown)';
    if (!r || r.measured !== true || r.degraded === true) {
      invalid.push({ id, why: `judge 降级=未测量（${(r && r.reason) || 'degraded'}）` });
      continue;
    }
    if (r.verdict === 'observe') {
      invalid.push({ id, why: '全部维度 observe-only=无门控读数，不构成质量证据' });
      continue;
    }
    if (GREEN_VERDICTS.has(r.verdict)) continue;
    if (r.verdict === 'RETRY' || r.verdict === 'ESCALATE') {
      gaps.push({ id, verdict: r.verdict, fit: r.fit ?? null, fitStatus: r.fitStatus ?? null, hintsCount: r.hintsCount ?? 0 });
      continue;
    }
    invalid.push({ id, why: `未知 verdict 取值「${String(r.verdict)}」（fail-closed 红）` });
  }
  return { ok: invalid.length === 0, invalid, gaps };
}

/**
 * 质量读数采集。`judge` 注入以便契约测离线跑；默认=BLOCK-119 评判门（经 judge-supply 单源装载供给）。
 * 返回**不含任何正文**的读数：判词提示语(hints)只计数不入库，被评文本只短暂存活于内存。
 */
export async function collectJudgeReading({ task, finalText, judge = defaultJudge }) {
  const t = task || {};
  const cfg = t.judge && typeof t.judge === 'object' ? t.judge : {};
  const output = String(finalText ?? '');
  const base = { id: String(t.id || ''), measured: true, degraded: false, verdict: null, fit: null, fitStatus: null, fitReplay: null, faithful: null, goals: [], hintsCount: 0, model: null, reason: null };
  if (!output.trim()) {
    return { ...base, measured: false, verdict: 'not_measured', reason: '答卷正文为空（不编造读数，judge 未调用）' };
  }
  let v = null;
  try {
    v = await judge({
      output,
      request: String(cfg.request ?? t.prompt ?? ''),
      reference: String(cfg.reference ?? ''),
      goals: Array.isArray(cfg.goals) ? cfg.goals : [],
    });
  } catch (err) {
    return { ...base, measured: false, verdict: 'judge_exception', reason: `judge 调用抛错：${String((err && err.message) || err).slice(0, 80)}` };
  }
  const st = (v && v.statuses) || {};
  const replay = st.fit && st.fit.replay;
  return {
    id: String(t.id || ''),
    measured: true,
    degraded: v ? v.degraded === true : true,
    verdict: v ? v.verdict : 'judge_no_response',
    reason: v ? (v.reason || (v.note ?? null) || null) : null,
    model: v ? (v.model || null) : null,
    fit: st.fit ? st.fit.value : null,
    fitStatus: st.fit ? st.fit.status : null,
    fitGates: st.fit && st.fit.gates ? st.fit.gates : null,
    fitReplay: replay ? { k: replay.k ?? null, median: replay.median ?? null, replayErrors: replay.replayErrors ?? null } : null,
    faithful: st.faithful ? { value: st.faithful.value, status: st.faithful.status } : null,
    goals: Array.isArray(st.goals) ? st.goals.map((g) => ({ index: g.goalIndex, value: g.value, status: g.status })) : [],
    hintsCount: Array.isArray(v && v.hints) ? v.hints.length : 0,
  };
}

/**
 * 读数棘轮（纯函数）：按 VERDICT_RANK 守「不得后退」，非达标基线同样有下界。
 *  · 本次比基线更差（PASS→RETRY/ESCALATE，或 RETRY→ESCALATE）=回归；
 *  · 基线在册而本次降级/无读数=回归（有效性优先，不得继承绿）；
 *  · 转绿或转好=改善；新任务不判红；**不比 fit 数值**（见文件头③，防真模型抖动假红）。
 */
export function compareJudgeVsBaseline(runReadings, baseline) {
  const run = new Map((runReadings || []).map((r) => [r.id, r]));
  const base = new Map(((baseline && baseline.readings) || []).map((r) => [r.id, r]));
  const regressions = [];
  const improvements = [];
  const newTasks = [];
  const severity = (r) => (!r || r.measured !== true || r.degraded === true ? Infinity : (VERDICT_RANK[r.verdict] ?? Infinity));
  const label = (r) => (!r || r.measured !== true || r.degraded === true ? 'invalid' : String(r.verdict));
  for (const [id, r] of run) {
    const b = base.get(id);
    if (!b) { newTasks.push(id); continue; }
    const was = severity(b);
    const now = severity(r);
    if (now > was) regressions.push(`${id}:judge_verdict ${label(b)}→${label(r)}`);
    else if (now < was) improvements.push(`${id}:judge_verdict ${label(b)}→${label(r)}`);
  }
  for (const [id] of base) {
    if (!run.has(id)) regressions.push(`${id}:judge_reading_missing`);
  }
  return { ok: regressions.length === 0, regressions, improvements, newTasks };
}

/** 判读层边界：只有真模型答卷有质量可言；脚本回合与罐头回放的读数=伪读数。 */
export function assertJudgeTier({ provider, judgeEnabled }) {
  if (!judgeEnabled) return { ok: true, reason: null };
  if (provider === 'real') return { ok: true, reason: null };
  return { ok: false, reason: `--judge 仅对 --provider=real 开放（当前 provider=${provider}：对脚本化回合/罐头回放做质量判读=伪读数，且毁掉回放层零 API 属性）` };
}

/** 基线提升载荷（写盘由调用方在显式审计 flag 下执行）。 */
export function buildJudgeBaseline({ suite, readings }) {
  const models = [...new Set((readings || []).map((r) => r && r.model).filter(Boolean))];
  return {
    suite: String(suite || ''),
    judgeModel: models.length === 1 ? models[0] : models,
    updatedAt: new Date().toISOString(),
    note: '只 gate verdict；fit 为趋势观测值（被评正文每次真模型生成都不同，分数差判红必假红）',
    readings: (readings || []).map((r) => ({ ...r })),
  };
}
