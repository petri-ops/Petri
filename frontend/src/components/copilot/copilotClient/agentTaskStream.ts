// ============================================================
// Agent task 事件流：订阅（afterSeq 续传）、有界退避重连、
// SSE 事件分发（task/legacy 共用）与 legacy 直连流。
// ============================================================

import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import type { TokenBudgetDetail } from '@/lib/events';
import { emitAgentTaskDone, getApiPrefix, getAuthHeader } from './apiBase';
import { ensureOnlineOrThrow } from './offline';
import {
  parseResultEditProgressEvent,
  parseToolCallEvent,
  parseToolOutputEvent,
  parseToolResultEvent,
} from './parse';
import type { AgentTaskTodoItem, StreamChatOptions } from './types';

/**
 * BLOCK-39: 订阅断线信号（typed）。仅三类来源：fetch 网络 reject（后端不可达）、
 * reader.read() reject（连接被切断）、流结束未见 [DONE]（干净截断）。携带 lastSeq
 * 供重连时 afterSeq 续传；HTTP 4xx/5xx 与 AbortError 不属于此类型（不重试）。
 */
export class AgentStreamDisconnectedError extends Error {
  readonly lastSeq: number;
  constructor(message: string, lastSeq: number) {
    super(message);
    this.name = 'AgentStreamDisconnected';
    this.lastSeq = lastSeq;
  }
}

/** 有界退避重连：起始 1s 指数至 4s 封顶，总窗口约 90s（覆盖 dev 后端重启 + 富余）。 */
const STREAM_RECONNECT_MAX_ATTEMPTS = 24;
const STREAM_RECONNECT_BASE_DELAY_MS = 1000;
const STREAM_RECONNECT_MAX_DELAY_MS = 4000;

function isAbortError(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError';
}

/**
 * [DONE] 哨兵匹配：SSE 惯例是裸 `data: [DONE]`；防御兼容带引号的
 * `data: "[DONE]"`（JSON.stringify('[DONE]') 的历史 bug 形状——曾导致
 * 每个 task 完成后被判「在完成前中断」并烧完 90s 重连窗）。
 */
function isSseDone(data: string): boolean {
  return data === '[DONE]' || data === '"[DONE]"';
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** GET /ai/agent/task/:taskId 订阅事件流（afterSeq 支持续传；断线有界退避重连） */
export async function subscribeAgentTask(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<void> {
  let seq = afterSeq;
  for (let attempt = 0; ; attempt++) {
    try {
      seq = await subscribeAgentTaskOnce(taskId, opts, seq);
      return;
    } catch (err: unknown) {
      if (
        err instanceof AgentStreamDisconnectedError &&
        attempt < STREAM_RECONNECT_MAX_ATTEMPTS
      ) {
        // 断线时已收到的最后 seq（可能大于进入时的 afterSeq），重连从其后续传
        seq = err.lastSeq;
        const nextRetryMs = Math.min(
          STREAM_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
          STREAM_RECONNECT_MAX_DELAY_MS
        );
        // 等待期间用户主动停止 → AbortError 上抛（调用方静默处理）
        opts.onStreamReconnecting?.({ taskId, attempt: attempt + 1, lastSeq: seq, nextRetryMs });
        await abortableDelay(nextRetryMs, opts.signal);
        continue;
      }
      throw err;
    }
  }
}

/** 单次订阅尝试；正常完成（收到 [DONE]）返回最后的 seq，断线抛 AgentStreamDisconnectedError */
async function subscribeAgentTaskOnce(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<number> {
  const { signal, onDone, kind } = opts;
  // token 放 query（fetch 也能带 header，但 query 兼容 EventSource 未来切换）
  const authHeader = getAuthHeader();
  const token = authHeader.Authorization?.replace('Bearer ', '');
  const url = `${getApiPrefix()}/ai/agent/task/${taskId}?afterSeq=${afterSeq}${token ? '&token=' + encodeURIComponent(token) : ''}`;
  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers: { ...authHeader }, signal });
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;
    throw new AgentStreamDisconnectedError('任务事件流连接中断', afterSeq);
  }
  if (!resp.ok || !resp.body) {
    let errText = `HTTP ${resp.status}`;
    try {
      const t = await resp.text();
      if (t) errText += ': ' + t.slice(0, 200);
    } catch {}
    throw new Error(errText);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lastSeq = afterSeq;
  let sawDone = false;
  // BLOCK-31 P2: 记录 SSE done 事件携带的权威 filesChanged，随 agentTaskDone 派发
  let doneFiles: Array<{ path: string; status: string }> | undefined;
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      throw new AgentStreamDisconnectedError('任务事件流连接中断', lastSeq);
    }
    const { value, done } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      for (const line of rawEvent.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (isSseDone(data)) {
          sawDone = true;
          // P1.2：原 localStorage 在途键清理已随双轨退役（恢复改问后端 inflight 端点）。
          break;
        }
        try {
          const obj = JSON.parse(data);
          // task 模式事件包成 {seq, eventType, payload}，取 payload 走原解析
          const evt = obj.payload ? obj.payload : obj;
          if (typeof obj.seq === 'number') lastSeq = obj.seq;
          if (evt && evt.event === 'done' && Array.isArray(evt.filesChanged)) {
            doneFiles = evt.filesChanged;
          }
          _handleSseEvent(evt, opts);
        } catch {
          // Bad JSON — ignore
        }
      }
      if (sawDone) break;
    }
    if (sawDone) break;
  }
  if (!sawDone) {
    // BLOCK-39: 后端终态必发 [DONE]（events.js），干净截断 = 异常断线；
    // 不得误调 onDone 假装完成（任务实际可能已被清扫为 failed+interrupted）。
    throw new AgentStreamDisconnectedError('任务事件流在完成前中断', lastSeq);
  }
  onDone?.();
  emitAgentTaskDone(taskId, kind, {
    filesChanged: doneFiles,
    conversationId: opts.conversationId,
  });
  return lastSeq;
}

