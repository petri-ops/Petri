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

import {
  migrateThinkingLevel,
  type ThinkingLevel,
} from '../../thinkingLevel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import type { CopilotContext } from '@/lib/copilotContext';
import { petriEvents, subscribePetriEvent , dispatchPetriEvent } from '@/lib/events';
import { readBrandStorage } from '@/lib/brand';
import { copilotContextOverrideForAsk } from '@/lib/result-edit-agent-bridge';
import { INITIAL_NAV_STATE, type HistoryNavState } from '@/components/copilot/chatHistoryNav';
import {
  clearConversationDraft,
  migrateConversationDraft,
} from '@/components/copilot/conversationDraft';
import {
  getConversationRunSnapshot,
  isConversationRunning,
  startConversationRun,
  startSubAgentTask,
  stopConversationRun,
  clearConversationRun,
  type ConversationRunSnapshot,
} from '@/components/copilot/conversationRunStore';
import { type ChatMessage } from '@/components/copilot/copilotClient';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { resolveAutoPreset } from '@/lib/auto-model';
import { createTurnCheckpoint } from '@/lib/turn-checkpoints';
import { type SimpleMessage } from '../types';

/** BLOCK-102 P2 — 排队追问带会话归属：drain 只消费当前会话的条目，
 *  修复「流式期间切会话后 A 的追问注入 B 会话」竞态。 */
export interface QueuedPrompt {
  /** BLOCK-178 P1 — 稳定条目 ID（撤回/立即发送/排序的单一锚点）。 */
  id: string;
  conversationId: string | null;
  text: string;
  createdAt: number;
}

/** BLOCK-178 P1 — 队列上限（超限诚实提示，不再静默丢最旧）。 */
export const QUEUE_CAP = 20;

let _queueSeq = 0;

