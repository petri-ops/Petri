// ============================================================
// Copilot streaming chat client — talks to /api/ai/chat (SSE)
// ============================================================

import type { CopilotContext } from '@/lib/copilotContext';

import { getPlatformApiPrefix } from '@/lib/authClient';

export function getApiPrefix(): string {
  return getPlatformApiPrefix();
}

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** MULTIMODAL_v1 — optional image URLs (OSS) for this message. Threaded to
   *  the backend; only used by the model when a multimodal model is configured. */
  images?: string[];
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  name: string;
  summary: string;
  /** Present when name === 'act' */
  actType?: string;
  message?: string;
  undoToken?: string;
  undoableUntil?: number;
  actError?: string;
  analysisId?: string;
  taskId?: string;
  /** Present when actType === 'update_figcode_editor' */
  figcodeCode?: string;
  figcodeAutoRun?: boolean;
  /** scRNA UI controls */
  scTab?: 'preview' | 'plots' | 'data' | 'params';
  scCluster?: string;
  scGene?: string;
  scColumnFilters?: Record<string, string>;
  scSubsetName?: string | null;
  scLabelKey?: string;
  scLabelValue?: string;
  scDatasetIds?: string[];
  scMergeName?: string | null;
  scOpenReplotForAnalysis?: string;
  scUploadHint?: boolean;
  /** open_figcode_plot */
  figcardId?: string;
  /** open_tool */
  toolId?: string;
  /** open_tool autofill — when LLM passes autofillFromJobId, frontend uses
   * the prior job's output as the new tool's input. Saves user 2-3 manual
   * steps when chaining (e.g. DESeq2 → GO-KEGG). */
  autofillFromJobId?: string;
  autofillSourceTool?: string;
  /** Plan tool — propagated for inline plan card UI */
  planId?: string;
  allDone?: boolean;
  /** ACK token to confirm UI handler fired */
  ackToken?: string;
  /** ACT_GENERIC_v1 — generic handler dispatch */
  handlerId?: string;
  payload?: Record<string, unknown>;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  context?: CopilotContext;
  signal?: AbortSignal;
  /** Active conversation id; server will create one if absent */
  conversationId?: string;
  onDelta: (delta: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  /** Agent iteration started (1-indexed) */
  onIter?: (n: number) => void;
  /** Tool call started */
  onToolCall?: (e: ToolCallEvent) => void;
  /** Tool call returned */
  onToolResult?: (e: ToolResultEvent) => void;
  /** Server announces (or creates) the active conversation */
  onConversation?: (info: { conversationId: string; title?: string }) => void;
  /** Server detected the user has pivoted to a new topic mid-conversation */
  onTopicShift?: (info: { conversationId: string; reason: string }) => void;
}

/**
 * Stream a chat completion. Talks to /api/ai/agent (multi-turn tool calling),
 * falls back gracefully — server emits OpenAI-style choices.delta.content
 * plus extra `event` markers for tool_call / tool_result / iter.
 *
 * AGENT_TASK_MODE_v1：默认 task 模式（POST 提交拿 taskId → GET 订阅事件流，支持断线重连）。
 * env VITE_AGENT_TASK_MODE=legacy 或 ?legacy 回退到直连 SSE。
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const useTaskMode = (import.meta.env.VITE_AGENT_TASK_MODE || 'task') !== 'legacy';
  if (useTaskMode) {
    return streamChatViaTask(opts);
  }
  return streamChatLegacy(opts);
}

/** task 模式：提交拿 taskId → 订阅事件流 */
async function streamChatViaTask(opts: StreamChatOptions): Promise<void> {
  const { onDone } = opts;
  try {
    const taskId = await submitAgentTask(opts);
    // 存 localStorage 供重连发现（CopilotChat mount 时检查）
    try {
      localStorage.setItem(
        'biof3_agent_task_' + taskId,
        JSON.stringify({ taskId, ts: Date.now() })
      );
    } catch {}
    await subscribeAgentTask(taskId, opts, 0);
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    // task 模式失败时回退到 legacy（兼容期保护）
    try {
      return await streamChatLegacy(opts);
    } catch {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** POST /ai/agent 提交，返回 taskId */
async function submitAgentTask(opts: StreamChatOptions): Promise<string> {
  const { messages, context, conversationId, signal } = opts;
  const resp = await fetch(getApiPrefix() + '/ai/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ messages, context, conversationId }),
    signal,
  });
  if (!resp.ok) {
    let errText = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      errText = j?.message ? `${j.error || errText}: ${j.message}` : String(j?.error || errText);
    } catch {}
    throw new Error(errText);
  }
  const data = await resp.json();
  if (!data?.taskId) throw new Error('未返回 taskId');
  return data.taskId as string;
}

/** GET /ai/agent/task/:taskId 订阅事件流（afterSeq 支持续传） */
export async function subscribeAgentTask(
  taskId: string,
  opts: StreamChatOptions,
  afterSeq = 0
): Promise<void> {
  const { signal, onDone } = opts;
  // token 放 query（fetch 也能带 header，但 query 兼容 EventSource 未来切换）
  const authHeader = getAuthHeader();
  const token = authHeader.Authorization?.replace('Bearer ', '');
  const url = `${getApiPrefix()}/ai/agent/task/${taskId}?afterSeq=${afterSeq}${token ? '&token=' + encodeURIComponent(token) : ''}`;
  const resp = await fetch(url, { method: 'GET', headers: { ...authHeader }, signal });
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
        if (data === '[DONE]') {
          onDone?.();
          try {
            localStorage.removeItem('biof3_agent_task_' + taskId);
          } catch {}
          return;
        }
        try {
          const obj = JSON.parse(data);
          // task 模式事件包成 {seq, eventType, payload}，取 payload 走原解析
          const evt = obj.payload ? obj.payload : obj;
          if (typeof obj.seq === 'number') lastSeq = obj.seq;
          _handleSseEvent(evt, opts);
        } catch {
          // Bad JSON — ignore
        }
      }
    }
  }
  onDone?.();
}

