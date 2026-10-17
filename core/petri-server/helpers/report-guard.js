/**
 * helpers/report-guard.js — BLOCK-119 P2 子智能体汇报门（单点试点；默认关，fail-open）。
 *
 * 契约（plan docs/block-119-output-judge-harness-plan.md §P2）：
 *  - 默认关 + 显式开（D-4 先例）：PETRI_JEV_REPORT_GUARD=1 才生效；关闭=零出站零行为变化。
 *  - 挂点：runAgentLoop 结果的 assistantText 终态后、落库/child_finished 投递前（子侧汇报
 *    收敛面，UI-433 纪律的语义残差由本门承载）。
 *  - 三态：PASS=透传；RETRY=带判词单次重写（同 provider/model 单发 callChatProvider，
 *    重写后复判一次供试点观测，不二次重写）；ESCALATE/其他=原样透传+标注（父级与用户
 *    即升级面，不硬阻塞）。
 *  - fail-open：任何异常原样透传；决策降级（缺 key/网络/校验失败）=放行+标注。
 *  - 观测：决策落 decision_log（metaPoint=report-guard，区别于 dev 侧 output-judge），
 *    试点指标（采纳率/误拦率/延迟增量）经台账汇总；加映 4 起 meta 增 fitReplay（fit 阈值
 *    邻域重放观测：triggered/k/fits/median/band/replayErrors）。
 */
'use strict';

const judgeCore = require('./judge-core');
const decisionConfig = require('./decision-config');

function isReportGuardEnabled() {
  // BLOCK-199 P4② — 启用判定接配置中心（env 仍最高优先、默认关语义一字未改）：
  // 原状只认 PETRI_JEV_REPORT_GUARD=1 ⇒ 设置页看不见也关不掉；现纳入 RUNTIME_POINTS。
  if (process.env.PETRI_JEV_REPORT_GUARD === '0') return false;
  try {
    const runtime = decisionConfig.getPointRuntime('report-guard');
    if (runtime) return runtime.enabled === true;
  } catch { /* 配置面故障回退 env 判定（与门本身 fail-open 同向） */ }
  return process.env.PETRI_JEV_REPORT_GUARD === '1';
}

/**
 * 对 runAgentLoop 结果应用汇报门（原地可变：成功重写时改写 assistantText 并挂 meta）。
 * @param {object} loopResult runLoop 返回对象（含 assistantText）
 * @param {object} args { enabled, request, callProvider(body)=>result, modelName, onEvent, decisionOverrides?,
 *   goals?: string[]（spawn 声明的可核对目标——逐目标完备性门控，fail 进判词）,
 *   steeringLines?: string[]（运行中注入的显式指令行——重写时必须逐字保留，BLOCK-119 加映 3 修🟡缺口） }
 */
async function applyToLoopResult(loopResult, { enabled, request, callProvider, modelName, onEvent, decisionOverrides, goals = [], steeringLines = [] } = {}) {
  if (!loopResult || !enabled || !isReportGuardEnabled()) return loopResult;
  const output = loopResult.assistantText;
  if (!output || !String(output).trim()) return loopResult;
  try {
    const startedAt = Date.now();
    const judged = await judgeCore.judgeOutput({
      output: String(output),
      request: String(request || ''),
      goals: Array.isArray(goals) ? goals : [],
      overrides: decisionOverrides || {},
      metaPoint: 'report-guard',
    });
    const goalFails = (judged.statuses.goals || []).filter((g) => g.status === 'fail').length;
    const fitReplay = judged.statuses && judged.statuses.fit ? (judged.statuses.fit.replay || null) : null;
    const meta = {
      verdict: judged.verdict,
      degraded: judged.degraded === true,
      reason: judged.reason || null,
      fit: judged.statuses && judged.statuses.fit ? judged.statuses.fit.value : null,
      goalFails,
      fitReplay,
      model: judged.model || null,
      latencyMs: Date.now() - startedAt,
      rewritten: false,
      verdictAfter: null,
      fitAfter: null,
    };
    if (judged.verdict === 'RETRY' && typeof callProvider === 'function') {
      const steering = Array.isArray(steeringLines) ? steeringLines.filter(Boolean) : [];
      const rewritePrompt = [
        '你之前为子任务写的汇报未通过对题性检查，请重写。',
        '',
        '【原始任务】',
        String(request || '').slice(0, 800),
        '',
        '【你之前的汇报】',
        String(output).slice(0, 1500),
        '',
        '【检查判词（逐条修正）】',
        ...(judged.hints.length ? judged.hints.map((h) => '- ' + h) : ['- 契合度不足：只覆盖任务所问。']),
        ...(steering.length ? [
          '',
          '【运行中收到的显式指令（必须逐字保留在重写后的汇报中，不得删除或改写）】',
          ...steering.map((l) => '- ' + String(l).slice(0, 300)),
        ] : []),
        '',
        '重写要求：要点式（≤10 条、每条一句话），只回传所辖部分的事实、数据、结论；不要寒暄、不要背景铺垫、不要复述任务全文。直接输出新汇报正文。',
      ].join('\n');
      const result = await callProvider({ model: modelName, messages: [{ role: 'user', content: rewritePrompt }] });
      const message = result && result.choices && result.choices[0] && result.choices[0].message;
      const rewritten = message && typeof message.content === 'string' ? message.content.trim() : '';
      if (rewritten) {
        loopResult.assistantText = rewritten;
        meta.rewritten = true;
        const rejudged = await judgeCore.judgeOutput({
          output: rewritten,
          request: String(request || ''),
          goals: Array.isArray(goals) ? goals : [],
          overrides: decisionOverrides || {},
          metaPoint: 'report-guard',
        });
        meta.verdictAfter = rejudged.verdict;
        meta.fitAfter = rejudged.statuses && rejudged.statuses.fit ? rejudged.statuses.fit.value : null;
      }
    }
    loopResult.reportGuardMeta = meta;
    if (typeof onEvent === 'function') {
      try { onEvent({ event: 'report_guard', ...meta }); } catch { /* 观测事件失败不影响结果 */ }
    }
    return loopResult;
  } catch {
    return loopResult; // fail-open：任何异常原样透传
  }
}

module.exports = { isReportGuardEnabled, applyToLoopResult };
