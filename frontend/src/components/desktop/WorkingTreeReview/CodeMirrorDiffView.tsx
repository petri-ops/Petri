import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { CodeMirrorEditor } from '@/components/editor/CodeMirror/CodeMirrorEditor';
import type { DiffRevision, EditorApi } from '@/components/editor/CodeMirror/types';
import { getBridge } from '@/lib/desktopBridge';
import { createHunkControlsExtension, type HunkControlInfo } from './hunkControls';
import type { Hunk, HunkDecision } from './useWorkingTreeReview';

export interface CodeMirrorDiffViewProps {
  filePath: string;
  isBinary: boolean;
  /**
   * BLOCK-28 — git hunk 列表（与 useWorkingTreeReview.diff.files[].hunks 同源）。
   * 传入后渲染 hunk 悬浮 accept/reject 控件与滚动标记条。
   */
  hunks?: Hunk[];
  /**
   * BLOCK-28 — 与 hunks 等长的决策数组（null = pending）。
   * 来自 useWorkingTreeReview.decisions 的 `path#index` 键。
   */
  hunkDecisions?: Array<HunkDecision | null>;
  /** BLOCK-28 — 悬浮控件 Accept 回调（hunkIndex 语义）。 */
  onAcceptHunk?: (hunkIndex: number) => void;
  /** BLOCK-28 — 悬浮控件 Reject 回调（hunkIndex 语义）。 */
  onRejectHunk?: (hunkIndex: number) => void;
  /**
   * BLOCK-29 — 外部直接提供的 diff revision（提交历史只读查看）。
   * 提供时跳过 HEAD/WORKTREE 桥加载；hunk 控件仍由 onAccept/onReject 是否传入决定。
   */
  revisionOverride?: DiffRevision | null;
}

interface FileContentResult {
  ok: boolean;
  data?: { content: string; truncated?: boolean };
  error?: string;
  message?: string;
}

export function CodeMirrorDiffView({
  filePath,
  isBinary,
  hunks,
  hunkDecisions,
  onAcceptHunk,
  onRejectHunk,
  revisionOverride,
}: CodeMirrorDiffViewProps) {
  const [revision, setRevision] = useState<DiffRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  // BLOCK-32 — 项目级审阅隔离：fileContent 消费当前项目工作区仓库
  const routeParams = useParams<{ projectId?: string }>();
  const projectId = routeParams.projectId;

  useEffect(() => {
    if (revisionOverride) {
      setRevision(revisionOverride);
      setError(null);
      setLoading(false);
      return;
    }
    if (!filePath || isBinary) {
      setRevision(null);
      setError(null);
      return;
    }

    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevision(null);

    const load = async (): Promise<void> => {
      const headResult = (await bridge.fileContent({
        path: filePath,
        ref: 'HEAD',
        projectId,
      })) as FileContentResult;

      const worktreeResult = (await bridge.fileContent({
        path: filePath,
        ref: 'WORKTREE',
        projectId,
      })) as FileContentResult;

      if (cancelled) return;

      if (!worktreeResult.ok) {
        setError(worktreeResult.message || worktreeResult.error || 'Failed to load working tree content.');
        return;
      }

      setRevision({
        filePath,
        originalText: headResult.ok ? (headResult.data?.content ?? '') : '',
        modifiedText: worktreeResult.data?.content ?? '',
      });
    };

    load().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [filePath, isBinary, revisionOverride, projectId]);

  // BLOCK-28 — hunk 控件信息（git hunk newStart 对齐 modified doc 行号）
  const totalLines = useMemo(
    () => (revision ? revision.modifiedText.split('\n').length : 0),
    [revision],
  );
  const hunkInfos = useMemo<HunkControlInfo[]>(
    () => (hunks ?? []).map((h, i) => ({
      hunkIndex: i,
      line: Math.max(1, Math.min(h.newStart || 1, Math.max(totalLines, 1))),
      decided: hunkDecisions?.[i] === 'accept' || hunkDecisions?.[i] === 'reject'
        ? hunkDecisions[i]
        : null,
    })),
    [hunks, hunkDecisions, totalLines],
  );

  // BLOCK-28 — extraExtensions：hunk 悬浮控件（签名变化时插件内部刷新）
  const extraExtensions = useMemo(() => {
    if (!hunks || hunks.length === 0 || !onAcceptHunk || !onRejectHunk) return [];
    return [createHunkControlsExtension(
      () => hunkInfos,
      { onAccept: onAcceptHunk, onReject: onRejectHunk },
    )];
  }, [hunkInfos, onAcceptHunk, onRejectHunk]); // hunks 信息已由 hunkInfos 覆盖

  const jumpToHunk = (hunk: Hunk) => {
    const line = Math.max(1, Math.min(hunk.newStart || 1, Math.max(totalLines, 1)));
    try {
      apiRef.current?.scrollToLine({ line, highlight: true });
    } catch { /* view 可能已销毁 */ }
  };

  if (isBinary) {
    return <div className="wt-file-binary">二进制文件变更</div>;
  }

  if (loading) {
    return <div className="wt-diff-loading">差异加载中…</div>;
  }

  if (error) {
    return <div className="wt-diff-error" role="alert">{error}</div>;
  }

  if (!revision) return null;

  return (
    <div className="wt-diff-wrap">
      {hunks && hunks.length > 0 && (
        <div className="wt-diff-markers" role="navigation" aria-label="hunk positions">
          {hunks.map((h, i) => {
            const ratio = Math.max(0, Math.min(1, ((h.newStart || 1) - 0.5) / Math.max(totalLines, 1)));
            const decided = hunkDecisions?.[i];
            return (
              <button
                key={i}
                type="button"
                className={`wt-diff-marker${decided === 'accept' ? ' is-accepted' : decided === 'reject' ? ' is-rejected' : ''}`}
                style={{ top: `${ratio * 100}%` }}
                title={`Hunk ${i + 1}（第 ${h.newStart} 行）`}
                aria-label={`跳转到 hunk ${i + 1}`}
                onClick={() => jumpToHunk(h)}
              />
            );
          })}
        </div>
      )}
      <CodeMirrorEditor
        ref={apiRef}
        value={revision.modifiedText}
        mode="inline-diff"
        diffRevision={revision}
        readonly={true}
        language={filePath}
        className="wt-cm-diff"
        extraExtensions={extraExtensions}
        diffOptions={{ collapseUnchanged: { margin: 3, minSize: 12 } }}
      />
    </div>
  );
}
