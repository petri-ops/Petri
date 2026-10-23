'use strict';

/**
 * helpers/trajectory-events.js — BLOCK-248（Q3）执行轨迹的**单源**分类与有界摘要。
 *
 * 为什么放在后端：轨迹的事件分类/摘要/统计必须只有一份——前端若再写一套映射，
 * 同一条事件在轨迹、活动行、证据面会出现三种口径（第二真相）。前端只渲染这里
 * 产出的 `{group, summary, detail, status, durationMs}`。
 *
 * 三条纪律：
 *  1. **只读已记录事件**（`recordedOnly`）：不推断未上报的耗时/正文；没有 `durationMs`
 *     就不给字段，前端显示"—"而不是 0。
 *  2. **有界**：summary/detail ≤ 240 字符，不返回工具结果正文与模型原文（正文在
 *     模型 I/O surface）；工具参数只走既有 `summarizeToolCallForActivity` 的摘要。
 *  3. **未知事件不丢**：落 `system` 组并保留原始 eventType，升级后端后旧前端仍能看。
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_SUMMARY = 240;
const MAX_DETAIL = 240;

/** 8 类筛选组（与 Q3 口径一致；前端"全部"是额外的一枚 chip，不在组里）。 */
const TRAJECTORY_GROUPS = Object.freeze([
  'tool',
  'text',
  'reasoning',
  'error',
  'compaction',
  'user',
  'assistant',
  'system',
]);

