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

// UI-400-6 — Markdown 目录解析：1-3 级标题，跳过 ```/~~~ 围栏内伪标题。
// 点击跳转按 DOM 顺序对齐（渲染后的 h1-h3 顺序即解析顺序），不做 id 注入。
function parseMdHeadings(text: string): Array<{ level: 1 | 2 | 3; text: string }> {
  const items: Array<{ level: 1 | 2 | 3; text: string }> = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    items.push({ level: m[1].length as 1 | 2 | 3, text: m[2].replace(/`/g, '').trim() });
  }
  return items;
}

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
  // BLOCK-67 D3 — 远程 mtime 基线（打开时来自树条目，保存成功后滚动为最新）
  const savedMtimeRef = useRef<number | null>(null);
  // BLOCK-21 — Markdown view toggle: 'edit' | 'preview'; resets on file switch
  const [mdView, setMdView] = useState<'edit' | 'preview'>('preview');
  // UI-400-6 — MD 预览左侧悬浮目录开关（默认展开，点击隐藏/再展开）
  const [mdTocOpen, setMdTocOpen] = useState(true);
  // BLOCK-42 — pending-scroll 消费侧挂载（跳转/pulse 联动）
  const editorApiRef = useRef<EditorApi | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);

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

  // BLOCK-52 P2 头部「引用到对话」按钮已随 BLOCK-74 用户裁决退役（图片引用行删除）。

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
    savedMtimeRef.current = null;
    setMdTocOpen(true);
  }, [file?.path]);

  // UI-400-6 — MD 目录：预览态解析 1-3 级标题；跳转按渲染 DOM 的 h1-h3 顺序对齐
  const mdTocItems = useMemo(
    () => (isMarkdown && mdView === 'preview' && status === 'ready' ? parseMdHeadings(text) : []),
    [isMarkdown, mdView, status, text]
  );
  const jumpToMdHeading = useCallback((index: number) => {
    const nodes = previewBodyRef.current?.querySelectorAll(
      '.workspaceMarkdownPreview h1, .workspaceMarkdownPreview h2, .workspaceMarkdownPreview h3'
    );
    nodes?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSaveCurrent = useCallback(async () => {
    if (!file) return;
    try {
      // BLOCK-67：ssh 项目无本地 workspaceDir —— 保存走 REST PUT 直写远程（write-through，
      // 冲突/断线诚实呈现，不本地暂存）；local 项目沿用既有 IPC 通道（零回归）。
      // D3 冲突检测：expectedMtimeMs = 打开时的树基线（file.modifiedAt），保存成功后
      // 滚动为服务端返回的最新 mtime（后续连续保存不再误判自身写入）。
      if (file.workspaceKind === 'ssh') {
        if (!projectId) return;
        const baseline = savedMtimeRef.current ?? file.modifiedAt;
        const resp = await fetch(
          `${getApiPrefix()}/workspaces/${projectId}/file?path=${encodeURIComponent(file.path)}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
            body: JSON.stringify({
              content: text,
              ...(typeof baseline === 'number' ? { expectedMtimeMs: baseline } : {}),
            }),
          }
        );
        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          setSaveError(data?.error || `保存失败（HTTP ${resp.status}）`);
          return;
        }
        const data = await resp.json().catch(() => null);
        savedMtimeRef.current = data?.stat?.mtimeMs ?? null;
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

  // BLOCK-74 修复（UI-323 回归）：自动保存 effect 与 Ctrl+S 回调必须在 `if (!file)` 提前返回
  // 之前注册——否则无文件 → 打开文件的首次渲染 Hook 数从 N 变 N+2，React 抛
  // "Rendered more hooks" 导致整窗白屏（实机点击 md 复现）。
  const fallbackKind: 'csv' | 'pdf' | 'html' | 'json' | 'markdown' | 'image' | 'text' | 'binary' =
    isCsv ? 'csv'
    : isPdf ? 'pdf'
    : isHtml ? 'html'
    : isJson ? 'json'
    : isMarkdown ? 'markdown'
    : isImage ? 'image'
    : isText ? 'text'
    : 'binary';

  // BLOCK-74 — 自动保存：文本族编辑停顿 1.2s 后自动落盘（保存链不变：local IPC / ssh REST + D3 冲突诚实面）。
  // 成功静默（自动保存心智：无声 = 已保存），失败红字 alert 保留（见下方 saveError 渲染）。
  useEffect(() => {
    if (status !== 'ready') return;
    if (text === textSaved) return;
    if (!(fallbackKind === 'markdown' || fallbackKind === 'text' || fallbackKind === 'json')) return;
    const timer = window.setTimeout(() => { void handleSaveCurrent(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [status, text, textSaved, fallbackKind, handleSaveCurrent]);

  // BLOCK-74 — Ctrl/Cmd+S 立即保存（容器级 keydown：CodeMirror 键盘事件冒泡可达；拦截浏览器默认保存）
  const handlePreviewKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (text !== textSaved) void handleSaveCurrent();
    }
  }, [text, textSaved, handleSaveCurrent]);

  if (!file) {
    return (
      <div className={styles.workspacePreviewEmpty}>
        <Icon name="file" size={18} />
        <span>选择一个文本、图片或 PDF 文件预览</span>
      </div>
    );
  }

  return (
    <div className={styles.workspacePreview}>
      {openError && <div className={styles.workspacePreviewError}>{openError}</div>}
      <div className={styles.workspacePreviewBody} ref={previewBodyRef} onKeyDown={handlePreviewKeyDown}>
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
            {/* BLOCK-74 — 图片头部「引用到对话」行随用户裁决移除 */}
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
      {/* UI-323 加映（用户裁决 2026-09-10）：编辑/预览切换收为右上角悬浮图标，工具条行整体退役——
          预览态铅笔进编辑，编辑态眼睛回渲染；保存失败红字条悬浮顶部（仅出错时出现，不再占常驻行） */}
      {isMarkdown && status === 'ready' && (
        <button
          type="button"
          className={styles.workspaceMdViewToggle}
          onClick={() => setMdView(mdView === 'edit' ? 'preview' : 'edit')}
          aria-pressed={mdView === 'edit'}
          aria-label={mdView === 'edit' ? '预览' : '编辑'}
          title={mdView === 'edit' ? '预览' : '编辑'}
          data-testid="md-view-toggle"
        >
          <Icon name={mdView === 'edit' ? 'eye' : 'pencil'} size={14} />
        </button>
      )}
      {saveError && (isMarkdown || fallbackKind === 'text' || fallbackKind === 'json') && (
        <div className={styles.workspaceSaveErrorStrip} role="alert" data-testid="ssh-save-error">
          {saveError}
        </div>
      )}
      {/* UI-400-6 — MD 预览左侧悬浮目录：开关悬挂左上角，点击隐藏/再展开，条目点击平滑跳转 */}
      {isMarkdown && status === 'ready' && mdView === 'preview' && mdTocItems.length > 0 && (
        <>
          <button
            type="button"
            className={styles.workspaceMdTocToggle}
            onClick={() => setMdTocOpen((v) => !v)}
            aria-pressed={mdTocOpen}
            aria-label="文档目录"
            title={mdTocOpen ? '隐藏目录' : '展开目录'}
            data-testid="md-toc-toggle"
          >
            <Icon name="panel-left" size={14} />
          </button>
          {mdTocOpen && (
            <nav className={styles.workspaceMdTocPanel} aria-label="文档目录">
              {mdTocItems.map((item, index) => (
                <button
                  key={`${item.text}-${index}`}
                  type="button"
                  className={styles.workspaceMdTocItem}
                  data-level={item.level}
                  title={item.text}
                  onClick={() => jumpToMdHeading(index)}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          )}
        </>
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
