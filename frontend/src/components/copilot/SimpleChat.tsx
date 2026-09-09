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
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

// ── BLOCK-9.2 PHASE 4: types + helpers + attachments re-exports for backward compat ──
import {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  restoreProgressUpdates,
  type SlashCommand,
  type SimpleMessage,
  type AgentProgressUpdate,
  type ExamplePrompt,
  type ExamplePromptsProps,
  type SimpleChatHandle,
  type SimpleChatProps,
  type ErrorBannerProps,
  type PendingApproval,
  type ApprovalRepairState,
} from './SimpleChat/types';
import {
  DEFAULT_EXAMPLE_PROMPTS,
  MessageMeta,
  MessageTime,
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
import { ImagePreviewModal } from './SimpleChat/ImagePreviewModal';
// UI-268: 「后台进程」浮窗（持久输出独立小窗口）；工具活动记录改为内联手风琴
import { ToolActivityDock } from './ToolActivityDock';
import { MessageRail, type MessageRailItem } from './MessageRail';
import { ChatScrollbar } from './ChatScrollbar';
import {
  stringifyParamValue,
  shortValue,
} from './SimpleChat/formatHarness';
// UI-305 P0.1 — 尾部内联渲染组件外迁（LoopStatusPanel / AgentProgressList /
// ResultEditProgressList / ErrorBanner / ApprovalCard+ApprovalRepairHint），
// 零行为变化；ResultEditProgressList 按惯例在此再导出保持导入路径兼容。
import { LoopStatusPanel } from './SimpleChat/LoopStatusPanel';
import { AgentProgressList } from './SimpleChat/AgentProgressList';
import { ErrorBanner } from './SimpleChat/ErrorBanner';
import { ApprovalCard } from './SimpleChat/ApprovalCard';
import { ResultEditProgressList } from './SimpleChat/ResultEditProgressList';
import { useSummaryRetry } from './SimpleChat/hooks/useSummaryRetry';
import { useModelAccessMenus } from './SimpleChat/hooks/useModelAccessMenus';
import { useConversationResume } from './SimpleChat/hooks/useConversationResume';
import { useAutoFileReferenceRefresh } from './SimpleChat/hooks/useAutoFileReferenceRefresh';
export { ResultEditProgressList };

// Re-export helpers (so `import { restoreSimpleMessage } from './SimpleChat'` keeps working)
export {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  compactStageConclusion,
  DEFAULT_EXAMPLE_PROMPTS,
  MessageMeta,
  ExamplePrompts,
  ImagePreviewModal,
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

import {
  ackRunTool,
  retryToolSummary,
  restoreResultEditProgressEvents,
  findResumableAgentTask,
  type ResultEditProgressEvent,
} from './copilotClient';
import {
  getConversationMessages,
  forkConversation,
  type ConversationMessage,
} from './copilotConversationsClient';
import { useCopilotContext } from '@/lib/copilotContextProvider';
import { formatRelativeTime } from '@/lib/format';
import { useConversations } from '@/hooks/useConversations';
import { gewuEvents, dispatchGewuEvent, subscribeGewuEvent } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';
import { extractFileReferenceCandidates } from '@/lib/chat-file-references';

// SYSTEM_OPEN_FILE_EXTENSIONS + shouldOpenWithSystemApp moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

import {
  fetchHarnessToolManifest,
  repairHarnessParams,
  type HarnessToolManifest,
} from '@/lib/harness-client';
import {
  preferredModelPreset,
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import { CopilotMarkdown } from './copilotMarkdown';
import {
  formatToolDuration,
  type ToolActivityItem,
} from './toolActivity';
import { ToolActivityList } from './ToolActivityList';
import { SubAgentsBar } from './SubAgentsBar';
import { resolveToolSummaryPresentation } from './toolSummaryPresentation';
import {
  clearConversationPendingApproval,
  clearConversationRun,
  getConversationFallbackNotice,
  getChildFinishedNotices,
  shouldClearReconciledConversationRun,
  resumeConversationRun,
  resumeInterruptedConversation,
  useConversationRun,
  resumeOrphanAgentTasks,
  type ConversationPendingApproval,
  type ConversationLoopState,
} from './conversationRunStore';
import { ResumePrompt } from './SimpleChat/ResumePrompt';
import { useErrorFormatter } from './useErrorFormatter';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import {
  AssistantResultNodes,
  parseAssistantResultNodes,
  useExtraRenderersFlag,
} from './extraRenderers';
import type { ResultNode } from './types';
import './simple-chat.css';
import { Icon, type IconName } from '@/components/icons/Icon';
import { HighlightedCode } from '@/components/ui/CodeHighlight';
import { tools as staticTools } from '@/pages/_data';
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
import { useChatStream } from './SimpleChat/hooks/useChatStream';
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
import { isToolCallAllowed } from './accessModeValidator';
// BLOCK-55 P1/P2/P3 — Spec 门：计划模式开关 + 批准三选一 + 修订批准
import {
  PlanApprovalCard,
  type PlanApprovalAction,
  type PlanApprovalCardPlan,
} from './SimpleChat/PlanApprovalCard';
import {
  approvePlan,
  approvePlanRevision,
  buildFreshPlanTurn,
  fetchDraftPlansForConversation,
  fetchPlansWithPendingRevision,
} from './planApprovals';
import { ContextBudgetButton, type TokenBudget } from './ContextBudgetBar';

// SimpleMessage + restoreSimpleMessage + AgentProgressUpdate + restoreProgressUpdates + MessageMeta moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).



// ExamplePrompt interface + DEFAULT_EXAMPLE_PROMPTS + ExamplePromptsProps + ExamplePrompts moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).
// SimpleChatHandle + SimpleChatProps moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

// AttachmentFile type moved to ./SimpleChat/attachments.ts (BLOCK-9.2 PHASE 4).
// The type is imported at the top of the file alongside the handler helpers
// and re-exported from this file's header for any consumer that previously
// reached for AttachmentFile via the SimpleChat path.

export function SimpleChat({
  projectId,
  conversationId,
  onConversationChange,
  inputHeight: _inputHeight = 120,
  ownsCopilotAsk = false,
}: SimpleChatProps): React.ReactElement {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
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
    return subscribeGewuEvent(gewuEvents.selectionQuote, (detail) => {
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
    return subscribeGewuEvent(gewuEvents.imageQuote, (detail) => {
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
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [approvalRepair, setApprovalRepair] = useState<ApprovalRepairState>({ status: 'idle' });
  // BLOCK-57：远程执行目标——确认卡选择器数据（仅当存在已注册目标时渲染，本机永远是默认）
  // BLOCK-60 — composer 工具栏容器查询窄态（ResizeObserver 只读宽度，不影响弹性宽度逻辑）
  const composerBarRef = useRef<HTMLDivElement | null>(null);
  const [composerNarrow, setComposerNarrow] = useState(false);
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

  const autoApproveRef = useRef<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanApprovalCardPlan | null>(null);
  const [pendingRevision, setPendingRevision] = useState<{ planId: string; title: string; revNo: number } | null>(null);
  const [planCardBusy, setPlanCardBusy] = useState(false);
  const [forking, setForking] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<TokenBudget | null>(null);
  // Per-message index for "fork at this message" action
  const [forkingAtIndex, setForkingAtIndex] = useState<number | null>(null);
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
  const [slashFocusedIndex, setSlashFocusedIndex] = useState(0);
  const slashPanelRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  // Filtered commands based on query
  const filteredCommands = useMemo(() => {
    if (!slashQuery) return SLASH_COMMANDS;
    const q = slashQuery.toLowerCase();
    return SLASH_COMMANDS.filter(
      (cmd) => cmd.id.includes(q) || cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    );
  }, [slashQuery]);
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
  const durableLoop = useDurableConversationLoop(projectId, conversationId, activeRun?.loop);
  const pendingApproval = activeRun?.pendingApproval || null;

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
    setActive: setActiveModelId,
  } = useAiSettings();

  // UI-305 P0.3 — 模型菜单 + 访问档位菜单状态簇（原 322-330 useState/派生 +
  // 1322-1371 分组与 selectModel）整簇抽入 useModelAccessMenus，簇内 hook 相对
  // 顺序保持原样、零行为变化；调用点在 useAiSettings 解构之后。
  const {
    modelMenuOpen,
    setModelMenuOpen,
    modelSupplierKey,
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
    preferredPresetForSupplier,
    selectModel,
  } = useModelAccessMenus({ modelPresets, activeModelId, setActiveModelId });

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
  } = useSummaryRetry({
    conversationId,
    projectId,
    activeModel,
    activeModelId,
    refreshConversations,
    appendAssistantMessage: (message) => setMessages((current) => [...current, message]),
  });

  // Error formatter hook for user-friendly error display
  const { formatError, getTechnicalDetails } = useErrorFormatter();

  // UI-AGENTWB-004 A4 bridge: opt-in switch for routing
  // assistant messages that carry `meta.resultNodes` through the
  // ResultCard pipeline. Defaults to false so existing users see
  // no change; flip via `localStorage.biof3.simplechat.extraRenderers='true'`.
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
    // explicit biof3 artifact URIs still carry and verify their own job ID.
    setSettledContext({ projectId });
  }, [loading, projectId]);

  // BLOCK-22 P4.5: line/column forwarding note.
  // FileReferenceClickDetail currently carries no line/column — we default to 1.
  // Future enhancement: extract from the raw URI if it contains a line anchor (e.g. /path#L10).
  const handleFileReferenceClick = useCallback((detail: FileReferenceClickDetail) => {
    const resolved = detail.resolved;
    if (!resolved || resolved.projectId !== projectId) return;
    if (resolved.kind === 'artifact') {
      dispatchGewuEvent(gewuEvents.projectOpenArtifact, {
        jobId: resolved.jobId,
        artifactName: resolved.artifactName,
        projectId,
      });
      return;
    }
    dispatchGewuEvent(gewuEvents.projectOpenWorkspaceFile, {
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

  useEffect(() => {
    if (!pendingApproval?.params) {
      setParamDraft({});
      return;
    }
    const draft: Record<string, string> = {};
    Object.entries(pendingApproval.params).forEach(([key, value]) => {
      draft[key] = stringifyParamValue(value);
    });
    setParamDraft(draft);
  }, [pendingApproval]);

  useEffect(() => {
    if (!pendingApproval) {
      setApprovalRepair({ status: 'idle' });
      autoApproveRef.current = null;
      return;
    }
    if (!pendingApproval.toolId) {
      setApprovalRepair({ status: 'skipped', message: '缺少 toolId，暂时保留 agent 给出的原始参数。' });
      return;
    }

    let cancelled = false;
    const originalParams = pendingApproval.params || {};
    setApprovalRepair({ status: 'loading' });

    (async () => {
      try {
        const remoteManifest = await fetchHarnessToolManifest(pendingApproval.toolId || '');
        const fallbackManifest = staticTools.find((tool) => tool.id === pendingApproval.toolId) as
          | HarnessToolManifest
          | undefined;
        const manifest = remoteManifest || fallbackManifest || null;
        if (!manifest) {
          if (!cancelled) {
            setApprovalRepair({ status: 'skipped', message: '没有找到该工具的 manifest，参数将按原样确认。' });
          }
          return;
        }
        const activeArtifact = copilotCtxRef.current.activeArtifact;
        let response = null;
        if (activeArtifact) {
          try {
            response = await repairHarnessParams({
              scope: 'artifact',
              jobId: activeArtifact.jobId,
              activeArtifactName: activeArtifact.name,
              manifest,
              params: originalParams,
              maxFiles: 500,
            });
          } catch {
            // A stale result directory must not block project-level recovery.
            response = null;
          }
        }
        if (!response || response.diagnostics?.status === 'blocked') {
          response = await repairHarnessParams({
            scope: 'project',
            projectId,
            manifest,
            params: originalParams,
            maxFiles: 500,
          });
        }
        const repair = response.repair;
        if (!repair) {
          if (!cancelled) {
            setApprovalRepair({ status: 'skipped', message: 'Harness 未返回可用修复建议，参数将按原样确认。' });
          }
          return;
        }
        if (cancelled) return;
        setApprovalRepair({ status: 'ready', repair, diagnostics: response.diagnostics || null });
        setParamDraft((current) => {
          const next = { ...current };
          Object.entries(repair.repairedParams || {}).forEach(([key, value]) => {
            const originalValue = stringifyParamValue(originalParams[key]);
            if (next[key] == null || next[key] === originalValue) {
              next[key] = stringifyParamValue(value);
            }
          });
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          setApprovalRepair({
            status: 'error',
            message: error instanceof Error ? error.message : 'Harness 参数修复失败',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingApproval, projectId]);

  // UI-305 P0.4 — 会话恢复/对账簇（原 609-668 三个 effect：消息重载、
  // 隐藏期完结对账、T82 resumable 重连）整簇抽入 useConversationResume，
  // 零行为变化。
  const { reconciledRunRef } = useConversationResume({
    conversationId,
    projectId,
    activeRun,
    refreshConversations,
    setMessages,
    setLoading,
  });

  const baseDisplayMessages = (() => {
    if (!activeRun || activeRun.conversationId !== conversationId) {
      if (!durableLoop.loop) return messages;
      let lastAssistantIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'assistant') {
          lastAssistantIndex = index;
          break;
        }
      }
      if (lastAssistantIndex < 0) return messages;
      const next = messages.slice();
      next[lastAssistantIndex] = { ...next[lastAssistantIndex], loop: durableLoop.loop };
      return next;
    }
    const next = messages.slice();
    const lastUser = [...next].reverse().find((message) => message.role === 'user');
    const runUserPersisted =
      lastUser?.content === activeRun.userContent &&
      lastUser.ts !== activeRun.historyLastUserTs;
    if (activeRun.userContent && !runUserPersisted) {
      next.push({
        role: 'user',
        content: activeRun.userContent,
        ts: activeRun.userTs,
      });
    }
    const lastAssistant = next[next.length - 1];
    const assistantAlreadyPersisted =
      lastAssistant?.role === 'assistant' &&
      Boolean(activeRun.assistantContent) &&
      lastAssistant.content === activeRun.assistantContent &&
      Boolean(lastAssistant.ts && Date.parse(lastAssistant.ts) >= activeRun.startedAt);
    if (!assistantAlreadyPersisted) {
      const summaryPresentation = resolveToolSummaryPresentation({
        assistantContent: activeRun.assistantContent,
        assistantError: activeRun.assistantError,
        statusMessage: activeRun.statusMessage,
        toolActivities: activeRun.toolActivities,
      });

      next.push({
        role: 'assistant',
        content: summaryPresentation.content,
        pending: activeRun.assistantPending,
        error: summaryPresentation.error,
        ts: activeRun.assistantTs,
        toolActivities: activeRun.toolActivities,
        reasoningByIteration: activeRun.reasoningByIteration,
        processingDurationMs: activeRun.processingDurationMs,
        statusMessage: summaryPresentation.statusMessage,
        summaryUnavailable: summaryPresentation.summaryUnavailable,
        retryToolJobId: summaryPresentation.retryToolJobId,
        progressUpdates: activeRun.progressUpdates,
        resultEditProgress: activeRun.resultEditProgress,
        loop: durableLoop.loop || activeRun.loop,
        // UI-AGENTWB-### / chat-error-rendering: forward the raw stack
        // + error code stored by conversationRunStore.finish so the
        // ErrorBanner "查看详情" disclosure becomes reachable. Without
        // these the user only ever sees the humanised "发生未知错误".
        technicalDetails: activeRun.technicalDetails,
        errorCode: activeRun.errorCode,
        // BLOCK-38 P2 / UI-275 — 服务中断可续跑：转发标记 + taskId 供「继续执行」入口
        resumable: activeRun.resumable,
        interruptedAt: activeRun.interruptedAt,
        taskId: activeRun.taskId,
        // BLOCK-56 P1 — 模型降级提示（任务条持久显示「已降级到 X 模型」）
        modelFallbackNotice: activeRun.modelFallbackNotice,
      });
    }
    return next;
  })();
  // BLOCK-56 P1 / UI-287 — 降级提示附着到最后一条助手消息（覆盖全部构建路径）。
  // 请求级降级常与任务终态同批到达：run 终态对账（clearConversationRun）会清掉
  // run 快照且持久化消息不携带该字段，因此除 activeRun 外还兜底读会话级 notice
  // （store 模块级保留，下一次 run 开始才清除），否则提示存活 <300ms 用户不可见。
  const displayMessages = (() => {
    const fallbackNotice = activeRun?.modelFallbackNotice
      || (conversationId ? getConversationFallbackNotice(conversationId) : null);
    const childNotices = conversationId ? getChildFinishedNotices(conversationId) : [];
    if (!fallbackNotice && childNotices.length === 0) return baseDisplayMessages;
    const next = baseDisplayMessages.slice();
    const lastMsg = next[next.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      if (fallbackNotice && !lastMsg.modelFallbackNotice) {
        next[next.length - 1] = { ...lastMsg, modelFallbackNotice: fallbackNotice };
      }
      if (childNotices.length > 0 && !lastMsg.childFinishedNotices) {
        next[next.length - 1] = {
          ...next[next.length - 1],
          childFinishedNotices: childNotices.map((n) => ({
            childTaskId: n.childTaskId,
            status: n.status,
            summaryHead: n.summaryHead,
          })),
        };
      }
    }
    return next;
  })();
  const standaloneDurableLoop = durableLoop.loop && !displayMessages.some((message) => message.loop)
    ? durableLoop.loop
    : null;

  // T83: does the latest AI reply contain any file references? Drives the
  // fade of the file-reference refresh button when there's nothing to refresh.
  const lastAssistantContent = useMemo(() => {
    const m = [...displayMessages].reverse().find((msg) => msg.role === 'assistant');
    return m?.content || '';
  }, [displayMessages]);
  const hasFileReferences = useMemo(
    () => extractFileReferenceCandidates(lastAssistantContent).length > 0,
    [lastAssistantContent]
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRun, durableLoop.loop, messages]);

  // UI-262 — 左缘用户消息导航条：当前会话每条用户消息一个刻度，
  // 附紧随其后的 AI 回复摘要供悬浮预览。
  const railItems = useMemo<MessageRailItem[]>(() => {
    const items: MessageRailItem[] = [];
    displayMessages.forEach((m, i) => {
      if (m.role !== 'user' || !m.content) return;
      let reply: string | undefined;
      for (let j = i + 1; j < displayMessages.length; j++) {
        if (displayMessages[j].role === 'assistant') {
          reply = displayMessages[j].content;
          break;
        }
      }
      items.push({ key: m.ts ? `${m.ts}-${i}` : `idx-${i}`, content: m.content, reply });
    });
    return items;
  }, [displayMessages]);

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
    onDrop(e, setAttachments, setIsDraggingOver);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    onPaste(e, setAttachments);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    removeAttachmentById(id, setAttachments);
  }, []);

  const openPreview = useCallback((attachment: AttachmentFile) => {
    openImagePreview(attachment, setPreviewImage);
  }, []);

  const closePreview = useCallback(() => {
    closeImagePreview(setPreviewImage);
  }, []);

  // 自动聚焦输入框：新加载/刷新后无需先点一下才能打字。macOS 上窗口被程序化
  // 激活后 webview 常拿不到键盘焦点，挂载时主动聚焦一次即可立即可输入。
  // 仅 copilotAsk 的拥有者（中央会话）执行：两个实例可能同时挂载（中央会话 +
  // 右侧面板 chat tab），都自动聚焦会互相抢焦点。
  useEffect(() => {
    if (!ownsCopilotAsk) return;
    taRef.current?.focus();
  }, [ownsCopilotAsk]);

  // 键盘焦点兜底：窗口重新获焦、或用户开始打字时，若焦点并不在任何可输入控件/按钮
  // 上（例如停留在标题栏窗口控件这类非输入元素），把焦点交还输入框，避免击键被吞。
  // 菜单打开时跳过，避免抢走菜单焦点。同样只由 copilotAsk 拥有者执行。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    const focusInputIfIdle = () => {
      if (accessMenuOpen || modelMenuOpen) return;
      const ta = taRef.current;
      if (!ta || document.activeElement === ta) return;
      // 自身被隐藏（display:none，如切到非会话模式）时不抢焦点。
      if (ta.offsetParent === null) return;
      const ae = document.activeElement as HTMLElement | null;
      // 焦点已在真正的输入控件里（别处的输入框/可编辑区）就不要抢。
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      ta.focus();
    };
    const onWinFocus = () => focusInputIfIdle();
    const onDocKeyDown = (e: KeyboardEvent) => {
      // 仅在"可打印字符"击键且焦点无处安放时接管，不干扰快捷键与 Tab 导航。
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      focusInputIfIdle();
    };
    window.addEventListener('focus', onWinFocus);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      window.removeEventListener('focus', onWinFocus);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [accessMenuOpen, modelMenuOpen, ownsCopilotAsk]);

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
    runInBackground,
    streaming,
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
    displayMessages,
    activeRun,
    activeModel,
    activeModelId,
    accessMode,
    planMode,
    createConversationForRun,
  });

  // BLOCK-52 P1（选中即引用）：带引用块的发送包装——发送前把引用块渲染进
  // 消息正文，接受成功后清空引用块；被守卫拦截（空文本 / 运行中）时保留待重试。
  // BLOCK-52 P2：图片引用卡同管道——artifact 元数据合成进正文，成功后一并清空。
  const sendWithRefs = useCallback(async (text: string): Promise<boolean> => {
    const composed = composeMessageWithImageReferences(
      composeMessageWithSelectionReferences(text, selectionRefsRef.current),
      imageRefsRef.current,
    );
    const ok = await send(composed);
    if (ok) {
      setSelectionRefs([]);
      setImageRefs([]);
    }
    return ok;
  }, [send]);

  // BLOCK-55 P1/P3 — run 结束 / 会话切换后拉取待批准 draft 计划与待批准修订案。
  // 拉取失败静默降级（批准卡缺席不影响普通对话）。
  useEffect(() => {
    if (!conversationId || streaming) return;
    let cancelled = false;
    (async () => {
      try {
        const drafts = await fetchDraftPlansForConversation(conversationId);
        if (!cancelled) setPendingPlan(drafts[0] ? { ...drafts[0] } : null);
      } catch {
        if (!cancelled) setPendingPlan(null);
      }
      try {
        const revPlans = await fetchPlansWithPendingRevision(conversationId);
        if (!cancelled) {
          const first = revPlans[0];
          setPendingRevision(
            first && typeof first.pending_revision_no === 'number'
              ? { planId: first.id, title: first.title, revNo: first.pending_revision_no }
              : null
          );
        }
      } catch {
        if (!cancelled) setPendingRevision(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, streaming]);

  // BLOCK-55 P1 — 批准三选一：批准执行 / 批准并清上下文执行 / 继续讨论
  const handlePlanApprove = useCallback(async (action: PlanApprovalAction) => {
    if (!pendingPlan || planCardBusy) return;
    setPlanCardBusy(true);
    try {
      await approvePlan(pendingPlan.id, action);
      const plan = pendingPlan;
      setPendingPlan(null);
      if (action === 'keep-planning') return;
      // UI-303 — 批准执行即退出计划档：恢复进入计划模式前的档位（缺省完全访问）
      setAccessMode(prePlanAccessModeRef.current ?? 'full');
      prePlanAccessModeRef.current = null;
      if (action === 'execute') {
        await send(
          `计划「${plan.title}」已批准（planId: ${plan.id}），请从第一个 pending 步骤开始执行，每完成一步用 plan(op="update_step") 写回状态。`,
          { approvedPlanId: plan.id }
        );
      } else {
        await send(
          buildFreshPlanTurn(plan),
          { approvedPlanId: plan.id, approvedPlanFresh: true },
          { freshTurn: true }
        );
      }
    } catch {
      // 批准失败：保留批准卡供用户重试
    } finally {
      setPlanCardBusy(false);
    }
  }, [pendingPlan, planCardBusy, send]);

  // BLOCK-55 P3 — 修订案批准：替换步骤表后通知继续
  const handleRevisionApprove = useCallback(async () => {
    if (!pendingRevision || planCardBusy) return;
    setPlanCardBusy(true);
    try {
      await approvePlanRevision(pendingRevision.planId, pendingRevision.revNo);
      const rev = pendingRevision;
      setPendingRevision(null);
      await send(
        `计划「${rev.title}」修订案 #${rev.revNo} 已批准，请按修订后的步骤表继续执行。`,
        { approvedPlanId: rev.planId }
      );
    } catch {
      // 失败保留修订条
    } finally {
      setPlanCardBusy(false);
    }
  }, [pendingRevision, planCardBusy, send]);

  // BLOCK-68 / UI-317 —— 「刷新文件链接」入口删除后改自动化（hook 外迁可单测）：
  // 订阅 agent 写档/数据导入信号，debounce 后清解析缓存并 bump resolveNonce。
  useAutoFileReferenceRefresh(() => setResolveNonce((value) => value + 1));

  // Fork: create a new conversation with all messages copied from the current one.
  const handleFork = useCallback(async () => {
    if (!conversationId || forking) return;
    setForking(true);
    try {
      const forked = await forkConversation(conversationId);
      if (forked) {
        await refreshConversations();
        onConversationChange(forked.id);
      }
    } finally {
      setForking(false);
    }
  }, [conversationId, forking, refreshConversations, onConversationChange]);

  // Fork at a specific message index — creates a branch that includes all messages up to and including that index.
  const handleForkAt = useCallback(async (messageIndex: number) => {
    if (!conversationId || forkingAtIndex !== null) return;
    setForkingAtIndex(messageIndex);
    try {
      const forked = await forkConversation(conversationId, undefined, messageIndex);
      if (forked) {
        await refreshConversations();
        onConversationChange(forked.id);
        // Broadcast so LeftPanel (via project-workspace) refreshes the conversation list
        dispatchGewuEvent(gewuEvents.conversationForked, {
          newConversationId: forked.id,
          projectId: projectId || '',
        });
      }
    } finally {
      setForkingAtIndex(null);
    }
  }, [conversationId, forkingAtIndex, projectId, refreshConversations, onConversationChange]);



  const approvePending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    const mergedParams: Record<string, unknown> = { ...(pendingApproval.params || {}) };
    Object.entries(paramDraft).forEach(([key, value]) => {
      try {
        mergedParams[key] = JSON.parse(value);
      } catch {
        mergedParams[key] = value;
      }
    });
    const { ackToken, toolId } = pendingApproval;
    const acknowledged = await ackRunTool(ackToken, true, {
      projectId: projectId || null,
      conversationId: conversationId || null,
    });
    if (!acknowledged) return;
    if (conversationId) clearConversationPendingApproval(conversationId);
    send(
      `用户已确认开始（ackToken=${ackToken}）。请重调 run_tool(op=run, toolId="${toolId ?? ''}", params=${JSON.stringify(mergedParams)}, ackToken="${ackToken}") 续跑该重操作。`
    );
  }, [conversationId, paramDraft, pendingApproval, projectId, send, streaming]);

  const rejectPending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    const acknowledged = await ackRunTool(pendingApproval.ackToken, false, {
      projectId: projectId || null,
      conversationId: conversationId || null,
    });
    if (!acknowledged) return;
    if (conversationId) clearConversationPendingApproval(conversationId);
    send('用户取消了该重操作，不要重试。请简短说明已取消，并给出如需继续时应调整哪些参数。');
  }, [conversationId, pendingApproval, projectId, send, streaming]);

  useEffect(() => {
    // BLOCK-20 wire-up: also gate auto-approve through the frontend
    // accessModeValidator so the import is on the consumption path.
    // The boolean result is identical to `accessMode !== 'full'` for
    // the canonical full/read states; calling the validator keeps the
    // contract documented in one place and gives us a single grep
    // target for "where does read-only mode gate UI actions".
    if (
      !pendingApproval
      || streaming
      || !isToolCallAllowed('run_tool', { ...copilotCtxRef.current, accessMode })
    ) return;
    if (approvalRepair.status === 'loading') return;
    if (autoApproveRef.current === pendingApproval.ackToken) return;
    autoApproveRef.current = pendingApproval.ackToken;
    const timer = window.setTimeout(() => {
      void approvePending();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [accessMode, approvalRepair.status, approvePending, pendingApproval, streaming]);

  // BLOCK-20: token budget event listener — updates ContextBudgetButton state
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ contextWindow: number; messagesTokensUsed: number; systemPromptTokens: number; messagesTokens: number; pct: number; trimmed: boolean }>).detail;
      setTokenBudget({
        contextWindow: detail.contextWindow,
        messagesTokensUsed: detail.messagesTokensUsed,
        messagesKept: 0,
        messagesDropped: 0,
        pct: detail.pct,
        trimmed: detail.trimmed,
      });
    };
    window.addEventListener(gewuEvents.tokenBudget, handler);
    return () => window.removeEventListener(gewuEvents.tokenBudget, handler);
  }, []);

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
      const history = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content ?? '')
        .filter((c) => c.trim() !== '')
        .reverse();
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
      if (streaming) {
        // BLOCK-52 P1：排队消息同样携带当前引用块，入列后清空。
        const queuedWithRefs = composeMessageWithSelectionReferences(trimmed, selectionRefsRef.current);
        setQueuedPrompts((current) => [...current, queuedWithRefs].slice(-5));
        setInput('');
        historyNavRef.current = INITIAL_NAV_STATE;
        clearConversationDraft(projectId, conversationId);
        if (taRef.current) taRef.current.style.height = 'auto';
        setSelectionRefs([]);
      } else {
        void sendWithRefs(trimmed);
      }
    }
  };

  // BLOCK-28.8 — 移除排队/停止生成按钮（用户裁决）：
  // 流式期间仅保留禁用态发送按钮；stop/queue 能力保留在 useChatStream 内，
  // 需要时可经事件或快捷键恢复。

  // Create new conversation
  const newConversation = useCallback(async () => {
    onConversationChange(null);
    setMessages([]);
    setQueuedPrompts([]);
  }, [onConversationChange]);

  // Slash command handler
  const executeSlashCommand = useCallback((commandId: string) => {
    switch (commandId) {
      case 'new':
        void newConversation();
        break;
      case 'clear':
        setMessages([]);
        clearConversationDraft(projectId, conversationId);
        break;
      case 'model':
        setModelMenuOpen((current) => current ? null : 'model');
        break;
      case 'export': {
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
      case 'help':
        setSlashQuery('');
        break;
    }
    // Close panel and clear input
    setSlashOpen(false);
    setSlashQuery('');
    setInput('');
    historyNavRef.current = INITIAL_NAV_STATE;
    clearConversationDraft(projectId, conversationId);
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [newConversation, projectId, conversationId, displayMessages]);

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

  // Determine which example prompts to show (context-aware)
  const examplePrompts = useMemo(() => {
    // For now, return default prompts; can be extended for context awareness
    return DEFAULT_EXAMPLE_PROMPTS;
  }, []);

  const examplePromptsToShow = displayMessages.length === 0 ? examplePrompts : [];


  return (
    <div className="sc-outer" data-rail-body>
      <div className="sc-root">
        <div className="sc-body">
          <div className="sc-messages" ref={scrollRef}>
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
          {displayMessages.map((m, i) => {
            const key = m.ts ? `${m.role}-${m.ts}-${i}` : `${m.role}-${i}`;
            const messageActivities = m.toolActivities || [];
            return (
              <React.Fragment key={key}>
                <div className={`sc-msg sc-msg-${m.role}`}>
                  <div className="sc-msg-avatar">
                    {m.role === 'user' ? (
                      <Icon name="user" size={16} />
                    ) : (
                      <Icon name="cpu" size={16} />
                    )}
                  </div>
                  <div className="sc-msg-body">
                    {/* UI-271 增补：摘要条移入 agent 消息体（图标之下），明确归属本次回复 */}
                    {messageActivities.length > 0 && (
                      <ToolActivityList
                        activities={messageActivities}
                        processingDurationMs={m.processingDurationMs}
                        reasoningByIteration={m.reasoningByIteration}
                      />
                    )}
                    {m.role === 'assistant' && <MessageMeta modelName={m.modelName} />}
                    {m.role === 'assistant' && m.loop && m.loop.loopRunId && (
                      <LoopStatusPanel loop={m.loop} pending={Boolean(m.pending)} />
                    )}
                    {m.progressUpdates && m.progressUpdates.length > 0 && (
                      <AgentProgressList
                        updates={m.progressUpdates}
                        pending={Boolean(m.pending)}
                        onFileReferenceClick={handleFileReferenceClick}
                      />
                    )}
                    {m.resultEditProgress && m.resultEditProgress.length > 0 && (
                      <ResultEditProgressList events={m.resultEditProgress} />
                    )}
                    {extraRenderersFlag && m.resultNodes && m.resultNodes.length > 0 && (
                      <AssistantResultNodes nodes={m.resultNodes} />
                    )}
                    {m.role === 'assistant' && m.modelFallbackNotice && (
                      <div className="sc-msg-fallback-notice" role="status">
                        <Icon name="info" size={14} />
                        {m.modelFallbackNotice}
                      </div>
                    )}
                    {m.role === 'assistant' && m.childFinishedNotices && m.childFinishedNotices.length > 0 && (
                      <div className="sc-msg-child-finished" role="status">
                        {m.childFinishedNotices.map((n) => (
                          <span key={n.childTaskId} className="sc-msg-child-finished-item">
                            <Icon name={n.status === 'completed' ? 'check' : n.status === 'failed' ? 'alert-circle' : 'x'} size={12} />
                            {`子 agent ${n.status === 'completed' ? '已完成' : n.status === 'failed' ? '失败' : '已取消'}：${n.summaryHead.slice(0, 60)}`}
                          </span>
                        ))}
                      </div>
                    )}
                    <CopilotMarkdown
                      text={m.content || m.statusMessage || (m.pending ? '…' : '')}
                      onFileReferenceClick={handleFileReferenceClick}
                      resolveContext={m.pending || (m.role === 'assistant' && streaming) ? null : settledContext}
                      resolveNonce={resolveNonce}
                      highlightCode={m.role === 'assistant' ? ((code, language) => (
                        <HighlightedCode code={code} language={language} />
                      )) : undefined}
                    />
                    {m.error && m.role === 'assistant' && (() => {
                      // UI-AGENTWB-### / chat-error-rendering: prefer the
                      // raw stack captured by conversationRunStore.finish;
                      // fall back to m.content (legacy: Error instance
                      // passed through). formatError still classifies for
                      // userMessage + severity.
                      const formatted = formatError(m.content);
                      const techDetails = m.technicalDetails || getTechnicalDetails(m.content);
                      return (
                        <ErrorBanner
                          message={formatted.userMessage}
                          severity={formatted.severity}
                          showDetails={formatted.showDetails}
                          technicalDetails={techDetails}
                        />
                      );
                    })()}
                    {/* BLOCK-38 P2 / UI-275 — 仅服务中断任务显示「继续执行」（非中断失败诚实走 retry 链路） */}
                    {conversationId && m.role === 'assistant' && m.error && m.resumable && m.taskId && (() => {
                      const resumeTaskId = m.taskId;
                      const activeConversationId = conversationId;
                      return (
                        <ResumePrompt
                          taskId={resumeTaskId}
                          onConfirm={async () => {
                            await resumeInterruptedConversation(activeConversationId, projectId);
                          }}
                        />
                      );
                    })()}
                    {m.role === 'assistant' && m.summaryUnavailable && m.retryToolJobId && summaryRetryState[m.retryToolJobId] !== 'done' && (() => {
                      const tj = m.retryToolJobId!;
                      const attempts = summaryRetryAttempts[tj] ?? 0;
                      const cooling = Date.now() < (summaryRetryCooldownUntil[tj] ?? 0);
                      const exhausted = attempts >= MAX_SUMMARY_RETRIES;
                      const running = summaryRetryState[tj] === 'running';
                      if (exhausted) {
                        return (
                          <div className="sc-msg-actions sc-msg-actions-summary">
                            <span className="sc-msg-action-error">已达重试上限，请稍后再试</span>
                          </div>
                        );
                      }
                      const remaining = cooling ? Math.max(0, Math.ceil((summaryRetryCooldownUntil[tj]! - Date.now()) / 1000)) : 0;
                      return (
                        <div className="sc-msg-actions sc-msg-actions-summary">
                          <button
                            type="button"
                            className="sc-msg-action"
                            onClick={() => void retrySummary(tj)}
                            disabled={running || cooling}
                            title="仅重新生成 AI 总结，不会再次运行分析工具"
                          >
                            <Icon name="refresh" size={14} />
                            {running
                              ? '正在重试总结'
                              : cooling
                                ? `冷却中 ${remaining}s`
                                : `重试 AI 总结（剩 ${MAX_SUMMARY_RETRIES - attempts} 次）`}
                          </button>
                          {summaryRetryErrors[tj] && (
                            <span className="sc-msg-action-error">{summaryRetryErrors[tj]}</span>
                          )}
                        </div>
                      );
                    })()}
                    {m.role === 'assistant' && m.content && !m.pending && (
                      <div className="sc-msg-actions">
                        <button
                          type="button"
                          className="sc-msg-action"
                          onClick={() => void copyMessage(key, m.content)}
                          title="复制回复"
                          aria-label="复制回复"
                        >
                          <Icon name={copiedMessageKey === key ? 'check' : 'copy'} size={14} />
                          {copiedMessageKey === key ? '已复制' : '复制'}
                        </button>
                        <span className="sc-msg-action-divider" aria-hidden="true" />
                        <button
                          type="button"
                          className="sc-msg-action"
                          onClick={() => void regenerate()}
                          disabled={streaming}
                          title="用当前模型重新生成这条回复"
                          aria-label="重新生成回复"
                        >
                          <Icon name="repeat" size={14} />
                          重新生成
                        </button>
                        <span className="sc-msg-action-divider" aria-hidden="true" />
                        <button
                          type="button"
                          className="sc-msg-action"
                          onClick={() => void handleForkAt(i)}
                          disabled={forkingAtIndex !== null}
                          title={`以此消息为终点创建分支（新分支将包含从开始到这条回复的所有消息）`}
                          aria-label="创建分支"
                        >
                          <Icon name="git-branch" size={14} />
                          {forkingAtIndex === i ? '创建中…' : '创建分支'}
                        </button>
                        {/* UI-271 增补：回复时间移至操作行「创建分支」右侧 */}
                        <span className="sc-msg-action-divider" aria-hidden="true" />
                        <MessageTime ts={m.ts} />
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
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
            onDismiss={() => setPendingPlan(null)}
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

        {/* BLOCK-49 加映二 — 子 agent 活动条（模型派生 + 用户后台双源）；
            BLOCK-65 修正：传 projectId 供俯瞰面板按项目隔离 */}
        <SubAgentsBar conversationId={conversationId} projectId={projectId} />
        <div
          className="sc-input-area"
          style={{ ['--sc-composer-width' as string]: `${composerWidth}px` }}
        >
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
                      key={cmd.id}
                      type="button"
                      className={`sc-slash-item ${index === slashFocusedIndex ? 'sc-slash-item-focused' : ''}`}
                      onClick={() => executeSlashCommand(cmd.id)}
                      onMouseEnter={() => setSlashFocusedIndex(index)}
                    >
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
            className={`sc-composer${isDraggingOver ? ' sc-composer-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
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
                    <span className="sc-attachment-name" title={att.name}>
                      {att.name}
                    </span>
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
                placeholder="输入消息… (Enter 发送, Shift+Enter 换行, ↑/↓ 回溯历史)"
                onChange={onInputChange}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="sc-composer-bar">
              <div className="sc-composer-left">
                {/* BLOCK-60：死控件 + 已移除；刷新/I-O 收进 ⋯ 溢出菜单 */}
                <div className="sc-access-picker">
                  <button
                    type="button"
                    className="sc-access-btn"
                    onClick={() => setAccessMenuOpen((value) => !value)}
                    title="选择访问模式"
                  >
                    <Icon name="shield" size={14} />
                    <span>{accessModeLabel}</span>
                    <Icon name="chevron-down" size={12} />
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
              </div>
              <div className="sc-composer-right">
                {/* BLOCK-68 / UI-317 —— ⋯ 工具菜单整体移除：刷新文件链接改自动化
                    （订阅 projectWorkspaceChanged），模型 I/O 迁右栏 tab；不预留空壳 */}
                {/* BLOCK-20: live context-budget ring — UI-301 加映：移到供应商左侧 */}
                <ContextBudgetButton budget={tokenBudget} activeContextWindow={undefined} />
                <div className="sc-model-picker-pair">
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-model-provider-btn"
                      onClick={() => {
                        setModelSupplierKey(activeSupplierGroup?.key || null);
                        setModelMenuOpen((current) => current === 'supplier' ? null : 'supplier');
                      }}
                      title={activeSupplierGroup?.supplier || activeModel?.label || '选择供应商'}
                    >
                      {composerNarrow
                        ? <Icon name="cpu" size={14} />
                        : <span>{activeSupplierGroup?.supplier || activeModel?.label || '供应商'}</span>}
                      <Icon name="chevron-down" size={12} />
                    </button>
                  </div>
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-model-name-btn"
                      onClick={() => {
                        setModelSupplierKey(selectedSupplierGroup?.key || null);
                        setModelMenuOpen((current) => current === 'model' ? null : 'model');
                      }}
                      title={activeModel?.model || '选择会话模型'}
                    >
                      {composerNarrow
                        ? <Icon name="zap" size={14} />
                        : <span>{activeModel?.model || '选择模型'}</span>}
                      <Icon name="chevron-down" size={12} />
                    </button>
                  </div>
                  {modelMenuOpen && (
                    <>
                      <div className="sc-model-overlay" onClick={() => setModelMenuOpen(null)} />
                      <div className="sc-model-menu">
                        {modelMenuOpen === 'supplier' ? modelGroups.map((group) => (
                          <button
                            type="button"
                            key={group.key}
                            className={`sc-model-option ${group.key === selectedSupplierGroup?.key ? 'sc-model-option-active' : ''}`}
                            onClick={() => {
                              setModelSupplierKey(group.key);
                              const preferred = preferredPresetForSupplier(group);
                              if (preferred) void selectModel(preferred);
                            }}
                          >
                            <span className="sc-model-option-title">{group.supplier}</span>
                            <span className="sc-model-option-meta">{group.presets.length} 个模型</span>
                          </button>
                        )) : selectedSupplierGroup?.presets.map((preset) => (
                          <button
                            type="button"
                            key={preset.id}
                            className={`sc-model-option ${preset.id === activeModelId ? 'sc-model-option-active' : ''}`}
                            onClick={() => selectModel(preset)}
                          >
                            <span className="sc-model-option-title">{preset.model}</span>
                            <span className="sc-model-option-meta">
                              {preset.id === activeModelId ? '当前使用' : '点击切换'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="sc-send-cta sc-send-cta-send"
                  onClick={() => void sendWithRefs(input)}
                  disabled={!input.trim() || streaming}
                  title={streaming ? '任务进行中…' : '发送消息'}
                >
                  <Icon name="arrow-up" size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* UI-262 — 聊天区左缘用户消息导航条：锚定 sc-outer（会话栏最左边界），
          会话内容卡片（sc-root）固定宽度居中时 rail 仍贴列缘；悬浮预览、点击跳转对应消息 */}
      {railItems.length > 0 && <MessageRail items={railItems} onJump={handleRailJump} />}

      {/* UI-269 — 右缘自定义滚动条：锚定 sc-outer（会话栏最右边界），与 rail 左右对称；
          隐藏系统原生 thumb，常驻纤细 thumb + 轨道线 */}
      <ChatScrollbar containerRef={scrollRef} />

      {/* UI-268: 「后台进程」浮窗（持久输出独立小窗口） */}
      <ToolActivityDock conversationId={conversationId} projectId={projectId} />

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
