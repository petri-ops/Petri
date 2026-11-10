#!/usr/bin/env node
/**
 * K0 三条被推翻判据的「作废记录 / 重立判据」纯函数（可篡改负测）。
 *
 * 旧判据（作废，禁止再作为优化依据）：
 *   K-01「会话列表全量 DOM」→ 服务端 ai-conversations.js:71 LIMIT 100 已证伪。
 *        重立判据 = 「服务端会话列表截断」：convRowMatches 自 100 会话起 plateau。
 *   K-02「content-visibility 改 DOM 节点数」→ cv A/B 0.7ms vs 0.7ms 无收益、已回滚。
 *        重立判据 = 「强制布局耗时中位数 B < A×0.9 才落 CSS」，且探针不写产品源码。
 *   K-03「热栈 5 轮 = 冷启动 ×5」→ 冷启动 x5 独立证据 stageCoverage.cdpPageReady=0。
 *        重立判据 = 冷热分开命名/取数；专项脚本带「有活栈才断言」且不进常驻链。
 *
 * 本模块不读盘、不联网、不写盘：输入证据对象，输出裁决，便于负测注入篡改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CRITERIA_IDS = Object.freeze(['K-01', 'K-02', 'K-03']);

export const VOIDED_CRITERIA = Object.freeze({
  'K-01': '会话列表全量 DOM（前端渲染 O(n)）',
  'K-02': 'content-visibility 降低 DOM 节点数即优化',
  'K-03': '热栈连续 5 轮可达性 = 冷启动 ×5',
});

export const RESTATED_CRITERIA = Object.freeze({
  'K-01': '服务端会话列表 LIMIT 100 截断 → 先决定分页/游标/上限提示的产品语义，再谈渲染',
  'K-02': '强制布局耗时中位数 B < A×0.9 才落 CSS；无收益回滚且不改产品源码',
  'K-03': '冷启动 ×5 与热栈 5 轮分开命名分开取数；依赖活栈的门带「有栈才断言」显式条件',
});

/** 从仓库内既有证据读取三条判据的原始事实（只读）。 */
export function readCriteriaEvidence(root = ROOT) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  const dom = read('acceptance/post-s7-2026-11-10/h8/dom-budget-live.json');
  const cv = read('acceptance/post-s7-2026-11-10/h9/cv-ab.json');
  const hot = read('acceptance/post-s7-2026-11-10/h8/startup-five-stage.json');
  const cold = fs.existsSync(path.join(root, 'acceptance/post-s7-2026-11-10/h10/cold-start-x5.json'))
    ? read('acceptance/post-s7-2026-11-10/h10/cold-start-x5.json') : null;
  const conversationsSource = fs.readFileSync(path.join(root, 'core/petri-server/routes/ai-conversations.js'), 'utf8');
  const closeoutScript = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.closeout;
  const byLabel = Object.fromEntries(dom.samples.map((s) => [s.label, s]));
  // 会话列表 handler 段内没有 limit/offset/cursor 参数；
  // 消息路由 :127 的 req.query.limit 是另一条路由，不能用来判定会话列表。
  // K-01 判据语义 = 「服务端会话列表默认截断 100 条」，允许两种实现形态：
  //   ① 原形态 ORDER BY ... LIMIT 100（H8 取证时）；
  //   ② K2 additive 信封 ORDER BY ... LIMIT 101 + rows.slice(0,100)（多查 1 条判
  //      hasMore，默认仍返回 100 条）。字面钉 LIMIT 100 会随合法实现演进误判红，
  //      故改为钉「默认上限 100 + 无分页参数」这一真实不变量。
  const lines = conversationsSource.split('\n');
  const limitLine = lines.findIndex((l) => /ORDER BY updated_at DESC LIMIT (100|101)\b/.test(l));
  const listRouteSegment = lines.slice(0, limitLine + 1).join('\n');
  const lastGet = listRouteSegment.lastIndexOf('router.get(');
  const listHandler = lastGet >= 0 ? listRouteSegment.slice(lastGet) : listRouteSegment;
  const plainLimit = /ORDER BY updated_at DESC LIMIT 100\b/.test(listRouteSegment);
  const envelopeLimit = /ORDER BY updated_at DESC LIMIT 101\b/.test(listRouteSegment) &&
    /rows\.slice\(0, 100\)|page = hasMore \? rows\.slice\(0, 100\)/.test(conversationsSource);
  return {
    conversationsApiLimit: dom.serverSideLimits.conversationsApiLimit,
    conversationsSourceHasLimit: plainLimit || envelopeLimit,
    conversationsDefaultPageSize: envelopeLimit ? 100 : (plainLimit ? 100 : null),
    conversationsNoPaginationParam: !/req\.query\.(limit|offset|cursor)/.test(listHandler),
    plateau: {
      c100: byLabel['convs-100']?.convRowMatches,
      c400: byLabel['convs-400-over-limit']?.convRowMatches,
      c800: byLabel['convs-800-over-limit']?.convRowMatches,
    },
    nodes100: byLabel['convs-100']?.allNodes,
    nodes400: byLabel['convs-400-over-limit']?.allNodes,
    nodes800: byLabel['convs-800-over-limit']?.allNodes,
    cv: { aMedian: cv.a.medianLayoutMs, bMedian: cv.b.medianLayoutMs, improved: cv.improved, decision: cv.decision, criterion: cv.criterion },
    cvCriterionRatio: 0.9,
    hotStack: { sampling: hot.sampling, rounds: Array.isArray(hot.rounds) ? hot.rounds.length : 0, verdict: hot.verdict },
    coldStart: cold ? { rounds: cold.rounds, readyCount: cold.readyCount, cdpPageReadyCoverage: cold.stageCoverage?.cdpPageReady ?? null } : null,
    startupGateInCloseoutChain: /startup|five-stage/i.test(closeoutScript),
  };
}

