// ============================================================
// SimpleChat — lightweight conversation-only chat component
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ackRunTool,
  restoreResultEditProgressEvents,
  type ChatMessage,
  type ResultEditProgressEvent,
} from './copilotClient';
import {
  getConversationMessages,
} from './copilotConversationsClient';
import { useCopilotContext } from '@/lib/copilotContextProvider';
import { useConversations } from '@/hooks/useConversations';
import { biof3Events, subscribeBioF3Event, dispatchBioF3Event } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';
import { __resetFileReferenceCache } from '@/lib/chat-file-references';

/**
 * Files that cannot be inlined in the right Files panel trigger the system
 * opener alongside the in-app preview. Office/iWork files that we now parse
 * (docx/xlsx/pptx/odt/ods/odp) and simple text/code files are intentionally
 * excluded so the user only sees one window per click. R / scanpy data
 * formats (rds, RData, h5ad, h5, hdf5, loom, mtx) are excluded because no
 * default macOS app can open them — auto-opening would just pop the
 * "Choose Application" dialog, which is more disruptive than helpful. Users
 * who actually want to open them in RStudio / scanpy can still use the
 * "Open with system app" button in the preview card.
 */
const SYSTEM_OPEN_FILE_EXTENSIONS = new Set([
  'doc', 'dot', 'xls', 'xlt', 'ppt', 'pps', 'pot',
  'pages', 'numbers', 'keynote',
  'rtf', 'epub', 'tif', 'tiff', 'heic', 'heif',
]);

export function shouldOpenWithSystemApp(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return SYSTEM_OPEN_FILE_EXTENSIONS.has(extension);
}
import {
  fetchHarnessToolManifest,
  repairHarnessParams,
  type HarnessDiagnosticIssue,
  type HarnessNextAction,
  type HarnessRunDiagnostics,
  type HarnessParamRepair,
  type HarnessToolManifest,
} from '@/lib/harness-client';
import {
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import type { CopilotContext } from '@/lib/copilotContext';
import { copilotContextOverrideForAsk } from '@/lib/result-edit-agent-bridge';
import { CopilotMarkdown } from './copilotMarkdown';
import {
  formatToolDuration,
  formatToolSideEffects,
  restoreToolActivities,
  type ToolActivityItem,
} from './toolActivity';
import {
  clearConversationPendingApproval,
  clearConversationRun,
  stopConversationRun,
  isConversationRunning,
  shouldClearReconciledConversationRun,
  startConversationRun,
  useConversationRun,
  type ConversationPendingApproval,
  type ConversationLoopState,
} from './conversationRunStore';
import { deriveLoopDisplay, loopDecisionLabel } from '@/lib/loop-client';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';
import { HighlightedCode } from '@/components/ui/CodeHighlight';
import { tools as staticTools } from '@/pages/_data';

const conversationDrafts = new Map<string, string>();

function conversationDraftKey(projectId: string, conversationId: string | null): string {
  return `${projectId}:${conversationId || 'new'}`;
}

interface SimpleMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
  ts?: string;
  toolActivities?: ToolActivityItem[];
  processingDurationMs?: number;
  statusMessage?: string;
  progressUpdates?: Array<{ iteration: number; content: string }>;
  resultEditProgress?: ResultEditProgressEvent[];
  /** HLE-C4R: live durable-loop projection for the running assistant turn. */
  loop?: ConversationLoopState | null;
}

interface AgentProgressUpdate {
  iteration: number;
  content: string;
}

function restoreProgressUpdates(value: unknown): Array<{ iteration: number; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, 4000) : '';
    if (!content) return [];
    return [{
      iteration: typeof raw.iteration === 'number' ? raw.iteration : index + 1,
      content,
    }];
  });
}

type PendingApproval = ConversationPendingApproval;

type ApprovalRepairState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; repair: HarnessParamRepair; diagnostics?: HarnessRunDiagnostics | null }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string };

// ChatModelPreset type + DEFAULT_CHAT_MODEL_PRESETS live in
// `@/hooks/useAiSettings` — Plan 1.6 §4.5 [HIGH] type dedup.

