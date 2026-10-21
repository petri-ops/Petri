// ============================================================
// SimpleChat — lightweight conversation-only chat component.
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
//
// BLOCK-9.2 PHASE 4: extracted to ./SimpleChat/{types.ts,helpers.tsx,attachments.ts,ImagePreviewModal.tsx,formatHarness.ts,hooks/useChatStream.ts}.
//   • 189-line types.ts holds 14 type/const declarations.
//   • 108-line helpers.ts holds MessageMeta + ExamplePrompts + compactStageConclusion.
//   • attachments.ts holds AttachmentFile type + drag/drop/paste/remove/open/close helpers.
//   • ImagePreviewModal.tsx holds the image preview modal component (~110 lines).
//   • formatHarness.ts holds the 5 pure harness payload formatting helpers
//     (stringifyParamValue / shortValue / formatHarnessRepair / formatHarnessWarning /
//     formatHarnessDiagnosticIssue).
//   • hooks/useChatStream.ts owns the 5 stream-related callbacks
//     (send / stop / regenerate / queue / runInBackground) plus the
//     `starting` state, `messagesRef` / `sendRef` indirection, the
//     `copilotAsk` event subscription, and the queue drain effect.
//   • The main component drops from ~2115 → ~1965 lines after this
//     commit; send/stop/regenerate/queue/runInBackground + 9 hooks
//     now live in the custom hook, called once at the position the
//     inline `send` useCallback used to occupy. Hook order is fixed
//     and documented at the top of useChatStream.ts.
//
// Pure code organization change; 0 behavior difference. All public exports
// re-exported from main file to keep `import { ... } from '@/components/copilot/SimpleChat'` working.
// ============================================================
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// ── BLOCK-9.2 PHASE 4: types + helpers + attachments re-exports for backward compat ──
import {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  type SlashCommand,
  type SimpleMessage,
  type AgentProgressUpdate,
  type ExamplePrompt,
  type ExamplePromptsProps,
  type SimpleChatHandle,
  type SimpleChatProps,
  type ErrorBannerProps,
  type PendingApproval,
} from './SimpleChat/types';
// BLOCK-160 W2 P3（KNW-3）— 斜杠菜单动态数据源（产品 Skills + run_tool 模板；
// 选中注入执行意图文本模板，v1 不跳页不自动执行）
import { fetchSlashEntries, filterSlashEntries, slashIntentTemplate, type SlashEntry } from './SimpleChat/slashSources';
import { classifySlashCommand } from './SimpleChat/slashExecute';
import {
  useDomainExamplePrompts,
  ExamplePrompts,
  compactStageConclusion,
} from './SimpleChat/helpers';
import {
  type AttachmentFile,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  removeAttachmentById,
  openImagePreview,
  closeImagePreview,
} from './SimpleChat/attachments';
import {
  composeAttachmentReferenceLines,
  uploadAttachment,
} from './SimpleChat/attachmentUpload';
import { ImagePreviewModal } from './SimpleChat/ImagePreviewModal';
// BLOCK-92 三波拆分 — 思考档位/滚动守卫两簇外迁 hooks/（原样平移）
import { useThinkingLevel } from './SimpleChat/hooks/useThinkingLevel';
import { useScrollGuard } from './SimpleChat/hooks/useScrollGuard';
// UI-268: 「后台进程」浮窗（持久输出独立小窗口）；工具活动记录改为内联手风琴
import { ToolActivityDock } from './ToolActivityDock';
import { MessageRail } from './MessageRail';
import { ChatScrollbar } from './ChatScrollbar';
// UI-305 P0.1 — 尾部内联渲染组件外迁（LoopStatusPanel / AgentProgressList /
// ResultEditProgressList / ErrorBanner / ApprovalCard+ApprovalRepairHint），
// 零行为变化；ResultEditProgressList 按惯例在此再导出保持导入路径兼容。
import { LoopStatusPanel } from './SimpleChat/LoopStatusPanel';
import { ApprovalCard } from './SimpleChat/ApprovalCard';
import { ResultEditProgressList } from './SimpleChat/ResultEditProgressList';
// BLOCK-154 波次 3 — 消息行组件（memo 渲染边界，契约见该文件头与 SimpleChatMessageRow.test.tsx）。
import { SimpleChatMessageRow } from './SimpleChat/SimpleChatMessageRow';
import { GuardAckCard } from './SimpleChat/GuardAckCard';
import { resolveGenUiFollowUp, type GenUiFollowUpRequest, type GenUiFollowUpResult } from './gen-ui/followUp';
import { useSummaryRetry } from './SimpleChat/hooks/useSummaryRetry';
import { useModelAccessMenus } from './SimpleChat/hooks/useModelAccessMenus';
import { useConversationResume } from './SimpleChat/hooks/useConversationResume';
import { useAutoFileReferenceRefresh } from './SimpleChat/hooks/useAutoFileReferenceRefresh';
import { useKnowledgeSpaceToggle } from './SimpleChat/hooks/useKnowledgeSpace';
// BLOCK-92 Wave A-3 — 状态/派生簇外迁（纯搬运，调用点见组件内标注）。
import { applyConversationNotices, buildBaseDisplayMessages, buildRailItems } from './SimpleChat/displayMessages';
import { useApprovalFlow } from './SimpleChat/hooks/useApprovalFlow';
import { useComposerFocus } from './SimpleChat/hooks/useComposerFocus';
import { useForkConversation } from './SimpleChat/hooks/useForkConversation';
import { usePlanApprovalFlow } from './SimpleChat/hooks/usePlanApprovalFlow';
import { useTokenBudgetState } from './SimpleChat/hooks/useTokenBudgetState';
export { ResultEditProgressList };

// Re-export helpers (so `import { restoreSimpleMessage } from './SimpleChat'` keeps working)
export {
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  compactStageConclusion,
};
export type {
  SlashCommand,
  SimpleMessage,
  AgentProgressUpdate,
  ExamplePrompt,
  ExamplePromptsProps,
  SimpleChatHandle,
  SimpleChatProps,
  ErrorBannerProps,
  PendingApproval,
  AttachmentFile,
};

import { useCopilotContext } from '@/lib/copilotContextProvider';
import { useConversations } from '@/hooks/useConversations';
import { petriEvents, dispatchPetriEvent, subscribePetriEvent } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';

// SYSTEM_OPEN_FILE_EXTENSIONS + shouldOpenWithSystemApp moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

import { useAiSettings } from '@/hooks/useAiSettings';
// BLOCK-81 P2 — 思考档位（会话级持久化 + 词表）；载入/持久化 helper 已随
// useThinkingLevel 簇迁至 SimpleChat/hooks/useThinkingLevel.ts
import {
  THINKING_LEVEL_LABELS,
  THINKING_LEVELS,
  nextThinkingLevel,
  saveThinkingLevel,
} from './thinkingLevel';
import { buildConversationSegments } from './conversationSegments';
import type { ConversationSegment } from './conversationSegments';
import {
  useConversationRun,
  useSubAgentTasksForConversation,
  resumeOrphanAgentTasks,
  getConversationRunSnapshot,
  clearConversationRun,
} from './conversationRunStore';
import { useErrorFormatter } from './useErrorFormatter';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import { useExtraRenderersFlag } from './extraRenderers';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';

// BLOCK-154 波次 3 — 无 timeline 分段消息的共享空数组（行 memo 的 segments prop
// 需要稳定引用；`?? []` 每次新建会击穿 memo）。
const EMPTY_ROW_SEGMENTS: ConversationSegment[] = [];
import { getBridge } from '@/lib/desktopBridge';
import { ModelMenu } from './SimpleChat/ModelMenu';
import { ModelChip } from './SimpleChat/ModelChip';
import { useAutoModelPreference } from '@/hooks/useAutoModelPreference';
import { describeAutoDecision, resolveAutoPreset } from '@/lib/auto-model';
import { useTurnNotifications } from './useTurnNotifications';
import { matchesCombo } from '@/lib/appKeymap';
import { useKeymapSafe } from '@/lib/appKeymapContext';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { INITIAL_NAV_STATE, stepHistoryNavigation } from './chatHistoryNav';
import {
  clearConversationDraft,
  loadConversationDraft,
  saveConversationDraft,
} from './conversationDraft';
// BLOCK-9.2 PHASE 4: stream control extracted from this file.
// The hook owns send/stop/regenerate/queue/runInBackground plus the
// `starting` state, messagesRef/sendRef indirection, the copilotAsk
// event subscription, and the queue drain effect.
import { useChatStream, enqueueQueuedPrompt, QUEUE_CAP, type QueuedPrompt } from './SimpleChat/hooks/useChatStream';
// BLOCK-52 P1（选中即引用）: 引用块纯函数助手（状态管理 + 发送渲染）。
import {
  appendSelectionReference,
  composeMessageWithSelectionReferences,
  selectionReferenceChipLabel,
  selectionReferenceLocation,
  type SelectionReference,
} from './SimpleChat/selectionReferences';
// BLOCK-52 P2（图片/结果图引用）: 图片引用卡纯函数助手（状态管理 + 发送渲染）。
import {
  appendImageReference,
  composeMessageWithImageReferences,
  imageReferenceSourceLine,
  type ImageReference,
} from './SimpleChat/imageReferences';
// BLOCK-20: orphaned helpers (8/21, commit 9cbf8e3) wired into
// the SimpleChat consumption side. The two helpers below are pure
// UI utilities and safe to import from the renderer:
//   • accessModeValidator — provides a defensive pre-send guard that
//     mirrors the backend agent-tool-policy. The backend is the
//     authoritative enforcer (test/accessmode-validation.test.mjs);
//     the validator here is a UI feedback hook (validateToolCall
//     throws synchronously before any network IO). Used inside the
//     read-only auto-approve gate below.
//   • ContextBudgetBar — renders a passive ring + popover for the
//     active turn's token budget. Backed today by the 3 backend
//     helpers (token-estimator / model-context-windows /
//     message-trimmer); until those land a tiktoken dep + an SSE
//     event we render in idle mode with no live `budget`, which
//     surfaces the placeholder (`—`) instead of fake numbers.
// BLOCK-55 P1/P2/P3 — Spec 门：计划模式开关 + 批准三选一 + 修订批准
import { PlanApprovalCard } from './SimpleChat/PlanApprovalCard';
import { composerPlaceholder } from './SimpleChat/ComposerYield';
import { ContextBudgetButton } from './ContextBudgetBar';
// UI-523 — composer 运行计量条（卡片下方读数；环组件搬进条内，单一实例）
import { RunStatsBar } from './RunStatsBar';
import { useRunUsage } from './SimpleChat/hooks/useRunUsage';
import { useConversationUsage } from './SimpleChat/hooks/useConversationUsage';

// SimpleMessage + restoreSimpleMessage + AgentProgressUpdate + restoreProgressUpdates + MessageMeta moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).

// ExamplePrompt interface + DEFAULT_EXAMPLE_PROMPTS + ExamplePromptsProps + ExamplePrompts moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).
// SimpleChatHandle + SimpleChatProps moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

// AttachmentFile type moved to ./SimpleChat/attachments.ts (BLOCK-9.2 PHASE 4).
// The type is imported at the top of the file alongside the handler helpers
// and re-exported from this file's header for any consumer that previously
// reached for AttachmentFile via the SimpleChat path.

// UI-386 — spawn 自动唤起去重表（模块级：跨 SimpleChat 实例/重挂载每 task 只切一次）
const autoOpenedSubAgents = new Set<string>();

