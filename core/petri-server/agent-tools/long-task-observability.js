'use strict';

/**
 * M4 / BLOCK-430 — 长任务评测与可观测（6 项能力收敛单一纯模块）。
 *
 * 差异化：fixture 零出网零真实 Provider；traceId 全链可持久化投影（跨重启可查）；
 * usage 三层事实表 + 失败请求也记账，成本可计量、事件可重放。
 *
 * 红线：零新增依赖、零 spawn、零 DB 写入、零网络；不改主循环 / SSE 事件形状 /
 * MAX_AGENT_ITERS=Infinity / workspace_exec 默认放行；quality:perf 基线保持不动。
 * 「稳定完成长任务」不得宣称——claimStableLongTask 恒 false，除非有当次真实任务证据。
 */

const FIXTURE_MIN_TURNS = 1000;
const TRACE_KINDS = Object.freeze(['main_loop', 'subagent', 'background', 'retry', 'tool']);
const USAGE_LAYERS = Object.freeze(['model', 'turn', 'tool']);
const PERF_BUDGETS = Object.freeze({
  domNodes: 400, scrollP50Ms: 16, scrollP95Ms: 32, firstPaintMs: 1500, exportMs: 5000,
});
const PERF_BUDGET_MAP = new Map(Object.entries(PERF_BUDGETS));

// ── M4-1 本地长任务 fixture（确定性合成，零出网零 Provider） ────────────────
function generateFixture({ turns = FIXTURE_MIN_TURNS, seed = 1 } = {}) {
  const n = Math.max(1, Number(turns) || FIXTURE_MIN_TURNS);
  const messages = [];
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    messages.push({ seq: messages.length + 1, role: 'user', turn: i, content: `task-${i}` });
    messages.push({ seq: messages.length + 1, role: 'assistant', turn: i, content: `reply-${i}` });
    parts.push({ seq: parts.length + 1, type: 'tool_call', callId: `c${i}`, state: 'done', turn: i });
    parts.push({ seq: parts.length + 1, type: 'tool_result', callId: `c${i}`, bytes: 32, turn: i });
    if (i % 100 === 99) parts.push({ seq: parts.length + 1, type: 'compaction', turn: i });
    if (i % 250 === 249) parts.push({ seq: parts.length + 1, type: 'retry', turn: i });
  }
  const todos = Array.from({ length: 60 }, (_, i) => ({ id: `todo-${i}`, status: i % 2 ? 'done' : 'pending' }));
  const manifest = Object.freeze({
    kind: 'm4-long-task-fixture',
    turns: n,
    turnCount: n,
    messageCount: messages.length,
    partCount: parts.length,
    todoCount: todos.length,
    compactionCount: parts.filter((p) => p.type === 'compaction').length,
    retryCount: parts.filter((p) => p.type === 'retry').length,
    seed: Number(seed) || 1,
    provider: 'mock',
    network: false,
    generatedAt: new Date('2026-11-11T00:00:00.000Z').toISOString(),
  });
  return { manifest, messages, parts, todos };
}

function verifyFixture(fx) {
  const issues = [];
  if (!fx || !fx.manifest) return { ok: false, issues: ['MANIFEST_MISSING'] };
  const m = fx.manifest;
  if (m.turnCount < FIXTURE_MIN_TURNS) issues.push('FIXTURE_TOO_SMALL');
  if (m.messageCount !== (fx.messages || []).length) issues.push('MESSAGE_COUNT_DRIFT');
  if (m.partCount !== (fx.parts || []).length) issues.push('PART_COUNT_DRIFT');
  if (m.todoCount !== (fx.todos || []).length) issues.push('TODO_COUNT_DRIFT');
  if (m.provider !== 'mock' || m.network !== false) issues.push('FIXTURE_NOT_LOCAL_MOCK');
  return { ok: issues.length === 0, issues };
}

// ── M4-2 长任务成功率 / 完成度 / 跨恢复一致性基线 ──────────────────────────
function adjudicateLongTaskBaseline(runs = []) {
  const list = Array.isArray(runs) ? runs : [];
  const n = list.length;
  const success = list.filter((r) => r && r.success === true).length;
  const completion = list.reduce((a, r) => a + (Number(r && r.completion) || 0), 0);
  const consistent = list.filter((r) => r && r.resumeConsistent === true).length;
  return Object.freeze({
    runCount: n,
    successRate: n ? success / n : 0,
    avgCompletion: n ? completion / n : 0,
    resumeConsistency: n ? consistent / n : 0,
    evidenceClass: 'synthetic-mock-baseline',
    // 硬约束：合成 mock 基线不构成「稳定完成长任务」的产品证据
    claimStableLongTask: false,
  });
}

