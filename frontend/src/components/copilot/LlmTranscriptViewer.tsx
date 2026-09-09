/**
 * BLOCK-37 P3 — 会话级「模型 I/O」查看器（UI-274）
 *
 * 按时间倒序列出本会话全部模型调用（时间 / 模型 / 轮次 / tokens / 体积 / 错误标记），
 * 点击展开单条——请求 messages 按角色折叠 + 响应聚合正文（含 reasoning / tool_calls /
 * usage），SSE 帧数与截断标记诚实呈现。严格只读，无重放/编辑/删除。
 *
 * BLOCK-68 / UI-317 — 自 ⋯ 菜单 overlay 形态迁为右栏 dock 形态（与文件/审阅并列）：
 * overlay/dialog 外壳与 Esc/遮罩关闭退役，绑 activeConvId 会话切换内容随动，
 * 无会话渲染诚实空态。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/icons/Icon';
import {
  fetchLlmTranscriptRecord,
  listLlmTranscripts,
  type LlmTranscriptIndexEntry,
  type LlmTranscriptMessage,
  type LlmTranscriptRecord,
} from './llmTranscripts';
import './LlmTranscriptViewer.css';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTokens(usage?: { total_tokens?: number }): string {
  const total = usage && Number.isFinite(usage.total_tokens) ? usage.total_tokens : undefined;
  return total !== undefined ? `${total} tok` : '—';
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function messageText(message: LlmTranscriptMessage): string {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function contentPreview(message: LlmTranscriptMessage): string {
  const text = messageText(message).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function RequestMessageRow({ message }: { message: LlmTranscriptMessage }) {
  const [expanded, setExpanded] = useState(false);
  const role = typeof message?.role === 'string' ? message.role : 'unknown';
  const text = messageText(message);
  const preview = contentPreview(message);
  return (
    <div className="llm-tr-msg">
      <button
        type="button"
        className="llm-tr-msg-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className={`llm-tr-msg-role llm-tr-role-${role}`}>{role}</span>
        <span className="llm-tr-msg-preview">{preview || '（空内容）'}</span>
      </button>
      {expanded && (
        <pre className="llm-tr-msg-body">{text || '（空内容）'}</pre>
      )}
    </div>
  );
}

function RecordDetail({ record }: { record: LlmTranscriptRecord }) {
  const messages = Array.isArray(record?.request?.messages) ? record.request.messages : [];
  const response = record?.response || null;
  const usage = response?.usage;
  return (
    <div className="llm-tr-detail">
      <div className="llm-tr-detail-meta">
        <span>{record.model || record.profileId || '未知模型'}</span>
        <span>kind: {record.kind}</span>
        <span>role: {record.role}</span>
        {Number.isFinite(record.durationMs) && <span>{record.durationMs}ms</span>}
        {record.attemptIndex > 0 && <span className="llm-tr-fallback">fallback ×{record.attemptIndex}</span>}
        {record.error && <span className="llm-tr-error-chip">错误：{record.error}</span>}
      </div>

      <section className="llm-tr-section">
        <h4 className="llm-tr-section-title">请求 · messages（{messages.length}）</h4>
        {record.messagesTruncated > 0 && (
          <p className="llm-tr-truncated-note">⚠ 中段 {record.messagesTruncated} 条消息因超限未存盘</p>
        )}
        <div className="llm-tr-msg-list">
          {messages.map((message, index) => (
            <RequestMessageRow key={index} message={message} />
          ))}
        </div>
      </section>

      <section className="llm-tr-section">
        <h4 className="llm-tr-section-title">响应</h4>
        {response ? (
          <div className="llm-tr-response">
            <div className="llm-tr-response-meta">
              <span>finish: {response.finishReason || '—'}</span>
              {usage && Number.isFinite(usage.total_tokens) && (
                <span>tokens: {usage.total_tokens}
                  {Number.isFinite(usage.prompt_tokens as number) && Number.isFinite(usage.completion_tokens as number)
                    ? `（入 ${usage.prompt_tokens} / 出 ${usage.completion_tokens}）`
                    : ''}
                </span>
              )}
              <span>帧：{record.framesCount}{record.framesTruncated ? '+（超限未存）' : ''}</span>
            </div>
            {response.reasoningContent && (
              <div className="llm-tr-response-block">
                <span className="llm-tr-block-label">思考</span>
                <pre className="llm-tr-msg-body">{response.reasoningContent}</pre>
              </div>
            )}
            {response.content && (
              <div className="llm-tr-response-block">
                <span className="llm-tr-block-label">正文</span>
                <pre className="llm-tr-msg-body">{response.content}</pre>
              </div>
            )}
            {Array.isArray(response.toolCalls) && response.toolCalls.length > 0 && (
              <div className="llm-tr-response-block">
                <span className="llm-tr-block-label">工具调用（{response.toolCalls.length}）</span>
                <pre className="llm-tr-msg-body">{JSON.stringify(response.toolCalls, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : (
          <p className="llm-tr-empty-response">{record.error ? `本次调用失败：${record.error}` : '（无聚合响应）'}</p>
        )}
      </section>

      {record.truncated && (
        <p className="llm-tr-truncated-note">⚠ 本条记录因超过 8MB 落盘上限被截断（诚实标记，正文可能不完整）</p>
      )}
    </div>
  );
}

export function LlmTranscriptViewer({
  conversationId,
}: {
  conversationId: string | null;
}): React.ReactElement {
  const [entries, setEntries] = useState<LlmTranscriptIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, LlmTranscriptRecord>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  // 倒序展示（最新在前）
  const sortedEntries = useMemo(() => {
    if (!entries) return [];
    return [...entries].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }, [entries]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    setExpandedId(null);
    setDetailCache({});
    listLlmTranscripts(conversationId)
      .then((records) => {
        if (!cancelled) setEntries(records);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const toggleRecord = useCallback(
    (id: string) => {
      if (!conversationId) return;
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (detailCache[id]) return;
      setDetailLoading(true);
      fetchLlmTranscriptRecord(conversationId, id)
        .then((record) => {
          setDetailCache((cache) => ({ ...cache, [id]: record }));
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setExpandedId(null);
        })
        .finally(() => {
          setDetailLoading(false);
        });
    },
    [conversationId, expandedId, detailCache]
  );

  return (
    <div className="llm-tr-dock" aria-label="模型 I/O 信息流">
      <header className="llm-tr-head">
        <span className="llm-tr-title">模型 I/O 信息流</span>
        <span className="llm-tr-sub">本会话全部模型调用的请求与响应原文 · 只读</span>
      </header>

      <div className="llm-tr-body">
        {!conversationId && <div className="llm-tr-state">当前无会话</div>}
        {conversationId && error && <div className="llm-tr-error-banner">加载失败：{error}</div>}
        {conversationId && entries === null && !error && <div className="llm-tr-state">加载中…</div>}
        {conversationId && entries !== null && sortedEntries.length === 0 && (
          <div className="llm-tr-state">本会话暂无模型调用记录</div>
        )}
        {conversationId && sortedEntries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} className={`llm-tr-item${expanded ? ' is-expanded' : ''}`}>
                <button
                  type="button"
                  className="llm-tr-row"
                  aria-expanded={expanded}
                  onClick={() => toggleRecord(entry.id)}
                >
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                  <span className="llm-tr-row-time">{formatTime(entry.ts)}</span>
                  <span className="llm-tr-row-model">{entry.model || entry.profileId || '—'}</span>
                  <span className="llm-tr-row-kind">{entry.kind}</span>
                  {entry.attemptIndex > 0 && <span className="llm-tr-fallback">×{entry.attemptIndex + 1}</span>}
                  <span className="llm-tr-row-meta">{formatTokens(entry.usage)}</span>
                  <span className="llm-tr-row-meta">{formatBytes(entry.sizeBytes)}</span>
                  {entry.error && <span className="llm-tr-error-dot" title={entry.error} />}
                  {entry.truncated && <span className="llm-tr-cut-chip">截断</span>}
                </button>
                {expanded && (
                  detailLoading && !detailCache[entry.id]
                    ? <div className="llm-tr-state">加载详情…</div>
                    : detailCache[entry.id]
                      ? <RecordDetail record={detailCache[entry.id]} />
                      : null
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}