export interface SimpleChatHandle {
  newConversation: () => void;
}

interface SimpleChatProps {
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  inputHeight?: number;
  /**
   * Whether this instance handles the copilotAsk event. Exactly one mounted
   * instance may, so it defaults to false and the owner opts in explicitly.
   */
  ownsCopilotAsk?: boolean;
}

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
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [approvalRepair, setApprovalRepair] = useState<ApprovalRepairState>({ status: 'idle' });
  const autoApproveRef = useRef<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState<'supplier' | 'model' | null>(null);
  const [modelSupplierKey, setModelSupplierKey] = useState<string | null>(null);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<'full' | 'read'>('full');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRun = useConversationRun(conversationId);
  const durableLoop = useDurableConversationLoop(projectId, conversationId, activeRun?.loop);
  const streaming = starting || activeRun?.status === 'running';
  const pendingApproval = activeRun?.pendingApproval || null;

  // Plan 1.6 §4.2 — read Copilot context from React Context, not the
  // module-scope singleton. Captured into a ref so the latest value is
  // always reachable from the (stable) send callback without re-binding.
  const copilotCtx = useCopilotContext();
  const copilotCtxRef = useRef<CopilotContext>(copilotCtx);
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
      const ui: SimpleMessage[] = msgs.map((m) => ({
        role: m.role === 'system' ? 'assistant' : (m.role as 'user' | 'assistant'),
        content: m.content,
        ts: m.ts,
        toolActivities: restoreToolActivities(m.meta?.toolActivities),
        progressUpdates: restoreProgressUpdates(m.meta?.progressUpdates),
        resultEditProgress: restoreResultEditProgressEvents(m.meta?.resultEditProgress),
        processingDurationMs: typeof m.meta?.processingDurationMs === 'number'
          ? m.meta.processingDurationMs
          : undefined,
      }));
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
      setMessages(persisted.map((m) => ({
        role: m.role === 'system' ? 'assistant' : (m.role as 'user' | 'assistant'),
        content: m.content,
        ts: m.ts,
        toolActivities: restoreToolActivities(m.meta?.toolActivities),
        progressUpdates: restoreProgressUpdates(m.meta?.progressUpdates),
        resultEditProgress: restoreResultEditProgressEvents(m.meta?.resultEditProgress),
        processingDurationMs: typeof m.meta?.processingDurationMs === 'number'
          ? m.meta.processingDurationMs
          : undefined,
      })));
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
      next.push({
        role: 'assistant',
        content: activeRun.assistantContent,
        pending: activeRun.assistantPending,
        error: activeRun.assistantError,
        ts: activeRun.assistantTs,
        toolActivities: activeRun.toolActivities,
        processingDurationMs: activeRun.processingDurationMs,
        statusMessage: activeRun.statusMessage,
        progressUpdates: activeRun.progressUpdates,
        resultEditProgress: activeRun.resultEditProgress,
        loop: durableLoop.loop || activeRun.loop,
      });
    }
    return next;
  })();
  const standaloneDurableLoop = durableLoop.loop && !displayMessages.some((message) => message.loop)
    ? durableLoop.loop
    : null;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRun, durableLoop.loop, messages]);

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
    setInput(conversationDrafts.get(conversationDraftKey(projectId, conversationId)) || '');
  }, [conversationId, projectId]);

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    conversationDrafts.set(conversationDraftKey(projectId, conversationId), e.target.value);
    resizeTextarea(e.target);
  };

  const send = useCallback(async (text: string, contextOverride?: Partial<CopilotContext>) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setStarting(true);

    try {
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        const created = await createConversationForRun('新对话');
        if (!created) return;
        targetConversationId = created.id;
        onConversationChange(created.id);
      }
      if (isConversationRunning(targetConversationId)) return;

      // Build upstream messages from current history
      const tagged: ChatMessage[] = messages
        .filter((m) => !m.error && !m.pending)
        .map((m) => ({ role: m.role, content: m.content }));
      tagged.push({ role: 'user', content: trimmed });

      const started = startConversationRun({
        conversationId: targetConversationId,
        projectId,
        userContent: trimmed,
        historyLastUserTs: [...messages].reverse().find((message) => message.role === 'user')?.ts,
        messages: tagged,
        modelPresetId: activeModel?.endpointProfileId || activeModelId,
        modelName: activeModel?.model,
        context: {
          ...copilotCtxRef.current,
          ...(contextOverride || {}),
          page: 'desktop-project',
          projectId,
          accessMode,
        },
      });
      if (!started) return;
      conversationDrafts.delete(conversationDraftKey(projectId, conversationId));
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } finally {
      setStarting(false);
    }
  }, [
    accessMode,
    activeModel,
    activeModelId,
    conversationId,
    createConversationForRun,
    messages,
    onConversationChange,
    projectId,
    streaming,
  ]);

  // Keep a ref to the latest send so the global event listener (mounted once) always
  // invokes the current closure without re-binding on every message change.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // The embedded SimpleChat owns the agent now (global floating CopilotChat removed).
  // Toolbox clicks / "explain current result" / chain recommendations dispatch this
  // event with a ready-to-send prompt; we pick it up here and send it.
  useEffect(() => {
    // Exactly one instance may own this event. Two can be mounted at once — the
    // center conversation and a right-panel chat tab, which RightPanel keeps
    // alive via openRightTabs.map — and both subscribing would send the prompt
    // twice. When no conversation exists yet, createConversationForRun is
    // awaited before the running check, so each would also create its own.
    if (!ownsCopilotAsk) return undefined;
    const unsub = subscribeBioF3Event(biof3Events.copilotAsk, (detail) => {
      const { prompt } = detail;
      const p = typeof prompt === 'string' ? prompt.trim() : '';
      // Snapshot override was created at click time. Pass it into send before
      // send can await conversation creation, otherwise the result/token may
      // drift to whichever Artifact happens to be open afterwards.
      if (p) void sendRef.current(p, copilotContextOverrideForAsk(detail));
    });
    return unsub;
  }, [ownsCopilotAsk]);

  const stop = useCallback(() => {
    if (conversationId) stopConversationRun(conversationId);
  }, [conversationId]);

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
    if (!pendingApproval || streaming || accessMode !== 'full') return;
    if (approvalRepair.status === 'loading') return;
    if (autoApproveRef.current === pendingApproval.ackToken) return;
    autoApproveRef.current = pendingApproval.ackToken;
    const timer = window.setTimeout(() => {
      void approvePending();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [accessMode, approvalRepair.status, approvePending, pendingApproval, streaming]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  // Create new conversation
  const newConversation = useCallback(async () => {
    onConversationChange(null);
    setMessages([]);
  }, [onConversationChange]);

  // Expose via ref-like pattern through props is not needed here;
  // parent controls conversationId directly.

  const accessModeLabel = accessMode === 'full' ? '完全访问' : '只读模式';
  const modelGroups = modelPresets.reduce<Array<{ key: string; supplier: string; defaultModel: string; presets: ChatModelPreset[] }>>(
    (groups, preset) => {
      const supplier = preset.label || preset.provider;
      const key = preset.endpointProfileId || preset.provider;
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.presets.push(preset);
      else groups.push({ key, supplier, defaultModel: preset.defaultModel || preset.model, presets: [preset] });
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
    if (group.key === activeSupplierGroup?.key) {
      return group.presets.find((preset) => preset.id === activeModelId)
        || group.presets.find((preset) => preset.model === group.defaultModel)
        || group.presets[0];
    }
    return group.presets.find((preset) => preset.model === group.defaultModel)
      || group.presets[0];
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
                    <CopilotMarkdown
                      text={m.content || m.statusMessage || (m.pending ? '…' : '')}
                      onFileReferenceClick={handleFileReferenceClick}
                      resolveContext={m.pending || (m.role === 'assistant' && streaming) ? null : settledContext}
                      resolveNonce={resolveNonce}
                      highlightCode={m.role === 'assistant' ? ((code, language) => (
                        <HighlightedCode code={code} language={language} />
                      )) : undefined}
                    />
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

        <div
          className="sc-input-area"
          style={{ ['--sc-composer-width' as string]: `${composerWidth}px` }}
        >
          <div className="sc-composer">
            <div className="sc-composer-body">
              <textarea
                ref={taRef}
                className="sc-input"
                rows={1}
                value={input}
                placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
                onChange={onInputChange}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="sc-composer-bar">
              <div className="sc-composer-left">
                <button type="button" className="sc-composer-icon-btn" title="添加内容">
                  <Icon name="plus" size={20} />
                </button>
                <button
                  type="button"
                  className="sc-composer-icon-btn"
                  title="重新解析当前会话中的文件链接（清除解析缓存并对所有已落地消息重跑解析器；首次生效需重启 Electron 让 r-server 加载最新索引逻辑）"
                  aria-label="刷新文件链接"
                  onClick={() => {
                    __resetFileReferenceCache();
                    setResolveNonce((value) => value + 1);
                  }}
                >
                  <Icon name="refresh" size={16} />
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
                {streaming ? (
                  <button className="sc-send-cta sc-send-cta-stop" onClick={stop} title="停止生成">
                    <Icon name="square" size={14} />
                  </button>
                ) : (
                  <button
                    className="sc-send-cta sc-send-cta-send"
                    onClick={() => send(input)}
                    disabled={!input.trim()}
                    title="发送消息"
                  >
                    <Icon name="arrow-up" size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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

export function compactStageConclusion(content: string, maxLength = 240): string {
  const normalized = String(content || '')
    .trim()
    .replace(/^(?:好的?|可以)[，,：:]\s*/u, '')
    .replace(/\s+/gu, ' ');
  if (!normalized) return '';

  const sentenceEnd = normalized.search(/[。！？]/u);
  const firstSentence = sentenceEnd >= 0
    ? normalized.slice(0, sentenceEnd + 1)
    : normalized;
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
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
    .map(([action, count]) => `${action} ${count}`)
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

function stringifyParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shortValue(value: unknown): string {
  const text = stringifyParamValue(value);
  return text.length > 64 ? `${text.slice(0, 61)}…` : text;
}

function formatHarnessRepair(item: Record<string, unknown>): string {
  const code = String(item.code || '');
  const inputId = String(item.inputId || '参数');
  if (code === 'file_input_prefilled') {
    return `已为 ${inputId} 选择候选文件：${shortValue(item.value)}`;
  }
  if (code === 'column_alias_mapped') {
    return `已识别 ${inputId} 的关键列别名：${shortValue(item.mappings)}`;
  }
  if (code === 'number_param_clamped') {
    return item.confirmationRequired
      ? `建议将 ${inputId} 从 ${shortValue(item.from)} 调整为 ${shortValue(item.to)}（需确认）`
      : `已将 ${inputId} 从 ${shortValue(item.from)} 调整为 ${shortValue(item.to)}`;
  }
  if (code === 'number_default_filled') {
    return `已补齐 ${inputId} 默认值：${shortValue(item.to)}`;
  }
  return `${inputId}: ${shortValue(item)}`;
}

function formatHarnessWarning(item: Record<string, unknown>): string {
  const code = String(item.code || '');
  const inputId = String(item.inputId || '参数');
  if (code === 'missing_required_columns') {
    return `${inputId} 可能缺少必要列：${shortValue(item.missing)}`;
  }
  return `${inputId}: ${shortValue(item)}`;
}

function formatHarnessDiagnosticIssue(issue: HarnessDiagnosticIssue): string {
  const inputId = issue.inputId ? `${String(issue.inputId)}：` : '';
  const message = String(issue.message || issue.code || '诊断问题');
  const detail = issue.detail ? `（${String(issue.detail)}）` : '';
  return `${inputId}${message}${detail}`;
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
          className="sc-approval-btn sc-approval-approve"
          onClick={onApprove}
          disabled={busy}
        >
          <Icon name="check" size={13} />
          开始
        </button>
        <button
          type="button"
          className="sc-approval-btn sc-approval-cancel"
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