const GROUP_BY_EVENT = Object.freeze({
  tool_call: 'tool',
  tool_result: 'tool',
  tool_output: 'tool',
  tool_cancel: 'tool',
  error: 'error',
  message_persist_failed: 'error',
  report_guard: 'error',
  cost_cap_exceeded: 'error',
  context_compacted: 'compaction',
  input_queued: 'user',
  parent_message_delivered: 'user',
  user_question_answered: 'user',
  run_started: 'assistant',
  done: 'assistant',
  agent_cancelled: 'assistant',
  agent_status: 'assistant',
  loop_phase: 'assistant',
  loop_iteration: 'assistant',
  iter: 'assistant',
  agent_progress: 'text',
  model_fallback: 'system',
  token_budget: 'system',
  usage: 'system',
  knowledge_citations: 'system',
  topic_shift: 'system',
  reconciliation_notice: 'system',
  task_todo: 'system',
  tool_route: 'system',
  guard_ack: 'system',
  result_edit_progress: 'system',
  conversation: 'system',
  started: 'assistant',
  child_finished: 'system',
  run_terminal: 'assistant',
});

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function clampAfterSeq(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function textOf(value, max = MAX_SUMMARY) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function tokenCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function deltaOf(payload) {
  const choices = payload && Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  return first && first.delta && typeof first.delta === 'object' ? first.delta : null;
}

/** 事件分组：delta 按内容细分（content→text / reasoning→reasoning / tool_calls→tool）。 */
function classifyEvent(eventType, payload) {
  const type = String(eventType || '');
  if (type === 'delta') {
    const delta = deltaOf(payload);
    if (!delta) return 'text';
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return 'tool';
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return 'reasoning';
    return 'text';
  }
  return GROUP_BY_EVENT[type] || 'system';
}

function summarizeToolCallEvent(payload) {
  // 延迟 require：tool-events 体积较大，轨迹只在真正有工具事件时才需要它。
  const { summarizeToolCallForActivity } = require('../agent-tools/tool-events');
  const name = payload && typeof payload.name === 'string' ? payload.name : 'tool';
  const args = payload && payload.args && typeof payload.args === 'object' ? payload.args : {};
  const summarized = summarizeToolCallForActivity(name, args);
  return {
    summary: `${summarized.actionLabel || '已调用'} ${name}`.trim(),
    detail: summarized.actionDetail ? textOf(summarized.actionDetail, MAX_DETAIL) : '',
  };
}

function summarizeEvent(eventType, payload) {
  const type = String(eventType || '');
  switch (type) {
    case 'delta': {
      const delta = deltaOf(payload);
      const reasoning = delta && typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
      if (reasoning) return { summary: textOf(reasoning) || '(思考片段)', detail: '' };
      const content = delta && typeof delta.content === 'string' ? delta.content : '';
      if (content) return { summary: textOf(content), detail: '' };
      if (delta && Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
        const call = delta.tool_calls[0] || {};
        const name = call.function && typeof call.function.name === 'string' ? call.function.name : 'tool';
        return { summary: `准备调用 ${name}`, detail: '' };
      }
      return { summary: '(空增量)', detail: '' };
    }
    case 'tool_call':
      return summarizeToolCallEvent(payload || {});
    case 'tool_result': {
      const result = payload && payload.toolResult && typeof payload.toolResult === 'object' ? payload.toolResult : {};
      const status = typeof result.status === 'string' ? result.status : '';
      const durationMs = Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : undefined;
      const summary = textOf(payload && payload.summary) || (status === 'success' ? '工具完成' : '工具未成功');
      return { summary, detail: '', status, durationMs };
    }
    case 'tool_output': {
      const text = textOf(payload && (payload.text || payload.output));
      return { summary: text ? `输出：${text}` : '工具输出', detail: '' };
    }
    case 'tool_cancel':
      return { summary: '已请求取消工具', detail: textOf(payload && payload.callId, MAX_DETAIL) };
    case 'error':
      return {
        summary: textOf(payload && (payload.error || payload.message)) || '执行失败',
        detail: textOf(payload && payload.code, MAX_DETAIL),
        status: 'error',
      };
    case 'message_persist_failed':
      return { summary: '消息落库失败', detail: textOf(payload && (payload.error || payload.reason), MAX_DETAIL), status: 'error' };
    case 'report_guard': {
      const verdict = textOf(payload && payload.verdict, 40);
      return { summary: `汇报门${verdict ? `：${verdict}` : ''}`, detail: textOf(payload && payload.reason, MAX_DETAIL), status: verdict === 'PASS' ? '' : 'error' };
    }
    case 'cost_cap_exceeded':
      return { summary: '成本上限熔断', detail: textOf(payload && (payload.message || payload.reason), MAX_DETAIL), status: 'error' };
    case 'context_compacted': {
      const dropped = tokenCount(payload && payload.dropped);
      const summarized = payload && payload.summarized === true;
      return {
        summary: `上下文压缩：丢弃 ${dropped} 条消息${summarized ? ' + 生成摘要' : ''}`,
        detail: '',
      };
    }
    case 'input_queued':
      return { summary: `用户插话：${textOf(payload && payload.text, 160) || '(空)'}`, detail: '' };
    case 'parent_message_delivered': {
      const refs = payload && Array.isArray(payload.refs) ? payload.refs.length : 0;
      return { summary: `父任务消息已投递${refs ? `（${refs} 条）` : ''}`, detail: '' };
    }
    case 'user_question_answered':
      return { summary: '用户已回答问题', detail: '' };
    case 'run_started':
      return { summary: '开始运行', detail: textOf(payload && payload.kind, 60) };
    case 'done':
      return { summary: '运行完成', detail: '' };
    case 'agent_cancelled':
      return { summary: '运行已取消', detail: '' };
    case 'run_terminal':
      return { summary: `运行结束${payload && payload.status ? `（${payload.status}）` : ''}`, detail: '' };
    case 'agent_status':
      return { summary: `状态：${textOf(payload && payload.status, 40) || '未知'}`, detail: '' };
    case 'loop_phase':
      return { summary: `阶段：${textOf(payload && payload.phase, 40) || '未知'}`, detail: '' };
    case 'loop_iteration':
    case 'iter': {
      const n = tokenCount(payload && (payload.iteration ?? payload.iter));
      return { summary: n ? `第 ${n} 轮` : '迭代', detail: '' };
    }
    case 'agent_progress':
      return { summary: textOf(payload && (payload.text || payload.content)) || '阶段进展', detail: '' };
    case 'model_fallback': {
      const from = textOf(payload && (payload.fromProfileLabel || payload.from), 60);
      const to = textOf(payload && (payload.toProfileLabel || payload.to), 60);
      return { summary: `模型降级${from || to ? `：${from || '?'} → ${to || '?'}` : ''}`, detail: textOf(payload && payload.category, MAX_DETAIL) };
    }
    case 'usage': {
      const model = textOf(payload && payload.model, 60);
      const prompt = tokenCount(payload && payload.promptTokens);
      const completion = tokenCount(payload && payload.completionTokens);
      return { summary: `模型调用${model ? ` ${model}` : ''} · ${prompt}+${completion} tokens`, detail: '' };
    }
    case 'knowledge_citations': {
      const items = payload && (payload.items || payload.citations);
      const count = Array.isArray(items) ? items.length : 0;
      return { summary: `引用 ${count} 个知识块`, detail: '' };
    }
    case 'token_budget': {
      const used = payload && payload.used;
      const limit = payload && payload.limit;
      return { summary: `token 预算${used != null && limit != null ? `：${used}/${limit}` : ''}`, detail: '' };
    }
    case 'guard_ack': {
      const scope = textOf(payload && payload.scope, 30);
      return { summary: `审批通过${scope ? `（${scope}）` : ''}`, detail: textOf(payload && payload.toolName, MAX_DETAIL) };
    }
    case 'topic_shift':
      return { summary: '话题切换', detail: textOf(payload && payload.reason, MAX_DETAIL) };
    case 'reconciliation_notice':
      return { summary: '对账提示', detail: textOf(payload && payload.message, MAX_DETAIL) };
    case 'task_todo':
      return { summary: '任务清单更新', detail: '' };
    case 'tool_route':
      return { summary: '工具预路由', detail: textOf(payload && payload.domain, MAX_DETAIL) };
    case 'child_finished':
      return { summary: '子任务结束', detail: textOf(payload && payload.status, 40) };
    default:
      return { summary: `事件：${type || 'unknown'}`, detail: '' };
  }
}

/** task_events 行 → 轨迹行（唯一投影；前端不再二次解释 payload）。 */
function toTrajectoryEvent(row) {
  const eventType = String((row && row.eventType) || 'delta');
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  const type = eventType;
  const group = classifyEvent(type, payload);
  const summarized = summarizeEvent(type, payload);
  const seq = Number(row && row.seq);
  return {
    seq: Number.isFinite(seq) ? seq : 0,
    at: row && typeof row.createdAt === 'string' ? row.createdAt : null,
    type,
    group,
    summary: summarized.summary || '(无摘要)',
    ...(summarized.detail ? { detail: summarized.detail } : {}),
    ...(summarized.status ? { status: summarized.status } : {}),
    ...(Number.isFinite(summarized.durationMs) ? { durationMs: summarized.durationMs } : {}),
  };
}

/**
 * 只读查询编排（HTTP 外壳之外的纯逻辑，便于注入测试）。
 * 返回 `{ ok, status?, error?, ...payload }`；route 只做状态码映射。
 */
async function resolveTrajectoryQuery(input) {
  const store = input && input.store;
  const db = input && input.db;
  const userId = input && input.userId ? String(input.userId) : '';
  if (!userId) return { ok: false, status: 401, error: 'unauthorized' };
  if (!store) return { ok: false, status: 500, error: 'store_unavailable' };

  const conversationId = input.conversationId ? String(input.conversationId) : '';
  const explicitTaskId = input.taskId ? String(input.taskId) : '';
  const afterSeq = clampAfterSeq(input.afterSeq);
  const beforeSeqRaw = Number(input.beforeSeq);
  const beforeSeq = Number.isFinite(beforeSeqRaw) && beforeSeqRaw > 0 ? Math.floor(beforeSeqRaw) : 0;
  const limit = clampLimit(input.limit);
  // 三种读法：默认取最新一页（跟随尾部）；afterSeq 增量续读；beforeSeq 往更早翻。
  const mode = beforeSeq > 0 ? 'older' : afterSeq > 0 ? 'delta' : 'tail';

  let task = null;
  if (explicitTaskId) {
    task = store.getAgentTask(explicitTaskId);
    if (!task) return { ok: false, status: 404, error: 'task_not_found' };
    if (task.userId && task.userId !== userId) return { ok: false, status: 403, error: 'forbidden' };
    const taskConversation = task.params && task.params.conversationId ? String(task.params.conversationId) : '';
    if (conversationId && taskConversation && taskConversation !== conversationId) {
      return { ok: false, status: 400, error: 'task_conversation_mismatch' };
    }
  } else {
    if (!conversationId) return { ok: false, status: 400, error: 'conversation_id_required' };
    if (!db) return { ok: false, status: 500, error: 'db_unavailable' };
    const row = await db.prepare('SELECT user_id FROM copilot_conversations WHERE id = ?').get(conversationId);
    if (!row) return { ok: false, status: 404, error: 'conversation_not_found' };
    if (row.user_id && row.user_id !== userId) return { ok: false, status: 403, error: 'forbidden' };
    task = store.getLatestPrimaryTaskForConversation(userId, conversationId);
    if (!task) {
      return {
        ok: true,
        availability: 'no_task',
        recordedOnly: true,
        mode,
        conversationId,
        task: null,
        events: [],
        truncated: false,
        hasMoreOlder: false,
        nextAfterSeq: afterSeq,
        oldestSeq: null,
        stats: null,
      };
    }
  }

  const raw = mode === 'older'
    ? store.getAgentTaskEventsBefore(task.taskId, beforeSeq, limit + 1)
    : mode === 'delta'
      ? store.getAgentTaskEventsSince(task.taskId, afterSeq, limit + 1)
      : store.getRecentAgentTaskEvents(task.taskId, limit + 1);
  const truncated = raw.length > limit;
  // tail/older 的查询是"从新往旧"取的，截断要丢**最旧**那条；delta 丢最新那条。
  const page = mode === 'delta'
    ? (truncated ? raw.slice(0, limit) : raw)
    : (truncated ? raw.slice(raw.length - limit) : raw);
  const events = page.map(toTrajectoryEvent);
  const stats = store.getAgentTaskTrajectoryStats(task.taskId);
  const oldestSeq = events.length > 0 ? events[0].seq : null;
  return {
    ok: true,
    availability: events.length > 0 || (stats && stats.events > 0) ? 'available' : 'no_events',
    recordedOnly: true,
    mode,
    conversationId: conversationId || (task.params && task.params.conversationId) || null,
    task: {
      taskId: task.taskId,
      status: task.status || null,
      agentStatus: task.agentStatus || null,
      createdAt: task.createdAt || null,
      finishedAt: task.finishedAt || null,
      error: task.error || null,
    },
    events,
    truncated,
    hasMoreOlder: oldestSeq != null && Boolean(store.hasAgentTaskEventBefore(task.taskId, oldestSeq)),
    nextAfterSeq: events.length > 0 ? events[events.length - 1].seq : afterSeq,
    oldestSeq,
    stats,
  };
}

module.exports = {
  TRAJECTORY_GROUPS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  clampAfterSeq,
  classifyEvent,
  toTrajectoryEvent,
  resolveTrajectoryQuery,
};
