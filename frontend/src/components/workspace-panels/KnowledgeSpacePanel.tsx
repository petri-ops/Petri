/**
 * KnowledgeSpacePanel — BLOCK-69 / UI-318 知识空间右栏 tab（D6/D9/D10）
 *
 * 空间开关 + 文档列表（上传/删除/重建索引）+ 清空空间（两步确认）+ 检索测试框。
 * 启用状态单一真相 = DB；无 DashScope key 时诚实空态（D7），不假启用。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  batchDeleteKnowledgeDocuments,
  clearKnowledgeSpaceById,
  deleteKnowledgeDocument,
  fetchKnowledgeDocumentPreview,
  fetchKnowledgeSpace,
  reindexKnowledgeDocument,
  retryFailedKnowledgeDocuments,
  searchKnowledgeInSpace,
  uploadKnowledgeDocumentsWithSpace,
  type KnowledgeDoc,
  type KnowledgeDocPreview,
  type KnowledgeHit,
  type KnowledgeSpaceState,
} from '@/lib/knowledgeClient';
import { KnowledgeSpaceSwitcher } from './KnowledgeSpaceSwitcher';
import { subscribeGewuEvent } from '@/lib/events';
import {
  BUSY_STATUSES,
  formatBytes,
  HighlightedText,
  splitQueryTokens,
  STATUS_LABEL,
} from './knowledge-utils';
import styles from './KnowledgeSpacePanel.module.css';

export function KnowledgeSpacePanel() {
  const [state, setState] = useState<KnowledgeSpaceState | null>(null);
  // BLOCK-99 P2 — 当前空间（默认 ks_default；切换经 KnowledgeSpaceSwitcher）
  const [spaceId, setSpaceId] = useState('ks_default');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDocId, setSearchDocId] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<KnowledgeHit[] | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searchDegraded, setSearchDegraded] = useState(false);
  const [searchTokens, setSearchTokens] = useState<string[]>([]);
  // BLOCK-94 F3 摄取易用：拖拽上传 + 逐文件错误聚合 + 粘贴文本入库
  const [dragActive, setDragActive] = useState(false);
  const [uploadReport, setUploadReport] = useState<{ accepted: number; rejected: Array<{ name: string; error: string }> } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  // BLOCK-94 F4 管理面：批量选择 + 全文预览展开 + 失败批量重试
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<KnowledgeDocPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // BLOCK-94 F1 分页：首屏 50 篇，「加载更多」按 50 递增（服务端钳制 200）
  const [docLimit, setDocLimit] = useState(50);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchKnowledgeSpace({ docLimit, spaceId });
      setState(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [docLimit, spaceId]);

  // 轮询：摄取期 2s 快刷；空闲 10s 慢刷（外部/其他窗口上传的文档也能及时出现）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // BLOCK-99 G4 — 管理台会话驱动变更后即时刷新（双通道同一真相；轮询兜底不变）
  useEffect(
    () =>
      subscribeGewuEvent('gewu:knowledge-console-sync', () => {
        void refresh();
      }),
    [refresh]
  );

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
  const documentsTotal = state?.documentsTotal ?? documents.length;
  const documentsHasMore = !!state?.documentsHasMore;
  const staleEmbedding = state?.staleEmbedding;
  const scale = state?.scale;
  const failedCount = documents.filter((d) => d.status === 'failed').length;

  const handleToggle = useCallback(async () => {
    setActionError(null);
    try {
      const { setKnowledgeSpaceEnabled } = await import('@/lib/knowledgeClient');
      await setKnowledgeSpaceEnabled(!enabled, spaceId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [enabled, spaceId, refresh]);

  const handleUpload = useCallback(async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    setActionError(null);
    setUploadReport(null);
    try {
      const result = await uploadKnowledgeDocumentsWithSpace(list, spaceId);
      // BLOCK-94 F3：逐文件结果聚合（部分失败不再只显示第一个错误）
      setUploadReport({ accepted: result.accepted.length, rejected: result.rejected });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    await refresh();
  }, [spaceId, refresh]);

  const handlePaste = useCallback(async () => {
    if (!pasteText.trim() || pasting) return;
    setPasting(true);
    setActionError(null);
    setUploadReport(null);
    try {
      const { pasteKnowledgeDocument } = await import('@/lib/knowledgeClient');
      await pasteKnowledgeDocument(pasteName.trim(), pasteText, spaceId);
      setPasteOpen(false);
      setPasteName('');
      setPasteText('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPasting(false);
    }
    await refresh();
  }, [pasteName, pasteText, pasting, spaceId, refresh]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer?.files?.length) void handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  // BLOCK-94 F4：预览展开（逐文档懒取；切文档即换）
  const handlePreview = useCallback(async (doc: KnowledgeDoc) => {
    const next = previewId === doc.id ? null : doc.id;
    setPreviewId(next);
    setPreview(null);
    if (!next) return;
    setPreviewLoading(true);
    try {
      const result = await fetchKnowledgeDocumentPreview(doc.id);
      setPreview(result);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setPreviewId(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewId]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => (prev.size === documents.length ? new Set() : new Set(documents.map((d) => d.id))));
  }, [documents]);

  const handleBatchDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setActionError(null);
    try {
      const result = await batchDeleteKnowledgeDocuments([...selected]);
      if (result.missing.length > 0) {
        setActionError(`${result.deleted.length} 篇已删除，${result.missing.length} 篇不存在（已跳过）`);
      }
      setSelected(new Set());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [selected, refresh]);

  const handleRetryFailed = useCallback(async () => {
    setActionError(null);
    try {
      const result = await retryFailedKnowledgeDocuments();
      if (result.requeued === 0) setActionError('没有可重试的失败文档（原始文件缺失的已跳过）。');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [refresh]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

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
      await clearKnowledgeSpaceById(spaceId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }, [confirmClear, spaceId, refresh]);

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
    setSearchDegraded(false);
    setSearchTokens(splitQueryTokens(query));
    try {
      const result = await searchKnowledgeInSpace(query, spaceId, undefined, searchDocId || undefined);
      setSearchHits(result.hits);
      setSearchDegraded(!!result.ftsDegraded);
      if (result.readyChunks === 0) setSearchNote('知识库中没有匹配范围下的就绪分块（可能过滤条件过窄或尚未上传）。');
      else if (result.hits.length === 0 && !result.embeddingAvailable) setSearchNote('嵌入模型不可用，仅全文通道检索且本次无命中。');
      else if (result.hits.length === 0) setSearchNote('两条检索通道均无命中。');
    } catch (e) {
      setSearchHits(null);
      setSearchNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchDocId, searching, spaceId]);

  // BLOCK-94 F5：检索测试框的文档过滤下拉数据源（ready 文档）
  const filterableDocs = documents.filter((d) => d.status === 'ready');

  return (
    <div
      className={`${styles.panel} ${dragActive ? styles.dropActive : ''}`}
      data-testid="knowledge-panel"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className={styles.header}>
        <Icon name="brain" size={16} />
        <span className={styles.title}>{state?.space?.name || '知识空间'}</span>
        <span className={styles.headerNote}>启用后对话自动检索</span>
      </div>

      {/* BLOCK-99 P2 — 多空间切换/新建/重命名/删除 */}
      <KnowledgeSpaceSwitcher spaceId={spaceId} onSwitch={setSpaceId} onChanged={refresh} />

      {loadError && (
        <div className={styles.errorBox}>加载失败：{loadError}</div>
      )}

      {state && !embeddingAvailable && (
        <div className={styles.notice} data-testid="knowledge-embed-unavailable">
          配置 DashScope key（设置 → 模型）后可启用知识空间的语义检索。当前无法启用。
        </div>
      )}

      {state && enabled && !embeddingAvailable && (
        <div className={styles.notice} data-testid="knowledge-degraded-fts">
          嵌入模型当前不可用，自动召回降级为仅全文通道（仍可用，语义检索暂不可达）。
        </div>
      )}

      {state && scale && scale.scanWarning && (
        <div className={styles.notice} data-testid="knowledge-scale-warning">
          规模警戒：就绪分块 {scale.readyChunks} 已超过向量扫描观测阈值 {scale.scanWarnThreshold}（检索仍可用，性能评估见 BLOCK-94 plan §8）。
        </div>
      )}

      {state && staleEmbedding && staleEmbedding.staleChunks > 0 && (
        <div className={styles.notice} data-testid="knowledge-stale-embedding">
          嵌入模型已变更：{staleEmbedding.staleDocs} 篇文档的 {staleEmbedding.staleChunks} 个旧向量已被隔离（不影响全文检索），
          建议对这些文档执行「重建索引」。
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
            {documentsTotal} 篇文档 · {documents.filter((d) => d.status === 'ready').length} 篇就绪
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
          accept=".txt,.md,.markdown,.mdx,.rst,.log,.csv,.tsv,.json,.jsonl,.yaml,.yml,.toml,.ini,.xml,.html,.htm,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.r,.rmd,.ipynb,.sh,.bash,.zsh,.bat,.ps1,.sql,.css,.java,.c,.h,.cpp,.hpp,.go,.rs,.rb,.php,.lua,.pl,.m,.swift,.kt,.scala,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => void handleUpload(e.target.files)}
        />
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setPasteOpen((v) => !v)}
          data-testid="knowledge-paste-toggle"
        >
          <Icon name="pencil" size={13} />
          粘贴文本
        </button>
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

      {pasteOpen && (
        <div className={styles.pasteBox} data-testid="knowledge-paste-box">
          <input
            className={styles.pasteName}
            placeholder="文档名（可留空自动命名）"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
            data-testid="knowledge-paste-name"
          />
          <textarea
            className={styles.pasteText}
            placeholder="粘贴文本内容，入库后走同一条摄取管道（分块 + 嵌入 + 全文索引）"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            data-testid="knowledge-paste-text"
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={pasting || !pasteText.trim()}
              onClick={() => void handlePaste()}
              data-testid="knowledge-paste-submit"
            >
              {pasting ? '入库中…' : '确认入库'}
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => setPasteOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {uploadReport && uploadReport.rejected.length > 0 && (
        <div className={styles.errorBox} data-testid="knowledge-upload-report">
          上传完成：{uploadReport.accepted} 个成功，{uploadReport.rejected.length} 个被拒绝
          <ul className={styles.rejectedList}>
            {uploadReport.rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}>{r.name}：{r.error}</li>
            ))}
          </ul>
        </div>
      )}
      {uploadReport && uploadReport.rejected.length === 0 && (
        <div className={styles.notice} data-testid="knowledge-upload-report-ok">
          上传完成：{uploadReport.accepted} 个文档已进入摄取队列。
        </div>
      )}

      {actionError && <div className={styles.errorBox}>{actionError}</div>}

      {(documents.length > 0 || failedCount > 0) && (
        <div className={styles.batchBar} data-testid="knowledge-batch-bar">
          {documents.length > 0 && (
            <label className={styles.selectAll}>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === documents.length}
                onChange={toggleSelectAll}
                data-testid="knowledge-select-all"
              />
              全选
            </label>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              className={`${styles.ghostBtn} ${styles.dangerBtn}`}
              onClick={() => void handleBatchDelete()}
              data-testid="knowledge-batch-delete"
            >
              <Icon name="trash" size={13} />
              删除所选（{selected.size}）
            </button>
          )}
          {failedCount > 0 && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => void handleRetryFailed()}
              data-testid="knowledge-retry-failed"
            >
              <Icon name="refresh" size={13} />
              重试全部失败（{failedCount}）
            </button>
          )}
        </div>
      )}

      <div className={styles.docList} data-testid="knowledge-doc-list">
        {documents.length === 0 && (
          <div className={styles.empty}>还没有文档。上传 / 拖入 txt、md、代码、csv、pdf 等文件，或粘贴文本，开始构建知识库。</div>
        )}
        {documents.map((doc) => (
          <React.Fragment key={doc.id}>
            <div className={styles.docRow} data-testid="knowledge-doc-row">
              <input
                type="checkbox"
                className={styles.docCheck}
                checked={selected.has(doc.id)}
                onChange={() => toggleSelected(doc.id)}
                data-testid="knowledge-doc-check"
              />
              <div className={styles.docMain}>
                <button
                  type="button"
                  className={styles.docNameBtn}
                  title="展开全文预览"
                  onClick={() => void handlePreview(doc)}
                  data-testid="knowledge-doc-name"
                >
                  {doc.name}
                </button>
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
            {previewId === doc.id && (
              <div className={styles.previewBox} data-testid="knowledge-doc-preview">
                {previewLoading && <div className={styles.previewMeta}>预览加载中…</div>}
                {!previewLoading && preview && (
                  <>
                    <div className={styles.previewMeta}>
                      {preview.chunks.length > 0
                        ? `索引全文（${preview.chunks.length} 块）`
                        : '暂无索引文本（文档可能未成功摄取）'}
                      {preview.rawAvailable && (
                        <button
                          type="button"
                          className={styles.previewOpenRaw}
                          onClick={() => void window.biof3Desktop?.files?.openPath(preview.rawPath)}
                          data-testid="knowledge-doc-open-raw"
                        >
                          打开原文件
                        </button>
                      )}
                    </div>
                    {preview.chunks.map((chunk) => (
                      <div key={chunk.seq} className={styles.previewChunk}>
                        <span className={styles.previewSeq}>第 {chunk.seq + 1} 块</span>
                        {chunk.text}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </React.Fragment>
        ))}
        {documentsHasMore && (
          <div className={styles.loadMoreRow}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setDocLimit((l) => l + 50)}
              data-testid="knowledge-load-more"
            >
              加载更多（已显示 {documents.length} / {documentsTotal}）
            </button>
          </div>
        )}
      </div>

      <div className={styles.searchBox}>
        <div className={styles.searchTitle}>检索测试</div>
        {filterableDocs.length > 0 && (
          <select
            className={styles.searchFilter}
            value={searchDocId}
            onChange={(e) => setSearchDocId(e.target.value)}
            data-testid="knowledge-search-doc-filter"
          >
            <option value="">全部文档</option>
            {filterableDocs.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
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
        {searchDegraded && (
          <div className={styles.searchNote} data-testid="knowledge-search-degraded">
            查询语法无法进入全文索引（纯符号或过短），已降级为子串匹配。
          </div>
        )}
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
                <div className={styles.hitText}>
                  <HighlightedText text={hit.text.slice(0, 220) + (hit.text.length > 220 ? '…' : '')} tokens={searchTokens} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeSpacePanel;
