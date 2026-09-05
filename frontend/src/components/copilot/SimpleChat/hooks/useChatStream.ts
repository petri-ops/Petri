// ============================================================
// useChatStream — SimpleChat stream/state control custom hook
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4 (commit 3).
// Owns the 5 stream-related callbacks (send / stop / regenerate /
// queue / runInBackground) plus the internal state and effects that
// drive them: `starting` (transient send-in-progress flag), the
// `messagesRef` snapshot used by send/regenerate to read the latest
// history without stale-closure traps, the `sendRef` indirection used
// by copilotAsk subscribers and regenerate to invoke the latest
// `send` from a stable handle, the `copilotAsk` event subscription
// (3 IPC subscriptions — `projectOpenArtifact` / `copilotAsk` /
// `conversationForked` — and this hook owns only the copilotAsk
// one; the other two are dispatch-only and stay in the parent),
// and the queue drain effect that auto-fires the next queued prompt
// after a previous run finishes.
//
// 0 behavior change vs the inline callback set in SimpleChat.tsx.
// All call sites stay semantically identical: `send` still takes
// (text, contextOverride?), `stop`/`regenerate` are zero-arg,
// `queue`/`runInBackground` now take the text explicitly (the
// original read from `input` state — the parent now passes
// `input.trim()`). Hook order inside useChatStream is fixed and
// matches the prior inline order (useState → useRef → useEffect
// for messagesRef → useCallback(send) → useRef + useEffect for
// sendRef → useEffect(copilotAsk subscribe) → useCallback(stop)
// → useCallback(regenerate) → useCallback(runInBackground)
// → useCallback(queue) → useEffect(queue drain)).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import type { CopilotContext } from '@/lib/copilotContext';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { readBrandStorage } from '@/lib/brand';
import { copilotContextOverrideForAsk } from '@/lib/result-edit-agent-bridge';
import { INITIAL_NAV_STATE, type HistoryNavState } from '@/components/copilot/chatHistoryNav';
import {
  clearConversationDraft,
  migrateConversationDraft,
} from '@/components/copilot/conversationDraft';
import {
  isConversationRunning,
  startConversationRun,
  startSubAgentTask,
  stopConversationRun,
  clearConversationRun,
  type ConversationRunSnapshot,
} from '@/components/copilot/conversationRunStore';
import { type ChatMessage } from '@/components/copilot/copilotClient';
import { type SimpleMessage } from '../types';

export interface UseChatStreamArgs {
  // Props (stable from parent)
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  ownsCopilotAsk: boolean;

  // Refs — parent owns these for cross-cutting use (textarea resize,
  // history draft capture, copilot context snapshot, reconciled-run
  // marker). The hook borrows them by reference.
  taRef: React.RefObject<HTMLTextAreaElement>;
  historyNavRef: React.MutableRefObject<HistoryNavState>;
  copilotCtxRef: React.MutableRefObject<CopilotContext>;
  reconciledRunRef: React.MutableRefObject<string | null>;

  // Setters (React guarantees stable identity)
  setMessages: React.Dispatch<React.SetStateAction<SimpleMessage[]>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setQueuedPrompts: React.Dispatch<React.SetStateAction<string[]>>;

  // State values to read
  input: string;
  messages: SimpleMessage[];
  queuedPrompts: string[];
  displayMessages: SimpleMessage[];
  activeRun: ConversationRunSnapshot | null;
  activeModel: ChatModelPreset | undefined;
  activeModelId: string;
  accessMode: 'full' | 'workspace-write' | 'read';
  /** BLOCK-55 P1 — 计划模式（Spec 门）：随所有 send 路径进入请求 context。 */
  planMode: boolean;
  /** BLOCK-57 UI-290 — 会话级执行目标（设置页「默认执行目标」，localStorage 持久化；缺省 = 本机）。可选：缺省时 send 内部自行读取。 */
  executionTargetId?: string | null;

  // SWR-backed conversation creator
  createConversationForRun: (title?: string) => Promise<{ id: string } | null>;
}