export function SimpleChat({
  projectId,
  conversationId,
  onConversationChange,
  inputHeight: _inputHeight = 120,
  ownsCopilotAsk = false,
  composerOnly = false,
  sendGuard,
  compact = false,
  lockedAccessMode,
  slimComposer = false,
}: SimpleChatProps): React.ReactElement {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // BLOCK-102 P2 — 队列条目带会话归属（修复排队追问跨会话注入竞态）。
  // BLOCK-178 P2 — 懒初始化从 localStorage 水合（刷新不丢；避免 mount effect 同步 setState）。
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>(() => {
    try {
      const raw = localStorage.getItem('petri:chat-queue:v1');
      return raw ? (JSON.parse(raw) as QueuedPrompt[]) : [];
    } catch { return []; }
  });
  // BLOCK-178 — 投递模式（转向=steer 立即注入下一轮；排队=收尾后自动发）+ 暂停排水 + 溢出提示
  const [deliveryMode, setDeliveryMode] = useState<'steer' | 'queue'>(() => {
    try { return localStorage.getItem('petri:delivery-mode') === 'queue' ? 'queue' : 'steer'; } catch { return 'steer'; }
  });
  const [autoDrain, setAutoDrain] = useState(true);
  const [queueOverflow, setQueueOverflow] = useState(false);
  const queueOverflowTimerRef = useRef<number | null>(null);
  const showQueueOverflow = useCallback(() => {
    setQueueOverflow(true);
    if (queueOverflowTimerRef.current) window.clearTimeout(queueOverflowTimerRef.current);
    queueOverflowTimerRef.current = window.setTimeout(() => setQueueOverflow(false), 4000);
  }, []);
  const toggleDeliveryMode = useCallback((next: 'steer' | 'queue') => {
    setDeliveryMode(next);
    try { localStorage.setItem('petri:delivery-mode', next); } catch { /* 存储不可用=会话内有效 */ }
  }, []);
  const effectiveDelivery = useCallback((reverse?: boolean): 'steer' | 'queue' => {
    if (!reverse) return deliveryMode;
    return deliveryMode === 'steer' ? 'queue' : 'steer';
  }, [deliveryMode]);
  // BLOCK-178 P2 — 队列随会话持久化（写面；归属标记 BLOCK-102 语义不变）
  useEffect(() => {
    try { localStorage.setItem('petri:chat-queue:v1', JSON.stringify(queuedPrompts)); } catch { /* 忽略 */ }
  }, [queuedPrompts]);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  // BLOCK-91 — 附件发送失败/守卫提示（诚实可见，不再静默丢弃）。
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  // BLOCK-150 加映 — 识图能力位：后端 /ai/settings vision_configured=false 时图片输入
  // 前置阻断（贴图/拖图即提示配置去向，替代发出去之后的 vision_failed）。缺省 true：
  // 仅在后端明确回报不可用时才阻断（取数失败/旧后端无字段 → 维持旧行为）。
  // BLOCK-155 放宽 — 本位不再是图片输入的唯一放行条件：聊天渠道自身声明视觉能力
  // （chatVisionCapable，见 useAiSettings 解构之后）时同样放行，合并判据单源
  // imageInputAllowed（两者皆无才阻断）。
  const [visionConfigured, setVisionConfigured] = useState(true);
  useEffect(() => {
    // 能力位必须问「将执行识图的聊天后端」——dev 双后端形态下 rApiBase 才是执行方
    // （BLOCK-85 端口纪律①：跨进程状态同源；问错侧=能力位与执行位脑裂）。
    const rApiBase = (window as unknown as { petriDesktop?: { backendConfig?: { rApiBase?: string } } })
      ?.petriDesktop?.backendConfig?.rApiBase;
    const apiBase = rApiBase || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
    let cancelled = false;
    fetch(`${apiBase}/ai/settings`)
      .then((resp) => (resp.ok ? resp.json() as Promise<{ settings?: { vision_configured?: boolean } } | null> : Promise.resolve(null)))
      .then((data) => {
        if (!cancelled && data?.settings && typeof data.settings.vision_configured === 'boolean') {
          setVisionConfigured(data.settings.vision_configured);
        }
      })
      .catch(() => { /* 保守：取数失败不阻断 */ });
    return () => { cancelled = true; };
  }, []);
  // BLOCK-171 CP-4 — steer 状态行内提示（原 CK-01 4s 自动消退形态；
  // 持续可见语义见 hook 调用后的 steerNotice 副本——state 移至 useChatStream
  // 之后声明，使 effect 依赖可读 streaming）

  // UI-444 加映（用户反馈「点击了下载但没有窗口出来」）——改为原生另存为：
  // fetch 后端组合的 Markdown → files.saveTextFile（原生保存对话框，位置可控、
  // 确认后写入）→ 行内回执告知路径；浏览器（非桌面）回退 blob 锚点下载。
  const handleExportConversation = useCallback((): void => {
    if (!conversationId) return;
    void (async () => {
      const url = `${getPlatformApiPrefix()}/ai/conversations/${encodeURIComponent(conversationId)}/export.md`;
      const token = getToken();
      let content: string | null = null;
      try {
        const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (resp.ok) content = await resp.text();
      } catch { content = null; }
      if (content == null) {
        setSteerNotice('会话导出失败：无法读取会话内容');
        return;
      }
      const name = `会话导出-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.md`;
      const bridge = getBridge('files');
      if (bridge?.saveTextFile) {
        const r = await bridge.saveTextFile(name, content);
        if (r && r.ok && r.path) setSteerNotice(`已导出：${r.path}`);
        else if (r && r.ok && r.canceled) { /* 用户取消，不打扰 */ }
        else setSteerNotice('会话导出失败：' + ((r && r.error) || '未知原因'));
        return;
      }
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    })();
  }, [conversationId]);
  // BLOCK-52 P1（选中即引用）: 右栏预览选中文字 → 引用块，随下一条消息发送。
  const [selectionRefs, setSelectionRefs] = useState<SelectionReference[]>([]);
  const selectionRefsRef = useRef<SelectionReference[]>([]);
  useEffect(() => {
    selectionRefsRef.current = selectionRefs;
  }, [selectionRefs]);
  // 订阅右栏 WorkspaceFilePreview 的「引用到对话」事件。仅 copilotAsk 拥有者
  // （中央会话）消费，避免右栏 chat tab 与中央会话重复入列；跨项目载荷丢弃。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    return subscribePetriEvent(petriEvents.selectionQuote, (detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      setSelectionRefs((prev) => appendSelectionReference(prev, detail));
    });
  }, [ownsCopilotAsk, projectId]);
  const removeSelectionRef = useCallback((id: string) => {
    setSelectionRefs((prev) => prev.filter((ref) => ref.id !== id));
  }, []);
  // BLOCK-52 P2（图片/结果图引用）: 右栏图片预览/结果面板图片 → 引用卡，随下一条消息发送。
  const [imageRefs, setImageRefs] = useState<ImageReference[]>([]);
  const imageRefsRef = useRef<ImageReference[]>([]);
  useEffect(() => {
    imageRefsRef.current = imageRefs;
  }, [imageRefs]);
  // 订阅 imageQuote 事件（WorkspaceFilePreview 静态图 / ResultView 结果图）。
  // 与 P1 同策略：仅 copilotAsk 拥有者消费；跨项目载荷丢弃。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    return subscribePetriEvent(petriEvents.imageQuote, (detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      setImageRefs((prev) => appendImageReference(prev, detail));
    });
  }, [ownsCopilotAsk, projectId]);
  const removeImageRef = useCallback((id: string) => {
    setImageRefs((prev) => prev.filter((ref) => ref.id !== id));
  }, []);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<AttachmentFile | null>(null);
  const [loading, setLoading] = useState(false);
  // BLOCK-57：远程执行目标——确认卡选择器数据（仅当存在已注册目标时渲染，本机永远是默认）
  // BLOCK-60 — composer 工具栏容器查询窄态（ResizeObserver 只读宽度，不影响弹性宽度逻辑）
  const composerBarRef = useRef<HTMLDivElement | null>(null);
  const [composerNarrow, setComposerNarrow] = useState(false);
  // BLOCK-81 P2 — 思考档位：会话级态（随会话恢复），默认「标准」＝不发任何上游参数。
  // BLOCK-92 三波拆分 — 296-308 连续簇抽入 useThinkingLevel（调用点原位保持 hook
  // 顺序；Ctrl+T 循环 effect 与簇不连续，仍在下方原位经 setThinkingLevel 驱动）。
  const { thinkingLevel, setThinkingLevel, thinkingMenuOpen, setThinkingMenuOpen, applyThinkingLevel } =
    useThinkingLevel(projectId, conversationId);
  useEffect(() => {
    const el = composerBarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setComposerNarrow(entry.contentRect.width < 680);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // BLOCK-57 UI-290 — 执行目标：composer 选择器（本机永远默认；选择持久化，
  // 页面刷新/重启后保留——用户测试反馈会话态易丢失，跑错本机）。

  // Note: backend runtime flags (rRuntime / pyRuntime) are diagnostic
  // channels for the desktop bridge and MUST stay invisible to the chat
  // surface. Surfacing them here mixes IPC-failure null cases with genuine
  // runtime-missing cases (see lib/electron.d.ts L7-9 "must use === false")
  // and also mis-promotes a backend flag into a user-facing product signal.
  // Tool-level Python runtime issues (e.g. scanpy missing) are surfaced by
  // the tool-execution error path inside conversationRunStore, not here.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  // BLOCK-160 W2 P3（KNW-3）— 斜杠动态条目（Skills+模板；面板打开时拉取，模块级 60s 缓存）
  const [dynamicSlashEntries, setDynamicSlashEntries] = useState<SlashEntry[]>([]);
  const [slashFocusedIndex, setSlashFocusedIndex] = useState(0);
  const slashPanelRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  // Filtered commands based on query
  const combinedSlashEntries = useMemo(
    () => [
      ...SLASH_COMMANDS.map((cmd) => ({ kind: 'action' as const, id: cmd.id, label: cmd.label, description: cmd.description })),
      ...dynamicSlashEntries,
    ],
    [dynamicSlashEntries]
  );
  const filteredCommands = useMemo(() => filterSlashEntries(combinedSlashEntries, slashQuery), [combinedSlashEntries, slashQuery]);
  // 输入框 ↑/↓ 历史回溯的导航态（null = 未进入导航，输入框即实时草稿）。
  const historyNavRef = useRef<typeof INITIAL_NAV_STATE>(INITIAL_NAV_STATE);
  const activeRun = useConversationRun(conversationId);
  // AGENT-CONCURRENCY A-5: 会话挂载/切换时恢复崩溃或刷新前仍在跑的后台任务
  // （sub-agent 走后端 loop_runs，主 agent 走 localStorage resumable task）。
  // 幂等：已追踪的 sub-agent 会被跳过，已有活跃主 run 时不重复恢复。
  useEffect(() => {
    if (!conversationId) return;
    void resumeOrphanAgentTasks(conversationId, projectId);
  }, [conversationId, projectId]);
  // UI-386 — spawn 自动唤起（自已退役的聊天区聚合条迁入）：
  // 新运行中子 agent → 派发 agentOpenInRail，右栏「智能体」tab 自动切过去。
  // 模块级 Set 保证每 task 只切一次（多 SimpleChat 实例/重挂载不重复）。
  const subTasksForAutoOpen = useSubAgentTasksForConversation(conversationId);
  useEffect(() => {
    for (const t of subTasksForAutoOpen) {
      if (t.status !== 'running') continue;
      const id = t.taskId || '';
      if (!id || autoOpenedSubAgents.has(id)) continue;
      autoOpenedSubAgents.add(id);
      dispatchPetriEvent(petriEvents.agentOpenInRail, { runId: id });
    }
  }, [subTasksForAutoOpen]);
  const durableLoop = useDurableConversationLoop(projectId, conversationId, activeRun?.loop);
  const pendingApproval = activeRun?.pendingApproval || null;
  useTurnNotifications(conversationId, activeRun?.status ?? null, pendingApproval);

  // Plan 1.6 §4.2 — read Copilot context from React Context, not the
  // module-scope singleton. Captured into a ref so the latest value is
  // always reachable from the latest send callback without re-binding.
  // The ref is shared with useChatStream (which calls `send` from a
  // stable closure) so the activeArtifact / contextToken / etc. used
  // at send time stay correct even when the React Context updates
  // between send scheduling and execution.
  const copilotCtx = useCopilotContext();
  const copilotCtxRef = useRef(copilotCtx);
  useEffect(() => {
    copilotCtxRef.current = copilotCtx;
  }, [copilotCtx]);

  // Plan 1.6 §4.3 — subscribe to the shared SWR conversation cache so
  // the chat header / future list UI stays in sync with sidebar mutations
  // without polling. The hook loads once on mount; `refresh` is invoked
  // after server-driven onConversation events append a new conv.
  const {
    list: conversationList,
    refresh: refreshConversations,
    create: createConversationForRun,
  } = useConversations(projectId);

  // Plan 1.6 §4.5 — read presets + activeId from the shared SWR
  // hook (module-scope cache). The settings panel and this chat
  // panel both subscribe, so a CRUD in one propagates to the
  // other without re-fetching.
  const {
    presets: modelPresets,
    activeId: activeModelId,
    activePreset: activeModel,
    catalog: modelCatalog,
    roleBindings,
    setActive: setActiveModelId,
  } = useAiSettings();
  // BLOCK-225 — D4 Auto：开关持久化；解析预览跟随当前附件。
  const { autoModel, setAutoModel, error: autoModelError } = useAutoModelPreference();
  const autoDecision = useMemo(() => resolveAutoPreset({
    presets: modelPresets,
    catalog: modelCatalog,
    roleBindings,
    hasImages: imageRefs.length > 0,
    fallbackId: activeModelId,
  }), [activeModelId, imageRefs.length, modelCatalog, modelPresets, roleBindings]);
  const autoPreview = describeAutoDecision(autoDecision);

  // BLOCK-69 / UI-318 — 知识空间大脑开关（启用真相在 DB；无 key 禁用不假启用）
  const knowledgeSpace = useKnowledgeSpaceToggle();

  // UI-305 P0.3 — 模型菜单 + 访问档位菜单状态簇（原 322-330 useState/派生 +
  // 1322-1371 分组与 selectModel）整簇抽入 useModelAccessMenus，簇内 hook 相对
  // 顺序保持原样、零行为变化；调用点在 useAiSettings 解构之后。
  const {
    modelMenuOpen,
    setModelMenuOpen,
    setModelSupplierKey,
    accessMenuOpen,
    setAccessMenuOpen,
    accessMode,
    setAccessMode,
    planMode,
    prePlanAccessModeRef,
    accessModeLabel,
    modelGroups,
    activeSupplierGroup,
    selectedSupplierGroup,
    catalogSummary,
    preferredPresetForSupplier,
    selectModel,
  } = useModelAccessMenus({
    modelPresets,
    activeModelId,
    setActiveModelId,
    catalog: modelCatalog,
    onModelSelected: (preset) => {
      if (preset.defaultThinkingLevel) applyThinkingLevel(preset.defaultThinkingLevel);
    },
    lockedAccessMode,
  });

  // BLOCK-92 Wave A-3 — 焦点管理簇外迁（挂载聚焦 + 窗口获焦/可打印击键兜底，
  // 仅 copilotAsk 拥有者执行；见 ./SimpleChat/hooks/useComposerFocus.ts）。
  useComposerFocus({ taRef, ownsCopilotAsk, accessMenuOpen, modelMenuOpen });

  // 能力位门控（D3 双保险①的 UI 侧）：仅当当前渠道声明 reasoning 才渲染档位控件，
  // 避免对不支持的渠道出现「假开关」。后端仍会二次门控。
  const reasoningSupported = Array.isArray(activeModel?.capabilities)
    && activeModel.capabilities.includes('reasoning');
  // BLOCK-155 真·单通道 vision — 聊天渠道自身视觉能力位（同源读 activeModel.capabilities，
  // 对齐上方 reasoning 能力位读取先例）：渠道声明 vision 时当前轮图片直接内联进聊天请求体，
  // 识图角色未配置（vision_configured=false）也不必前置阻断贴图/拖图。合并放行判据
  // （vision_configured || 渠道视觉能力）单源在 attachments.ts 的 imageInputAllowed。
  const chatVisionCapable = Array.isArray(activeModel?.capabilities)
    && activeModel.capabilities.includes('vision');
  // Ctrl+T 循环档位（对齐 ZCode 习惯）；未声明能力的渠道不响应。
  // BLOCK-200 P1：组合串读键位注册表（`thinking.cycle`），能力门与局部生效条件留在这里。
  const { bindings: keymapBindings } = useKeymapSafe();
  const thinkingCycleCombo = keymapBindings['thinking.cycle'];
  useEffect(() => {
    if (!reasoningSupported) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!matchesCombo(thinkingCycleCombo, e)) return;
      e.preventDefault();
      setThinkingLevel((current) => {
        const next = nextThinkingLevel(current);
        saveThinkingLevel(projectId, conversationId, next);
        return next;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reasoningSupported, projectId, conversationId, thinkingCycleCombo]);

  // UI-305 P0.2 — summary retry 状态簇（原 297-303 的 5 个 useState +
  // retrySummary useCallback + UX1H 冷却 tick effect）整簇抽入 useSummaryRetry，
  // 簇内 hook 相对顺序保持原样、零行为变化；调用点在全部依赖声明之后。
  const {
    retrySummary,
    summaryRetryState,
    summaryRetryErrors,
    summaryRetryAttempts,
    summaryRetryCooldownUntil,
    MAX_SUMMARY_RETRIES,
    retryTick,
  } = useSummaryRetry({
    conversationId,
    projectId,
    activeModel,
    activeModelId,
    refreshConversations,
    appendAssistantMessage: (message) => setMessages((current) => [...current, message]),
  });

  // BLOCK-154 波次 3 — 冷却计时采样：retryTick 变化时刷新采样点，行组件以
  // cooldownNow 计算「冷却中 Ns」。tick 调度点（minUntil）不变，标签刷新精度等价；
  // 四个 retry record 的身份不因 tick 变化，行 memo 不被冷却期 tick 击穿。
  const cooldownNow = useMemo(() => Date.now(), [retryTick]);

  // Error formatter hook for user-friendly error display
  const { formatError, getTechnicalDetails } = useErrorFormatter();

  // UI-AGENTWB-004 A4 bridge: opt-in switch for routing
  // assistant messages that carry `meta.resultNodes` through the
  // ResultCard pipeline. Defaults to false so existing users see
  // no change; flip via `localStorage.petri.simplechat.extraRenderers='true'`.
  const extraRenderersFlag = useExtraRenderersFlag();

  // Resolve file references only after a message is fully settled —
  // streaming deltas would otherwise hammer the resolver and we never want
  // to surface a clickable artifact on half-rendered text. We snapshot the
  // latest Copilot context once per settled message and let CopilotMarkdown
  // drive the resolution effect.
  const [settledContext, setSettledContext] = useState<ExtractContext | null>(null);
  const [resolveNonce, setResolveNonce] = useState(0);
  const settledConvRef = useRef<string | null>(conversationId);
  useEffect(() => {
    // Conv switch: clear until the new history finishes loading.
    if (settledConvRef.current !== conversationId) {
      settledConvRef.current = conversationId;
      setSettledContext(null);
    }
  }, [conversationId]);
  useEffect(() => {
    if (loading) return;
    // A page-level active job can belong to another conversation. Settled
    // history therefore resolves only against this project's workspace;
    // explicit petri artifact URIs still carry and verify their own job ID.
    setSettledContext({ projectId });
  }, [loading, projectId]);

  // BLOCK-22 P4.5: line/column forwarding note.
  // FileReferenceClickDetail currently carries no line/column — we default to 1.
  // Future enhancement: extract from the raw URI if it contains a line anchor (e.g. /path#L10).
  const handleFileReferenceClick = useCallback((detail: FileReferenceClickDetail) => {
    const resolved = detail.resolved;
    if (!resolved || resolved.projectId !== projectId) return;
    if (resolved.kind === 'artifact') {
      dispatchPetriEvent(petriEvents.projectOpenArtifact, {
        jobId: resolved.jobId,
        artifactName: resolved.artifactName,
        projectId,
      });
      return;
    }
    dispatchPetriEvent(petriEvents.projectOpenWorkspaceFile, {
      projectId,
      relativePath: resolved.relativePath,
      name: resolved.name,
      openWithSystemApp: shouldOpenWithSystemApp(resolved.name || resolved.relativePath),
      // BLOCK-22 P4.5: default line/column — future: parse from raw URI anchor
      line: 1,
      column: 0,
    });
  }, [projectId]);

  const copyMessage = useCallback(async (messageKey: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => {
        setCopiedMessageKey((current) => current === messageKey ? null : current);
      }, 1500);
    } catch {
      // Clipboard may be unavailable in an embedded or non-secure preview.
    }
  }, []);

  // UI-305 P0.4 — 会话恢复/对账簇（原 609-668 三个 effect：消息重载、
  // 隐藏期完结对账、T82 resumable 重连）整簇抽入 useConversationResume，
  // 零行为变化。
  const { reconciledRunRef, older, compaction } = useConversationResume({
    conversationId,
    projectId,
    activeRun,
    refreshConversations,
    setMessages,
    setLoading,
  });

  // BLOCK-92 Wave A-3 — 消息列表派生纯函数外迁（./SimpleChat/displayMessages.ts）：
  // baseDisplayMessages（run/loop 投影合并）→ displayMessages（会话级降级/子 agent
  // 终态 notice 附着），语义与拆分前的两个渲染期 IIFE 逐行一致。
  // BLOCK-95 A2 — 派生链 useMemo 化：此前每次 render（含 composer 输入 keystroke、
  // 菜单开合等无关 state 变化）都全量重拼 250+ 条历史；useMemo 后仅
  // messages/activeRun/durableLoop 变化（真数据变化）才重算。
  const baseDisplayMessages = useMemo(
    () => buildBaseDisplayMessages({ activeRun, conversationId, messages, durableLoop }),
    [activeRun, conversationId, messages, durableLoop]
  );
  const displayMessages = useMemo(
    () => applyConversationNotices({ base: baseDisplayMessages, activeRun, conversationId }),
    [baseDisplayMessages, activeRun, conversationId]
  );

  // BLOCK-107 P1c — 每条 assistant 消息的时间线分段（D1=c：思考/工具按 iteration
  // 交错）。纯派生且与 displayMessages 同一 useMemo 语义：仅在消息真数据变化时
  // 重算，composer keystroke 等无关 state 不触发（沿用 BLOCK-95 A2 的教训）。
  // BLOCK-154 波次 3 — WeakMap 身份缓存：displayMessages 数组每个流式 tick 重建
  // （尾消息替换/推送致新数组），本 map 随之重建；历史消息对象引用恒定，WeakMap
  // 命中即复用原分段数组——行 memo 的 segments prop 身份稳定，未变行零重算零重渲染。
  const timelineSegmentsCacheRef = useRef(new WeakMap<SimpleMessage, ConversationSegment[]>());
  const timelineSegmentsByMessage = useMemo(() => {
    const segmentsCache = timelineSegmentsCacheRef.current;
    const map = new Map<string, ConversationSegment[]>();
    displayMessages.forEach((message, index) => {
      if (message.role !== 'assistant') return;
      let messageSegments = segmentsCache.get(message);
      if (!messageSegments) {
        messageSegments = buildConversationSegments({
          content: message.content,
          toolActivities: message.toolActivities,
          reasoningByIteration: message.reasoningByIteration,
          // D5（P2c）：阶段进度一并入模，由 ConversationTimeline 按 iteration 上轴。
          progressUpdates: message.progressUpdates,
        });
        segmentsCache.set(message, messageSegments);
      }
      map.set(message.id ?? `idx:${index}`, messageSegments);
    });
    return map;
  }, [displayMessages]);
  const standaloneDurableLoop = durableLoop.loop && !displayMessages.some((message) => message.loop)
    ? durableLoop.loop
    : null;

  // T83: does the latest AI reply contain any file references? Drives the
  // fade of the file-reference refresh button when there's nothing to refresh.

  // BLOCK-95 A3 — 自动滚底守卫：用户上翻离开底部后不再强制跟随，浮标一键回底；
  // 发送消息 / 切换会话视为「回到底部」意图，恢复跟随。
  const atBottomRef = useRef(true);
  // BLOCK-95 A1+A3 — 滚动守卫簇（591-642 连续段）抽入 useScrollGuard：
  // 调用点原位保持 hook 顺序；atBottomRef 仍由组件持有（send 路径也写它），
  // prependAnchorRef/olderRef 为簇内私有随簇迁移。
  const { showJumpToBottom, setShowJumpToBottom, scrollToBottom, handleMessagesScroll } = useScrollGuard({
    scrollRef,
    atBottomRef,
    older,
    activeRun,
    durableLoop,
    messages,
    conversationId,
  });

  // BLOCK-95 A4 — 话题转移小节分隔：持久真值=DB last_topic_shift_at（会话列表行），
  // 运行中 SSE onTopicShift 经事件总线即时补充并触发 refreshConversations 固化。
  const [liveTopicShift, setLiveTopicShift] = useState<{ at: string; reason: string } | null>(null);
  useEffect(() => {
    setLiveTopicShift(null);
  }, [conversationId]);
  useEffect(() => {
    return subscribePetriEvent(petriEvents.conversationTopicShift, (detail) => {
      if (detail.conversationId !== conversationId) return;
      setLiveTopicShift({ at: detail.at, reason: detail.reason });
      void refreshConversations();
    });
  }, [conversationId, refreshConversations]);

  // UI-262 — 左缘用户消息导航条（构建逻辑外迁至 ./SimpleChat/displayMessages.ts）。
  const railItems = useMemo(() => buildRailItems(displayMessages), [displayMessages]);

  // BLOCK-95 A4 — 话题小节分隔位置：转移时刻之后的第一条 user 消息。仅持久化
  // 消息（有 id）参与判断——run 投影的临时 user 消息 ts 是发送时刻，晚于检测
  // 完成时刻，会被误标；index 以 displayMessages 计，与渲染 map 直接对齐。
  const activeConversationMeta = conversationList.find((c) => c.id === conversationId);
  const topicShiftAt = liveTopicShift?.at || activeConversationMeta?.last_topic_shift_at || null;
  const topicShiftReason = liveTopicShift?.reason || activeConversationMeta?.last_topic_shift_reason || '';
  const topicShiftIndex = useMemo(() => {
    if (!topicShiftAt) return -1;
    const atMs = Date.parse(topicShiftAt);
    if (Number.isNaN(atMs)) return -1;
    return displayMessages.findIndex(
      (m) => m.role === 'user' && m.id && m.ts && Date.parse(m.ts) >= atMs
    );
  }, [displayMessages, topicShiftAt]);

  const handleRailJump = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>('.sc-msg-user');
    nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const inputLength = input.trim().length;
  const composerWidth = Math.min(980, Math.max(720, 720 + Math.sqrt(inputLength) * 42));

  // Auto-resize textarea height. Width is handled by the composer CSS var.
  const resizeTextarea = useCallback((ta: HTMLTextAreaElement | null) => {
    if (!ta) return;
    ta.style.height = 'auto';
    const nextHeight = Math.min(Math.max(ta.scrollHeight, 52), 220);
    ta.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea(taRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    setInput(loadConversationDraft(projectId, conversationId) || '');
    setQueuedPrompts([]);
    historyNavRef.current = INITIAL_NAV_STATE;
  }, [conversationId, projectId]);

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    saveConversationDraft(projectId, conversationId, value);
    historyNavRef.current = INITIAL_NAV_STATE;
    resizeTextarea(e.target);

    // Slash command detection
    if (value.startsWith('/')) {
      const query = value.slice(1);
      setSlashQuery(query);
      setSlashOpen(true);
      setSlashFocusedIndex(0);
      void fetchSlashEntries().then((entries) => setDynamicSlashEntries(entries));
    } else {
      setSlashOpen(false);
      setSlashQuery('');
    }
  };

  // Drag/drop handlers for file attachments (logic lives in ./SimpleChat/attachments.ts;
  // these wrappers just bind the host component's setters per React's stable-identity rules).
  const handleDragOver = useCallback((e: React.DragEvent) => {
    onDragOver(e, setIsDraggingOver);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    onDragLeave(e, setIsDraggingOver);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    // BLOCK-150 加映 / BLOCK-155 放宽 — 图片前置门（放行判据单源 imageInputAllowed：
    // vision_configured || 聊天渠道视觉能力，两者皆无才阻断；返回提示文案则落 attachmentNotice）
    const notice = onDrop(e, setAttachments, setIsDraggingOver, { visionEnabled: visionConfigured, chatVisionCapable });
    if (notice) setAttachmentNotice(notice);
  }, [visionConfigured, chatVisionCapable]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const notice = onPaste(e, setAttachments, { visionEnabled: visionConfigured, chatVisionCapable });
    if (notice) setAttachmentNotice(notice);
  }, [visionConfigured, chatVisionCapable]);

  const removeAttachment = useCallback((id: string) => {
    removeAttachmentById(id, setAttachments);
  }, []);

  const openPreview = useCallback((attachment: AttachmentFile) => {
    openImagePreview(attachment, setPreviewImage);
  }, []);

  const closePreview = useCallback(() => {
    closeImagePreview(setPreviewImage);
  }, []);

  // BLOCK-9.2 PHASE 4: extracted the 5 stream-related callbacks
  // (send / stop / regenerate / queue / runInBackground) plus the
  // `starting` state, `messagesRef` / `sendRef` indirection, the
  // `copilotAsk` event subscription, and the queue drain effect
  // into useChatStream(). The hook owns the same hooks in the
  // same order they appeared inline here before — see the comment
  // block at the top of useChatStream.ts for the canonical hook
  // sequence. The parent must still surface `streaming` for the
  // JSX rendering (send/stop buttons, copy/regenerate disabled
  // gates, CopilotMarkdown resolveContext) and for the
  // approve/reject/auto-approve callbacks that wrap `send`.
  const {
    send,
    regenerate,
    streaming,
    // BLOCK-171 CP-1 — Stop 复出（hook 内已接后端级联取消）
    stop,
    // BLOCK-178 — 队列一等化操作面
    removeQueuedById,
    withdrawQueued,
    moveQueued,
    sendNowQueued,
  } = useChatStream({
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
    autoDrain,
    displayMessages,
    activeRun,
    activeModel,
    activeModelId,
    autoModel,
    modelPresets,
    modelCatalog,
    roleBindings,
    hasImages: () => imageRefsRef.current.length > 0,
    accessMode,
    planMode,
    createConversationForRun,
    thinkingLevel,
    // UI-373 — 未选项目等宿主侧发送拦截（欢迎页）
    sendGuard,
    // CK-01 — 运行中发送自动 steer 回执（行内轻提示 + 自动消退）
    onSteer: (info) => {
      if (info.ok) {
        const preview = info.text.length > 24 ? info.text.slice(0, 24) + '…' : info.text;
        setSteerNotice('已转向当前任务' + (typeof info.depth === 'number' && info.depth > 1 ? '（排队第 ' + info.depth + ' 位）' : '') + '：' + preview);
      } else {
        setSteerNotice('转向失败：' + (info.error || '未知原因') + '（输入已保留）');
      }
    },
  });

  // BLOCK-178 P2 — 失焦任务完成桌面通知（实验特性开关 petri:notify-on-done，默认开）。
  // 仅 streaming true→false 边沿 + 窗口失焦时触发；通知点击回窗。
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!was || streaming) return;
    try {
      if (typeof document !== 'undefined' && !document.hidden) return;
      if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
      if (window.localStorage.getItem('petri:notify-on-done') === '0') return;
      const notification = new Notification('Petri · 任务完成', { body: '当前任务已收尾——点击回到窗口查看结果' });
      notification.onclick = () => {
        try { window.focus(); notification.close(); } catch { /* 聚焦失败忽略 */ }
      };
    } catch { /* 通知面失败不阻塞主流程 */ }
  }, [streaming]);

  // BLOCK-171 CP-4 — steer 状态持续可见：state 移到 hook 后声明（effect 依赖
  // 可读 streaming）。流式期间不自动消退；run 结束 4s 后消退。
  const [steerNotice, setSteerNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!steerNotice) return undefined;
    if (streaming) return undefined;
    const t = window.setTimeout(() => setSteerNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [steerNotice, streaming]);

  // BLOCK-171 CP-2 — 确认通道卡：从 run 快照工具活动派生最新一条待确认拒绝
  // （dynamic_guard / user_rule_require_ack 且带 guardKey；本地已裁定键跳过）。
  // BLOCK-180 — 派生扩展字段：requestId/command/spans（审批一等资源面）。
  const [ackedGuardKeys, setAckedGuardKeys] = useState<string[]>([]);
  const [guardAckBusy, setGuardAckBusy] = useState(false);
  const pendingGuardAck = useMemo(() => {
    const acts = activeRun?.toolActivities || [];
    for (let i = acts.length - 1; i >= 0; i -= 1) {
      const activity = acts[i] as { status?: string; name?: string; resultData?: unknown };
      if (activity.status !== 'denied' && activity.status !== 'error') continue;
      const data = activity.resultData as {
        error?: string; reason?: string; guardKey?: string; message?: string;
        requestId?: string; command?: string; spans?: Array<{ start: number; end: number; kind: string }>;
      } | undefined;
      if (!data || !data.guardKey) continue;
      // BLOCK-181 代行评估抓真 — 信封 error 实为 *_triggered（reason 才是
      // dynamic_guard/user_rule_require_ack）；两字段都接受以兼容历史快照。
      const isGuardDeny = data.error === 'dynamic_guard' || data.error === 'dynamic_guard_triggered'
        || data.reason === 'dynamic_guard' || data.error === 'user_rule_require_ack'
        || data.reason === 'user_rule_require_ack';
      if (!isGuardDeny) continue;
      if (ackedGuardKeys.includes(data.guardKey)) continue;
      return {
        guardKey: data.guardKey,
        toolName: activity.name || '',
        message: data.message || '',
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
        command: typeof data.command === 'string' ? data.command : null,
        spans: Array.isArray(data.spans) ? data.spans : null,
      };
    }
    return null;
  }, [activeRun, ackedGuardKeys]);
  const handleGuardAck = useCallback((mode: 'once' | 'always') => {
    if (!pendingGuardAck || !conversationId) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    if (!runTaskId) return;
    setGuardAckBusy(true);
    void fetch(getPlatformApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/guard-ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      // BLOCK-180 — requestId 在场=请求级决策；缺席=存量键级放行（向后兼容）
      body: JSON.stringify({
        guardKey: pendingGuardAck.guardKey,
        always: mode === 'always',
        ...(pendingGuardAck.requestId ? { requestId: pendingGuardAck.requestId, decision: 'approve' } : {}),
      }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((data: { ok?: unknown }) => {
        if (data && data.ok) setAckedGuardKeys((current) => [...current, pendingGuardAck.guardKey]);
      })
      .catch(() => {
        // 网络失败保留卡片（用户可重试）；本地态不变
      })
      .finally(() => setGuardAckBusy(false));
  }, [conversationId, pendingGuardAck]);
  // BLOCK-180 P0 — 拒绝上送（请求级 deny 留痕；键级退化为本地关卡）
  const handleGuardDismiss = useCallback(() => {
    if (!pendingGuardAck || !conversationId) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    setAckedGuardKeys((current) => [...current, pendingGuardAck.guardKey]);
    if (!pendingGuardAck.requestId || !runTaskId) return;
    void fetch(getPlatformApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/guard-ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      body: JSON.stringify({ requestId: pendingGuardAck.requestId, guardKey: pendingGuardAck.guardKey, decision: 'deny' }),
    }).catch(() => { /* deny 上送失败不阻塞本地关卡 */ });
  }, [conversationId, pendingGuardAck]);

  // BLOCK-171 CP-4 — 排队追问可见可撤（当前会话的 queued 条目，带位次）。
  // BLOCK-178 P1 — 管理操作锚点改稳定 id；撤回=回填输入框编辑重发。
  const visibleQueuedPrompts = queuedPrompts.filter((q) => q.conversationId === conversationId);
  const handleWithdrawQueued = useCallback((id: string) => {
    const result = withdrawQueued(id);
    if (result.ok && result.text) {
      setInput(result.text);
      if (taRef.current) {
        taRef.current.focus();
        const len = result.text.length;
        taRef.current.setSelectionRange(len, len);
      }
    }
  }, [withdrawQueued]);
  const handleSendNowQueued = useCallback((id: string) => {
    sendNowQueued(id);
  }, [sendNowQueued]);
  const handleMoveQueued = useCallback((id: string, dir: -1 | 1) => {
    moveQueued(id, dir);
  }, [moveQueued]);

  // BLOCK-178 P0 — 用户消息「编辑」：回退到该消息之前 + 文本回填输入框（重发即新轮）。
  // 仅历史消息可编辑（run 投影件 indexOf 不到，行组件不渲染编辑钮——诚实边界）。
  const handleEditUserMessage = useCallback((m: SimpleMessage) => {
    if (streaming) return;
    const idx = messages.indexOf(m);
    if (idx < 0) return;
    const truncated = messages.slice(0, idx);
    setMessages(truncated);
    if (conversationId) clearConversationRun(conversationId);
    const content = m.content ?? '';
    setInput(content);
    try { saveConversationDraft(projectId, conversationId, content); } catch { /* 草稿面失败不阻塞 */ }
    if (taRef.current) {
      taRef.current.focus();
      const len = content.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [conversationId, messages, projectId, setInput, streaming]);

  // BLOCK-171 CP-1 — 运行簇取消：POST tool-cancel（后端注册表精确 abort + tool_cancel
  // 事件留痕）。标识稳定（taskId 经 snapshot 读，不入依赖）→ 不破坏行级 memo。
  const handleCancelTools = useCallback((callIds: string[]) => {
    if (!conversationId || callIds.length === 0) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    if (!runTaskId) return;
    for (const callId of callIds) {
      void fetch(getPlatformApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/tool-cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
        },
        body: JSON.stringify({ callId }),
      }).catch(() => {
        // 取消请求失败不阻塞界面（run 仍受 Stop/轮边界收尾兜底）
      });
    }
  }, [conversationId]);

  // BLOCK-92 Wave A-3 — 审批流状态簇外迁（参数草稿同步/harness 修复/自动批准门，
  // 见 ./SimpleChat/hooks/useApprovalFlow.ts）+ 计划批准状态簇外迁（BLOCK-55，
  // 见 ./SimpleChat/hooks/usePlanApprovalFlow.ts）。调用点依赖 send/streaming，
  // 故置于 useChatStream 之后。
  const {
    approvalRepair,
    approvePending,
    rejectPending,
  } = useApprovalFlow({
    pendingApproval,
    streaming,
    accessMode,
    copilotCtxRef,
    projectId,
    conversationId,
    send,
  });
  const {
    pendingPlan,
    setPendingPlan,
    pendingRevision,
    planCardBusy,
    handlePlanApprove,
    handleRevisionApprove,
  } = usePlanApprovalFlow({
    conversationId,
    streaming,
    send,
    setAccessMode,
    prePlanAccessModeRef,
  });

  // BLOCK-52 P1（选中即引用）：带引用块的发送包装——发送前把引用块渲染进
  // 消息正文，接受成功后清空引用块；被守卫拦截（空文本 / 运行中）时保留待重试。
  // BLOCK-52 P2：图片引用卡同管道——artifact 元数据合成进正文，成功后一并清空。
  // BLOCK-178 P2 — prompt 历史跨会话持久化（按项目隔离；去重连续项，上限 50）。
  const appendPromptHistory = useCallback((text: string) => {
    try {
      const key = `petri:prompt-history:v1:${projectId || 'global'}`;
      const raw = localStorage.getItem(key);
      const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (list[list.length - 1] !== text) list.push(text);
      localStorage.setItem(key, JSON.stringify(list.slice(-50)));
    } catch { /* 存储不可用=会话内历史兜底 */ }
  }, [projectId]);
  const loadPromptHistory = useCallback((): string[] => {
    try {
      const key = `petri:prompt-history:v1:${projectId || 'global'}`;
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as string[]).slice().reverse() : [];
    } catch { return []; }
  }, [projectId]);

  const sendWithRefs = useCallback(async (text: string): Promise<boolean> => {
    // BLOCK-91 — 附件真实接入：发送前上传到工作区 .chat-attachments/，
    // 消息追加引用行（模型按路径读取，与 imageRefs 同构）。无项目（欢迎页）
    // 诚实报错——不再静默丢弃附件。
    let attachmentBlock = '';
    if (attachments.length > 0) {
      if (!projectId) {
        setAttachmentNotice('附件需在项目工作区中使用；请先选择项目再发送附件');
        return false;
      }
      try {
        const refs = [];
        for (const att of attachments) {
          refs.push(await uploadAttachment(projectId, att));
        }
        attachmentBlock = composeAttachmentReferenceLines(refs);
      } catch (error) {
        setAttachmentNotice((error as Error).message || '附件上传失败');
        return false;
      }
    }
    const composed = composeMessageWithImageReferences(
      composeMessageWithSelectionReferences(text, selectionRefsRef.current),
      imageRefsRef.current,
    ) + attachmentBlock;
    // A3 — 用户主动发送 = 回到底部意图，恢复自动跟随。
    atBottomRef.current = true;
    setShowJumpToBottom(false);
    const ok = await send(composed);
    if (ok) {
      appendPromptHistory(composed);
      setSelectionRefs([]);
      setImageRefs([]);
      if (attachments.length > 0) {
        for (const att of attachments) {
          if (att.previewUrl && !att.dataUrl) URL.revokeObjectURL(att.previewUrl);
        }
        setAttachments([]);
        setAttachmentNotice(null);
      }
    }
    return ok;
  }, [send, attachments, projectId, appendPromptHistory]);

  // BLOCK-166 P2 — Gen UI follow-up 追问（规格 §8）：判定走 followUp.ts 纯函数
  // （只读/过期/非当前会话明确拒绝），确认框标题=卡片给定的 title（≤250）；
  // 通过后写入现有输入绑定的发送路径——非流式直接发，流式走既有排队（BLOCK-52），
  // 与 Enter 路径完全同构；状态变化绝不自动开启新模型轮次，follow-up 是唯一显式入口。
  const handleGenUiFollowUp = useCallback((request: GenUiFollowUpRequest): Promise<GenUiFollowUpResult> => {
    const verdict = resolveGenUiFollowUp({
      request,
      currentConversationId: conversationId,
      inputAvailable: Boolean(taRef.current),
    });
    if (!verdict.ok) return Promise.resolve({ ok: false, reason: verdict.reason });
    const prompt = verdict.prompt ?? '';
    const confirmed = window.confirm(`${verdict.title}\n\n${prompt.length > 500 ? `${prompt.slice(0, 500)}…` : prompt}`);
    if (!confirmed) return Promise.resolve({ ok: false, reason: '已取消' });
    if (streaming) {
      const queuedWithRefs = composeMessageWithSelectionReferences(prompt, selectionRefsRef.current);
      const enqueued = enqueueQueuedPrompt(queuedPrompts, queuedWithRefs, conversationId ?? '');
      if (!enqueued.ok) { showQueueOverflow(); return Promise.resolve({ ok: false, reason: '队列已满（上限 20）' }); }
      setQueuedPrompts(enqueued.next);
      setInput('');
      historyNavRef.current = INITIAL_NAV_STATE;
      clearConversationDraft(projectId, conversationId);
      if (taRef.current) taRef.current.style.height = 'auto';
      setSelectionRefs([]);
    } else {
      void sendWithRefs(prompt);
    }
    return Promise.resolve({ ok: true });
  }, [conversationId, projectId, streaming, sendWithRefs]);

  // BLOCK-68 / UI-317 —— 「刷新文件链接」入口删除后改自动化（hook 外迁可单测）：
  // 订阅 agent 写档/数据导入信号，debounce 后清解析缓存并 bump resolveNonce。
  useAutoFileReferenceRefresh(() => setResolveNonce((value) => value + 1));

  // BLOCK-92 Wave A-3 — fork 状态簇（./SimpleChat/hooks/useForkConversation.ts）
  // 与 token 预算事件状态（./SimpleChat/hooks/useTokenBudgetState.ts）外迁。
  const { forkingAtIndex, handleForkAt } = useForkConversation({
    conversationId,
    projectId,
    refreshConversations,
    onConversationChange,
  });
  const tokenBudget = useTokenBudgetState();

  // UI-523 — composer 运行计量条数据：最近一次调用实测（事件）+ 本会话累计（只读聚合）。
  // 运行结束（status 变化）强制刷一次会话累计；运行中由事件 2s 节流刷新。
  const runUsage = useRunUsage(conversationId);
  const conversationUsage = useConversationUsage(conversationId, activeRun?.status ?? null);
  const runSteps = activeRun ? activeRun.toolActivities.length : null;
  const runRounds = activeRun ? (activeRun.iteration ?? activeRun.loop?.iterations.length ?? null) : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command navigation
    if (slashOpen) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashFocusedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashFocusedIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[slashFocusedIndex];
        if (cmd) executeSlashCommand(cmd.id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        setSlashQuery('');
        return;
      }
      // If user types something other than part of query (like space after /), close panel
      if (e.key === ' ' && input === '/') {
        e.preventDefault();
        setSlashOpen(false);
        setSlashQuery('');
        return;
      }
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      // 历史源：本会话已发送的用户消息，最新在前（反序）。
      // BLOCK-178 P2 — 并入跨会话持久历史（会话内消息优先，去重补位）。
      const inConversation = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content ?? '')
        .filter((c) => c.trim() !== '')
        .reverse();
      const seen = new Set(inConversation);
      const history = [...inConversation, ...loadPromptHistory().filter((h) => !seen.has(h))];
      const { state, value } = stepHistoryNavigation(
        history,
        historyNavRef.current,
        direction,
        input,
      );
      historyNavRef.current = state;
      const changed = value !== input;
      if (changed) setInput(value);
      // 仅在真正切换了历史时才拦截默认行为，避免空历史/最旧处打断多行光标移动。
      if (changed) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      // BLOCK-178 P0 — Alt+Enter 单次反向投递（转向↔排队）；默认按投递模式路由。
      void submitComposer(trimmed, { reverse: e.altKey });
    }
  };

  // BLOCK-178 P0 — 统一提交路由：空闲直发；运行中按投递模式（转向=send() 走
  // task/:id/steer 立即注入下一轮边界；排队=BLOCK-52 本地队列收尾后自动发）。
  // steer 被拒（非运行/网络）时回退排队并诚实提示；入队即不可撤语义不变。
  const submitComposer = useCallback(async (rawText: string, opts?: { reverse?: boolean }) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const mode = effectiveDelivery(opts?.reverse);
    if (!streaming) {
      await sendWithRefs(trimmed);
      return;
    }
    const composed = composeMessageWithSelectionReferences(trimmed, selectionRefsRef.current);
    if (mode === 'queue') {
      const enqueued = enqueueQueuedPrompt(queuedPrompts, composed, conversationId);
      if (!enqueued.ok) { showQueueOverflow(); return; }
      setQueuedPrompts(enqueued.next);
      setInput('');
      historyNavRef.current = INITIAL_NAV_STATE;
      clearConversationDraft(projectId, conversationId);
      if (taRef.current) taRef.current.style.height = 'auto';
      setSelectionRefs([]);
      return;
    }
    // steer：send() 流式期自动改走 task/:id/steer（CK-01）；ok=true 由本处清输入
    const accepted = await send(composed);
    if (accepted) {
      setInput('');
      historyNavRef.current = INITIAL_NAV_STATE;
      clearConversationDraft(projectId, conversationId);
      if (taRef.current) taRef.current.style.height = 'auto';
      setSelectionRefs([]);
    } else {
      // 转向失败（无运行 taskId/网络）→ 回退排队（诚实：溢出则保留输入）
      const enqueued = enqueueQueuedPrompt(queuedPrompts, composed, conversationId);
      if (enqueued.ok) {
        setQueuedPrompts(enqueued.next);
        setInput('');
        setSteerNotice('转向未受理，已转入排队（收尾后自动发送）');
        historyNavRef.current = INITIAL_NAV_STATE;
        clearConversationDraft(projectId, conversationId);
        if (taRef.current) taRef.current.style.height = 'auto';
        setSelectionRefs([]);
      } else {
        setQueueOverflow(true);
      }
    }
  }, [conversationId, effectiveDelivery, projectId, queuedPrompts, send, sendWithRefs, showQueueOverflow, streaming]);

  // BLOCK-28.8 — 排队/停止按钮曾按用户裁决移除；BLOCK-171 CP-1/CP-4 经用户
  // 整波授权恢复（Stop 键随 streaming 条件渲染、排队 chips 可见可撤），
  // stop/queue 能力仍以 useChatStream 为单一实现源。

  // Create new conversation
  const newConversation = useCallback(() => {
    onConversationChange(null);
    setMessages([]);
    setQueuedPrompts([]);
  }, [onConversationChange]);

  const executeSlashCommand = useCallback((commandId: string) => {
    switch (classifySlashCommand(commandId)) {
      case 'new-conversation':
        void newConversation();
        break;
      case 'clear-conversation':
        setMessages([]);
        clearConversationDraft(projectId, conversationId);
        break;
      case 'toggle-model-menu':
        setModelMenuOpen((current) => current ? null : 'model');
        break;
      case 'export-markdown': {
        const markdown = displayMessages
          .map((m) => `### ${m.role === 'user' ? '用户' : 'AI'}\n\n${m.content}\n`)
          .join('\n---\n\n');
        const blob = new Blob([`# 对话导出\n\n> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n${markdown}`], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'compact-context': {
        // BLOCK-172 CP-7 — /compact 手动压缩（后端 BLOCK-95 B2 端点；同步等摘要）。
        if (!conversationId) {
          setSteerNotice('压缩上下文：当前无会话');
          break;
        }
        setSteerNotice('正在压缩上下文（生成摘要中）…');
        void (async () => {
          try {
            const response = await fetch(getPlatformApiPrefix() + '/ai/conversations/' + encodeURIComponent(conversationId) + '/compact', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
              },
            });
            const data = (await response.json().catch(() => ({}))) as { status?: string; compacted?: boolean; reason?: string; compaction?: { coversCount?: number }; error?: string };
            if (response.ok && data.status === 'ok' && data.compacted) {
              setSteerNotice(`上下文已压缩（覆盖 ${data.compaction?.coversCount ?? 0} 条较早消息）`);
            } else if (data.reason === 'below_threshold' || data.reason === 'too_few_messages') {
              setSteerNotice('上下文尚未达到压缩阈值，无需压缩');
            } else if (data.error === 'session compaction disabled') {
              setSteerNotice('会话压缩开关未开启（设置→实验特性）');
            } else {
              setSteerNotice('压缩失败：' + (data.error || 'HTTP ' + response.status));
            }
          } catch (e) {
            setSteerNotice('压缩失败：' + (e instanceof Error ? e.message : '网络错误'));
          }
        })();
        break;
      }
      case 'dismiss-slash':
        setSlashQuery('');
        break;
    }
    // BLOCK-160 W2 P3（KNW-3）— 执行意图条目：注入文本模板而非执行 UI 动作
    if (commandId.startsWith('skill:') || commandId.startsWith('template:')) {
      const kind = commandId.startsWith('skill:') ? 'skill' : 'template';
      const id = commandId.slice(kind.length + 1);
      const template = slashIntentTemplate({ kind, id, label: '', description: '' });
      setInput(template);
      saveConversationDraft(projectId, conversationId, template);
      setSlashOpen(false);
      setSlashQuery('');
      historyNavRef.current = INITIAL_NAV_STATE;
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.focus();
          taRef.current.setSelectionRange(template.length, template.length);
          resizeTextarea(taRef.current);
        }
      });
      return;
    }
    // Close panel and clear input
    setSlashOpen(false);
    setSlashQuery('');
    setInput('');
    historyNavRef.current = INITIAL_NAV_STATE;
    clearConversationDraft(projectId, conversationId);
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [newConversation, projectId, conversationId, displayMessages, resizeTextarea]);

  // Close slash panel on outside click
  useEffect(() => {
    if (!slashOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (slashPanelRef.current && !slashPanelRef.current.contains(e.target as Node)) {
        setSlashOpen(false);
        setSlashQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [slashOpen]);

  // Handle example prompt selection
  const handleExampleSelect = useCallback((prompt: string) => {
    setInput(prompt);
    saveConversationDraft(projectId, conversationId, prompt);
    taRef.current?.focus();
  }, [projectId, conversationId]);

  // 2026-09-18 历史残留清理 — 领域感知示例卡（通用卡兜底 + 已装领域包动态追加）
  const examplePrompts = useDomainExamplePrompts();

  const examplePromptsToShow = displayMessages.length === 0 ? examplePrompts : [];

  return (
    <div className={`sc-outer${composerOnly ? ' sc-outer-composer-only' : ''}`} data-rail-body>
      <div className={`sc-root${composerOnly ? ' sc-root-composer-only' : ''}`}>
        <div className="sc-body">
          <div className="sc-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
          {older.loadingMore && <div className="sc-loading-older">加载更早消息…</div>}
          {/* BLOCK-95 B2/A5 — 压缩诚实可见：LLM 视图中更早上下文已折叠为摘要（本界面仍显示原文） */}
          {compaction && !composerOnly && displayMessages.length > 0 && (
            <div className="sc-compaction-notice" role="status" title={compaction.summary}>
              <Icon name="layers" size={13} />
              <span>
                上下文压缩视图：更早的 {compaction.coversCount} 条消息已折叠为摘要参与对话
                <span className="sc-compaction-notice-sub">（此处仍显示原文 · {compaction.sourceTokens} tokens 已压缩）</span>
              </span>
            </div>
          )}
          {loading && <div className="sc-loading">加载会话…</div>}
          {!loading && displayMessages.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-icon">
                <Icon name="message-circle" size={32} />
              </div>
              <p>开始新的对话</p>
              <span>在下方输入框中提问</span>
              {examplePromptsToShow.length > 0 && (
                <ExamplePrompts prompts={examplePromptsToShow} onSelect={handleExampleSelect} />
              )}
            </div>
          )}
          {/* BLOCK-154 波次 3 — 行渲染走 memo 化 SimpleChatMessageRow：历史消息对象
              引用恒定（派生链 slice+尾替换）+ 回调/记录身份稳定 → 流式 tick 只重渲染
              实际变化的行；topicShift 分隔与行 DOM 结构逐行保留在行组件内。 */}
          {displayMessages.map((m, i) => {
            const key = m.ts ? `${m.role}-${m.ts}-${i}` : `${m.role}-${i}`;
            return (
              <SimpleChatMessageRow
                key={key}
                m={m}
                messageKey={key}
                isTopicShiftStart={i === topicShiftIndex}
                topicShiftReason={topicShiftReason}
                segments={timelineSegmentsByMessage.get(m.id ?? `idx:${i}`) ?? EMPTY_ROW_SEGMENTS}
                streaming={streaming}
                onCancelTools={handleCancelTools}
                settledContext={settledContext}
                resolveNonce={resolveNonce}
                extraRenderersFlag={extraRenderersFlag}
                conversationId={conversationId}
                projectId={projectId}
                copiedMessageKey={copiedMessageKey}
                forkingAtIndex={forkingAtIndex}
                forkAbsoluteIndex={older.windowOffset + i}
                summaryRetryState={summaryRetryState}
                summaryRetryErrors={summaryRetryErrors}
                summaryRetryAttempts={summaryRetryAttempts}
                summaryRetryCooldownUntil={summaryRetryCooldownUntil}
                cooldownNow={cooldownNow}
                maxSummaryRetries={MAX_SUMMARY_RETRIES}
                formatError={formatError}
                getTechnicalDetails={getTechnicalDetails}
                onFileReferenceClick={handleFileReferenceClick}
                onCopyMessage={copyMessage}
                onRegenerate={regenerate}
                onEditUserMessage={m.role === 'user' && !m.pending && i < messages.length && !streaming ? handleEditUserMessage : undefined}
                onForkAt={handleForkAt}
                onRetrySummary={retrySummary}
                onGenUiFollowUp={handleGenUiFollowUp}
              />
            );
          })}
          {standaloneDurableLoop && (
            <div className="sc-msg sc-msg-assistant" aria-label="历史任务循环">
              <div className="sc-msg-avatar">
                <Icon name="cpu" size={16} />
              </div>
              <div className="sc-msg-body">
                <LoopStatusPanel loop={standaloneDurableLoop} pending={false} />
              </div>
            </div>
          )}
          {pendingApproval && accessMode !== 'full' && (
            <ApprovalCard
              approval={pendingApproval}
              repairState={approvalRepair}
              onApprove={() => void approvePending()}
              onReject={() => void rejectPending()}
              busy={streaming}
            />
          )}
        </div>

        {/* BLOCK-55 P1/P3 — 计划批准卡 + 修订批准条（仅在有待批准内容时渲染） */}
        {pendingPlan && (
          <PlanApprovalCard
            plan={pendingPlan}
            busy={planCardBusy}
            onApprove={(action) => void handlePlanApprove(action)}
            onDismiss={() => setPendingPlan(null)} onOpenInTab={(planId) => dispatchPetriEvent(petriEvents.planSurfaceOpen, { planId })}
          />
        )}
        {pendingRevision && !pendingPlan && (
          <div className="sc-plan-revision-banner" role="status">
            <Icon name="git-branch" size={14} />
            <span className="sc-plan-revision-text">
              计划「{pendingRevision.title}」有待批准修订案 #{pendingRevision.revNo}
            </span>
            <button
              type="button"
              className="sc-plan-approval-btn sc-plan-approval-btn-primary"
              disabled={planCardBusy}
              onClick={() => void handleRevisionApprove()}
            >
              批准修订
            </button>
          </div>
        )}

        {/* UI-386 — 聊天区子智能体聚合条退役：聚合/历史图标化进摘要卡「智能体」节，
            实时状态由时间线内联卡 + 右栏「智能体」tab 承载 */}
        <div
          className="sc-input-area"
          style={{ ['--sc-composer-width' as string]: `${composerWidth}px` }}
        >
          {/* BLOCK-95 A3 — 回到底部浮标：锚定输入区顶缘（bottom:100%），用户上翻且
              距底 >600px 时出现，点击回底并恢复自动跟随 */}
          {showJumpToBottom && !composerOnly && (
            <button
              type="button"
              className="sc-jump-bottom"
              onClick={() => scrollToBottom(true)}
              aria-label="回到底部"
            >
              <Icon name="chevron-down" size={14} />
              回到底部
            </button>
          )}
          {/* Slash command panel */}
          {slashOpen && (
            <div className="sc-slash-panel" ref={slashPanelRef}>
              <div className="sc-slash-header">
                <span className="sc-slash-title">命令</span>
                <span className="sc-slash-hint">↑↓ 导航 · Enter 执行 · Esc 关闭</span>
              </div>
              <div className="sc-slash-list" ref={slashListRef}>
                {filteredCommands.length === 0 ? (
                  <div className="sc-slash-empty">未找到匹配命令</div>
                ) : (
                  filteredCommands.map((cmd, index) => (
                    <button
                      key={`${cmd.kind}:${cmd.id}`}
                      type="button"
                      className={`sc-slash-item ${index === slashFocusedIndex ? 'sc-slash-item-focused' : ''}`}
                      onClick={() => executeSlashCommand(cmd.kind === 'action' ? cmd.id : `${cmd.kind}:${cmd.id}`)}
                      onMouseEnter={() => setSlashFocusedIndex(index)}
                    >
                      {cmd.kind !== 'action' && (
                        <span
                          className="sc-slash-item-label"
                          style={{ marginRight: 6, fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-accent, #3b82f6)' }}
                        >
                          {cmd.kind === 'skill' ? '技能' : '模板'}
                        </span>
                      )}
                      <span className="sc-slash-item-label">{cmd.label}</span>
                      <span className="sc-slash-item-desc">{cmd.description}</span>
                    </button>
                  ))
                )}
              </div>
              {slashQuery === '' && filteredCommands.length > 0 && (
                <div className="sc-slash-help-hint">输入 / 或命令名称搜索</div>
              )}
            </div>
          )}
          <div
            ref={composerBarRef}
            className={`sc-composer${isDraggingOver ? ' sc-composer-dragging' : ''}${slimComposer ? ' sc-composer-slim' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
            {/* BLOCK-91 — 附件守卫/失败提示 */}
            {attachmentNotice && (
              <div className="sc-attachment-notice" role="alert">{attachmentNotice}</div>
            )}
            {steerNotice && (
              <div className="sc-attachment-notice" role="status">{steerNotice}</div>
            )}
            {/* BLOCK-171 CP-2 — 动态防护确认卡（require-ack 用户可见面）；
                BLOCK-180 — 审批资源面：requestId 级决策/command span 高亮/两步武装 */}
            {pendingGuardAck && (
              <GuardAckCard
                toolName={pendingGuardAck.toolName}
                guardKey={pendingGuardAck.guardKey}
                message={pendingGuardAck.message}
                busy={guardAckBusy}
                requestId={pendingGuardAck.requestId}
                command={pendingGuardAck.command}
                spans={pendingGuardAck.spans}
                armedGuardKeys={ackedGuardKeys}
                onAck={handleGuardAck}
                onDismiss={handleGuardDismiss}
              />
            )}
            {/* BLOCK-171 CP-4 + BLOCK-178 加映 — 排队面板（ZCode ConversationQueuePanel 形态：
                竖排全宽行=位次+文本+动作簇；溢出/暂停状态行内联面板顶部；输入框上方） */}
            {(visibleQueuedPrompts.length > 0 || queueOverflow || !autoDrain) && (
              <div className="sc-queue-panel" role="list" aria-label="排队中的追问" data-testid="queue-panel">
                <div className="sc-queue-panel__head">
                  <span className="sc-queue-panel__title">
                    排队 {visibleQueuedPrompts.length} 条{!autoDrain ? ' · 自动排水已暂停' : ''}
                  </span>
                  {visibleQueuedPrompts.length > 0 && autoDrain && (
                    <button
                      type="button"
                      className="sc-queue-panel__headbtn"
                      aria-label="暂停自动排水"
                      title="暂停自动排水：跑完当前轮后不自动发送，排队项保留"
                      data-testid="queue-pause"
                      onClick={() => setAutoDrain(false)}
                    >
                      ‖ 暂停排水
                    </button>
                  )}
                  {!autoDrain && (
                    <button
                      type="button"
                      className="sc-queue-panel__headbtn"
                      aria-label="恢复自动排水"
                      title="恢复自动排水（跑完自动发送排队项）"
                      data-testid="queue-resume"
                      onClick={() => setAutoDrain(true)}
                    >
                      ▶ 恢复排水
                    </button>
                  )}
                </div>
                {queueOverflow && (
                  <div className="sc-queue-panel__notice" role="status" data-testid="queue-overflow">
                    队列已满（上限 {QUEUE_CAP} 条）——请先处理既有排队项
                  </div>
                )}
                {visibleQueuedPrompts.map((q, i) => (
                  <div key={q.id} className="sc-queue-row" role="listitem" data-testid={`queue-row-${q.id}`}>
                    <span className="sc-queue-row__pos">#{i + 1}</span>
                    <span className="sc-queue-row__text" title={q.text}>{q.text}</span>
                    <span className="sc-queue-row__actions">
                      <button type="button" className="sc-queue-row__btn" aria-label="立即发送该条" title="立即发送：停止当前轮并优先消费该条" data-testid="queue-chip-send-now" onClick={() => handleSendNowQueued(q.id)}>▶</button>
                      <button type="button" className="sc-queue-row__btn" aria-label="撤回该排队消息到输入框" title="撤回编辑（回填输入框）" data-testid="queue-chip-withdraw" onClick={() => handleWithdrawQueued(q.id)}>✎</button>
                      <button type="button" className="sc-queue-row__btn" aria-label="上移" title="上移一位" data-testid="queue-chip-up" onClick={() => handleMoveQueued(q.id, -1)}>↑</button>
                      <button type="button" className="sc-queue-row__btn" aria-label="下移" title="下移一位" data-testid="queue-chip-down" onClick={() => handleMoveQueued(q.id, 1)}>↓</button>
                      <button
                        type="button"
                        className="sc-queue-row__btn sc-queue-row__btn--danger"
                        aria-label="移除该排队消息"
                        title="移除该排队消息"
                        data-testid="queue-chip-remove"
                        onClick={() => removeQueuedById(q.id)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="sc-attachments">
                {attachments.map((att) => (
                  <div key={att.id} className="sc-attachment">
                    {att.previewUrl ? (
                      <button
                        type="button"
                        className="sc-attachment-preview-btn"
                        onClick={() => openPreview(att)}
                        title={`预览 ${att.name}`}
                        aria-label={`预览 ${att.name}`}
                      >
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="sc-attachment-thumb"
                        />
                        <span className="sc-attachment-overlay">
                          <Icon name="eye" size={16} />
                        </span>
                      </button>
                    ) : (
                      <div className="sc-attachment-file">
                        <Icon name="file" size={20} />
                      </div>
                    )}
                    {/* UI-477 加映（用户裁决「直接是个缩小的图就行」）：图片附件
                        不再显示文件名（缩略图即语义）；非图片文件保留文件名。 */}
                    {!att.previewUrl && (
                      <span className="sc-attachment-name" title={att.name}>
                        {att.name}
                      </span>
                    )}
                    <button
                      type="button"
                      className="sc-attachment-remove"
                      onClick={() => removeAttachment(att.id)}
                      title="移除"
                      aria-label="移除"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* BLOCK-52 P1 — 选中即引用条：右栏预览选中的文字块，随下一条消息发送 */}
            {selectionRefs.length > 0 && (
              <div className="sc-selection-refs">
                {selectionRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="sc-selection-ref"
                    title={`${selectionReferenceLocation(ref)}\n${ref.text}`}
                  >
                    <Icon name="file" size={12} />
                    <span className="sc-selection-ref-loc">{selectionReferenceLocation(ref)}</span>
                    <span className="sc-selection-ref-text">{selectionReferenceChipLabel(ref)}</span>
                    <button
                      type="button"
                      className="sc-selection-ref-remove"
                      onClick={() => removeSelectionRef(ref.id)}
                      title="移除引用"
                      aria-label="移除引用"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* BLOCK-52 P2 — 图片引用卡：右栏图片预览选中的图片，随下一条消息发送 */}
            {imageRefs.length > 0 && (
              <div className="sc-image-refs">
                {imageRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="sc-image-ref"
                    title={imageReferenceSourceLine(ref)}
                  >
                    <img
                      src={ref.url}
                      alt={ref.name}
                      className="sc-image-ref-thumb"
                      draggable={false}
                    />
                    <span className="sc-image-ref-name" title={ref.name}>{ref.name}</span>
                    <span className="sc-image-ref-source">{imageReferenceSourceLine(ref)}</span>
                    <button
                      type="button"
                      className="sc-image-ref-remove"
                      onClick={() => removeImageRef(ref.id)}
                      title="移除图片引用"
                      aria-label="移除图片引用"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sc-composer-body">
              <textarea
                ref={taRef}
                className="sc-input"
                rows={1}
                value={input}
                placeholder={composerPlaceholder(compact)}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="sc-composer-bar">
              <div className="sc-composer-left">
                {/* BLOCK-60：死控件 + 已移除；刷新/I-O 收进 ⋯ 溢出菜单 */}
                <div className="sc-access-picker">
                  {conversationId && !slimComposer ? (
                    <button
                      type="button"
                      className="sc-access-btn"
                      onClick={handleExportConversation}
                      title="导出会话为 Markdown"
                    >
                      <Icon name="download" size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="sc-access-btn"
                    onClick={() => setAccessMenuOpen((value) => !value)}
                    disabled={Boolean(lockedAccessMode)}
                    title={lockedAccessMode
                      ? '此面板仅聊天（只读档）：如需修改文件请回中栏输入'
                      : '选择访问模式'}
                  >
                    <Icon name="shield" size={14} />
                    <span>{accessModeLabel}</span>
                    {!lockedAccessMode && <Icon name="chevron-down" size={12} />}
                  </button>
                  {accessMenuOpen && (
                    <>
                      <div className="sc-access-overlay" onClick={() => setAccessMenuOpen(false)} />
                      <div className="sc-access-menu">
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'full' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('full');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">完全访问</span>
                          <span className="sc-access-option-sub">允许命令行、文件修改与工具调用</span>
                        </button>
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'workspace-write' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('workspace-write');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">项目写</span>
                          <span className="sc-access-option-sub">允许项目内文件修改与前台命令；后台进程与插件执行不可用</span>
                        </button>
                        {/* UI-303 — 计划模式并入档位菜单（BLOCK-55 Spec 门）：只读探索 + 起草计划 */}
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'plan' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            if (accessMode !== 'plan') prePlanAccessModeRef.current = accessMode;
                            setAccessMode('plan');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">计划模式</span>
                          <span className="sc-access-option-sub">只读探索并起草计划，获批后再执行</span>
                        </button>
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'read' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('read');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">只读模式</span>
                          <span className="sc-access-option-sub">仅浏览、解释和建议</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* UI-303 — 独立「计划模式」开关已并入左侧档位菜单第四档，composer 不再承载 */}
                {/* BLOCK-57 UI-290 + BLOCK-60 — 执行目标选择已迁至 设置→计算与数据（默认执行目标），composer 不再承载 */}
                {/* BLOCK-69 / UI-318 — 知识空间大脑开关（独立 icon 开关，不挂已移除的 ⋯ 菜单） */}
                <button
                  type="button"
                  className={`sc-knowledge-toggle${knowledgeSpace.enabled ? ' sc-knowledge-toggle-on' : ''}`}
                  onClick={() => void knowledgeSpace.toggle()}
                  disabled={knowledgeSpace.busy || !knowledgeSpace.embeddingAvailable}
                  title={
                    !knowledgeSpace.embeddingAvailable
                      ? '知识空间不可用：请先在设置中配置 DashScope key'
                      : knowledgeSpace.enabled
                        ? '知识空间已启用：对话自动检索知识库（点击关闭）'
                        : '启用知识空间：对话自动检索知识库'
                  }
                  data-testid="knowledge-composer-toggle"
                >
                  <Icon name="brain" size={14} />
                </button>
              </div>
              <div className="sc-composer-right">
                {/* BLOCK-68 / UI-317 —— ⋯ 工具菜单整体移除：刷新文件链接改自动化
                    （订阅 projectWorkspaceChanged），模型 I/O 迁右栏 tab；不预留空壳 */}
                {/* UI-268 改造：后台进程指示器从独立浮条收入 composer 工具栏（图标+状态点，点击展开浮层） */}
                <ToolActivityDock conversationId={conversationId} projectId={projectId} />
                {/* UI-523 — 上下文预算环搬进卡片下方计量条右端（同一组件实例；
                    UI-448 加映 v3 — slimComposer 悬挂面整条不渲染）。 */}
                <div className="sc-model-picker-pair">
                <ModelChip
                  supplier={activeSupplierGroup?.supplier || activeModel?.label || ''}
                  modelName={activeModel?.model || ''}
                  autoModel={autoModel}
                  autoPreview={autoPreview}
                  narrow={composerNarrow}
                  onOpenSupplier={() => {
                    setModelSupplierKey(activeSupplierGroup?.key || null);
                    setModelMenuOpen((current) => current === 'supplier' ? null : 'supplier');
                  }}
                  onOpenModel={() => {
                    setModelSupplierKey(selectedSupplierGroup?.key || null);
                    setModelMenuOpen((current) => current === 'model' ? null : 'model');
                  }}
                />
                  {/* BLOCK-178 P0 — 投递模式显式切换（运行中提交的路由语义） */}
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-thinking-btn"
                      onClick={() => toggleDeliveryMode(deliveryMode === 'steer' ? 'queue' : 'steer')}
                      title={deliveryMode === 'steer'
                        ? '投递模式：转向（运行中发送=立即注入当前任务下一轮）——点击切换为排队'
                        : '投递模式：排队（运行中发送=收尾后自动发送）——点击切换为转向'}
                      aria-label={`投递模式：${deliveryMode === 'steer' ? '转向' : '排队'}`}
                      data-testid="delivery-mode-toggle"
                      data-mode={deliveryMode}
                    >
                      <Icon name={deliveryMode === 'steer' ? 'arrow-right' : 'layers'} size={14} />
                      {!composerNarrow && <span>{deliveryMode === 'steer' ? '转向' : '排队'}</span>}
                    </button>
                  </div>
                  {autoDrain ? null : (
                    <div className="sc-model-picker sc-model-picker-footer">
                      <button
                        type="button"
                        className="sc-model-btn sc-thinking-btn"
                        onClick={() => setAutoDrain(true)}
                        title="自动排水已暂停——点击恢复（跑完自动发送排队项）"
                        aria-label="恢复自动排水"
                        data-testid="autodrain-toggle"
                      >
                        <Icon name="clock" size={14} />
                        {!composerNarrow && <span>已暂停</span>}
                      </button>
                    </div>
                  )}
                  {reasoningSupported && (
                    <div className="sc-model-picker sc-model-picker-footer">
                      <button
                        type="button"
                        className="sc-model-btn sc-thinking-btn"
                        onClick={() => setThinkingMenuOpen((current) => !current)}
                        title={`思考档位：${THINKING_LEVEL_LABELS[thinkingLevel]}（Ctrl+T 循环切换）`}
                        aria-label={`思考档位：${THINKING_LEVEL_LABELS[thinkingLevel]}`}
                        aria-expanded={thinkingMenuOpen}
                        data-testid="thinking-level-trigger"
                        data-level={thinkingLevel}
                      >
                        <Icon name="brain" size={14} />
                        {!composerNarrow && <span>{THINKING_LEVEL_LABELS[thinkingLevel]}</span>}
                        <Icon name="chevron-down" size={12} />
                      </button>
                    </div>
                  )}
                  {thinkingMenuOpen && (
                    <>
                      <div className="sc-model-overlay" onClick={() => setThinkingMenuOpen(false)} />
                      <div className="sc-model-menu" role="menu" aria-label="思考档位">
                        {THINKING_LEVELS.map((level) => (
                          <button
                            type="button"
                            key={level}
                            className="sc-model-option"
                            role="menuitemradio"
                            aria-checked={level === thinkingLevel}
                            data-testid={`thinking-level-option-${level}`}
                            onClick={() => applyThinkingLevel(level)}
                            title={level === 'standard' ? '不发任何思考参数（默认）' : undefined}
                          >
                            <span className="sc-model-option-title">{THINKING_LEVEL_LABELS[level]}</span>
                            <span className="sc-model-option-meta">
                              {level === thinkingLevel ? '当前使用' : level === 'standard' ? '默认·不发参数' : '点击切换'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {modelMenuOpen && (
                    <ModelMenu
                      mode={modelMenuOpen}
                      groups={modelGroups}
                      selectedGroup={selectedSupplierGroup}
                      activeModelId={activeModelId}
                      summary={catalogSummary}
                      autoModel={autoModel}
                      autoPreview={autoPreview}
                      autoError={autoModelError}
                      onToggleAuto={() => void setAutoModel(!autoModel)}
                      onClose={() => setModelMenuOpen(null)}
                      onPickSupplier={(group) => {
                        setModelSupplierKey(group.key);
                        const preferred = preferredPresetForSupplier(group);
                        if (preferred) void selectModel(preferred);
                      }}
                      onPickModel={(preset) => void selectModel(preset)}
                    />
                  )}
                </div>
                {/* BLOCK-171 CP-1 — Stop 复出（推翻 BLOCK-28.8；hook 内接后端级联取消）。
                    BLOCK-178 P0 — Stop 与发送并存：运行中发送钮保持可点，
                    点击按投递模式路由（转向=立即注入下一轮边界；排队=收尾后自动发）。 */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {streaming && (
                    <button
                      type="button"
                      className="sc-send-cta sc-send-cta-stop"
                      onClick={stop}
                      title="停止生成"
                      aria-label="停止生成"
                      data-testid="chat-stop"
                    >
                      <Icon name="square" size={12} />
                    </button>
                  )}
                  <button
                    className="sc-send-cta sc-send-cta-send"
                    onClick={(e) => void submitComposer(input, { reverse: e.altKey })}
                    disabled={!input.trim()}
                    title={streaming
                      ? (deliveryMode === 'steer'
                        ? '发送 · 转向当前任务（Alt+点击 改为排队）'
                        : '发送 · 加入排队（Alt+点击 改为转向）')
                      : '发送消息'}
                    aria-label={streaming ? '发送（按投递模式路由）' : '发送消息'}
                    data-testid="chat-send"
                  >
                    <Icon name="arrow-up" size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* UI-523 — 输入卡片下方运行计量条（本次/会话/上下文三段）。
              slimComposer 悬挂面整条不渲染（UI-448 加映 v3 既有纪律）。 */}
          {!slimComposer && (
            <RunStatsBar
              rounds={runRounds}
              steps={runSteps}
              runUsage={runUsage}
              conversationUsage={conversationUsage}
              contextPct={tokenBudget ? tokenBudget.pct : null}
              contextSlot={<ContextBudgetButton budget={tokenBudget} activeContextWindow={undefined} />}
              narrow={composerNarrow}
              running={Boolean(streaming)}
              conversationId={conversationId}
            />
          )}
        </div>
      </div>
      </div>

      {/* UI-262 — 聊天区左缘用户消息导航条：锚定 sc-outer（会话栏最左边界），
          会话内容卡片（sc-root）固定宽度居中时 rail 仍贴列缘；悬浮预览、点击跳转对应消息。
          UI-448 加映 v5 — 悬挂面（slimComposer）不渲染：300px 面板内刻度条挤占正文宽度 */}
      {!slimComposer && railItems.length > 0 && <MessageRail items={railItems} onJump={handleRailJump} />}

      {/* UI-269 — 右缘自定义滚动条：锚定 sc-outer（会话栏最右边界），与 rail 左右对称；
          隐藏系统原生 thumb，常驻纤细 thumb + 轨道线 */}
      {!composerOnly && <ChatScrollbar containerRef={scrollRef} />}

      {/* Image Preview Modal */}
      {previewImage && (
        <ImagePreviewModal
          attachment={previewImage}
          onClose={closePreview}
        />
      )}
    </div>
  );
}

// ImagePreviewModal (and ImagePreviewModalProps) moved to ./SimpleChat/ImagePreviewModal.tsx (BLOCK-9.2 PHASE 4).
// The canonical component is imported at the top of this file and re-exported from
// the header for any consumer reaching it via the SimpleChat path.

