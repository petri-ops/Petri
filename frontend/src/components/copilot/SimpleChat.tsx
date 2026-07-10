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
import {
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import type { CopilotContext } from '@/lib/copilotContext';
import { CopilotMarkdown } from './copilotMarkdown';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';

interface SimpleMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
  ts?: string;
  resultCards?: SimpleResultCard[];
}

interface SimpleResultCard {
  jobId: string;
  toolId?: string;
  title: string;
  status: 'done' | 'failed';
  projectId?: string | null;
  error?: string;
  artifacts?: Array<{
    id?: string;
    name?: string;
    filename?: string;
    type?: string;
    label?: string;
    title?: string;
  }>;
  files?: string[];
  outputs?: Array<{
    id?: string;
    name?: string;
    filename?: string;
    type?: string;
    label?: string;
  }>;
}

interface PendingApproval {
  ackToken: string;
  toolJobId?: string;
  toolId?: string;
  message?: string;
  params?: Record<string, unknown>;
}

// ChatModelPreset type + DEFAULT_CHAT_MODEL_PRESETS live in
// `@/hooks/useAiSettings` — Plan 1.6 §4.5 [HIGH] type dedup.

export interface SimpleChatHandle {
  newConversation: () => void;
}

interface SimpleChatProps {
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  onOpenResult?: (jobId: string) => void;
  inputHeight?: number;
}

export function SimpleChat({
  projectId,
  conversationId,
  onConversationChange,
  onOpenResult,
  inputHeight = 120,
}: SimpleChatProps): React.ReactElement {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
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
      draft[key] = typeof value === 'string' ? value : JSON.stringify(value);
    });
    setParamDraft(draft);
  }, [pendingApproval]);

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
        resultCards: m.role === 'assistant' ? parseResultCards(m.meta?.resultCards) : undefined,
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

  // Auto-resize textarea
  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
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
        if (event.name !== 'run_tool' || !event.toolJobId || event.needApproval) return;
        const toolId = event.toolId || 'analysis';
        const card: SimpleResultCard = {
          jobId: event.toolJobId,
          toolId,
          title: `${toolId} 分析结果`,
          status: event.summary && event.summary.startsWith('错误') ? 'failed' : 'done',
          projectId,
          error: event.message || (event.summary && event.summary.startsWith('错误') ? event.summary : undefined),
        };
        setMessages((prev) => {
          const copy = prev.slice();
          const lastIdx = copy.length - 1;
          const last = copy[lastIdx];
          if (!last || last.role !== 'assistant') return prev;
          if ((last.resultCards || []).some((item) => item.jobId === card.jobId)) return prev;
          copy[lastIdx] = {
            ...last,
            resultCards: [...(last.resultCards || []), card],
          };
          return copy;
        });
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
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail || {};
      const prompt = typeof detail.prompt === 'string' ? detail.prompt.trim() : '';
      if (!prompt) return;
      sendRef.current(prompt);
    };
    window.addEventListener('biof3:copilot-ask', onAsk as EventListener);
    return () => window.removeEventListener('biof3:copilot-ask', onAsk as EventListener);
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
                    {m.resultCards?.map((card) => (
                      <ResultCard
                        key={card.jobId}
                        card={card}
                        disabled={streaming}
                        onOpenResult={onOpenResult}
                        onContinue={() => {
                          if (card.status === 'failed') {
                            send(`这个分析任务失败了：${card.title}（toolJobId=${card.jobId}）。错误信息：${card.error || '未知错误'}。请帮我定位原因，给出可恢复方案，并告诉我应该如何调整参数后重试。`);
                          } else {
                            send(`请基于刚完成的 ${card.title}（toolJobId=${card.jobId}）解释结果，并推荐下一步分析。`);
                          }
                        }}
                      />
                    ))}
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
              paramDraft={paramDraft}
              disabled={streaming}
              onParamChange={(key, value) =>
                setParamDraft((prev) => ({ ...prev, [key]: value }))
              }
              onApprove={approvePending}
              onReject={rejectPending}
            />
          )}
        </div>

        <div className="sc-input-area">
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
                style={{ height: inputHeight, maxHeight: inputHeight }}
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
                    <span className="sc-model-btn-dot" />
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
                    <Icon name="send" size={15} />
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

