/**
 * KnowledgeDocLibrary — BLOCK-103 P2 文档库页签（自 KnowledgeSpacePanel 拆出）
 *
 * 承接 BLOCK-94 F3/F4 全部能力：上传（含拖拽 hero）/粘贴入库/逐文件错误聚合/
 * 批量选择删除/失败重试/全文预览/逐文档重建索引/删除/清空两步确认。
 * 空态 = hero 大 dropzone（双 CTA 内嵌），有文档 = 工具行 + 列表。
 * 交互局部状态内聚于此；数据由 KnowledgeSpacePanel 持有，变更经 onChanged 上抛刷新。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  batchDeleteKnowledgeDocuments,
  clearKnowledgeSpaceById,
  deleteKnowledgeDocument,
  fetchKnowledgeDocumentPreview,
  reindexKnowledgeDocument,
  retryFailedKnowledgeDocuments,
  uploadKnowledgeDocumentsWithSpace,
  type KnowledgeDoc,
  type KnowledgeDocPreview,
} from '@/lib/knowledgeClient';
import { formatBytes, STATUS_LABEL } from './knowledge-utils';
import styles from './KnowledgeSpacePanel.module.css';

export function KnowledgeDocLibrary({
  spaceId,
  documents,
  documentsTotal,
  documentsHasMore,
  knowledgeDir,
  onLoadMore,
  onChanged,
}: {
  spaceId: string;
  documents: KnowledgeDoc[];
  documentsTotal: number;
  documentsHasMore: boolean;
  knowledgeDir?: string;
  onLoadMore: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState<{ accepted: number; rejected: Array<{ name: string; error: string }> } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<KnowledgeDocPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmpty = documents.length === 0;
  const failedCount = documents.filter((d) => d.status === 'failed').length;

  // 清空两步确认 3s 复位（BLOCK-64 先例）
  useEffect(() => {
    if (!confirmClear) return;
    clearTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [confirmClear]);

  // 切空间后清交互局部状态（选择集/预览/报告不复用上一个空间的上下文）
  useEffect(() => {
    setSelected(new Set());
    setPreviewId(null);
    setPreview(null);
    setUploadReport(null);
    setActionError(null);
  }, [spaceId]);

  const handleUpload = useCallback(async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    setActionError(null);
    setUploadReport(null);
    try {
      const result = await uploadKnowledgeDocumentsWithSpace(list, spaceId);
      setUploadReport({ accepted: result.accepted.length, rejected: result.rejected });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    onChanged();
  }, [spaceId, onChanged]);

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
    onChanged();
  }, [pasteName, pasteText, pasting, spaceId, onChanged]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer?.files?.length) void handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

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
    onChanged();
  }, [selected, onChanged]);

  const handleRetryFailed = useCallback(async () => {
    setActionError(null);
    try {
      const result = await retryFailedKnowledgeDocuments();
      if (result.requeued === 0) setActionError('没有可重试的失败文档（原始文件缺失的已跳过）。');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    onChanged();
  }, [onChanged]);

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
    onChanged();
  }, [onChanged]);

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
    onChanged();
  }, [onChanged]);

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
    onChanged();
  }, [confirmClear, spaceId, onChanged]);

  const handleOpenDir = useCallback(() => {
    if (knowledgeDir) {
      void window.biof3Desktop?.files?.openPath(knowledgeDir);
    }
  }, [knowledgeDir]);

  const uploadButton = (variant: 'primary' | 'hero') => (
    <button
      type="button"
      className={variant === 'hero' ? styles.heroPrimaryBtn : styles.primaryBtn}
      disabled={uploading}
      onClick={() => fileInputRef.current?.click()}
      data-testid="knowledge-upload"
    >
      <Icon name="arrow-up" size={13} />
      {uploading ? '上传中…' : '上传文档'}
    </button>
  );

  const pasteToggle = (variant: 'ghost' | 'hero') => (
    <button
      type="button"
      className={variant === 'hero' ? styles.heroGhostBtn : styles.ghostBtn}
      onClick={() => setPasteOpen((v) => !v)}
      data-testid="knowledge-paste-toggle"
    >
      <Icon name="pencil" size={13} />
      粘贴文本
    </button>
  );

  return (
    <div
      className={`${styles.library} ${dragActive ? styles.dropActive : ''}`}
      data-testid="knowledge-doc-library"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.mdx,.rst,.log,.csv,.tsv,.json,.jsonl,.yaml,.yml,.toml,.ini,.xml,.html,.htm,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.r,.rmd,.ipynb,.sh,.bash,.zsh,.bat,.ps1,.sql,.css,.java,.c,.h,.cpp,.hpp,.go,.rs,.rb,.php,.lua,.pl,.m,.swift,.kt,.scala,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => void handleUpload(e.target.files)}
      />

      {isEmpty ? (
        <div className={styles.hero} data-testid="knowledge-empty-hero">
          <div className={styles.heroIcon}>
            <Icon name="brain" size={26} />
          </div>
          <div className={styles.heroTitle}>构建你的知识库</div>
          <p className={styles.heroText}>
            上传或拖入 txt、md、代码、csv、pdf 等文件，或直接粘贴文本。
            启用知识空间后，对话会自动检索这里的内容作为回答依据。
          </p>
          <div className={styles.heroCtas}>
            {uploadButton('hero')}
            {pasteToggle('hero')}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            {uploadButton('primary')}
            {pasteToggle('ghost')}
            <button type="button" className={styles.ghostBtn} onClick={handleOpenDir} title={knowledgeDir || ''}>
              <Icon name="folder" size={13} />
              打开知识目录
            </button>
            <button
              type="button"
              className={`${styles.ghostBtn} ${confirmClear ? styles.dangerBtn : ''}`}
              onClick={() => void handleClear()}
              data-testid="knowledge-clear"
            >
              <Icon name="trash" size={13} />
              {confirmClear ? '确认清空？' : '清空空间'}
            </button>
          </div>

          {(documents.length > 0 || failedCount > 0) && (
            <div className={styles.batchBar} data-testid="knowledge-batch-bar">
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === documents.length}
                  onChange={toggleSelectAll}
                  data-testid="knowledge-select-all"
                />
                全选
              </label>
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
                  onClick={onLoadMore}
                  data-testid="knowledge-load-more"
                >
                  加载更多（已显示 {documents.length} / {documentsTotal}）
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 上传报告 / 动作错误：hero 与列表两态共用（空态首传也立即可见） */}
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
    </div>
  );
}

