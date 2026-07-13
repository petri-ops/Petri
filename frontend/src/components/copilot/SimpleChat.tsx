// ============================================================
// SimpleChat — lightweight conversation-only chat component
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ackRunTool,
  streamChat,
  type ChatMessage,
} from './copilotClient';
import {
  getConversationMessages,
} from './copilotConversationsClient';
import { useCopilotContext } from '@/lib/copilotContextProvider';
import { useConversations } from '@/hooks/useConversations';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
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
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';
import { tools as staticTools } from '@/pages/_data';

interface SimpleMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
  ts?: string;
}

interface PendingApproval {
  ackToken: string;
  toolJobId?: string;
  toolId?: string;
  message?: string;
  params?: Record<string, unknown>;
}

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
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [approvalRepair, setApprovalRepair] = useState<ApprovalRepairState>({ status: 'idle' });
  const autoApproveRef = useRef<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<'full' | 'read'>('full');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeConvRef = useRef<string | null>(conversationId);

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
  const { refresh: refreshConversations } = useConversations(projectId);

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

  // Keep ref in sync
  useEffect(() => { activeConvRef.current = conversationId; }, [conversationId]);

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
    if (!conversationId) {
      setMessages([]);
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
      }));
      setMessages(ui);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    resizeTextarea(e.target);
  };

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';

    const userMsg: SimpleMessage = {
      role: 'user',
      content: trimmed,
      ts: new Date().toISOString(),
    };
    const assistantMsg: SimpleMessage = {
      role: 'assistant',
      content: '',
      pending: true,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Build upstream messages from current history
    const tagged: ChatMessage[] = messages
      .filter((m) => !m.error && !m.pending)
      .map((m) => ({ role: m.role, content: m.content }));
    tagged.push({ role: 'user', content: trimmed });

    let acc = '';

    await streamChat({
      messages: tagged,
      modelPresetId: activeModelId,
      context: {
        ...copilotCtxRef.current,
        page: 'desktop-project',
        projectId,
      },
      signal: ctrl.signal,
      conversationId: activeConvRef.current || undefined,
      onDelta: (delta) => {
        acc += delta;
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: acc, pending: false };
          }
          return copy;
        });
      },
      onConversation: (info) => {
        if (info.conversationId && info.conversationId !== activeConvRef.current) {
          activeConvRef.current = info.conversationId;
          onConversationChange(info.conversationId);
          refreshConversations();
        }
      },
      onToolResult: (event) => {
        if (event.name === 'run_tool' && event.needApproval && event.ackToken) {
          setPendingApproval({
            ackToken: event.ackToken,
            toolJobId: event.toolJobId,
            toolId: event.toolId,
            message: event.message,
            params: event.params,
          });
          return;
        }
      },
      onDone: () => {
        setStreaming(false);
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant' && last.pending) {
            copy[copy.length - 1] = { ...last, pending: false };
          }
          return copy;
        });
        refreshConversations();
      },
      onError: (err) => {
        setStreaming(false);
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = {
              ...last,
              content: '⚠️ ' + (err.message || '请求失败'),
              pending: false,
              error: true,
            };
          }
          return copy;
        });
      },
    });
  }, [streaming, messages, onConversationChange, refreshConversations, projectId, activeModelId]);

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
    if (abortRef.current) abortRef.current.abort();
    setStreaming(false);
  }, []);

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
    setPendingApproval(null);
    send(
      `用户已确认开始（ackToken=${ackToken}）。请重调 run_tool(op=run, toolId="${toolId ?? ''}", params=${JSON.stringify(mergedParams)}, ackToken="${ackToken}") 续跑该重操作。`
    );
  }, [paramDraft, pendingApproval, send, streaming]);

  const rejectPending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    await ackRunTool(pendingApproval.ackToken, false);
    setPendingApproval(null);
    send('用户取消了该重操作，不要重试。请简短说明已取消，并给出如需继续时应调整哪些参数。');
  }, [pendingApproval, send, streaming]);

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
    if (streaming) stop();
    onConversationChange(null);
    setMessages([]);
  }, [streaming, stop, onConversationChange]);

  // Expose via ref-like pattern through props is not needed here;
  // parent controls conversationId directly.

  const accessModeLabel = accessMode === 'full' ? '完全访问' : '只读模式';
  const selectModel = useCallback(async (preset: ChatModelPreset) => {
    setModelMenuOpen(false);
    // Hook persists the new active id + llm_provider via electron
    // bridge (Plan 1.6 §4.5 — replaces the local get-then-save).
    await setActiveModelId(preset.id);
  }, [setActiveModelId]);

  return (
    <div className="sc-root">
      <div className="sc-body">
        <div className="sc-messages" ref={scrollRef}>
          {loading && <div className="sc-loading">加载会话…</div>}
          {!loading && messages.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-icon">
                <Icon name="message-circle" size={32} />
              </div>
              <p>开始新的对话</p>
              <span>在下方输入框中提问</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`sc-msg sc-msg-${m.role}`}>
              <div className="sc-msg-avatar">
                {m.role === 'user' ? (
                  <Icon name="user" size={16} />
                ) : (
                  <Icon name="cpu" size={16} />
                )}
              </div>
              <div className="sc-msg-body">
                {m.role === 'assistant' ? (
                  <>
                    <CopilotMarkdown text={m.content || (m.pending ? '…' : '')} />
                  </>
                ) : (
                  <div className="sc-msg-text">{m.content}</div>
                )}
              </div>
            </div>
          ))}
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
                <div className="sc-model-picker sc-model-picker-footer">
                  <button
                    type="button"
                    className="sc-model-btn"
                    onClick={() => setModelMenuOpen((value) => !value)}
                    title="选择会话模型"
                  >
                    <span>{activeModel?.label || activeModel?.model || 'DeepSeek Chat'}</span>
                    <Icon name="chevron-down" size={12} />
                  </button>
                  {modelMenuOpen && (
                    <>
                      <div className="sc-model-overlay" onClick={() => setModelMenuOpen(false)} />
                      <div className="sc-model-menu">
                        {modelPresets.map((preset) => (
                          <button
                            type="button"
                            key={preset.id}
                            className={`sc-model-option ${preset.id === activeModelId ? 'sc-model-option-active' : ''}`}
                            onClick={() => selectModel(preset)}
                          >
                            <span className="sc-model-option-title">{preset.label || preset.model}</span>
                            <span className="sc-model-option-meta">{preset.provider} · {preset.model}</span>
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
    return `已将 ${inputId} 从 ${shortValue(item.from)} 调整为 ${shortValue(item.to)}`;
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
