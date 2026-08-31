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
} from './SimpleChat/types';
import {
  DEFAULT_EXAMPLE_PROMPTS,
  MessageMeta,
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
import { AgentChangesCard } from './AgentChangesCard';
import { MessageRail, type MessageRailItem } from './MessageRail';
import {
  stringifyParamValue,
  shortValue,
  formatHarnessRepair,
  formatHarnessWarning,
  formatHarnessDiagnosticIssue,
} from './SimpleChat/formatHarness';

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
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';
import { __resetFileReferenceCache, extractFileReferenceCandidates } from '@/lib/chat-file-references';

// SYSTEM_OPEN_FILE_EXTENSIONS + shouldOpenWithSystemApp moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

import {
  fetchHarnessToolManifest,
  repairHarnessParams,
  type HarnessNextAction,
  type HarnessRunDiagnostics,
  type HarnessParamRepair,
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
  formatToolSideEffects,
  restoreToolActivities,
  type ToolActivityItem,
} from './toolActivity';
import { resolveToolSummaryPresentation } from './toolSummaryPresentation';
import {
  clearConversationPendingApproval,
  clearConversationRun,
  shouldClearReconciledConversationRun,
  resumeConversationRun,
  useConversationRun,
  resumeOrphanAgentTasks,
  type ConversationPendingApproval,
  type ConversationLoopState,
} from './conversationRunStore';
import { useErrorFormatter } from './useErrorFormatter';
import { deriveLoopDisplay, loopDecisionLabel } from '@/lib/loop-client';
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
import { ContextBudgetButton, type TokenBudget } from './ContextBudgetBar';

// SimpleMessage + restoreSimpleMessage + AgentProgressUpdate + restoreProgressUpdates + MessageMeta moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).


type ApprovalRepairState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; repair: HarnessParamRepair; diagnostics?: HarnessRunDiagnostics | null }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string };

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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<AttachmentFile | null>(null);
  const MAX_SUMMARY_RETRIES = 3;
  const RETRY_BACKOFF_MS = [2000, 4000, 8000];
  const [summaryRetryState, setSummaryRetryState] = useState<Record<string, 'running' | 'done'>>({});
  const [summaryRetryErrors, setSummaryRetryErrors] = useState<Record<string, string>>({});
  const [summaryRetryAttempts, setSummaryRetryAttempts] = useState<Record<string, number>>({});
  const [summaryRetryCooldownUntil, setSummaryRetryCooldownUntil] = useState<Record<string, number>>({});
  const [retryTick, setRetryTick] = useState(0);
  const [loading, setLoading] = useState(false);
  // T83: transient spinner state for the file-reference refresh button.
  const [refreshing, setRefreshing] = useState(false);
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [approvalRepair, setApprovalRepair] = useState<ApprovalRepairState>({ status: 'idle' });
  const autoApproveRef = useRef<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState<'supplier' | 'model' | null>(null);
  const [modelSupplierKey, setModelSupplierKey] = useState<string | null>(null);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<'full' | 'read'>('full');
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
      dispatchBioF3Event(biof3Events.projectOpenArtifact, {
        jobId: resolved.jobId,
        artifactName: resolved.artifactName,
        projectId,
      });
      return;
    }
    dispatchBioF3Event(biof3Events.projectOpenWorkspaceFile, {
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

  // Load messages when conversationId changes
  useEffect(() => {
    setMessages([]);
    if (!conversationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const msgs = await getConversationMessages(conversationId, 200);
      if (cancelled) return;
      const ui: SimpleMessage[] = msgs.map(restoreSimpleMessage);
      setMessages(ui);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // A completed run may have settled while this conversation was hidden or
  // while the whole chat surface was unmounted. Reconcile from SQLite when it
  // becomes visible again; running/error snapshots remain available in the
  // shared store so switching views never loses live state.
  const reconciledRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !activeRun || activeRun.status === 'running' || !activeRun.completedAt) return;
    const reconciliationId = `${conversationId}:${activeRun.completedAt}`;
    if (reconciledRunRef.current === reconciliationId) return;
    let cancelled = false;
    (async () => {
      const persisted = await getConversationMessages(conversationId, 200);
      if (cancelled) return;
      reconciledRunRef.current = reconciliationId;
      setMessages(persisted.map(restoreSimpleMessage));
      // Cancellation is persisted by the backend just like successful
      // completion. Once SQLite has supplied that durable message, discard
      // the local snapshot so progress and tool blocks are not duplicated.
      if (shouldClearReconciledConversationRun(activeRun)) {
        clearConversationRun(conversationId);
      }
      await refreshConversations();
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRun, conversationId, refreshConversations]);

  // T82 — recover an in-progress agent task after a refresh / Electron restart.
  // On conversation mount, if a prior run left a resumable task in localStorage
  // (findResumableAgentTask), reconnect its SSE and rebuild the live snapshot so
  // the user does not stare at a blank "running" state for the whole ~10+ min run.
  // Guarded so it only attempts once per conversationId (also survives StrictMode).
  const resumableCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (resumableCheckedRef.current === conversationId) return;
    resumableCheckedRef.current = conversationId;
    const record = findResumableAgentTask(conversationId, projectId);
    if (record) resumeConversationRun(record, conversationId, projectId);
  }, [conversationId]);

  const displayMessages = (() => {
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
      });
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
  const composerWidth = Math.min(980, Math.max(560, 560 + Math.sqrt(inputLength) * 42));

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
    createConversationForRun,
  });

  // T83: file-reference refresh feedback layer (no core-logic change).
  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    __resetFileReferenceCache();
    setResolveNonce((value) => value + 1);
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 700);
  }, [refreshing]);

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
        dispatchBioF3Event(biof3Events.conversationForked, {
          newConversationId: forked.id,
          projectId: projectId || '',
        });
      }
    } finally {
      setForkingAtIndex(null);
    }
  }, [conversationId, forkingAtIndex, projectId, refreshConversations, onConversationChange]);

  const retrySummary = useCallback(async (toolJobId: string) => {
    const attempts = summaryRetryAttempts[toolJobId] ?? 0;
    if (!conversationId) return;
    if (summaryRetryState[toolJobId] === 'running') return;
    if (attempts >= MAX_SUMMARY_RETRIES) return;
    if (Date.now() < (summaryRetryCooldownUntil[toolJobId] ?? 0)) return;
    setSummaryRetryState((current) => ({ ...current, [toolJobId]: 'running' }));
    setSummaryRetryErrors((current) => {
      const next = { ...current };
      delete next[toolJobId];
      return next;
    });
    try {
      const content = await retryToolSummary({
        toolJobId,
        projectId,
        conversationId,
        modelPresetId: activeModel?.endpointProfileId || activeModelId,
      });
      setMessages((current) => [
        ...current,
        { role: 'assistant', content, ts: new Date().toISOString() },
      ]);
      clearConversationRun(conversationId);
      setSummaryRetryState((current) => ({ ...current, [toolJobId]: 'done' }));
      setSummaryRetryAttempts((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      setSummaryRetryCooldownUntil((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      await refreshConversations();
    } catch (error) {
      const nextAttempts = attempts + 1;
      setSummaryRetryAttempts((current) => ({ ...current, [toolJobId]: nextAttempts }));
      setSummaryRetryState((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      setSummaryRetryErrors((current) => ({
        ...current,
        [toolJobId]: error instanceof Error ? error.message : 'AI 总结仍不可用，请稍后重试',
      }));
      if (nextAttempts < MAX_SUMMARY_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[nextAttempts - 1] ?? 8000;
        setSummaryRetryCooldownUntil((current) => ({ ...current, [toolJobId]: Date.now() + backoff }));
      }
    }
  }, [activeModel, activeModelId, conversationId, projectId, refreshConversations, summaryRetryState, summaryRetryAttempts, summaryRetryCooldownUntil]);

  // UX1H: tick while any summary-retry cooldown is active so the "冷却中 Ns"
  // label and re-enable update without a full external re-render.
  useEffect(() => {
    const now = Date.now();
    const active = Object.values(summaryRetryCooldownUntil).filter((until) => until > now);
    if (active.length === 0) return;
    const minUntil = Math.min(...active);
    const timer = window.setTimeout(() => setRetryTick((t) => t + 1), Math.max(250, minUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [summaryRetryCooldownUntil, retryTick]);

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
    window.addEventListener(biof3Events.tokenBudget, handler);
    return () => window.removeEventListener(biof3Events.tokenBudget, handler);
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
        setQueuedPrompts((current) => [...current, trimmed].slice(-5));
        setInput('');
        historyNavRef.current = INITIAL_NAV_STATE;
        clearConversationDraft(projectId, conversationId);
        if (taRef.current) taRef.current.style.height = 'auto';
      } else {
        void send(trimmed);
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

  const accessModeLabel = accessMode === 'full' ? '完全访问' : '只读模式';
  const modelGroups = modelPresets.reduce<Array<{
    key: string;
    supplier: string;
    defaultModel: string;
    lastSelectedModel: string;
    presets: ChatModelPreset[];
  }>>(
    (groups, preset) => {
      const supplier = preset.label || preset.provider;
      const key = preset.endpointProfileId || preset.provider;
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.presets.push(preset);
      else groups.push({
        key,
        supplier,
        defaultModel: preset.defaultModel || preset.model,
        lastSelectedModel: preset.lastSelectedModel || preset.model,
        presets: [preset],
      });
      return groups;
    },
    []
  );
  const activeSupplierGroup = modelGroups.find((group) =>
    group.presets.some((preset) => preset.id === activeModelId)
  ) || modelGroups[0];
  const selectedSupplierGroup = modelGroups.find((group) => group.key === modelSupplierKey)
    || activeSupplierGroup;
  const preferredPresetForSupplier = useCallback((group: typeof modelGroups[number]) => {
    return preferredModelPreset(
      group.presets,
      group.key === activeSupplierGroup?.key ? activeModelId : undefined,
      group.lastSelectedModel,
      group.defaultModel
    );
  }, [activeModelId, activeSupplierGroup?.key]);
  const selectModel = useCallback(async (preset: ChatModelPreset) => {
    setModelMenuOpen(null);
    setModelSupplierKey(null);
    // Hook persists the new active id + llm_provider via electron
    // bridge (Plan 1.6 §4.5 — replaces the local get-then-save).
    await setActiveModelId(preset.id);
  }, [setActiveModelId]);

  return (
    <div className="sc-root">
      <div className="sc-body" data-rail-body>
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
                {messageActivities.length > 0 && (
                  <ToolActivityList
                    activities={messageActivities}
                    processingDurationMs={m.processingDurationMs}
                  />
                )}
                <div className={`sc-msg sc-msg-${m.role}`}>
                  <div className="sc-msg-avatar">
                    {m.role === 'user' ? (
                      <Icon name="user" size={16} />
                    ) : (
                      <Icon name="cpu" size={16} />
                    )}
                  </div>
                  <div className="sc-msg-body">
                    {m.role === 'assistant' && <MessageMeta modelName={m.modelName} ts={m.ts} />}
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

        {/* BLOCK-28.7 — 工作区改动卡片：每文件 ±统计，点击行跳转审阅；BLOCK-31 P3 传入会话 id 做会话作用域 */}
        <AgentChangesCard conversationId={conversationId} />

        {/* UI-262 — 聊天区左缘用户消息导航条：悬浮预览、点击跳转对应消息 */}
        {railItems.length > 0 && <MessageRail items={railItems} onJump={handleRailJump} />}

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
                <button
                  type="button"
                  className="sc-composer-icon-btn"
                  title="添加内容（即将上线）"
                  aria-label="添加内容"
                  disabled
                >
                  <Icon name="plus" size={20} />
                </button>
                <button
                  type="button"
                  className={`sc-composer-icon-btn${refreshing ? ' is-refreshing' : ''}${hasFileReferences ? '' : ' is-faded'}`}
                  title="重新解析当前会话中的文件链接（清除解析缓存并对所有已落地消息重跑解析器；首次生效需重启 Electron 让 biof3-server 加载最新索引逻辑）"
                  aria-label="刷新文件链接"
                  disabled={refreshing}
                  onClick={() => void handleRefresh()}
                >
                  <Icon name="refresh" size={16} className={refreshing ? 'sc-icon-spin' : undefined} />
                </button>
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
              </div>
              <div className="sc-composer-right">
                <div className="sc-model-picker-pair">
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-model-provider-btn"
                      onClick={() => {
                        setModelSupplierKey(activeSupplierGroup?.key || null);
                        setModelMenuOpen((current) => current === 'supplier' ? null : 'supplier');
                      }}
                      title="选择供应商"
                    >
                      <span>{activeSupplierGroup?.supplier || activeModel?.label || '供应商'}</span>
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
                      title="选择会话模型"
                    >
                      <span>{activeModel?.model || '选择模型'}</span>
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
                  onClick={() => send(input)}
                  disabled={!input.trim() || streaming}
                  title={streaming ? '任务进行中…' : '发送消息'}
                >
                  <Icon name="arrow-up" size={12} />
                </button>
                {/* BLOCK-20: live context-budget ring updated by token_budget SSE event. */}
                <ContextBudgetButton budget={tokenBudget} activeContextWindow={undefined} />
              </div>
            </div>
          </div>
        </div>
      </div>

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

function LoopStatusPanel({
  loop,
  pending,
}: {
  loop: ConversationLoopState;
  pending: boolean;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const display = deriveLoopDisplay(loop, pending);
  const iterations = loop.iterations || [];
  // Only surface public conclusions — never hidden reasoning. The backend
  // already redacts these; blocked/failed turns must read as "not complete".
  const conclusions = iterations.filter(
    (it) => it.publicConclusion && it.publicConclusion.trim()
  );

  return (
    <div className={`sc-loop-panel sc-loop-tone-${display.tone}`} aria-label="任务循环状态">
      <button
        type="button"
        className="sc-loop-summary"
        aria-expanded={expanded}
        aria-controls="sc-loop-iterations"
        aria-label={expanded ? '收起循环详情' : '展开循环详情'}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="sc-loop-status-dot" aria-hidden="true" />
        <span className="sc-loop-status-label">{display.label}</span>
        {display.attempts > 0 && (
          <span className="sc-loop-attempts">· {display.attempts} 轮</span>
        )}
        {loop.latestConclusion && (
          <span className="sc-loop-latest">
            · {compactStageConclusion(loop.latestConclusion, 80)}
          </span>
        )}
        {conclusions.length > 0 && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />}
      </button>
      {expanded && conclusions.length > 0 && (
        <div className="sc-loop-iterations">
          {conclusions.map((it) => (
            <div
              key={it.iterationId}
              className={`sc-loop-iteration sc-loop-iteration-${it.status}`}
            >
              <span className="sc-loop-iteration-seq" aria-hidden="true">#{it.sequence}</span>
              <span className="sc-loop-iteration-decision">{loopDecisionLabel(it.decision)}</span>
              <span className="sc-loop-iteration-conclusion">
                {compactStageConclusion(it.publicConclusion, 200)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentProgressList({
  updates,
  pending,
  onFileReferenceClick,
}: {
  updates: AgentProgressUpdate[];
  pending: boolean;
  onFileReferenceClick: (detail: FileReferenceClickDetail) => void;
}): React.ReactElement {
  // Every progress update after the first starts with the previous stage's
  // public conclusion (enforced by the agent prompt). The first update is only
  // an intention, so it is deliberately omitted from the conclusion trail.
  const conclusions = updates.slice(1).map((progress) => ({
    key: `${progress.iteration}:${progress.content}`,
    content: compactStageConclusion(progress.content),
  })).filter((item) => item.content);

  return (
    <div className="sc-agent-progress" aria-label="阶段结论">
      {conclusions.map((conclusion) => (
        <div key={conclusion.key} className="sc-agent-progress-item">
          <span className="sc-agent-progress-dot" aria-hidden="true" />
          <CopilotMarkdown
            text={conclusion.content}
            onFileReferenceClick={onFileReferenceClick}
            resolveContext={null}
          />
        </div>
      ))}
      {pending && (
        <div className="sc-agent-progress-item sc-agent-progress-current">
          <span className="sc-agent-progress-dot" aria-hidden="true" />
          <span>当前阶段执行中</span>
        </div>
      )}
    </div>
  );
}

export function ResultEditProgressList({
  events,
}: {
  events: ResultEditProgressEvent[];
}): React.ReactElement {
  const phases = new Map<string, { label: string; status: string }>();
  for (const event of events) {
    if (!event.publicPhase || !event.publicPhaseLabel) continue;
    phases.set(event.publicPhase, { label: event.publicPhaseLabel, status: event.status });
  }
  const terminal = [...events].reverse().find((event) => event.status === 'terminal');
  return (
    <div className="sc-result-edit-progress" aria-label="结果修改五阶段进度">
      {[...phases.entries()].map(([phase, item]) => (
        <span key={phase} data-status={item.status}>
          {item.label}
        </span>
      ))}
      {terminal && (
        <strong>{terminal.stage === 'cancelled' ? '修改已停止' : '修改未完成'}</strong>
      )}
    </div>
  );
}

// compactStageConclusion + ErrorBannerProps moved to ./SimpleChat/{helpers,types}.ts (BLOCK-9.2 PHASE 4).

function ErrorBanner({ message, severity, showDetails, technicalDetails }: ErrorBannerProps): React.ReactElement {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const severityClass = `sc-error-${severity}`;
  const iconName: IconName = severity === 'error' ? 'alert-circle' : severity === 'warning' ? 'alert-triangle' : 'help-circle';

  return (
    <div className={`sc-error-banner ${severityClass}`} role="alert">
      <div className="sc-error-header">
        <Icon name={iconName} size={16} />
        <span className="sc-error-message">{message}</span>
      </div>
      {showDetails && technicalDetails && (
        <button
          type="button"
          className="sc-error-toggle"
          onClick={() => setDetailsExpanded((prev) => !prev)}
          aria-expanded={detailsExpanded}
        >
          {detailsExpanded ? '收起详情' : '查看详情'}
          <Icon name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
      )}
      {showDetails && detailsExpanded && technicalDetails && (
        <details className="sc-error-details" open>
          <pre className="sc-error-details-content">{technicalDetails}</pre>
        </details>
      )}
    </div>
  );
}

function ToolActivityList({
  activities,
  processingDurationMs,
}: {
  activities: ToolActivityItem[];
  processingDurationMs?: number;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const statusLabels: Record<ToolActivityItem['status'], string> = {
    running: '运行中',
    awaiting_confirmation: '等待确认',
    success: '已完成',
    error: '失败',
    denied: '已拒绝',
  };

  useEffect(() => {
    if (activities.length === 0) setExpanded(false);
  }, [activities.length]);

  const running = activities.filter((activity) => activity.status === 'running').length;
  const awaiting = activities.filter((activity) => activity.status === 'awaiting_confirmation').length;
  const attention = activities.filter(
    (activity) => activity.status === 'error' || activity.status === 'denied'
  ).length;
  const totalDurationMs = activities.reduce(
    (total, activity) => total + (typeof activity.durationMs === 'number' ? activity.durationMs : 0),
    0
  );
  const totalDuration = formatToolDuration(processingDurationMs ?? totalDurationMs);
  const actionCounts = activities.reduce<Record<string, number>>((counts, activity) => {
    const action = activity.actionLabel.replace(/^已/, '') || '处理';
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
  const actionSummary = Object.entries(actionCounts)
    .slice(0, 3)
    .map(([action, count]) => `${action} ${count} 次`)
    .join(' · ');
  const summary = running > 0
    ? `正在处理 ${running}/${activities.length} 项${actionSummary ? ` · ${actionSummary}` : ''}`
    : awaiting > 0
      ? `等待确认 ${awaiting} 项`
      : `已完成 ${activities.length} 项${attention ? ` · ${attention} 项需注意` : ''}${actionSummary ? ` · ${actionSummary}` : ''}${totalDuration ? ` · ${totalDuration}` : ''}`;

  return (
    <div className="sc-tool-activity-list" aria-label="工具活动">
      <button
        type="button"
        className="sc-tool-activity-summary"
        aria-expanded={expanded}
        aria-label={expanded ? '收起处理详情' : '展开处理详情'}
        title={expanded ? '收起处理详情' : '展开处理详情'}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="sc-tool-activity-summary-label">{summary}</span>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {expanded && activities.map((activity) => {
        const duration = formatToolDuration(activity.durationMs);
        const sideEffects = formatToolSideEffects(activity.sideEffects);
        const showReason = activity.status === 'error' || activity.status === 'denied';
        return (
          <div
            key={activity.key}
            className={`sc-tool-activity sc-tool-activity-${activity.status}`}
          >
            <span className="sc-tool-activity-icon" aria-hidden="true">
              <Icon name={activity.status === 'success' ? 'check' : 'wrench'} size={14} />
            </span>
            <div className="sc-tool-activity-body sc-tool-activity-detail">
              <span className="sc-tool-activity-action">{activity.actionLabel}</span>
              {activity.actionDetail && (
                <code className="sc-tool-activity-command">{activity.actionDetail}</code>
              )}
              <span className="sc-tool-activity-status">{statusLabels[activity.status]}</span>
              {duration && <span>{duration}</span>}
              <span className="sc-tool-activity-tool">{activity.name}</span>
              {activity.truncated && activity.status === 'success' && <span>仅显示摘要</span>}
              {sideEffects && <span>影响：{sideEffects}</span>}
              {showReason && activity.terminationReason && (
                <span className="sc-tool-activity-reason">原因：{activity.terminationReason}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalCard({
  approval,
  repairState,
  onApprove,
  onReject,
  busy,
}: {
  approval: PendingApproval;
  repairState: ApprovalRepairState;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}): React.ReactElement {
  const repairItems = repairState.status === 'ready' ? repairState.repair.repairs || [] : [];
  const warningItems = repairState.status === 'ready' ? repairState.repair.warnings || [] : [];
  const diagnostics = repairState.status === 'ready' ? repairState.diagnostics : null;
  const nextActions = diagnostics?.nextActions || [];
  return (
    <div className="sc-approval-card">
      <div className="sc-approval-header">
        <div className="sc-approval-icon">
          <Icon name="shield" size={16} />
        </div>
        <div className="sc-approval-title-wrap">
          <div className="sc-approval-title">Harness 自动校正</div>
          <div className="sc-approval-sub">
            {approval.toolId || 'analysis'}{approval.toolJobId ? ` · ${approval.toolJobId}` : ''}
          </div>
        </div>
      </div>
      <div className="sc-approval-message">
        {approval.message && !/确认参数|请确认|confirm/i.test(approval.message)
          ? approval.message
          : 'Harness 已接管参数校正，系统将自动启动该分析。'}
      </div>
      <ApprovalRepairHint
        state={repairState}
        repairItems={repairItems}
        warningItems={warningItems}
        nextActions={nextActions}
      />
      <div className="sc-approval-risk">
        正式分析会写入项目任务记录，并生成可复现的参数、输入和结果产物。
      </div>
      <div className="sc-approval-actions">
        <button
          type="button"
          className="biof3-btn sc-approval-btn sc-approval-approve"
          onClick={onApprove}
          disabled={busy}
        >
          <Icon name="check" size={13} />
          开始
        </button>
        <button
          type="button"
          className="biof3-btn sc-approval-btn sc-approval-cancel"
          onClick={onReject}
          disabled={busy}
        >
          <Icon name="x" size={13} />
          取消
        </button>
      </div>
    </div>
  );
}

function ApprovalRepairHint({
  state,
  repairItems,
  warningItems,
  nextActions,
}: {
  state: ApprovalRepairState;
  repairItems: Array<Record<string, unknown>>;
  warningItems: Array<Record<string, unknown>>;
  nextActions: HarnessNextAction[];
}): React.ReactElement | null {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <div className="sc-approval-harness">Harness 正在根据项目文件探测并校正参数…</div>;
  }
  if (state.status === 'skipped') {
    return <div className="sc-approval-harness sc-approval-harness-muted">{state.message}</div>;
  }
  if (state.status === 'error') {
    return <div className="sc-approval-harness sc-approval-harness-warning">Harness 建议暂不可用：{state.message}</div>;
  }
  const diagnostics = state.diagnostics || null;
  const diagnosticIssues = diagnostics?.issues || [];
  if (!repairItems.length && !warningItems.length && !diagnosticIssues.length) {
    return <div className="sc-approval-harness">Harness 已检查项目文件，当前参数无需自动修正。</div>;
  }
  const blocked = diagnostics?.status === 'blocked';
  const needsReview = diagnostics?.status === 'needs_review';
  return (
    <div className={`sc-approval-harness ${blocked ? 'sc-approval-harness-blocked' : ''}`}>
      <div className="sc-approval-harness-title">
        {blocked ? 'Harness 阻塞项' : needsReview ? 'Harness 需确认项' : 'Harness 参数建议'}
      </div>
      {repairItems.length > 0 && (
        <ul className="sc-approval-harness-list">
          {repairItems.slice(0, 4).map((item, index) => (
            <li key={`${String(item.code || 'repair')}-${index}`}>{formatHarnessRepair(item)}</li>
          ))}
        </ul>
      )}
      {diagnosticIssues.length > 0 && (
        <ul className="sc-approval-harness-list">
          {diagnosticIssues.slice(0, 3).map((item, index) => (
            <li key={`${String(item.code || 'issue')}-${index}`}>{formatHarnessDiagnosticIssue(item)}</li>
          ))}
        </ul>
      )}
      {warningItems.length > 0 && (
        <div className="sc-approval-harness-warning">
          {warningItems.slice(0, 2).map((item) => formatHarnessWarning(item)).join('；')}
        </div>
      )}
      {nextActions.length > 0 && (
        <div className="sc-approval-harness-next">
          {nextActions.slice(0, 4).map((action) => action.label).join(' · ')}
        </div>
      )}
      {blocked && (
        <div className="sc-approval-harness-warning">
          当前参数暂不可执行，请先补齐文件、修正格式或配置运行时。
        </div>
      )}
    </div>
  );
}
