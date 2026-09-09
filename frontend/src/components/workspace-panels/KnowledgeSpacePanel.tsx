/**
 * KnowledgeSpacePanel — BLOCK-69 / UI-318 知识空间右栏 tab（D6/D9/D10）
 *
 * 空间开关 + 文档列表（上传/删除/重建索引）+ 清空空间（两步确认）+ 检索测试框。
 * 启用状态单一真相 = DB；无 DashScope key 时诚实空态（D7），不假启用。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  clearKnowledgeSpace,
  deleteKnowledgeDocument,
  fetchKnowledgeSpace,
  reindexKnowledgeDocument,
  searchKnowledge,
  uploadKnowledgeDocuments,
  type KnowledgeDoc,
  type KnowledgeHit,
  type KnowledgeSpaceState,
} from '@/lib/knowledgeClient';
import styles from './KnowledgeSpacePanel.module.css';

const STATUS_LABEL: Record<KnowledgeDoc['status'], string> = {
  uploaded: '已上传',
  parsing: '解析中',
  chunking: '分块中',
  embedding: '嵌入中',
  ready: '就绪',
  failed: '失败',
};

const BUSY_STATUSES = new Set(['uploaded', 'parsing', 'chunking', 'embedding']);

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function KnowledgeSpacePanel() {
  const [state, setState] = useState<KnowledgeSpaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<KnowledgeHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchKnowledgeSpace();
      setState(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 轮询：摄取期 2s 快刷；空闲 10s 慢刷（外部/其他窗口上传的文档也能及时出现）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const hasBusy = (state?.documents || []).some((doc) => BUSY_STATUSES.has(doc.status));
    const timer = setInterval(() => void refresh(), hasBusy ? 2000 : 10000);
    return () => clearInterval(timer);
  }, [state?.documents, refresh]);

  // 清空两步确认 3s 复位
  useEffect(() => {
    if (!confirmClear) return;
    clearTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [confirmClear]);

  const enabled = !!state?.space?.enabled;
  const embeddingAvailable = state ? state.embeddingAvailable : true;
  const documents = state?.documents || [];

  const handleToggle = useCallback(async () => {
    setActionError(null);
    try {
      const { setKnowledgeSpaceEnabled } = await import('@/lib/knowledgeClient');
      await setKnowledgeSpaceEnabled(!enabled);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [enabled, refresh]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setActionError(null);
    try {
      const result = await uploadKnowledgeDocuments(Array.from(files));
      const rejectedCount = result.rejected.length;
      if (rejectedCount > 0) {
        setActionError(`${rejectedCount} 个文件被拒绝：${result.rejected[0].error}`);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (doc: KnowledgeDoc) => {
    setBusyDocId(doc.id);
    setActionError(null);
    try {
      await deleteKnowledgeDocument(doc.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyDocId(null);
    }
    await refresh();
  }, [refresh]);

  const handleReindex = useCallback(async (doc: KnowledgeDoc) => {
    setBusyDocId(doc.id);
    setActionError(null);
    try {
      await reindexKnowledgeDocument(doc.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyDocId(null);
    }
    await refresh();
  }, [refresh]);

  const handleClear = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    setActionError(null);
    try {
      await clearKnowledgeSpace();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [confirmClear, refresh]);

  const handleOpenDir = useCallback(() => {
    if (state?.knowledgeDir) {
      void window.biof3Desktop?.files?.openPath(state.knowledgeDir);
    }
  }, [state?.knowledgeDir]);

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchNote(null);
    try {
      const result = await searchKnowledge(query);
      setSearchHits(result.hits);
      if (result.readyChunks === 0) setSearchNote('知识库中还没有就绪的文档。');
      else if (result.hits.length === 0 && !result.embeddingAvailable) setSearchNote('嵌入模型不可用，仅全文通道检索且本次无命中。');
      else if (result.hits.length === 0) setSearchNote('两条检索通道均无命中。');
    } catch (e) {
      setSearchHits(null);
      setSearchNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searching]);

  return (
    <div className={styles.panel} data-testid="knowledge-panel">
      <div className={styles.header}>
        <Icon name="brain" size={16} />
        <span className={styles.title}>{state?.space?.name || '知识空间'}</span>
        <span className={styles.headerNote}>启用后对话自动检索</span>
      </div>

      {loadError && (
        <div className={styles.errorBox}>加载失败：{loadError}</div>
      )}

      {state && !embeddingAvailable && (
        <div className={styles.notice} data-testid="knowledge-embed-unavailable">
          配置 DashScope key（设置 → 模型）后可启用知识空间的语义检索。当前无法启用。
        </div>
      )}

      {state && (
        <div className={styles.spaceRow}>
          <button
            type="button"
            className={`${styles.toggleBtn} ${enabled ? styles.toggleBtnOn : ''}`}
            disabled={!embeddingAvailable}
            onClick={handleToggle}
            data-testid="knowledge-toggle"
          >
            <Icon name="brain" size={14} />
            {enabled ? '已启用' : '未启用'}
          </button>
          <span className={styles.spaceMeta}>
            {documents.length} 篇文档 · {documents.filter((d) => d.status === 'ready').length} 篇就绪
            {state.queueDepth > 0 ? ` · 摄取中 ${state.queueDepth}` : ''}
          </span>
        </div>
      )}

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid="knowledge-upload"
        >
          <Icon name="arrow-up" size={13} />
          {uploading ? '上传中…' : '上传文档'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.mdx,.rst,.log,.csv,.tsv,.json,.jsonl,.yaml,.yml,.toml,.ini,.xml,.html,.htm,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.r,.rmd,.ipynb,.sh,.bash,.zsh,.bat,.ps1,.sql,.css,.java,.c,.h,.cpp,.hpp,.go,.rs,.rb,.php,.lua,.pl,.m,.swift,.kt,.scala"
          style={{ display: 'none' }}
          onChange={(e) => void handleUpload(e.target.files)}
        />
        <button type="button" className={styles.ghostBtn} onClick={handleOpenDir} title={state?.knowledgeDir || ''}>
          <Icon name="folder" size={13} />
          打开知识目录
        </button>
        {documents.length > 0 && (
          <button
            type="button"
            className={`${styles.ghostBtn} ${confirmClear ? styles.dangerBtn : ''}`}
            onClick={handleClear}
            data-testid="knowledge-clear"
          >
            <Icon name="trash" size={13} />
            {confirmClear ? '确认清空？' : '清空空间'}
          </button>
        )}
      </div>

      {actionError && <div className={styles.errorBox}>{actionError}</div>}

      <div className={styles.docList} data-testid="knowledge-doc-list">
        {documents.length === 0 && (
          <div className={styles.empty}>还没有文档。上传 txt / md / 代码 / csv 等文本文件开始构建知识库。</div>
        )}
        {documents.map((doc) => (
          <div key={doc.id} className={styles.docRow} data-testid="knowledge-doc-row">
            <div className={styles.docMain}>
              <span className={styles.docName} title={doc.name}>{doc.name}</span>
              <span className={`${styles.docStatus} ${doc.status === 'ready' ? styles.docStatusReady : ''} ${doc.status === 'failed' ? styles.docStatusFailed : ''}`}>
                {STATUS_LABEL[doc.status]}
                {doc.status === 'ready' ? ` · ${doc.chunkCount} 块` : ''}
                {doc.status === 'failed' && doc.error ? ` · ${doc.error}` : ''}
              </span>
            </div>
            <span className={styles.docMeta}>{formatBytes(doc.size)}</span>
            <div className={styles.docActions}>
              <button
                type="button"
                className={styles.iconBtn}
                title="重建索引"
                disabled={busyDocId === doc.id}
                onClick={() => void handleReindex(doc)}
              >
                <Icon name="refresh" size={13} />
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                title="删除文档"
                disabled={busyDocId === doc.id}
                onClick={() => void handleDelete(doc)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.searchBox}>
        <div className={styles.searchTitle}>检索测试</div>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="输入查询，预览 top-k 命中"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            data-testid="knowledge-search-input"
          />
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={searching || !searchQuery.trim()}
            onClick={() => void handleSearch()}
            data-testid="knowledge-search-btn"
          >
            {searching ? '检索中…' : '检索'}
          </button>
        </div>
        {searchNote && <div className={styles.searchNote}>{searchNote}</div>}
        {searchHits && searchHits.length > 0 && (
          <div className={styles.hitList} data-testid="knowledge-search-hits">
            {searchHits.map((hit) => (
              <div key={hit.docId} className={styles.hitRow}>
                <div className={styles.hitHead}>
                  <span className={styles.hitDoc}>{hit.docName} · 第 {hit.seq + 1} 块</span>
                  <span className={styles.hitScore}>
                    {hit.channels.vector != null ? `语义 ${hit.channels.vector.toFixed(2)}` : ''}
                    {hit.channels.vector != null && hit.channels.fts != null ? ' + ' : ''}
                    {hit.channels.fts != null ? '全文' : ''}
                  </span>
                </div>
                <div className={styles.hitText}>{hit.text.slice(0, 220)}{hit.text.length > 220 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeSpacePanel;
