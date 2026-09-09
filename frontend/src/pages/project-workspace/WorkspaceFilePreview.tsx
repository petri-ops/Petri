// ============================================================
// WorkspaceFilePreview — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2414-2874 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// UI-305 P1 — sanitize schema（原 project-workspace.tsx 模块级常量，唯一消费方随迁）
const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
    div: [...(defaultSchema.attributes?.div || []), ['className']],
  },
};
import { Icon, type IconName } from '@/components/icons/Icon';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import { Lightbox } from '@/components/ui/Lightbox';
import { HighlightedCode, codeLanguageForFile } from '@/components/ui/CodeHighlight';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import type { DiffRevision, EditorApi } from '@/components/editor/CodeMirror/types';
import { WorkspaceFilePreviewBridge } from '@/components/editor';
import { useTheme } from '@/themes/ThemeProvider';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';
import { getBridge } from '@/lib/desktopBridge';
import {
  describeOfficeKind,
  loadOfficePreview,
  revokeOfficePreviewBlobs,
  suggestedOpener,
  type OfficePreviewAsset,
  type OfficePreviewKind,
  type OfficePreviewModel,
} from '@/lib/office-file-preview';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile } from './types';
import { BinaryPreviewCard } from './BinaryPreviewCard';
import { OfficePreviewPane } from './OfficePreviewPane';
import { isCsvFile, isPdfFile, isHtmlFile, isJsonFile, withReportTheme, detectOfficeKind, fallbackKindForExtension, formatSize } from './helpers';

