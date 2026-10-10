// ============================================================
// Agent task 事件流：订阅（afterSeq 续传）、有界退避重连、
// SSE 事件分发（task/legacy 共用）与 legacy 直连流。
// ============================================================

import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import type { TokenBudgetDetail } from '@/lib/events';
import { isProjectionEnv } from '@/lib/projectionDataBridges';
import { emitAgentTaskDone, getApiPrefix, getAuthHeader } from './apiBase';
import {
  parseResultEditProgressEvent,
  parseToolCallEvent,
  parseToolOutputEvent,
  parseToolResultEvent,
} from './parse';
import type { AgentTaskTodoItem, KnowledgeCitation, StreamChatOptions } from './types';

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

/**
 * BLOCK-159 P1-6 — 水位续传使重连安全（服务端 DB 按 afterSeq 持久回放 +
 * 前端 BLOCK-151 单调 seq 守卫已在），重试不再设硬上限：隧道长断恢复后照常
 * 补齐事件收口，而不是旧 24 次/90s 烧窗后误判「任务在完成前中断」。
 * 退避 1s 指数到 30s 封顶 + ±30% 抖动（多设备同时回连不踩同一瞬）。
 */
const STREAM_RECONNECT_BASE_DELAY_MS = 1000;
const STREAM_RECONNECT_MAX_DELAY_MS = 30_000;

function streamRetryDelayMs(attempt: number): number {
  const capped = Math.min(
    STREAM_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
    STREAM_RECONNECT_MAX_DELAY_MS
  );
  const jitter = 1 + (Math.random() * 2 - 1) * 0.3;
  return Math.max(250, Math.round(capped * jitter));
}

/**
 * BLOCK-162 P3 — 投影环境 WS-first：单连接 /m/api/ws（进程内即时推送，无 500ms
 * 轮询地板），传输级连续失败 3 次 → 5 分钟内直走既有 SSE（防代理拦死 upgrade 的
 * 死循环），随后恢复尝试。水位无限重连/退避抖动/非水位错误不重试语义全部不变
 * （外层循环共用，仅单次订阅尝试内部换传输）。
 */
const WS_FALLBACK_FAILURE_THRESHOLD = 3;
const WS_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000;
let wsFailStreak = 0;
let wsDisabledUntil = 0;

function shouldTryWs(): boolean {
  return (
    isProjectionEnv()
    && typeof WebSocket !== 'undefined'
    && Date.now() >= wsDisabledUntil
  );
}

/**
 * SSE wire 事件形状（BLOCK-105 §7 Batch-5 类型化；JSON.parse 出站边界契约文档）。
 * 字段默认 unknown＝后端可能发任意 JSON，运行时防御式解析（typeof/Array.isArray/String）
 * 保持原样；本接口只锁定期望形状供编译期检查，不改变任何运行时行为。
 */
export interface AgentSseEvent {
  /** task 模式信封判别字段 */
  event?: unknown;
  seq?: unknown;
  /** task 模式信封：{seq, eventType, payload}——取 payload 走原解析 */
  payload?: AgentSseEvent;
  /** legacy OpenAI 兼容增量（choices[0].delta.content / reasoning_content） */
  choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
  // —— task/loop 事件字符串字段（wire 契约；运行时 String()/|| 防御保持原样）——
  childTaskId?: string;
  status?: string;
  summaryHead?: string;
  phase?: string;
  message?: string;
  content?: string;
  loopRunId?: string;
  iterationId?: string;
  decision?: string;
  decisionReasonCode?: string;
  publicConclusion?: string;
  automationMode?: string;
  proposedActionKey?: string;
  actionKeyHash?: string;
  reason?: string;
  [key: string]: unknown;
}

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