// ── M4-3 traceId 全链可持久化投影 ──────────────────────────────────────────
function createTraceProjection({ traceId = '', persisted } = {}) {
  const spans = [];
  if (persisted && Array.isArray(persisted.spans)) {
    for (const s of persisted.spans) spans.push({ ...s });
  }
  const tid = traceId || (persisted && persisted.traceId) || '';
  const append = ({ kind, name, costMs = 0 }) => {
    if (!TRACE_KINDS.includes(kind)) {
      throw Object.assign(new Error(`UNKNOWN_TRACE_KIND: ${kind}`), { code: 'UNKNOWN_TRACE_KIND' });
    }
    const span = Object.freeze({
      seq: spans.length + 1, traceId: tid, kind, name: String(name || ''), costMs: Number(costMs) || 0,
    });
    spans.push(span);
    return span;
  };
  const byKind = (kind) => spans.filter((s) => s.kind === kind);
  const persist = () => ({ traceId: tid, spans: spans.map((s) => ({ ...s })) });
  return { append, byKind, persist, get count() { return spans.length; }, get spans() { return spans.slice(); } };
}

// ── M4-4 usage 三层事实表 + 价格表配置 + 失败请求记账 ───────────────────────
function createUsageLedger({ prices = {} } = {}) {
  const rows = [];
  const events = [];
  const record = ({ layer, model = 'unknown', inputTokens = 0, outputTokens = 0, name = '', bytes = 0 }) => {
    if (!USAGE_LAYERS.includes(layer)) {
      throw Object.assign(new Error(`UNKNOWN_USAGE_LAYER: ${layer}`), { code: 'UNKNOWN_USAGE_LAYER' });
    }
    const price = Object.getOwnPropertyDescriptor(prices, model)?.value || { input: 0, output: 0 };
    const costCny = (Number(inputTokens) * (Number(price.input) || 0) + Number(outputTokens) * (Number(price.output) || 0)) / 1000;
    const row = Object.freeze({ seq: rows.length + 1, layer, model, inputTokens, outputTokens, name, bytes, costCny, failed: false });
    rows.push(row);
    return row;
  };
  const recordFailed = ({ model = 'unknown', reason = '' } = {}) => {
    const row = Object.freeze({ seq: rows.length + 1, layer: 'model', model, inputTokens: 0, outputTokens: 0, name: '', bytes: 0, costCny: 0, failed: true });
    rows.push(row);
    events.push(Object.freeze({ seq: events.length + 1, type: 'model_request_failed', model, reason: String(reason) }));
    return row;
  };
  const byLayer = (layer) => rows.filter((r) => r.layer === layer);
  return { record, recordFailed, byLayer, events, get rows() { return rows.slice(); }, get totalCostCny() { return rows.reduce((a, r) => a + r.costCny, 0); } };
}

// ── M4-5 用户可感性能判据 + 长列表窗口化 ───────────────────────────────────
function adjudicateUserPerceivedPerf(sample = {}) {
  const issues = [];
  const check = (key, code) => {
    const value = Number(Object.getOwnPropertyDescriptor(sample, key)?.value);
    const budget = PERF_BUDGET_MAP.get(key);
    if (Number.isFinite(value) && value > budget) {
      issues.push({ code, value, budget });
    }
  };
  check('domNodes', 'DOM_NODE_BUDGET_EXCEEDED');
  check('scrollP50Ms', 'SCROLL_P50_EXCEEDED');
  check('scrollP95Ms', 'SCROLL_P95_EXCEEDED');
  check('firstPaintMs', 'FIRST_PAINT_EXCEEDED');
  check('exportMs', 'EXPORT_TIME_EXCEEDED');
  return { ok: issues.length === 0, issues, budgets: PERF_BUDGETS };
}

function planWindowedRender({ totalItems = 0, viewportItems = 20, scrollIndex = 0, overscan = 2 } = {}) {
  const total = Math.max(0, Number(totalItems) || 0);
  const size = Math.max(1, Number(viewportItems) || 20);
  const start = Math.max(0, Math.min(total - size, (Number(scrollIndex) || 0) - overscan));
  const end = Math.min(total, start + size + overscan * 2);
  const rendered = [];
  for (let index = start; index < end; index += 1) rendered.push({ index, key: `row-${index}` });
  return { totalItems: total, start, end, rendered, virtualized: true, dependenciesAdded: 0 };
}

module.exports = {
  FIXTURE_MIN_TURNS,
  TRACE_KINDS,
  USAGE_LAYERS,
  PERF_BUDGETS,
  generateFixture,
  verifyFixture,
  adjudicateLongTaskBaseline,
  createTraceProjection,
  createUsageLedger,
  adjudicateUserPerceivedPerf,
  planWindowedRender,
};