export function WorkspaceFilePreview({
  file,
  refreshVersion,
  openError,
  opening,
  onOpen,
  onDownload,
  onOpenFile,
  projectId,
}: {
  file: ActiveWorkspaceFile | null;
  refreshVersion: number;
  openError: string;
  opening: boolean;
  onOpen: () => void | Promise<void>;
  onDownload: () => void;
  onOpenFile?: (file: ActiveWorkspaceFile) => void;
  projectId?: string;
}): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<OfficePreviewModel | null>(null);
  const [officeStatus, setOfficeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // BLOCK-20 — tracks the last-saved text so isDirty can compare against it
  const [textSaved, setTextSaved] = useState<string>('');
  // BLOCK-67 — ssh 远程保存的诚实错误面（409 冲突 / 断线 502）
  const [saveError, setSaveError] = useState<string>('');
  // BLOCK-21 — Markdown view toggle: 'edit' | 'preview'; resets on file switch
  const [mdView, setMdView] = useState<'edit' | 'preview'>('preview');
  // BLOCK-52 P1（选中即引用）：编辑器命令面 + 预览容器内选中状态跟踪。
  const editorApiRef = useRef<EditorApi | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const [hasPreviewSelection, setHasPreviewSelection] = useState(false);

  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      const host = previewBodyRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !host || !sel.anchorNode) {
        setHasPreviewSelection(false);
        return;
      }
      // CodeMirror 选中会同步到 DOM selection；统一按「选区在预览容器内」判定。
      setHasPreviewSelection(host.contains(sel.anchorNode) && host.contains(sel.focusNode));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // BLOCK-52 P1（选中即引用）：把选中文字派发给 SimpleChat composer。
  // CodeMirror 选区优先（带行号）；Markdown 渲染视图等场景退回 DOM selection（无行号）。
  const handleQuoteSelection = useCallback(() => {
    if (!file) return;
    const cmSel = editorApiRef.current?.getSelection();
    if (cmSel && cmSel.text.trim()) {
      dispatchGewuEvent(gewuEvents.selectionQuote, {
        projectId,
        path: file.path,
        name: file.name,
        startLine: cmSel.startLine,
        endLine: cmSel.endLine,
        text: cmSel.text,
      });
      return;
    }
    const domSel = window.getSelection();
    const host = previewBodyRef.current;
    const text = domSel?.toString() ?? '';
    if (
      domSel && !domSel.isCollapsed && text.trim()
      && host && domSel.anchorNode && host.contains(domSel.anchorNode)
    ) {
      dispatchGewuEvent(gewuEvents.selectionQuote, {
        projectId,
        path: file.path,
        name: file.name,
        text,
      });
    }
  }, [file, projectId]);

  const isImage = isImageFile(file?.name);
  const isText = isTextFile(file?.name);
  const isMarkdown = isMarkdownFile(file?.name);
  const isCsv = isCsvFile(file?.name);
  const isPdf = isPdfFile(file?.name);
  const isHtml = isHtmlFile(file?.name);
  const isJson = isJsonFile(file?.name);
  const officeKind = detectOfficeKind(file?.name);
  const codeLanguage = codeLanguageForFile(file?.name);
  const previewUrl = useMemo(() => {
    if (!file?.url) return '';
    const separator = file.url.includes('?') ? '&' : '?';
    return `${file.url}${separator}workspaceRevision=${refreshVersion}`;
  }, [file?.url, refreshVersion]);

  // BLOCK-52 P2（图片/结果图引用）：把当前预览图片派发给 SimpleChat composer。
  const handleQuoteImage = useCallback(() => {
    if (!file || !previewUrl) return;
    dispatchGewuEvent(gewuEvents.imageQuote, {
      projectId,
      kind: 'workspace-file',
      name: file.name,
      path: file.path,
      url: previewUrl,
    });
  }, [file, previewUrl, projectId]);

  useEffect(() => {
    let cancelled = false;
    setText('');
    setPreviewData(null);
    setOfficePreview(null);
    setOfficeStatus('idle');
    if (!file) {
      setStatus('idle');
      return () => { cancelled = true; };
    }
    if (isImage || isPdf || isHtml) {
      setStatus('ready');
      return () => { cancelled = true; };
    }
    if (officeKind) {
      setOfficeStatus('loading');
      loadOfficePreview({
        url: previewUrl,
        name: file.name,
        authToken: getToken() || undefined,
      })
        .then((model) => {
          if (cancelled) return;
          setOfficePreview(model);
          setOfficeStatus(model.fallback ? 'error' : 'ready');
          setStatus(model.fallback ? 'unsupported' : 'ready');
        })
        .catch(() => {
          if (cancelled) return;
          setOfficePreview(null);
          setOfficeStatus('error');
          setStatus('unsupported');
        });
      return () => { cancelled = true; revokeOfficePreviewBlobs(); };
    }
    if (!isText && !isCsv && !isJson) {
      setStatus('unsupported');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    fetch(previewUrl, { cache: 'no-store' })
      .then((resp) => {
        if (!resp.ok) throw new Error('preview failed');
        return resp.text();
      })
      .then((body) => {
        if (cancelled) return;
        if (isCsv) {
          setPreviewData(buildPreviewTable(body, file.name, { maxRows: 200 }));
          setStatus('ready');
          return;
        }
        const clipped = body.length > 120_000
          ? `${body.slice(0, 120_000)}\n\n... 文件较大，仅预览前 120KB`
          : body;
        // BLOCK-42 P4：打开文件时同步保存基线。此前 textSaved 恒为 ''，
        // 文本/JSON/markdown 文件一打开就误报「有未保存修改」（BLOCK-20 遗留缺陷，
        // 实机走查暴露）。基线=打开时的格式化内容，恢复语义不变（回退到已加载内容）。
        const formatted = formatPreviewText(file.name, clipped);
        setText(formatted);
        setTextSaved(formatted);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [file, isCsv, isHtml, isImage, isJson, isPdf, isText, officeKind, previewUrl]);

  // BLOCK-20 — 文件切换时重置保存基准线和 Markdown 视图
  useEffect(() => {
    setTextSaved('');
    setMdView('preview');
  }, [file?.path]);

  const handleSaveCurrent = useCallback(async () => {
    if (!file) return;
    try {
      // BLOCK-67：ssh 项目无本地 workspaceDir —— 保存走 REST PUT 直写远程（write-through，
      // 冲突/断线诚实呈现，不本地暂存）；local 项目沿用既有 IPC 通道（零回归）。
      if (file.workspaceKind === 'ssh') {
        if (!projectId) return;
        const resp = await fetch(
          `${getApiPrefix()}/workspaces/${projectId}/file?path=${encodeURIComponent(file.path)}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
            body: JSON.stringify({ content: text }),
          }
        );
        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          setSaveError(data?.error || `保存失败（HTTP ${resp.status}）`);
          return;
        }
        setSaveError('');
        setTextSaved(text);
        return;
      }
      if (file.workspaceDir) {
        const wbridge = getBridge('workspace');
        if (!wbridge) return;
        const resp = await wbridge.writeTextFile(file.workspaceDir, file.path, text);
        if (!resp.ok) return;
      }
      setSaveError('');
      setTextSaved(text);
    } catch {
      setSaveError('保存失败：远程连接异常');
    }
  }, [file, projectId, text]);

  const handleDiscard = useCallback(() => {
    if (!file) return;
    setText(textSaved);
  }, [file, textSaved]);

  if (!file) {
    return (
      <div className={styles.workspacePreviewEmpty}>
        <Icon name="file" size={18} />
        <span>选择一个文本、图片或 PDF 文件预览</span>
      </div>
    );
  }

  const fallbackKind: 'csv' | 'pdf' | 'html' | 'json' | 'markdown' | 'image' | 'text' | 'binary' =
    isCsv ? 'csv'
    : isPdf ? 'pdf'
    : isHtml ? 'html'
    : isJson ? 'json'
    : isMarkdown ? 'markdown'
    : isImage ? 'image'
    : isText ? 'text'
    : 'binary';

  return (
    <div className={styles.workspacePreview}>
      {openError && <div className={styles.workspacePreviewError}>{openError}</div>}
      <div className={styles.workspacePreviewBody} ref={previewBodyRef}>
        {(isMarkdown || fallbackKind === 'text' || fallbackKind === 'json') && (
          <div className={styles.workspaceMarkdownDiffToolbar}>
            {isMarkdown && (
              <div className={styles.workspaceMarkdownDiffTabs}>
                <button
                  type="button"
                  className={`${styles.workspaceMarkdownDiffTab} ${mdView === 'edit' ? styles.workspaceMarkdownDiffTabActive : ''}`}
                  onClick={() => setMdView('edit')}
                  aria-pressed={mdView === 'edit'}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className={`${styles.workspaceMarkdownDiffTab} ${mdView === 'preview' ? styles.workspaceMarkdownDiffTabActive : ''}`}
                  onClick={() => setMdView('preview')}
                  aria-pressed={mdView === 'preview'}
                >
                  预览
                </button>
              </div>
            )}
            <div className={styles.workspaceMarkdownDiffActions}>
              {/* BLOCK-52 P1（选中即引用）：选中预览文字后一键引用到对话 composer */}
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                disabled={!hasPreviewSelection}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleQuoteSelection}
                title="把选中文字引用到对话"
              >
                引用到对话
              </button>
              {text !== textSaved && (
                <span className={styles.workspaceMarkdownDiffHint}>有未保存修改</span>
              )}
              {saveError && (
                <span
                  className={styles.workspaceMarkdownDiffHint}
                  role="alert"
                  data-testid="ssh-save-error"
                  style={{ color: 'var(--color-danger, #d54949)' }}
                >
                  {saveError}
                </span>
              )}
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                disabled={text === textSaved}
                onClick={() => void handleSaveCurrent()}
                title="保存到文件"
              >
                保存
              </button>
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                disabled={text === textSaved}
                onClick={() => void handleDiscard()}
                title="放弃修改"
              >
                恢复
              </button>
            </div>
          </div>
        )}
        {status === 'loading' && <p className={styles.panelEmpty}>加载预览…</p>}
        {status === 'error' && <p className={styles.panelEmpty}>预览失败</p>}
        {status === 'unsupported' && !officePreview && (
          <BinaryPreviewCard
            file={file}
            opening={opening}
            onOpen={onOpen}
            onDownload={onDownload}
          />
        )}
        {status === 'unsupported' && officePreview && officePreview.fallback && (
          <BinaryPreviewCard
            file={file}
            opening={opening}
            onOpen={onOpen}
            onDownload={onDownload}
            reason={officePreview.fallback.reason}
          />
        )}
        {officeStatus === 'loading' && (
          <p className={styles.panelEmpty}>解析 {file.name} 的内容…</p>
        )}
        {officeStatus === 'ready' && officePreview && !officePreview.fallback && (
          <OfficePreviewPane preview={officePreview} onAssetOpen={setLightboxSrc} />
        )}
        {status === 'ready' && fallbackKind === 'image' && (
          <>
            <div className={styles.workspaceMarkdownDiffActions}>
              {/* BLOCK-52 P2（图片/结果图引用）：把当前预览图片引用到对话 composer */}
              <button
                type="button"
                className={styles.workspaceMarkdownSave}
                onClick={handleQuoteImage}
                title="把这张图片引用到对话"
              >
                引用到对话
              </button>
            </div>
            <button className={styles.workspaceImageButton} onClick={() => setLightboxSrc(previewUrl)}>
              <img src={previewUrl} alt={file.name} className={styles.workspaceImagePreview} />
            </button>
          </>
        )}
        {status === 'ready' && fallbackKind === 'pdf' && (
          <object
            data={previewUrl}
            type="application/pdf"
            className={styles.workspacePdfObject}
            aria-label={file.name}
          >
            <iframe
              src={previewUrl}
              title={file.name}
              className={styles.workspacePdfIframe}
            />
          </object>
        )}
        {status === 'ready' && fallbackKind === 'html' && (
          <iframe
            src={withReportTheme(previewUrl, resolvedTheme)}
            title={file.name}
            className={styles.workspaceHtmlIframe}
            sandbox=""
          />
        )}
        {status === 'ready' && fallbackKind === 'csv' && previewData && previewData.length > 0 && (
          <div className={styles.workspaceCsvPreview}>
            <table>
              <thead>
                <tr>
                  {previewData[0].map((cell, idx) => (
                    <th key={`${cell || 'col'}-${idx}`}>{cell || `列 ${idx + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.slice(1, 41).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {previewData[0].map((_, cellIndex) => (
                      <td key={cellIndex}>{row[cellIndex] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewData.length > 41 && (
              <p className={styles.workspaceCsvHint}>
                已展示前 40 行 / 共 {previewData.length - 1} 行，完整数据请在外部工具打开。
              </p>
            )}
          </div>
        )}
        {status === 'ready' && fallbackKind === 'markdown' && mdView === 'preview' && (
          <div className={styles.workspaceMarkdownPreview}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, markdownSanitizeSchema]]}
              components={{
                a: ({ href, children, ...props }) => {
                  if (!href || !onOpenFile || !file) return <a {...props} href={href}>{children}</a>;
                  // Skip external links and anchors
                  if (href.startsWith('http') || href.startsWith('mailto') || href.startsWith('#')) {
                    return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                  }
                  // Resolve relative path against current file's directory
                  const fileDir = file.path.split('/').slice(0, -1).join('/');
                  const resolvedPath = fileDir ? `${fileDir}/${href}` : href;
                  const normalizedPath = resolvedPath.replace(/\/+/g, '/').replace(/\/\.\//g, '/');
                  const linkedFile: ActiveWorkspaceFile = {
                    path: normalizedPath,
                    name: normalizedPath.split('/').pop() || normalizedPath,
                    url: getApiPrefix() + `/workspaces/${encodeURIComponent(projectId || '')}/file?path=${encodeURIComponent(normalizedPath)}`,
                  };
                  return (
                    <a
                      {...props}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenFile(linkedFile);
                      }}
                      style={{ color: 'var(--gewu-accent, #4f86ff)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
        {status === 'ready' && fallbackKind === 'markdown' && mdView === 'edit' && (
          /* BLOCK-42 — pending-scroll 消费侧挂载：textarea → CodeMirror（跳转/pulse 联动） */
          <WorkspaceFilePreviewBridge
            filePath={file.path}
            value={text}
            language="markdown"
            readonly={false}
            className={styles.workspaceCodeEditor}
            onChange={setText}
            editorRef={editorApiRef}
          />
        )}
        {status === 'ready' && fallbackKind === 'text' && (
          /* BLOCK-42 — 同上：文本/代码预览切 CodeMirror */
          <WorkspaceFilePreviewBridge
            filePath={file.path}
            value={text}
            language={codeLanguage || undefined}
            readonly={false}
            className={styles.workspaceCodeEditor}
            onChange={setText}
            editorRef={editorApiRef}
          />
        )}
        {status === 'ready' && fallbackKind === 'json' && (
          /* BLOCK-42 — 同上：JSON 预览切 CodeMirror */
          <WorkspaceFilePreviewBridge
            filePath={file.path}
            value={text}
            language="json"
            readonly={false}
            className={styles.workspaceCodeEditor}
            onChange={setText}
            editorRef={editorApiRef}
          />
        )}
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