function parseResultCards(value: unknown): SimpleResultCard[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cards = value
    .map((item): SimpleResultCard | null => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      if (typeof raw.jobId !== 'string' || !raw.jobId) return null;
      const toolId = typeof raw.toolId === 'string' && raw.toolId ? raw.toolId : undefined;
      const title =
        typeof raw.title === 'string' && raw.title
          ? raw.title
          : `${toolId || 'analysis'} 分析结果`;
      const status = raw.status === 'failed' ? 'failed' : 'done';
      const files = Array.isArray(raw.files)
        ? raw.files.filter((file): file is string => typeof file === 'string')
        : undefined;
      const artifacts: SimpleResultCard['artifacts'] = [];
      if (Array.isArray(raw.artifacts)) {
        raw.artifacts.forEach((artifact) => {
          if (!artifact || typeof artifact !== 'object') return;
          const a = artifact as Record<string, unknown>;
          artifacts.push({
            id: typeof a.id === 'string' ? a.id : undefined,
            name: typeof a.name === 'string' ? a.name : undefined,
            filename: typeof a.filename === 'string' ? a.filename : undefined,
            type: typeof a.type === 'string' ? a.type : undefined,
            label: typeof a.label === 'string' ? a.label : undefined,
            title: typeof a.title === 'string' ? a.title : undefined,
          });
        });
      }
      const outputs: SimpleResultCard['outputs'] = [];
      if (Array.isArray(raw.outputs)) {
        raw.outputs.forEach((output) => {
          if (!output || typeof output !== 'object') return;
          const o = output as Record<string, unknown>;
          outputs.push({
            id: typeof o.id === 'string' ? o.id : undefined,
            name: typeof o.name === 'string' ? o.name : undefined,
            filename: typeof o.filename === 'string' ? o.filename : undefined,
            type: typeof o.type === 'string' ? o.type : undefined,
            label: typeof o.label === 'string' ? o.label : undefined,
          });
        });
      }
      return {
        jobId: raw.jobId,
        toolId,
        title,
        status,
        projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
        error: typeof raw.error === 'string' ? raw.error : undefined,
        artifacts: artifacts.length ? artifacts : undefined,
        files,
        outputs: outputs.length ? outputs : undefined,
      };
    })
    .filter((card): card is SimpleResultCard => Boolean(card));
  return cards.length ? cards : undefined;
}

function ApprovalCard({
  approval,
  paramDraft,
  disabled,
  onParamChange,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  paramDraft: Record<string, string>;
  disabled: boolean;
  onParamChange: (key: string, value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}): React.ReactElement {
  const paramEntries = Object.entries(paramDraft);
  return (
    <div className="sc-approval-card">
      <div className="sc-approval-header">
        <div className="sc-approval-icon">
          <Icon name="shield" size={16} />
        </div>
        <div className="sc-approval-title-wrap">
          <div className="sc-approval-title">参数确认</div>
          <div className="sc-approval-sub">
            {approval.toolId || 'analysis'}{approval.toolJobId ? ` · ${approval.toolJobId}` : ''}
          </div>
        </div>
      </div>
      <div className="sc-approval-message">
        {approval.message || 'agent 准备执行一个正式分析任务，请确认参数后再开始。'}
      </div>
      {paramEntries.length > 0 && (
        <div className="sc-approval-params">
          {paramEntries.map(([key, value]) => (
            <label key={key} className="sc-approval-param-row">
              <span className="sc-approval-param-key">{key}</span>
              <input
                className="sc-approval-param-input"
                value={value}
                onChange={(event) => onParamChange(key, event.target.value)}
                disabled={disabled}
              />
            </label>
          ))}
        </div>
      )}
      <div className="sc-approval-risk">
        正式分析会写入项目任务记录，并生成可复现的参数、输入和结果产物。
      </div>
      <div className="sc-approval-actions">
        <button
          type="button"
          className="sc-approval-btn sc-approval-approve"
          onClick={onApprove}
          disabled={disabled}
        >
          <Icon name="check" size={13} /> 确认开始
        </button>
        <button
          type="button"
          className="sc-approval-btn sc-approval-cancel"
          onClick={onReject}
          disabled={disabled}
        >
          <Icon name="x" size={13} /> 取消
        </button>
      </div>
    </div>
  );
}

function ResultCard({
  card,
  disabled,
  onOpenResult,
  onContinue,
}: {
  card: SimpleResultCard;
  disabled: boolean;
  onOpenResult?: (jobId: string) => void;
  onContinue: () => void;
}): React.ReactElement {
  return (
    <div className={`sc-result-card sc-result-card-${card.status}`}>
      <div className="sc-result-main">
        <div className="sc-result-icon">
          <Icon name={card.status === 'done' ? 'bar-chart' : 'x'} size={16} />
        </div>
        <div className="sc-result-copy">
          <div className="sc-result-title">{card.title}</div>
          <div className="sc-result-meta">
            {card.status === 'done' ? '结果已生成' : '分析失败'} · {card.jobId}
          </div>
          {card.status === 'failed' && card.error && (
            <div className="sc-result-error">{card.error}</div>
          )}
        </div>
      </div>
      <div className="sc-result-actions">
        <button
          type="button"
          className="sc-result-btn"
          onClick={() => onOpenResult?.(card.jobId)}
          disabled={!onOpenResult}
        >
          <Icon name="bar-chart" size={13} /> 查看结果
        </button>
        <button
          type="button"
          className="sc-result-btn sc-result-btn-secondary"
          onClick={onContinue}
          disabled={disabled}
        >
          <Icon name="message-circle" size={13} /> {card.status === 'failed' ? '排查修复' : '解释下一步'}
        </button>
      </div>
    </div>
  );
}
