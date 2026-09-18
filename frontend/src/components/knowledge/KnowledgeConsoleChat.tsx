/**
 * KnowledgeConsoleChat — BLOCK-99 G4 空间管理会话台（/knowledge 页内嵌轻量聊天面）
 *
 * D3 独立轻量面：自然语言驱动知识空间内容组织（建/改/启停/移动/删除/重建/检索），
 * 不复用 SimpleChat 主文件；D4 破坏性操作经内联确认卡（与手动 UI 两步确认同门）。
 * 诚实边界：会话台控制的是空间内容，不是面板 UI 布局。
 */

import React, { useCallback, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useKnowledgeConsole, type ConsoleToolEntry } from './useKnowledgeConsole';
import styles from './KnowledgeConsoleChat.module.css';

const TOOL_LABELS: Record<string, string> = {
  knowledge_search: '检索知识',
  knowledge_status: '空间状态',
  knowledge_read: '读取文档',
  knowledge_space_list: '空间清单',
  knowledge_space_impact: '影响面',
  knowledge_space_create: '建空间',
  knowledge_space_rename: '重命名',
  knowledge_space_enable: '启停空间',
  knowledge_space_bind: '绑定本会话',
  knowledge_space_delete: '删空间',
  knowledge_space_clear: '清空空间',
  knowledge_doc_list: '文档清单',
  knowledge_doc_move: '移动文档',
  knowledge_doc_delete: '删文档',
  knowledge_doc_reindex: '重建索引',
};

function ToolRow({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: ConsoleToolEntry;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const label = TOOL_LABELS[entry.name] || entry.name;
  const icon =
    entry.status === 'running' ? 'refresh' : entry.status === 'error' ? 'alert-circle' : 'check';
  return (
    <div className={`${styles.toolRow} ${entry.status === 'error' ? styles.toolRowError : ''}`}>
      <Icon name={icon} size={13} className={entry.status === 'running' ? styles.toolSpin : undefined} />
      <span className={styles.toolLabel}>{label}</span>
      {entry.summary ? <span className={styles.toolSummary}>{entry.summary}</span> : null}
      {entry.confirmation ? (
        <div className={styles.confirmCard} data-testid="knowledge-console-confirm">
          <div className={styles.confirmTitle}>破坏性操作，等待你的确认</div>
          <div className={styles.confirmImpact}>{entry.confirmation.impactText}</div>
          {entry.confirmation.resolved === 'pending' ? (
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmBtnDanger}
                onClick={() => onConfirm(entry.id)}
              >
                确认执行
              </button>
              <button
                type="button"
                className={styles.confirmBtnGhost}
                onClick={() => onCancel(entry.id)}
              >
                取消
              </button>
            </div>
          ) : (
            <div className={styles.confirmResolved}>
              {entry.confirmation.resolved === 'confirmed' ? '已确认' : '已取消'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeConsoleChat(): React.ReactElement {
  const {
    entries,
    streaming,
    error,
    ready,
    send,
    confirmDestructive,
    cancelDestructive,
  } = useKnowledgeConsole();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    void send(text);
  }, [draft, send, streaming]);

  // 新内容落底（轻量面不做回底浮标）
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, streaming]);

  return (
    <section className={styles.console} data-testid="knowledge-console" aria-label="知识空间管理台">
      <header className={styles.header}>
        <Icon name="message-circle" size={14} />
        <span className={styles.headerTitle}>管理会话台</span>
        <span className={styles.headerHint}>自然语言管理空间内容</span>
      </header>
      <div className={styles.list} ref={listRef}>
        {ready && entries.length === 0 ? (
          <div className={styles.empty}>
            <p>试试这样管理知识空间：</p>
            <ul>
              <li>「新建一个空间叫转录组笔记，然后启用它」</li>
              <li>「列出所有空间和文档数量」</li>
              <li>「把这两篇文档移到 B 空间」</li>
              <li>「检索一下 TP53 相关的笔记」</li>
            </ul>
            <p className={styles.emptyNote}>
              删空间、清空、批量删除会先列出影响面并等你确认；面板布局本身请在页面上手动调整。
            </p>
          </div>
        ) : null}
        {entries.map((entry) =>
          entry.kind === 'message' ? (
            <div
              key={entry.id}
              className={`${styles.msg} ${entry.role === 'user' ? styles.msgUser : styles.msgAssistant}`}
            >
              {entry.content}
            </div>
          ) : (
            <ToolRow key={entry.id} entry={entry} onConfirm={confirmDestructive} onCancel={cancelDestructive} />
          )
        )}
        {streaming && entries.every((e) => e.kind === 'message' && e.role === 'user') ? (
          <div className={styles.msgAssistant}>思考中…</div>
        ) : null}
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      <footer className={styles.composer}>
        <textarea
          className={styles.input}
          value={draft}
          placeholder={ready ? '用自然语言管理知识空间…' : '会话台启动中…'}
          disabled={!ready || streaming}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          type="button"
          className={styles.sendBtn}
          disabled={!ready || streaming || !draft.trim()}
          onClick={handleSend}
          aria-label="发送"
        >
          <Icon name="send" size={15} />
        </button>
      </footer>
    </section>
  );
}