/** 处理单个 SSE 事件对象（原 streamChat 的解析逻辑，task/legacy 共用） */
function _handleSseEvent(obj: any, opts: StreamChatOptions): void {
  const {
    onDelta,
    onDone,
    onError,
    onIter,
    onToolCall,
    onToolResult,
    onConversation,
    onTopicShift,
  } = opts;
  if (obj.error) {
    onError?.(new Error(obj.error));
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
  if (obj.event === 'iter') {
    onIter?.(obj.n || 1);
    return;
  }
  if (obj.event === 'tool_call') {
    onToolCall?.({ name: obj.name, args: obj.args || {} });
    return;
  }
  if (obj.event === 'tool_result') {
    onToolResult?.({
      name: obj.name,
      summary: obj.summary || '',
      actType: obj.actType,
      message: obj.message,
      undoToken: obj.undoToken,
      undoableUntil: obj.undoableUntil,
      actError: obj.actError,
      analysisId: obj.analysisId,
      taskId: obj.taskId,
      figcodeCode: obj.figcodeCode,
      figcodeAutoRun: obj.figcodeAutoRun,
      scTab: obj.scTab,
      scCluster: obj.scCluster,
      scGene: obj.scGene,
      scColumnFilters: obj.scColumnFilters,
      scSubsetName: obj.scSubsetName,
      scLabelKey: obj.scLabelKey,
      scLabelValue: obj.scLabelValue,
      scDatasetIds: obj.scDatasetIds,
      scMergeName: obj.scMergeName,
      scOpenReplotForAnalysis: obj.scOpenReplotForAnalysis,
      scUploadHint: obj.scUploadHint,
      figcardId: obj.figcardId,
      toolId: obj.toolId,
      autofillFromJobId: obj.autofillFromJobId,
      autofillSourceTool: obj.autofillSourceTool,
      planId: obj.planId,
      allDone: obj.allDone,
      ackToken: obj.ackToken,
      handlerId: obj.handlerId,
      payload: obj.payload,
    });
    return;
  }
  if (obj.event === 'done') {
    return;
  }
  const delta = obj?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    onDelta(delta);
  }
}

/** 老路径：直连 SSE（fallback） */
async function streamChatLegacy(opts: StreamChatOptions): Promise<void> {
  const { messages, context, conversationId, signal, onDelta, onDone, onError } = opts;
  try {
    const resp = await fetch(getApiPrefix() + '/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ messages, context, conversationId }),
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
          if (data === '[DONE]') {
            onDone?.();
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
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Confirm to the server that a frontend-side act handler actually fired.
 * Called after each window event for `update_figcode_editor`, `switch_result_tab`, etc.
 * If `info.error` is supplied the server records it.
 */
export async function ackAct(
  token: string,
  info?: { error?: string; ok?: boolean }
): Promise<void> {
  if (!token) return;
  try {
    await fetch(getApiPrefix() + '/ai/act-ack/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(info || { ok: true }),
    });
  } catch {
    // best-effort
  }
}