/** BLOCK-178 P1 — 入队纯函数（稳定 ID + 上限 + 诚实溢出；测试直打）。 */
export function enqueueQueuedPrompt(
  current: QueuedPrompt[],
  text: string,
  conversationId: string | null,
): { next: QueuedPrompt[]; ok: boolean; overflow: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { next: current, ok: false, overflow: false };
  if (current.length >= QUEUE_CAP) {
    return { next: current, ok: false, overflow: true };
  }
  _queueSeq += 1;
  const entry: QueuedPrompt = {
    id: `q_${Date.now().toString(36)}_${_queueSeq}`,
    conversationId,
    text: trimmed,
    createdAt: Date.now(),
  };
  return { next: [...current, entry], ok: true, overflow: false };
}

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
  setQueuedPrompts: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;

  // State values to read
  input: string;
  messages: SimpleMessage[];
  queuedPrompts: QueuedPrompt[];
  /** BLOCK-178 P1 — 自动排水开关（暂停后跑完不自动发；管理面可见）。 */
  autoDrain: boolean;
  displayMessages: SimpleMessage[];
  activeRun: ConversationRunSnapshot | null;
  activeModel: ChatModelPreset | undefined;
  activeModelId: string;
  /** BLOCK-225 — D4 Auto：发送时按任务/附件解析模型（默认关=直接用 activeModel）。 */
  autoModel?: boolean;
  modelPresets?: ChatModelPreset[];
  modelCatalog?: import('@/lib/model-catalog').ModelCatalogState;
  roleBindings?: Record<string, string>;
  /** BLOCK-225 — 当前输入是否带图片引用（决定 vision 优先）。 */
  hasImages?: () => boolean;
  // UI-303 — 四档：'plan'（计划模式并入档位菜单，Spec 门）
  accessMode: 'full' | 'workspace-write' | 'plan' | 'read';
  /** BLOCK-55 P1 — 计划模式（Spec 门）：随所有 send 路径进入请求 context。UI-303 起由 accessMode='plan' 派生。 */
  planMode: boolean;
  /** BLOCK-57 UI-290 — 会话级执行目标（设置页「默认执行目标」，localStorage 持久化；缺省 = 本机）。可选：缺省时 send 内部自行读取。 */
  executionTargetId?: string | null;

  // SWR-backed conversation creator
  createConversationForRun: (title?: string) => Promise<{ id: string } | null>;
  /** BLOCK-81 P2 — 会话级思考档位（缺省/standard＝不发任何上游思考参数） */
  thinkingLevel?: ThinkingLevel;
  /** CK-01（C-06）— 运行中发送自动 steer 的回执回调：ok=true 已入队（depth=排队深度），
   *  ok=false 转向失败（error=原因，调用方应保留输入）。缺省=静默（回归原行为）。 */
  onSteer?: (info: { ok: boolean; text: string; depth?: number; error?: string }) => void;
  /**
   * UI-373 — 发送前置守卫：返回非空字符串 = 拦截本次发送（侧效应由守卫自身
   * 负责，如欢迎页未选项目时展开项目选择器）。守卫在空文本/streaming 检查
   * 之后、建会话之前执行，覆盖 Enter / copilotAsk（快捷 chips）全部发送路径。
   */
  sendGuard?: () => string | null;
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
  /** BLOCK-178 P1 — 删除队列项。 */
  removeQueuedById: (id: string) => void;
  /** BLOCK-178 P1 — 撤回队列项（出队并交还文本供编辑重发）。 */
  withdrawQueued: (id: string) => { ok: boolean; text?: string };
  /** BLOCK-178 P1 — 上移/下移（同名会话子序列内换位）。 */
  moveQueued: (id: string, dir: -1 | 1) => void;
  /** BLOCK-178 P1 — 立即发送：挪到会话子序列首位并停当前轮，排水优先消费。 */
  sendNowQueued: (id: string) => boolean;
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
  onSteer,
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
  autoDrain,
  displayMessages,
  activeRun,
  activeModel,
  activeModelId,
  autoModel,
  modelPresets,
  modelCatalog,
  roleBindings,
  hasImages,
  accessMode,
  planMode,
  executionTargetId,
  createConversationForRun,
  thinkingLevel,
  sendGuard,
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

  // BLOCK-225 — D4：每轮发送前解析实际模型（不写回 active 绑定）。
  const resolveModelForSend = useCallback((withImages: boolean) => {
    if (!autoModel) return activeModel;
    return resolveAutoPreset({
      presets: modelPresets || [],
      catalog: modelCatalog,
      roleBindings,
      hasImages: withImages,
      fallbackId: activeModelId,
    })?.preset || activeModel;
  }, [activeModel, activeModelId, autoModel, modelCatalog, modelPresets, roleBindings]);

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
    // UI-373 — 宿主发送守卫（欢迎页：未选项目不得建会话）。拦截时把文本退回
    // 输入框保留（copilotAsk 直发路径的 chip prompt 不再凭空丢失；Enter 路径
    // 本就等于当前输入，无损），展开选择器等侧效应由守卫自身负责。
    if (sendGuard?.()) {
      setInput(text);
      return false;
    }
    setStarting(true);

    try {
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        const created = await createConversationForRun('新对话');
        if (!created) return false;
        migrateConversationDraft(projectId, null, created.id);
        // BLOCK-81 P2 — 档位随新会话落到新键（否则首轮之后丢档）
        migrateThinkingLevel(projectId, null, created.id);
        targetConversationId = created.id;
        onConversationChange(created.id);
        // 广播新会话（AppRailContext 订阅后即时刷新左栏项目树——用户反馈「左侧列表不实时更新」）
        try {
          dispatchPetriEvent(petriEvents.conversationCreated, {
            conversationId: created.id,
            title: (created as { title?: string }).title,
            projectId: projectId || null,
          });
        } catch {
          // 事件总线失败不阻塞发送
        }
      }
      // CK-01（C-06）— 运行中发送自动改走 steer 通道：不再静默吞掉，POST
      // task/:id/steer 入队（下一轮模型请求边界注入，后端 BLOCK-98 M4）。
      // 诚实边界：入队即不可撤（已在后端队列），成功回执经 onSteer 行内提示；
      // 失败（404/非运行/网络）回退原行为——文本退回输入框保留。
      if (isConversationRunning(targetConversationId)) {
        const runTaskId = getConversationRunSnapshot(targetConversationId)?.taskId;
        if (!runTaskId) return false; // 极旧运行态无 taskId：保持原静默行为
        try {
          const resp = await fetch(getApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/steer', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
            },
            body: JSON.stringify({ message: trimmed }),
          });
          const data = (await resp.json().catch(() => ({}))) as { ok?: unknown; depth?: unknown; error?: unknown; message?: unknown };
          if (resp.ok && data.ok) {
            onSteer?.({ ok: true, text: trimmed, depth: typeof data.depth === 'number' ? data.depth : undefined });
            return true; // 已受理：调用方按既有 ok=true 语义清空输入与引用块
          }
          const reason = typeof data.message === 'string' && data.message
            ? data.message
            : typeof data.error === 'string' && data.error ? data.error : 'HTTP ' + resp.status;
          onSteer?.({ ok: false, text: trimmed, error: reason });
          setInput(text);
          return false;
        } catch (e) {
          onSteer?.({ ok: false, text: trimmed, error: e instanceof Error ? e.message : '网络错误' });
          setInput(text);
          return false;
        }
      }

      // BLOCK-244 Q1-REM — 发送同时发起工作树快照（best-effort，不 await）：
      // 非 git/非桌面/失败都不登记也不阻断发送；ref 落 localStorage 供编辑重发回退。
      // 不 await 的缘由：await 会把快照塞进 send 的宏任务链，与既有 drain 守卫测试
      // （fake timers + act 收敛）冲突，发送链路不得被安全网拖住。
      void createTurnCheckpoint({ projectId, conversationId: targetConversationId, text: trimmed });

      // BLOCK-55 P1 — 清上下文执行：仅发 spec 自包含首 turn，不带会话历史
      const history: ChatMessage[] = messagesRef.current
        .filter((m) => !m.error && !m.pending)
        .map((m) => ({ role: m.role, content: m.content }));
      const tagged: ChatMessage[] = opts?.freshTurn
        ? [{ role: 'user', content: trimmed }]
        : [...history, { role: 'user', content: trimmed }];

      const sendModel = resolveModelForSend(hasImages ? hasImages() : false);
      const started = startConversationRun({
        conversationId: targetConversationId,
        projectId,
        userContent: trimmed,
        historyLastUserTs: [...messagesRef.current].reverse().find((message) => message.role === 'user')?.ts,
        messages: tagged,
        modelPresetId: sendModel?.endpointProfileId || sendModel?.id || activeModelId,
        modelName: sendModel?.model,
        // BLOCK-81 P2 — 思考档位随本轮下发（后端按 profile 能力位门控后映射上游参数）
        thinkingLevel,
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
      // UI-341 实机抓真修：空会话发送路径上 migrateConversationDraft 已把
      // 待发文本迁到新会话键（启动失败时的保底），启动成功后旧键与新会话键
      // 都必须清除——只清旧键会让已发送文本留在 proj:<convId> 下，工作区
      // composer 挂载读草稿时把它回填（看起来像没发出去，且易误触发重发）。
      clearConversationDraft(projectId, conversationId);
      clearConversationDraft(projectId, targetConversationId);
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
    // UI-373 — 守卫闭包须新鲜（宿主按选中态切换守卫）
    sendGuard,
    // CK-01 — steer 回执闭包须新鲜（行内提示读取最新 setState）
    onSteer,
    streaming,
    // BLOCK-81 P3 实机抓真修：`send` 闭包读了 thinkingLevel，漏进依赖数组会让
    // 「切档位后不刷新页面直接发送」沿用挂载时的旧档位——控件显示「高」而请求体
    // 仍是 standard（上游收不到 reasoning_effort），档位静默失效。sendRef 经
    // [send] 同步，此处补齐后自动恢复新鲜。
    thinkingLevel,
  ]);

  // 4. `sendRef` — stable handle for the latest `send`. Used by
  // the copilotAsk event subscription and by `regenerate` so that
  // a fresh send is always available from a closure that may have
  // been captured many renders ago.
  const sendRef = useRef(send);
  // BLOCK-102 P2 — runInBackground 同款 latest-ref（copilotAsk 订阅 effect 经 ref
  // 读取最新引用，避免闭包锁定首帧）；定义在 349 行，此处先置空、return 前回填。
  const runInBackgroundRef = useRef<(text: string) => void>(() => {});
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
    const unsub = subscribePetriEvent(petriEvents.copilotAsk, (detail) => {
      const { prompt, analysisMode } = detail;
      const p = typeof prompt === 'string' ? prompt.trim() : '';
      if (!p) return;
      if (analysisMode) {
        // BLOCK-102 P2 — 经 ref 取最新引用：effect deps 只有 ownsCopilotAsk，
        // 直接闭包捕获会锁定首帧的 runInBackground（activeRun 恒 null）。
        void runInBackgroundRef.current(p);
      } else {
        void sendRef.current(p, copilotContextOverrideForAsk(detail));
      }
    });
    return unsub;
  }, [ownsCopilotAsk]);

  // 6. `stop` — terminates the active run for the current conversation.
  // BLOCK-171 CP-1 — Stop 贯通后端：POST task/:taskId/cancel（context.js
  // cancelAgentTaskCascade 级联主任务+子 agent → loop controller 预轮检查收尾）。
  // 本地态翻转保留即时反馈；后端请求 fire-and-forget（网络失败不阻塞本地停止，
  // run 终态以 SSE/对账投影为准）。
  const stop = useCallback(() => {
    if (!conversationId) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    if (runTaskId) {
      void fetch(getApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
        },
      }).catch(() => {
        // 后端取消请求失败不阻塞本地停止（与既有 steer 失败仅提示同语义级别）
      });
    }
    stopConversationRun(conversationId);
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
  // subagent system (petri-server) provides the routing.
  const runInBackground = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId) return;
    const parentTaskId = activeRun?.taskId;
    if (!parentTaskId) return;
    const tagged: ChatMessage[] = messagesRef.current
      .filter((m) => !m.error && !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));
    tagged.push({ role: 'user', content: trimmed });
    const childModel = resolveModelForSend(false);
    startSubAgentTask({
      conversationId,
      projectId,
      userContent: trimmed,
      messages: tagged,
      parentTaskId,
      modelPresetId: childModel?.endpointProfileId || childModel?.id || activeModelId,
      modelName: childModel?.model,
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
  const queue = useCallback((text: string): { ok: boolean; overflow: boolean } => {
    const trimmed = text.trim();
    if (!trimmed || !streaming) return { ok: false, overflow: false };
    // BLOCK-102 P2 — 归属标记：追问属于发起它的会话。
    // BLOCK-178 — 从 props 权威态计算入队（React 不保证 updater 同步执行，
    // 在 updater 内回读结果会静默失效——契约测试抓真后修正）。
    const enqueued = enqueueQueuedPrompt(queuedPrompts, trimmed, conversationId);
    if (!enqueued.ok) return { ok: false, overflow: enqueued.overflow }; // 溢出：输入原样保留
    setQueuedPrompts(enqueued.next);
    setInput('');
    historyNavRef.current = INITIAL_NAV_STATE;
    clearConversationDraft(projectId, conversationId);
    if (taRef.current) taRef.current.style.height = 'auto';
    return { ok: true, overflow: false };
  }, [conversationId, projectId, queuedPrompts, setQueuedPrompts, streaming]);

  // BLOCK-178 P1 — 队列管理操作（撤回编辑/删除/排序/立即发送；按 id 锚定）。
  const removeQueuedById = useCallback((id: string) => {
    setQueuedPrompts((current) => current.filter((q) => q.id !== id));
  }, [setQueuedPrompts]);

  /** 撤回队列项：出队并把文本交还调用方回填输入框（编辑后重发）。 */
  const withdrawQueued = useCallback((id: string): { ok: boolean; text?: string } => {
    const target = queuedPrompts.find((q) => q.id === id);
    if (!target) return { ok: false };
    setQueuedPrompts((current) => current.filter((q) => q.id !== id));
    return { ok: true, text: target.text };
  }, [queuedPrompts, setQueuedPrompts]);

  /** 上移/下移：仅在同名会话子序列内换位（跨会话归属语义不动）。 */
  const moveQueued = useCallback((id: string, dir: -1 | 1) => {
    setQueuedPrompts((current) => {
      const idx = current.findIndex((q) => q.id === id);
      if (idx < 0) return current;
      const cid = current[idx].conversationId;
      let anchorIdx = idx + dir;
      while (anchorIdx >= 0 && anchorIdx < current.length && current[anchorIdx].conversationId !== cid) {
        anchorIdx += dir;
      }
      if (anchorIdx < 0 || anchorIdx >= current.length) return current;
      const next = current.slice();
      const [item] = next.splice(idx, 1);
      next.splice(anchorIdx, 0, item);
      return next;
    });
  }, [setQueuedPrompts]);

  /** 立即发送：把该项挪到同名会话子序列首位 + 停当前轮——排水效果在对账完成后优先消费它。 */
  const sendNowQueued = useCallback((id: string): boolean => {
    const target = queuedPrompts.find((q) => q.id === id);
    if (!target) return false;
    setQueuedPrompts((current) => {
      const rest = current.filter((q) => q.id !== id);
      const idx = rest.findIndex((q) => q.conversationId === target.conversationId);
      if (idx < 0) rest.push(target);
      else rest.splice(idx, 0, target);
      return rest;
    });
    if (streaming) stop();
    return true;
  }, [queuedPrompts, setQueuedPrompts, stop, streaming]);

  // 10. Queue drain effect — fires one queued prompt only after
  // the completed run has been reconciled from SQLite, so the
  // next turn receives the durable conversation history. Replaces
  // the inline effect that previously lived in SimpleChat.tsx.
  useEffect(() => {
    if (streaming || queuedPrompts.length === 0 || !conversationId) return;
    if (autoDrain === false) return; // BLOCK-178 P1 — 显式暂停门（undefined=开启，旧调用方零回归）
    if (activeRun?.completedAt
      && reconciledRunRef.current !== `${conversationId}:${activeRun.completedAt}`) return;
    // BLOCK-102 P2 — 只 drain 归属当前会话的条目：切走的会话其追问留在队列，
    // 回到该会话且对账完成后才发送（不再注入当前会话）。
    const idx = queuedPrompts.findIndex((q) => q.conversationId === conversationId);
    if (idx === -1) return;
    const next = queuedPrompts[idx];
    setQueuedPrompts(queuedPrompts.filter((_, i) => i !== idx));
    void send(next.text);
  }, [autoDrain, activeRun, conversationId, messages, queuedPrompts, send, streaming]);

  // `input` is read by the public API surface (the parent passes
  // input.trim() into queue/runInBackground), so we intentionally
  // reference it here to keep the callback deps aligned with the
  // intent, even though the hook signatures take an explicit text
  // parameter. Without this reference, the hook usage would
  // become inert to `input` changes the parent would otherwise
  // expect to be observed.
  void input;

  // BLOCK-102 P2 — 回填最新 runInBackground（声明在其定义之后、return 之前）
  runInBackgroundRef.current = runInBackground;
  return {
    send,
    stop,
    regenerate,
    queue,
    runInBackground,
    streaming,
    // BLOCK-178 — 队列一等化操作面
    removeQueuedById,
    withdrawQueued,
    moveQueued,
    sendNowQueued,
  };
}
