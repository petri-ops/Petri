// ============================================================
// ExpandedCommitDetail - UI-305 P2 extracted from ReviewMode.tsx (lines 223-346),
// behavior unchanged; main file imports it back as needed.
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { useWorkingTreeReview, type CommitInfo, type DiffFile, type DiffResult } from './useWorkingTreeReview';
import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  isFileReviewed,
} from './reviewModeHelpers';
import { CommitDiffFileView } from './CommitDiffFileView';

export function ExpandedCommitDetail({ commit, onSummary }: { commit: CommitInfo; onSummary?: (s: { files: number; added: number; removed: number }) => void }) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  // UI-232 — 加载失败与「真没有差异」分开呈现，不再让报错伪装成空提交
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  // BLOCK-29.7 UI-244 — 提交文件树：左 mini 树 + 右 diff，结构可见
  const [treeCollapsed, setTreeCollapsed] = useState<Record<string, boolean>>({});
  // BLOCK-32 — 项目级审阅隔离
  const { projectId } = useParams<{ projectId?: string }>();
  const commitGroups = useMemo(() => groupFilesByDirectory(diff?.files ?? []), [diff]);
  useEffect(() => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiff(null);
    setFilePath(null);
    bridge.commitDiff({ hash: commit.sha, projectId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          const parsed: DiffResult = res.data;
          setDiff(parsed);
          setFilePath(parsed.files[0]?.path ?? null);
          onSummary?.({ files: parsed.files.length, added: parsed.summary.added, removed: parsed.summary.removed });
        } else {
          setError(res.message || res.error || '提交差异加载失败。');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [commit.sha]);
  return (
    <div className="rvw-history-detail" data-testid={`rvw-commit-detail-${commit.shortSha}`}>
      {error && <div className="wt-diff-error" role="alert">提交差异加载失败：{error}</div>}
      {commit.message && (
        <div className="rvw-commit-body" data-testid="rvw-commit-body">
          <pre>{commit.message}</pre>
        </div>
      )}
      {/* BLOCK-29.7 UI-244 — filestrip → 左 mini 目录树 + 右 diff：版本改动 ↔ 项目结构对应可见 */}
      <div className="rvw-commit-detail-body">
        <aside className="rvw-commit-tree" role="tablist" aria-label="提交改动文件树">
          {commitGroups.map((group) => {
            const collapsed = !!treeCollapsed[group.dir];
            return (
              <div key={group.dir || '/'} className="rvw-commit-tree-group">
                <button
                  type="button"
                  className="rvw-commit-tree-dir"
                  aria-expanded={!collapsed}
                  title={group.dir || '（根目录）'}
                  onClick={() => setTreeCollapsed((s) => ({ ...s, [group.dir]: !collapsed }))}
                >
                  <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                    <span className="rvw-caret-icon"><Icon name="chevron-down" size={11} /></span>
                  </span>
                  <span className="rvw-commit-tree-dir-name">{groupDisplayName(group.dir)}</span>
                  <span className="rvw-commit-tree-count">{group.files.length}</span>
                </button>
                {!collapsed &&
                  group.files.map((f) => {
                    const stats = computeFileDiffStats(f);
                    const selected = filePath === f.path;
                    const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                    return (
                      <button
                        key={f.path}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className={`rvw-commit-tree-row${selected ? ' active' : ''}`}
                        onClick={() => setFilePath(f.path)}
                        title={f.path}
                      >
                        <span className="rvw-commit-tree-file">{fileName}</span>
                        {(stats.added > 0 || stats.removed > 0) && (
                          <span className="rvw-file-stats">
                            {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                            {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </aside>
        <main className="rvw-diff-area rvw-commit-diff" data-testid="rvw-commit-diff-area">
        {loading && <div className="wt-diff-loading">提交差异加载中…</div>}
        {!loading && !error && (() => {
          const file = (diff?.files ?? []).find((f) => f.path === filePath) || null;
          if (!file) {
            return <div className="wt-empty">该提交没有可显示的文件差异（空提交）。</div>;
          }
          return (
            <div className="rvw-file">
              <div className="wt-file-header rvw-file-header">
                <span className="rvw-history-sha">{commit.shortSha}</span>
                <span className="wt-file-path">{file.path}</span>
                <span className="rvw-file-stats">
                  <span className="rvw-stat-add">+{computeFileDiffStats(file).added}</span>
                  <span className="rvw-stat-del">−{computeFileDiffStats(file).removed}</span>
                </span>
                <span className="wt-file-hunk-count">{file.hunks.length} 个 hunk</span>
              </div>
              <CommitDiffFileView hash={commit.sha} file={file} />
            </div>
          );
        })()}
        </main>
      </div>
    </div>
  );
}