/**
 * 裁决三条判据是否处于「已作废 + 已重立」状态。
 * 返回 {ok, voided[], restated[], issues[]}；任何一条事实被篡改都会进 issues。
 */
export function adjudicateCriteria(input) {
  const issues = [];
  const voided = [];
  const restated = [];
  // fail-closed：证据整体/局部缺席时判红，不允许 TypeError 逃逸成「未测即过」。
  const e = {
    conversationsApiLimit: null,
    conversationsSourceHasLimit: false,
    conversationsDefaultPageSize: null,
    conversationsNoPaginationParam: false,
    plateau: {},
    nodes100: null, nodes400: null, nodes800: null,
    cv: {},
    cvCriterionRatio: 0.9,
    hotStack: {},
    coldStart: null,
    startupGateInCloseoutChain: false,
    ...(input && typeof input === 'object' ? input : {}),
  };
  e.plateau = e.plateau && typeof e.plateau === 'object' ? e.plateau : {};
  e.cv = e.cv && typeof e.cv === 'object' ? e.cv : {};
  e.hotStack = e.hotStack && typeof e.hotStack === 'object' ? e.hotStack : {};

  // K-01 作废：默认上限 100 在场（原 LIMIT 100 或 K2 additive 信封 LIMIT 101+slice）、
  // 无分页参数、100/400/800 的 convRowMatches plateau
  if (!(e.conversationsApiLimit === 100 && e.conversationsSourceHasLimit &&
        e.conversationsDefaultPageSize === 100 && e.conversationsNoPaginationParam)) {
    issues.push('K-01: 服务端默认上限 100 / 无分页参数 的作废依据被改写');
  }
  if (!(e.plateau.c100 === 500 && e.plateau.c400 === 500 && e.plateau.c800 === 500)) {
    issues.push('K-01: convRowMatches 平台期（100/400/800 同为 500）被改写');
  }
  if (!(e.nodes100 === 3052 && e.nodes400 === 7202 && e.nodes800 === 7202)) {
    issues.push('K-01: 100 档 3052 ≠ 400/800 档 7202 的真实读数被改写（禁止再写「三档同为 7202」）');
  }
  if (!issues.some((i) => i.startsWith('K-01'))) {
    voided.push('K-01');
    restated.push('K-01');
  }

  // K-02 作废：A/B 无收益、improved=false、decision=rollback，且判据是耗时比而非节点数
  const cvIssuesStart = issues.length;
  if (!(e.cv.improved === false && e.cv.decision === 'rollback-no-measurable-gain')) {
    issues.push('K-02: cv A/B 回滚裁决被改写');
  }
  if (!(e.cv.aMedian === 0.7 && e.cv.bMedian === 0.7 && !(e.cv.bMedian < e.cv.aMedian * e.cvCriterionRatio))) {
    issues.push('K-02: 0.7ms vs 0.7ms / B 未达 A×0.9 的耗时读数被改写');
  }
  if (!/耗时|layout|0\.9/.test(String(e.cv.criterion)) || /节点数/.test(String(e.cv.criterion).split('；')[0])) {
    issues.push('K-02: 重立判据必须是渲染耗时比，不得退回节点数');
  }
  if (issues.length === cvIssuesStart) {
    voided.push('K-02');
    restated.push('K-02');
  }

  // K-03 作废：热栈串在场、冷启动 x5 独立且有 cdpPageReady 缺口、专项门不进常驻链
  const hotIssuesStart = issues.length;
  if (!/热栈/.test(String(e.hotStack.sampling)) || !/非冷启动 5 次/.test(String(e.hotStack.sampling))) {
    issues.push('K-03: 热栈/冷启动分离命名被抹去');
  }
  if (e.hotStack.rounds !== 5 || !(e.coldStart && e.coldStart.rounds === 5 && e.coldStart.readyCount === 5)) {
    issues.push('K-03: 冷启动 ×5 独立证据缺席');
  }
  if (!(e.coldStart && e.coldStart.cdpPageReadyCoverage === 0)) {
    issues.push('K-03: 冷启动 cdpPageReady=0 的诚实缺口被抹去（热栈 5/5 不得冒充冷启动 5/5）');
  }
  if (e.startupGateInCloseoutChain !== false) {
    issues.push('K-03: 依赖活栈的专项脚本被挂进常驻链（fail-open 陷阱）');
  }
  if (issues.length === hotIssuesStart) {
    voided.push('K-03');
    restated.push('K-03');
  }

  return {
    ok: issues.length === 0,
    voided,
    restated,
    issues,
    verdict: issues.length === 0 ? 'three-criteria-voided-and-restated' : 'criteria-drift',
  };
}

function main() {
  const verdict = adjudicateCriteria(readCriteriaEvidence());
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