/** BLOCK-97 — task_todo 整单快照解析（防御式：畸形条目降级/过滤，不炸流） */
function parseTaskTodoEvent(obj: any): AgentTaskTodoItem[] {
  if (!Array.isArray(obj.items)) return [];
  const items: AgentTaskTodoItem[] = [];
  for (let i = 0; i < obj.items.length; i++) {
    const raw = obj.items[i];
    if (!raw || typeof raw !== 'object') continue;
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) continue;
    items.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : String(i + 1),
      content,
      status: raw.status === 'in_progress' || raw.status === 'completed' ? raw.status : 'pending',
    });
  }
  return items;
}

/** 处理单个 SSE 事件对象（原 streamChat 的解析逻辑，task/legacy 共用） */
function _handleSseEvent(obj: any, opts: StreamChatOptions): void {
  // UI-AGENTWB-###: SSE dispatch used to inline helpers (e.g.
  // localizeToolResult for backend tool-result envelopes). When those
  // helpers got refactored out of this module the call site silently
  // turned into `localizeToolResult is not a function` and bubbled up as
  // a flat "发生未知错误". Wrap the entire dispatch in a single typed
  // error guard so any dropped helper / type-coercion blow-up surfaces as
  // a friendly onError with the real message instead of swallowing the
  // whole stream.
  try {
    _dispatchSseEvent(obj, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.onError?.(new Error(`SSE dispatch failed: ${message}`));
  }
}

function _dispatchSseEvent(obj: any, opts: StreamChatOptions): void {
  const {
    onDelta,
    onReasoning,
    onError,
    onIter,
    onAgentStatus,
    onAgentProgress,
    onResultEditProgress,
    onToolCall,
    onToolOutput,
    onToolResult,
    onTaskTodo,
    onKnowledgeCitations,
    onInputQueued,
    onConversation,
    onTopicShift,
    onLoopPhase,
    onLoopIteration,
    onChildFinished,
    onModelFallback,
    kind,
  } = opts;
  if (obj.error) {
    // BLOCK-38 P2: 后端 error 事件携带 resumable/interruptedAt（服务中断清扫标记）
    // BLOCK-56 P1: 任务级降级时后端已自动新建续跑 task，error 附带 fallbackTaskId
    onError?.(new Error(obj.error), {
      resumable: obj.resumable === true,
      interruptedAt: typeof obj.interruptedAt === 'string' ? obj.interruptedAt : null,
      fallbackTaskId: typeof obj.fallbackTaskId === 'string' ? obj.fallbackTaskId : null,
      fallbackLabel: typeof obj.fallbackLabel === 'string' ? obj.fallbackLabel : null,
    });
    return;
  }
  if (obj.event === 'child_finished') {
    onChildFinished?.({
      childTaskId: String(obj.childTaskId || ''),
      status: String(obj.status || ''),
      summaryHead: String(obj.summaryHead || ''),
    });
    return;
  }
  if (obj.event === 'model_fallback') {
    onModelFallback?.({
      scope: typeof obj.scope === 'string' ? obj.scope : undefined,
      fromProfileId: typeof obj.fromProfileId === 'string' ? obj.fromProfileId : null,
      toProfileId: typeof obj.toProfileId === 'string' ? obj.toProfileId : null,
      toProfileLabel: typeof obj.toProfileLabel === 'string' ? obj.toProfileLabel : null,
      reason: typeof obj.reason === 'string' ? obj.reason : null,
      newTaskId: typeof obj.newTaskId === 'string' ? obj.newTaskId : null,
      message: typeof obj.message === 'string' ? obj.message : null,
    });
    return;
  }
  if (obj.event === 'conversation') {
    onConversation?.({ conversationId: obj.conversationId, title: obj.title });
    return;
  }
  if (obj.event === 'topic_shift') {
    onTopicShift?.({ conversationId: obj.conversationId, reason: obj.reason || '' });
    return;
  }
  // HLE-C4: Loop Controller events
  if (obj.event === 'loop_phase') {
    onLoopPhase?.({
      phase: String(obj.phase || ''),
      loopRunId: obj.loopRunId ? String(obj.loopRunId) : undefined,
      publicConclusion: obj.publicConclusion ? String(obj.publicConclusion) : undefined,
      reason: obj.reason ? String(obj.reason) : undefined,
      automationMode: obj.automationMode ? String(obj.automationMode) : undefined,
      executionIntent: obj.executionIntent === 'task_draft' || obj.executionIntent === 'task_execute'
        ? obj.executionIntent
        : undefined,
    });
    return;
  }
  if (obj.event === 'loop_iteration') {
    onLoopIteration?.({
      loopRunId: String(obj.loopRunId || ''),
      iterationId: String(obj.iterationId || ''),
      sequence: typeof obj.sequence === 'number' ? obj.sequence : 0,
      decision: String(obj.decision || ''),
      decisionReasonCode: String(obj.decisionReasonCode || ''),
      publicConclusion: String(obj.publicConclusion || ''),
      status: String(obj.status || ''),
      proposedActionKey: obj.proposedActionKey ? String(obj.proposedActionKey) : null,
      actionKeyHash: obj.actionKeyHash ? String(obj.actionKeyHash) : null,
    });
    return;
  }
  if (obj.event === 'iter') {
    onIter?.(obj.n || 1);
    return;
  }
  if (obj.event === 'agent_status') {
    onAgentStatus?.({
      phase: String(obj.phase || ''),
      message: String(obj.message || ''),
      attempt: typeof obj.attempt === 'number' ? obj.attempt : undefined,
      maxAttempts: typeof obj.maxAttempts === 'number' ? obj.maxAttempts : undefined,
      reason: obj.reason ? String(obj.reason) : undefined,
    });
    return;
  }
  if (obj.event === 'agent_progress') {
    const content = String(obj.content || '').trim();
    if (content) {
      onAgentProgress?.({
        iteration: typeof obj.iteration === 'number' ? obj.iteration : 1,
        content,
      });
    }
    return;
  }
  if (obj.event === 'result_edit_progress') {
    onResultEditProgress?.(parseResultEditProgressEvent(obj));
    return;
  }
  if (obj.event === 'tool_call') {
    onToolCall?.(parseToolCallEvent(obj));
    return;
  }
  if (obj.event === 'tool_output') {
    // BLOCK-33 P3 — 空 text 增量无意义，直接丢弃
    const outputEvent = parseToolOutputEvent(obj);
    if (outputEvent.text) onToolOutput?.(outputEvent);
    return;
  }
  if (obj.event === 'tool_result') {
    onToolResult?.(parseToolResultEvent(obj));
    return;
  }
  if (obj.event === 'input_queued') {
    // BLOCK-98 M4 — 插队消息入队通知（排队深度展示，诚实可见）
    onInputQueued?.({
      text: typeof obj.text === 'string' ? obj.text : '',
      depth: typeof obj.depth === 'number' ? obj.depth : 0,
    });
    return;
  }
  if (obj.event === 'task_todo') {
    // BLOCK-97 — 任务清单整单快照（todo_write 成功回执后由 agent-runner 广播）
    onTaskTodo?.(parseTaskTodoEvent(obj));
    return;
  }
  if (obj.event === 'knowledge_citations') {
    // BLOCK-94 / UI-402 — 知识溯源（自动召回注入块清单；防御式解析不炸流）
    const citations = Array.isArray(obj.citations)
      ? obj.citations
          .map((c: any) =>
            c && typeof c === 'object'
              ? {
                  docId: typeof c.docId === 'string' ? c.docId : undefined,
                  docName: typeof c.docName === 'string' ? c.docName : undefined,
                  seq: typeof c.seq === 'number' ? c.seq : undefined,
                  channels:
                    c.channels && typeof c.channels === 'object'
                      ? {
                          vector: typeof c.channels.vector === 'number' ? c.channels.vector : undefined,
                          fts: typeof c.channels.fts === 'number' ? c.channels.fts : undefined,
                        }
                      : undefined,
                }
              : null
          )
          .filter(Boolean)
      : [];
    onKnowledgeCitations?.({ citations });
    return;
  }
  if (obj.event === 'done') {
    const doneTaskId =
      (typeof obj.taskId === 'string' && obj.taskId) || 'legacy';
    // BLOCK-31 P2: done 事件携带权威 filesChanged + 任务所属会话
    emitAgentTaskDone(doneTaskId, kind, {
      filesChanged: Array.isArray(obj.filesChanged) ? obj.filesChanged : undefined,
      conversationId: opts.conversationId,
    });
    return;
  }
  if (obj.event === 'token_budget') {
    const detail: TokenBudgetDetail = {
      contextWindow: typeof obj.contextWindow === 'number' ? obj.contextWindow : 0,
      messagesTokensUsed: typeof obj.messagesTokensUsed === 'number' ? obj.messagesTokensUsed : 0,
      systemPromptTokens: typeof obj.systemPromptTokens === 'number' ? obj.systemPromptTokens : 0,
      messagesTokens: typeof obj.messagesTokens === 'number' ? obj.messagesTokens : 0,
      pct: typeof obj.pct === 'number' ? obj.pct : 0,
      trimmed: typeof obj.trimmed === 'boolean' ? obj.trimmed : false,
      knowledgeTokens: typeof obj.knowledgeTokens === 'number' ? obj.knowledgeTokens : 0,
    };
    dispatchGewuEvent(gewuEvents.tokenBudget, detail);
    return;
  }
  const delta = obj?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    onDelta(delta);
  }
  // UI-272 — 思考段增量（OpenAI 兼容 reasoning_content 字段）
  const reasoningDelta = obj?.choices?.[0]?.delta?.reasoning_content;
  if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
    onReasoning?.(reasoningDelta);
  }
}