export interface UseChatStreamReturn {
  /**
   * 发送一条消息。返回 Promise<boolean>：true = 已接受并启动（或进入）运行；
   * false = 因守卫（空文本 / streaming / 会话已在运行 / 启动失败）未发送。
   * BLOCK-52 P1：SimpleChat.sendWithRefs 依赖该返回值决定是否清空引用块。
   * BLOCK-55 P1：opts.freshTurn=true 时（批准并清上下文执行）消息数组仅含
   * 本条 spec 自包含首 turn，不带会话历史。
   */
  send: (
    text: string,
    contextOverride?: Partial<CopilotContext>,
    opts?: { freshTurn?: boolean }
  ) => Promise<boolean>;
  stop: () => void;
  regenerate: () => void;
  queue: (text: string) => void;
  runInBackground: (text: string) => void;
  /** Active run is streaming OR a transient send is in flight. */
  streaming: boolean;
}

/**
 * Hook that owns the chat stream lifecycle: send/stop/regenerate/queue/runInBackground.
 *
 * Hook order is fixed (see file header) — every render must call the
 * same hooks in the same order, otherwise React will throw a hooks
 * order error. The hook intentionally mirrors the inline callback
 * order that previously lived in SimpleChat.tsx, so it can be
 * substituted 1:1 at the call site without disturbing the parent's
 * surrounding hooks.
 */
