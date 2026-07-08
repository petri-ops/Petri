// ============================================================
// SimpleChat — lightweight conversation-only chat component
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  streamChat,
  getApiPrefix,
  type ChatMessage,
} from './copilotClient';
import {
  listConversations,
  createConversation,
  getConversationMessages,
  type ConversationSummary,
} from './copilotConversationsClient';
import { CopilotMarkdown } from './copilotMarkdown';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';

interface SimpleMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
  ts?: string;
}

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
  inputHeight = 120,
}: SimpleChatProps): React.ReactElement {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeConvRef = useRef<string | null>(conversationId);

  // Keep ref in sync
  useEffect(() => { activeConvRef.current = conversationId; }, [conversationId]);

  // Load conversation list for this project
  const refreshConversations = useCallback(async () => {
    const list = await listConversations('active', projectId);
    setConversations(list);
  }, [projectId]);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);

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
    let convCreated = false;

    await streamChat({
      messages: tagged,
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
        if (!convCreated && info.conversationId && !activeConvRef.current) {
          convCreated = true;
          activeConvRef.current = info.conversationId;
          onConversationChange(info.conversationId);
          refreshConversations();
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
  }, [streaming, messages, onConversationChange, refreshConversations]);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setStreaming(false);
  }, []);

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

  const currentConv = conversations.find((c) => c.id === conversationId);

  return (
    <div className="sc-root">
      {/* Header — conversation title */}
      <div className="sc-header">
        <span className="sc-title">
          {currentConv?.title || '新对话'}
        </span>
      </div>

      {/* Messages */}
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
                <CopilotMarkdown content={m.content || (m.pending ? '…' : '')} />
              ) : (
                <div className="sc-msg-text">{m.content}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="sc-input-area">
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
        <div className="sc-input-actions">
          {streaming ? (
            <button className="sc-stop-btn" onClick={stop}>
              <Icon name="square" size={14} /> 停止
            </button>
          ) : (
            <button
              className="sc-send-btn"
              onClick={() => send(input)}
              disabled={!input.trim()}
            >
              <Icon name="send" size={14} /> 发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
