// ============================================================
// SimpleChat — lightweight conversation-only chat component
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ackRunTool,
  type ChatMessage,
} from './copilotClient';
import {
  getConversationMessages,
} from './copilotConversationsClient';
import { useCopilotContext } from '@/lib/copilotContextProvider';
import { useConversations } from '@/hooks/useConversations';
import { biof3Events, subscribeBioF3Event, dispatchBioF3Event } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';
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
  detachConversationRun,
  isConversationRunning,
  startConversationRun,
  useConversationRun,
  type ConversationPendingApproval,
} from './conversationRunStore';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';
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
}

export function SimpleChat({
  projectId,
  conversationId,
  onConversationChange,
  inputHeight: _inputHeight = 120,
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
    setSettledContext({
      projectId: copilotCtx.projectId,
      activeJobId: copilotCtx.activeJobId || copilotCtx.activeArtifact?.jobId || null,
      activeArtifactName: copilotCtx.activeArtifact?.name,
    });
  }, [copilotCtx, loading]);

  const handleFileReferenceClick = useCallback((detail: FileReferenceClickDetail) => {
    const resolved = detail.resolved;
    if (resolved?.kind === 'artifact') {
      dispatchBioF3Event(biof3Events.projectOpenArtifact, {
        jobId: resolved.jobId,
        artifactName: resolved.artifactName,
        projectId: resolved.projectId ?? projectId,
      });
      return;
    }
    if (resolved?.kind === 'workspace') {
      dispatchBioF3Event(biof3Events.projectOpenWorkspaceFile, {
        projectId: resolved.projectId,
        relativePath: resolved.relativePath,
        name: resolved.name,
      });
    }
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
        let response = activeArtifact
          ? await repairHarnessParams({
              scope: 'artifact',
              jobId: activeArtifact.jobId,
              activeArtifactName: activeArtifact.name,
              manifest,
              params: originalParams,
              maxFiles: 500,
            })
          : null;
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
        processingDurationMs: typeof m.meta?.processingDurationMs === 'number'
          ? m.meta.processingDurationMs
          : undefined,
      })));
      if (activeRun.status === 'done' && !activeRun.pendingApproval) {
        clearConversationRun(conversationId);
      }
      await refreshConversations();
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRun, conversationId, refreshConversations]);

  const displayMessages = (() => {
    if (!activeRun || activeRun.conversationId !== conversationId) return messages;
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
      });
    }
    return next;
  })();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRun, messages]);

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

  const send = useCallback(async (text: string) => {
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
    const unsub = subscribeBioF3Event(biof3Events.copilotAsk, ({ prompt }) => {
      const p = typeof prompt === 'string' ? prompt.trim() : '';
      if (p) sendRef.current(p);
    });
    return unsub;
  }, []);

  const stop = useCallback(() => {
    if (conversationId) detachConversationRun(conversationId);
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
    await ackRunTool(ackToken, true);
    if (conversationId) clearConversationPendingApproval(conversationId);
    send(
      `用户已确认开始（ackToken=${ackToken}）。请重调 run_tool(op=run, toolId="${toolId ?? ''}", params=${JSON.stringify(mergedParams)}, ackToken="${ackToken}") 续跑该重操作。`
    );
  }, [conversationId, paramDraft, pendingApproval, send, streaming]);

  const rejectPending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    await ackRunTool(pendingApproval.ackToken, false);
    if (conversationId) clearConversationPendingApproval(conversationId);
    send('用户取消了该重操作，不要重试。请简短说明已取消，并给出如需继续时应调整哪些参数。');
  }, [conversationId, pendingApproval, send, streaming]);

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
                    {m.role === 'assistant' ? (
                      <CopilotMarkdown
                        text={m.content || (m.pending ? '…' : '')}
                        onFileReferenceClick={handleFileReferenceClick}
                        resolveContext={m.pending || streaming ? null : settledContext}
                      />
                    ) : (
                      <div className="sc-msg-text">{m.content}</div>
                    )}
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
          {pendingApproval && (
            <ApprovalCard
              approval={pendingApproval}
              repairState={approvalRepair}
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
                          <span className="sc-access-option-sub">可执行受控操作与工具调用</span>
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
  const totalDurationMs = activities.reduce(
    (total, activity) => total + (typeof activity.durationMs === 'number' ? activity.durationMs : 0),
    0
  );
  const totalDuration = formatToolDuration(processingDurationMs ?? totalDurationMs);
  const summary = running > 0
    ? '正在处理'
    : awaiting > 0
      ? '等待确认'
      : `已处理${totalDuration ? ` ${totalDuration}` : ''}`;

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
            <div className="sc-tool-activity-body">
              <div className="sc-tool-activity-head">
                <span className="sc-tool-activity-action">{activity.actionLabel}</span>
                {activity.actionDetail && (
                  <code className="sc-tool-activity-command">{activity.actionDetail}</code>
                )}
                <span className="sc-tool-activity-status">{statusLabels[activity.status]}</span>
              </div>
              <div className="sc-tool-activity-meta">
                <span className="sc-tool-activity-tool">{activity.name}</span>
                {duration && <span>{duration}</span>}
                {activity.truncated && activity.status === 'success' && <span>仅显示摘要</span>}
                {sideEffects && <span>副作用摘要：{sideEffects}</span>}
                {showReason && activity.terminationReason && (
                  <span className="sc-tool-activity-reason">
                    原因：{activity.terminationReason}
                  </span>
                )}
                {!activity.terminationReason && activity.summary && activity.status !== 'running' && (
                  <span>{activity.summary}</span>
                )}
              </div>
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
}: {
  approval: PendingApproval;
  repairState: ApprovalRepairState;
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