export function useChatStream({
  projectId,
  conversationId,
  onConversationChange,
  ownsCopilotAsk,
  taRef,
  historyNavRef,
  copilotCtxRef,
  reconciledRunRef,
  setMessages,
  setInput,
  setQueuedPrompts,
  input,
  messages,
  queuedPrompts,
  displayMessages,
  activeRun,
  activeModel,
  activeModelId,
  accessMode,
  planMode,
  executionTargetId,
  createConversationForRun,
}: UseChatStreamArgs): UseChatStreamReturn {
  // 1. `starting` — transient send-in-progress flag (drives the
  // streaming state alongside the persistent run status).
  const [starting, setStarting] = useState(false);
  const streaming = starting || activeRun?.status === 'running';

  // 2. `messagesRef` — snapshot of the latest messages so `send` and
  // `regenerate` can read history synchronously without waiting for
  // React to re-render an updated state slot.
  const messagesRef = useRef<SimpleMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 3. `send` — primary entry point. Creates a conversation if
  // needed, builds the upstream message history, and starts a
  // durable run via conversationRunStore.
  const send = useCallback(async (
    text: string,
    contextOverride?: Partial<CopilotContext>,
    opts?: { freshTurn?: boolean }
  ): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return false;
    setStarting(true);

    try {
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        const created = await createConversationForRun('新对话');
        if (!created) return false;
        migrateConversationDraft(projectId, null, created.id);
        targetConversationId = created.id;
        onConversationChange(created.id);
      }
      if (isConversationRunning(targetConversationId)) return false;

      // BLOCK-55 P1 — 清上下文执行：仅发 spec 自包含首 turn，不带会话历史
      const history: ChatMessage[] = messagesRef.current
        .filter((m) => !m.error && !m.pending)
        .map((m) => ({ role: m.role, content: m.content }));
      const tagged: ChatMessage[] = opts?.freshTurn
        ? [{ role: 'user', content: trimmed }]
        : [...history, { role: 'user', content: trimmed }];

      const started = startConversationRun({
        conversationId: targetConversationId,
        projectId,
        userContent: trimmed,
        historyLastUserTs: [...messagesRef.current].reverse().find((message) => message.role === 'user')?.ts,
        messages: tagged,
        modelPresetId: activeModel?.endpointProfileId || activeModelId,
        modelName: activeModel?.model,
        context: {
          ...copilotCtxRef.current,
          ...(contextOverride || {}),
          page: 'desktop-project',
          projectId,
          accessMode,
          planMode,
          executionTargetId: (executionTargetId ?? (() => {
            try { return readBrandStorage('executionTargetId'); } catch { return null; }
          })()) || null,
        },
      });
      if (!started) return false;
      clearConversationDraft(projectId, conversationId);
      setInput('');
      historyNavRef.current = INITIAL_NAV_STATE;
      if (taRef.current) taRef.current.style.height = 'auto';
      return true;
    } finally {
      setStarting(false);
    }
  }, [
    accessMode,
    executionTargetId,
    activeModel,
    activeModelId,
    conversationId,
    createConversationForRun,
    onConversationChange,
    planMode,
    projectId,
    streaming,
  ]);

  // 4. `sendRef` — stable handle for the latest `send`. Used by
  // the copilotAsk event subscription and by `regenerate` so that
  // a fresh send is always available from a closure that may have
  // been captured many renders ago.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // 5. copilotAsk event subscription. One instance may own this
  // (the parent passes `ownsCopilotAsk` to gate). When triggered,
  // the latest `send` is invoked with the event's pre-snapshotted
  // context override (the override is captured at click time, so
  // passing it synchronously here matters for stability — the
  // artifact/token may drift if `await createConversationForRun`
  // happens before the override is applied).
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    const unsub = subscribeGewuEvent(gewuEvents.copilotAsk, (detail) => {
      const { prompt, analysisMode } = detail;
      const p = typeof prompt === 'string' ? prompt.trim() : '';
      if (!p) return;
      if (analysisMode) {
        void runInBackground(p);
      } else {
        void sendRef.current(p, copilotContextOverrideForAsk(detail));
      }
    });
    return unsub;
  }, [ownsCopilotAsk]);

  // 6. `stop` — terminates the active run for the current conversation.
  const stop = useCallback(() => {
    if (conversationId) stopConversationRun(conversationId);
  }, [conversationId]);

  // 7. `regenerate` — re-sends the most recent user message with
  // the current model, replacing the trailing (user, assistant)
  // pair. Snapshots the stripped history into messagesRef before
  // delegating to the latest `send`.
  const regenerate = useCallback(() => {
    if (!conversationId || streaming) return;
    const lastUser = [...displayMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content) return;
    const stripped = (() => {
      let arr = messagesRef.current.slice();
      if (arr.length && arr[arr.length - 1].role === 'assistant') arr = arr.slice(0, -1);
      if (arr.length && arr[arr.length - 1].role === 'user') arr = arr.slice(0, -1);
      return arr;
    })();
    messagesRef.current = stripped;
    setMessages(stripped);
    // Drop any stale run snapshot so it doesn't re-inject the old user/assistant.
    clearConversationRun(conversationId);
    void sendRef.current(lastUser.content);
  }, [conversationId, streaming, displayMessages]);

  // 8. `runInBackground` — spawn a sub-agent task while the
  // primary conversation loop is busy. Requires an active parent
  // task (activeRun?.taskId); the parent Claude/Codex/Codex
  // subagent system (biof3-server) provides the routing.
  const runInBackground = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId) return;
    const parentTaskId = activeRun?.taskId;
    if (!parentTaskId) return;
    const tagged: ChatMessage[] = messagesRef.current
      .filter((m) => !m.error && !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));
    tagged.push({ role: 'user', content: trimmed });
    startSubAgentTask({
      conversationId,
      projectId,
      userContent: trimmed,
      messages: tagged,
      parentTaskId,
      modelPresetId: activeModel?.endpointProfileId || activeModelId,
      modelName: activeModel?.model,
      context: {
        ...copilotCtxRef.current,
        page: 'desktop-project',
        projectId,
        accessMode,
        planMode,
      },
    });
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [accessMode, activeModel, activeModelId, activeRun, conversationId, messages, planMode, projectId]);

  // 9. `queue` — push the current composer text into the queued
  // prompts list. Only allowed while a run is already streaming;
  // the drain effect (next hook) auto-fires the queued prompt
  // once the run completes and the SQLite history has been
  // reconciled.
  const queue = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !streaming) return;
    setQueuedPrompts((current) => [...current, trimmed].slice(-5));
    setInput('');
    historyNavRef.current = INITIAL_NAV_STATE;
    clearConversationDraft(projectId, conversationId);
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [conversationId, projectId, streaming]);

  // 10. Queue drain effect — fires one queued prompt only after
  // the completed run has been reconciled from SQLite, so the
  // next turn receives the durable conversation history. Replaces
  // the inline effect that previously lived in SimpleChat.tsx.
  useEffect(() => {
    if (streaming || queuedPrompts.length === 0 || !conversationId) return;
    if (activeRun?.completedAt
      && reconciledRunRef.current !== `${conversationId}:${activeRun.completedAt}`) return;
    const [next, ...rest] = queuedPrompts;
    setQueuedPrompts(rest);
    void send(next);
  }, [activeRun, conversationId, messages, queuedPrompts, send, streaming]);

  // `input` is read by the public API surface (the parent passes
  // input.trim() into queue/runInBackground), so we intentionally
  // reference it here to keep the callback deps aligned with the
  // intent, even though the hook signatures take an explicit text
  // parameter. Without this reference, the hook usage would
  // become inert to `input` changes the parent would otherwise
  // expect to be observed.
  void input;

  return { send, stop, regenerate, queue, runInBackground, streaming };
}