/** 老路径：直连 SSE（fallback）。供 streamChat 提交失败兼容期回退。 */
export async function streamChatLegacy(opts: StreamChatOptions): Promise<void> {
  const { messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId, signal, onDone, onError } = opts;
  try {
    // M2-5: 离线探测，先于 fetch 触发，避免裸 fetch 报错
    await ensureOnlineOrThrow();
    const resp = await fetch(getApiPrefix() + '/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ messages, context, conversationId, modelPresetId, modelName, kind, parentTaskId }),
      signal,
    });

    if (!resp.ok || !resp.body) {
      let errText = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.message) errText = `${j.error || errText}: ${j.message}`;
        else if (j?.error) errText = String(j.error);
      } catch {
        try {
          const t = await resp.text();
          if (t) errText = `HTTP ${resp.status}: ${t.slice(0, 200)}`;
        } catch {}
      }
      throw new Error(errText);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        for (const line of rawEvent.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          const data = m[1];
          if (isSseDone(data)) {
            onDone?.();
            emitAgentTaskDone('legacy', kind, { conversationId: opts.conversationId });
            return;
          }
          try {
            const obj = JSON.parse(data);
            _handleSseEvent(obj, opts);
          } catch {
            // Bad JSON — ignore
          }
        }
      }
    }
    onDone?.();
    emitAgentTaskDone('legacy', kind, { conversationId: opts.conversationId });
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
