// ============================================================
// CommitDiffFileView - UI-305 P2 extracted from ReviewMode.tsx (lines 69-222),
// behavior unchanged; main file imports it back as needed.
// ============================================================
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getBridge } from '@/lib/desktopBridge';
import { CodeMirrorEditor } from '@/components/editor';
import type { DiffRevision } from '@/components/editor/CodeMirror/types';
import { type DiffFile } from './useWorkingTreeReview';
import { CodeMirrorDiffView } from './CodeMirrorDiffView';
import {
  FULLTEXT_LANGUAGE_BY_EXT,
  type BlameData,
  type CommitFileViewMode,
} from './reviewModeHelpers';

export function CommitDiffFileView({ hash, file, fromRef = null, toRef = null }: { hash: string; file: DiffFile; fromRef?: string | null; toRef?: string | null }) {
  const [revision, setRevision] = useState<DiffRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CommitFileViewMode>('diff');
  // BLOCK-29.5 — blame 逐行归属（第四态，该提交时点版本）
  const [blameData, setBlameData] = useState<BlameData | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [blameError, setBlameError] = useState<string | null>(null);
  // BLOCK-32 — 项目级审阅隔离
  const { projectId } = useParams<{ projectId?: string }>();

  useEffect(() => {
    if (file.binary) return;
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevision(null);
    setViewMode('diff');
    setBlameData(null);
    setBlameError(null);
    bridge.commitFileContent(fromRef && toRef ? { path: file.path, fromRef, toRef, projectId } : { hash, path: file.path, projectId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setRevision({
            filePath: file.path,
            originalText: res.data.original,
            modifiedText: res.data.modified,
          });
        } else {
          setError(res.message || res.error || '加载提交文件内容失败。');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [hash, file.path, file.binary]);

  useEffect(() => {
    if (viewMode !== 'blame') return;
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setBlameLoading(true);
    setBlameError(null);
    setBlameData(null);
    bridge.blame({ path: file.path, ref: hash })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setBlameData(res.data);
        else setBlameError(res.message || res.error || '加载 blame 失败。');
      })
      .catch((e: unknown) => {
        if (!cancelled) setBlameError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBlameLoading(false);
      });
    return () => { cancelled = true; };
  }, [viewMode, hash, file.path]);

  if (file.binary) return <div className="wt-file-binary">二进制文件变更</div>;
  if (loading) return <div className="wt-diff-loading">差异加载中…</div>;
  if (error) return <div className="wt-diff-error" role="alert">{error}</div>;
  if (!revision) return null;
  const hasOriginal = revision.originalText.length > 0;
  const viewOptions: Array<{ key: CommitFileViewMode; label: string; title: string; disabled?: boolean }> = [
    { key: 'diff', label: 'diff', title: '差异视图' },
    { key: 'fullModified', label: '全文·改动后', title: '该提交时点的文件全文' },
    {
      key: 'fullOriginal',
      label: '全文·改动前',
      title: hasOriginal ? '父提交时点的文件全文' : '新增文件没有改动前版本',
      disabled: !hasOriginal,
    },
    { key: 'blame', label: 'blame', title: '逐行归属（该提交时点版本）' },
  ];
  return (
    <div className="rvw-commit-file-view">
      <div className="rvw-viewmode-toggle" role="group" aria-label="文件视图切换">
        {viewOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`rvw-viewmode-btn${viewMode === opt.key ? ' active' : ''}`}
            aria-pressed={viewMode === opt.key}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => setViewMode(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {viewMode === 'diff' ? (
        <CodeMirrorDiffView
          filePath={file.path}
          isBinary={file.binary}
          hunks={file.hunks}
          revisionOverride={revision}
        />
      ) : viewMode === 'blame' ? (
        <div className="rvw-fulltext-wrap" data-testid="rvw-blame">
          {blameLoading && <div className="wt-diff-loading">归属加载中…</div>}
          {blameError && <div className="wt-diff-error" role="alert">{blameError}</div>}
          {blameData && (() => {
            const contentLines = revision.modifiedText.split('\n');
            const day = (iso: string) => (iso ? iso.slice(0, 10) : '');
            return (
              <div className="rvw-blame-grid">
                {blameData.lines.map((l) => {
                  const c = blameData.commits[l.sha];
                  return (
                    <div key={l.line} className="rvw-blame-row" title={c ? c.subject : ''}>
                      <span className="rvw-blame-line">{l.line}</span>
                      <span className="rvw-blame-meta">
                        <span className="rvw-blame-sha">{l.sha}</span>
                        <span className="rvw-blame-author">{c ? c.author : ''} · {c ? day(c.isoDate) : ''}</span>
                      </span>
                      <span className="rvw-blame-content">{contentLines[l.line - 1] ?? ''}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {blameData?.truncated && <div className="wt-empty">文件超过 5000 行，仅显示前 5000 行归属。</div>}
        </div>
      ) : (
        <div className="rvw-fulltext-wrap" data-testid="rvw-fulltext">
          <CodeMirrorEditor
            value={viewMode === 'fullModified' ? revision.modifiedText : revision.originalText}
            language={FULLTEXT_LANGUAGE_BY_EXT[file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase()]}
            className="rvw-fulltext-editor"
          />
        </div>
      )}
    </div>
  );
}

/**
 * UI-231 — 历史列表行内展开的提交详情（自包含）：
 * 自行拉取 commitDiff 与选中文件全文，展开在触发行正下方；列表不跳转、可同开多条。
 * UI-233 — 详情头不再重复 subject/作者·时间（行上已有）；汇总统计经 onSummary
 * 上移到行展示；展开区直接以完整提交说明开始。
 */