/** GET /ai/agent/task/:taskId 订阅事件流（afterSeq 支持续传；断线水位重试不设硬上限） */
export async function subscribeAgentTask(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<void> {
  let seq = afterSeq;
  for (let attempt = 0; ; attempt++) {
    const useWs = shouldTryWs();
    try {
      seq = await (useWs
        ? subscribeAgentTaskOnceWs(taskId, opts, seq)
        : subscribeAgentTaskOnce(taskId, opts, seq));
      wsFailStreak = 0;
      return;
    } catch (err: unknown) {
      if (err instanceof AgentStreamDisconnectedError) {
        if (useWs) {
          wsFailStreak += 1;
          if (wsFailStreak >= WS_FALLBACK_FAILURE_THRESHOLD) {
            wsDisabledUntil = Date.now() + WS_FALLBACK_COOLDOWN_MS;
          }
        }
        // 断线时已收到的最后 seq（可能大于进入时的 afterSeq），重连从其后续传。
        // 终态任务重连会回放 done/error/[DONE] 正常收口；非水位可续错误
        // （HTTP 4xx/5xx、用户 abort）不是本类型，照旧上抛不重试。
        seq = err.lastSeq;
        const nextRetryMs = streamRetryDelayMs(attempt);
        // 等待期间用户主动停止 → AbortError 上抛（调用方静默处理）
        opts.onStreamReconnecting?.({ taskId, attempt: attempt + 1, lastSeq: seq, nextRetryMs });
        await abortableDelay(nextRetryMs, opts.signal);
        continue;
      }
      throw err;
    }
  }
}

/** 单次 WS 订阅尝试：/m/api/ws 单连接；done 帧收口返回 lastSeq，传输断开抛 AgentStreamDisconnectedError(lastSeq)。 */
function subscribeAgentTaskOnceWs(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let lastSeq = afterSeq;
    let settled = false;
    let doneFiles: Array<{ path: string; status: string }> | undefined;
    const protocol = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${protocol}//${location.host}/m/api/ws`);
    } catch {
      reject(new AgentStreamDisconnectedError('WS 建连失败', afterSeq));
      return;
    }
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      try { ws.close(); } catch { /* 已关 */ }
      fn();
    };
    const onAbort = () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      settle(() => reject(err));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    ws.onopen = () => {
      try { ws.send(JSON.stringify({ t: 'sub', taskId, afterSeq: lastSeq })); } catch { /* close 会接手 */ }
    };
    ws.onmessage = (event) => {
      let msg: {
        t?: string; taskId?: string; seq?: number; eventType?: string; payload?: AgentSseEvent;
        status?: string; error?: string; resumable?: boolean; interruptedAt?: string | null;
        fallbackTaskId?: string | null; fallbackLabel?: string | null; fallbackCategory?: string | null;
        filesChanged?: unknown; message?: string;
      };
      try { msg = JSON.parse(String(event.data)) as typeof msg; } catch { return; }
      if (msg.t === 'ev') {
        if (typeof msg.seq === 'number' && msg.seq > lastSeq) lastSeq = msg.seq;
        // 信封形状与 SSE 对齐：{seq,eventType,payload}，payload 走原分发
        const evt = msg.payload ?? { seq: msg.seq, eventType: msg.eventType };
        if (evt && evt.event === 'done' && Array.isArray(evt.filesChanged)) {
          doneFiles = evt.filesChanged as Array<{ path: string; status: string }>;
        }
        _handleSseEvent(evt, opts);
        return;
      }
      if (msg.t === 'done') {
        if (msg.status === 'failed') {
          _handleSseEvent({
            event: 'error',
            error: msg.error,
            resumable: msg.resumable === true,
            interruptedAt: msg.interruptedAt ?? null,
            fallbackTaskId: msg.fallbackTaskId ?? null,
            fallbackLabel: msg.fallbackLabel ?? null,
            fallbackCategory: msg.fallbackCategory ?? null,
          }, opts);
        } else if (msg.status === 'cancelled') {
          _handleSseEvent({ event: 'agent_cancelled' }, opts);
        } else {
          if (Array.isArray(msg.filesChanged)) {
            doneFiles = msg.filesChanged as Array<{ path: string; status: string }>;
          }
          _handleSseEvent({ event: 'done', filesChanged: msg.filesChanged }, opts);
        }
        settle(() => {
          opts.onDone?.();
          emitAgentTaskDone(taskId, opts.kind, {
            filesChanged: doneFiles,
            conversationId: opts.conversationId,
          });
          resolve(lastSeq);
        });
        return;
      }
      if (msg.t === 'err') {
        // 服务端业务错（task_not_found/forbidden/too_many）：非水位可续，不重试
        settle(() => reject(new Error(`WS ${msg.message || 'error'}`)));
      }
      // pong/未知帧：忽略
    };
    ws.onerror = () => settle(() => reject(new AgentStreamDisconnectedError('WS 连接中断', lastSeq)));
    ws.onclose = () => {
      if (!settled) settle(() => reject(new AgentStreamDisconnectedError('WS 连接在完成前关闭', lastSeq)));
    };
  });
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
  const url = `${getApiPrefix()}/ai/agent/task/${taskId}?afterSeq=${afterSeq}`;
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
          const obj = JSON.parse(data) as AgentSseEvent;
          // task 模式事件包成 {seq, eventType, payload}，取 payload 走原解析
          const evt = obj.payload ? obj.payload : obj;
          // BLOCK-151 A1 — lastSeq 单调守卫：只前进不回退。服务端重启后 seq 计数
          // 回退（或代理重放旧事件）时，回退赋值会让重连 afterSeq 倒退 → 已收事件
          // 重复下发（增量重复拼接/工具行重复渲染）。seq 天然单调，等值/回退均忽略。
          if (typeof obj.seq === 'number' && obj.seq > lastSeq) lastSeq = obj.seq;
          if (evt && evt.event === 'done' && Array.isArray(evt.filesChanged)) {
            doneFiles = evt.filesChanged as Array<{ path: string; status: string }>;
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
function parseTaskTodoEvent(obj: AgentSseEvent): AgentTaskTodoItem[] {
  const rawItems = Array.isArray(obj.items) ? (obj.items as Array<Record<string, unknown>>) : [];
  const items: AgentTaskTodoItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
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
function _handleSseEvent(obj: AgentSseEvent, opts: StreamChatOptions): void {
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

function _dispatchSseEvent(obj: AgentSseEvent, opts: StreamChatOptions): void {
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
    onMessagePersistFailed,
    onLoopPhase,
    onLoopIteration,
    onChildFinished,
    onModelFallback,
    kind,
  } = opts;
  if (obj.error) {
    // BLOCK-38 P2: 后端 error 事件携带 resumable/interruptedAt（服务中断清扫标记）
    // BLOCK-56 P1: 任务级降级时后端已自动新建续跑 task，error 附带 fallbackTaskId
    onError?.(new Error(obj.error as string), {
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
    onConversation?.({ conversationId: obj.conversationId as string, title: obj.title as string | undefined });
    return;
  }
  if (obj.event === 'topic_shift') {
    onTopicShift?.({ conversationId: obj.conversationId as string, reason: (obj.reason as string) || '' });
    return;
  }
  // BLOCK-150 ③ — 持久化失败诚实呈现：后端 appendAssistantMessage 落库失败时
  // emit（BLOCK-102 P1 事件），转发给 store 落会话级 notice。
  if (obj.event === 'message_persist_failed') {
    onMessagePersistFailed?.({
      conversationId: obj.conversationId as string,
      role: typeof obj.role === 'string' && obj.role ? obj.role : 'assistant',
    });
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
    onIter?.((obj.n as number) || 1);
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
      ? (obj.citations as Array<Record<string, unknown>>)
          .map((c): KnowledgeCitation | null =>
            c && typeof c === 'object'
              ? {
                  docId: typeof c.docId === 'string' ? c.docId : undefined,
                  docName: typeof c.docName === 'string' ? c.docName : undefined,
                  seq: typeof c.seq === 'number' ? c.seq : undefined,
                  channels:
                    c.channels && typeof c.channels === 'object'
                      ? {
                          vector: typeof (c.channels as { vector?: unknown }).vector === 'number'
                            ? (c.channels as { vector?: number }).vector
                            : undefined,
                          fts: typeof (c.channels as { fts?: unknown }).fts === 'number'
                            ? (c.channels as { fts?: number }).fts
                            : undefined,
                        }
                      : undefined,
                }
              : null
          )
          .filter((c): c is KnowledgeCitation => c !== null)
      : [];
    onKnowledgeCitations?.({ citations });
    return;
  }
  if (obj.event === 'done') {
    const doneTaskId =
      (typeof obj.taskId === 'string' && obj.taskId) || 'legacy';
    // BLOCK-31 P2: done 事件携带权威 filesChanged + 任务所属会话
    emitAgentTaskDone(doneTaskId, kind, {
      filesChanged: Array.isArray(obj.filesChanged)
        ? (obj.filesChanged as Array<{ path: string; status: string }>)
        : undefined,
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
    dispatchPetriEvent(petriEvents.tokenBudget, detail);
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
