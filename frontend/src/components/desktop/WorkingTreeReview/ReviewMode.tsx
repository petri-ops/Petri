// ============================================================
// ReviewMode — BLOCK-28 主区一级审阅模式（方案 B）
//
// 取代 BLOCK-20 侧边抽屉形态（WorkingTreeReview.tsx 已删除）。
// 复用 useWorkingTreeReview 状态机 + CodeMirrorDiffView + CodeReviewDrawer，
// IPC 0 新增（git:working-tree-* 全家桶；diffForReview=git diff HEAD 修复保留）。
// 布局：顶部 summary 条 / 左栏文件列表 / 右栏大空间 diff（sticky 文件头）/
//       底部内嵌提交框（VS Code SCM 风格，⌘+Enter，提交成功面板内轻提示）。
// 键盘流与旧抽屉一致：A/Y accept · R reject · ↑↓ navigate · Esc 退出模式。
// ============================================================

import { Fragment, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { CodeMirrorEditor } from '@/components/editor';
import type { DiffRevision } from '@/components/editor/CodeMirror/types';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { useWorkingTreeReview, type CommitInfo, type DiffFile, type DiffResult } from './useWorkingTreeReview';
import { CodeMirrorDiffView } from './CodeMirrorDiffView';
import { CodeReviewDrawer } from './CodeReviewDrawer';
import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  isFileReviewed,
} from './reviewModeHelpers';
import './WorkingTreeReview.css';
import './ReviewMode.css';

interface CommitSuccess {
  commit: string | null;
  files: string[];
  message: string;
}

/**
 * BLOCK-29.4 — 扩展名 → CodeMirror lang-* 语言小映射（未命中走纯文本）。
 */
const FULLTEXT_LANGUAGE_BY_EXT: Record<string, string> = {
  py: 'python',
  md: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'javascript',
  mjs: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
};

type CommitFileViewMode = 'diff' | 'fullModified' | 'fullOriginal' | 'blame';

interface BlameData {
  lines: Array<{ line: number; sha: string }>;
  commits: Record<string, { sha: string; shortSha: string; author: string; isoDate: string; subject: string }>;
  truncated: boolean;
}

/**
 * BLOCK-29 — 提交内单文件只读 diff：经 commitFileContent 取两版全文，
 * 组装 DiffRevision 交 CodeMirrorDiffView（revisionOverride，无 accept/reject 控件）。
 * BLOCK-29.4 — 两版全文本就持有，增加视图切换：diff / 全文·改动后 / 全文·改动前
 * （新增文件无改动前版本时禁用），全文用 CodeMirrorEditor 只读渲染。
 * BLOCK-29.5 — 对比模式传 fromRef/toRef（sha 区间），hash 为目标提交。
 */
function CommitDiffFileView({ hash, file, fromRef = null, toRef = null }: { hash: string; file: DiffFile; fromRef?: string | null; toRef?: string | null }) {
  const [revision, setRevision] = useState<DiffRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CommitFileViewMode>('diff');
  // BLOCK-29.5 — blame 逐行归属（第四态，该提交时点版本）
  const [blameData, setBlameData] = useState<BlameData | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [blameError, setBlameError] = useState<string | null>(null);

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
    bridge.commitFileContent(fromRef && toRef ? { path: file.path, fromRef, toRef } : { hash, path: file.path })
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
function ExpandedCommitDetail({ commit, onSummary }: { commit: CommitInfo; onSummary?: (s: { files: number; added: number; removed: number }) => void }) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  // UI-232 — 加载失败与「真没有差异」分开呈现，不再让报错伪装成空提交
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  // BLOCK-29.7 UI-244 — 提交文件树：左 mini 树 + 右 diff，结构可见
  const [treeCollapsed, setTreeCollapsed] = useState<Record<string, boolean>>({});
  const commitGroups = useMemo(() => groupFilesByDirectory(diff?.files ?? []), [diff]);
  useEffect(() => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiff(null);
    setFilePath(null);
    bridge.commitDiff({ hash: commit.sha })
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

function formatCommitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * BLOCK-29.5 — 未跟踪文件只读预览：fileContent WORKTREE 直读磁盘，
 * 替换原「暂无行级 diff」占位（CodeMirrorEditor 只读渲染）。
 */
function UntrackedFilePreview({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setContent(null);
    setFailed(false);
    bridge.fileContent({ path, ref: 'WORKTREE' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setContent(res.data.content);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [path]);
  if (failed) return <div className="wt-empty">未跟踪文件 — 内容读取失败。</div>;
  if (content === null) return <div className="wt-empty">未跟踪文件 — 内容加载中…</div>;
  if (content === '') return <div className="wt-empty">未跟踪文件 — 空文件。</div>;
  return (
    <div className="rvw-fulltext-wrap" data-testid="rvw-untracked-preview">
      <CodeMirrorEditor
        value={content}
        language={FULLTEXT_LANGUAGE_BY_EXT[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]}
        className="rvw-fulltext-editor"
      />
    </div>
  );
}

export interface ReviewModeProps {
  /**
   * BLOCK-28.2 — 呈现形态：
   * - 'mode'（默认）：主区一级模式（/review 路由，占满 main 区域）
   * - 'dock'：右侧停靠面板（wt-dock 容器内，文件条横向、diff 最大化）
   */
  variant?: 'mode' | 'dock';
  /** dock 形态的关闭回调（Esc / 关闭动作触发）。 */
  onClose?: () => void;
}

export function ReviewMode({ variant = 'mode', onClose }: ReviewModeProps) {
  const navigate = useNavigate();
  const isDock = variant === 'dock';
  const review = useWorkingTreeReview({ isOpen: true });

  const [commitMsg, setCommitMsg] = useState('');
  const [commitSuccess, setCommitSuccess] = useState<CommitSuccess | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [focusedHunk, setFocusedHunk] = useState(0);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  // UI-231 — 历史行内展开（点行 = 行下展开详情，列表不动，可同开多条）
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // UI-233 — 汇总统计上移到行（首次展开后加载并保留）
  const [commitSummaries, setCommitSummaries] = useState<Record<string, { files: number; added: number; removed: number }>>({});
  // BLOCK-29.6 UI-243 — 历史行 ⋯ 溢出菜单（收纳破坏性「撤销上次提交」）
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLInputElement>(null);

  // BLOCK-29.1 — dock 手风琴：每文件一行，点击展开/收起行内 diff。
  // selectedFilePath 变化（聊天卡片跳转等）时自动展开对应行。
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const target = review.selectedFilePath;
    if (!target) return;
    setExpandedPaths((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
  }, [review.selectedFilePath]);
  const toggleAccordionRow = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    review.setSelectedFilePath(path);
  };

  const exitReviewMode = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  // Esc 语义：先关行内编辑抽屉 → dock 形态关闭面板 → 输入框失焦 → mode 形态退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditDrawerOpen) {
        setIsEditDrawerOpen(false);
        return;
      }
      if (isDock && onClose) {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        target.blur();
        return;
      }
      exitReviewMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditDrawerOpen, isDock, onClose, navigate]);

  // 切换文件重置 hunk 焦点
  useEffect(() => { setFocusedHunk(0); }, [review.selectedFilePath]);

  // 键盘流：A/Y accept · R reject · ↑↓(j/k) navigate（与旧抽屉一致）
  useEffect(() => {
    const file = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      // BLOCK-29 — 历史分区为只读，A/R/↑↓ 只作用于「改动」分区
      if (review.historyView !== 'changes') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      const hunks = file.hunks;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocusedHunk((prev) => Math.min(prev + 1, hunks.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocusedHunk((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        const key = `${file.path}#${focusedHunk}`;
        if (review.decisions[key] !== 'accept') void review.decideHunk(file.path, focusedHunk, 'accept');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void review.decideHunk(file.path, focusedHunk, 'reject');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, focusedHunk]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFile = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;

  // P2 — diff 文件索引 + 目录分组 + 已审进度
  const diffByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of review.diff?.files ?? []) map.set(f.path, f);
    return map;
  }, [review.diff]);

  const statusFiles = review.status?.files ?? [];
  const fileGroups = useMemo(() => groupFilesByDirectory(statusFiles), [review.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewedCount = useMemo(
    () => statusFiles.filter((f) => isFileReviewed(diffByPath.get(f.path), review.decisions)).length,
    [statusFiles, diffByPath, review.decisions]
  );
  const totalFiles = statusFiles.length;

  // UI-235 — 历史分区汇总：当前 ref + 已加载提交数 + 已加载提交合计 ±
  //（替代误置的工作区 +0 −0/审阅进度；「已加载」措辞保证不冒充全分支总量）
  const historyAggregate = useMemo(() => {
    let added = 0;
    let removed = 0;
    let withStats = false;
    for (const c of review.commits ?? []) {
      if (c.stats) {
        withStats = true;
        added += c.stats.added;
        removed += c.stats.removed;
      }
    }
    return withStats ? { added, removed } : null;
  }, [review.commits]);

  const toggleDir = (dir: string) => {
    setCollapsedDirs((prev) => ({ ...prev, [dir]: !prev[dir] }));
  };

  const fileDecisionSummary = (path: string) => {
    const keys = Object.entries(review.decisions).filter(([k]) => k.startsWith(`${path}#`));
    if (keys.length === 0) return null;
    const accepted = keys.filter(([, v]) => v === 'accept').length;
    const rejected = keys.filter(([, v]) => v === 'reject').length;
    return { accepted, rejected, total: keys.length };
  };

  const hasDecisions = Object.keys(review.decisions).length > 0;
  const decisionCount = Object.keys(review.decisions).length;
  const acceptedCount = review.appliedCount;
  const rejectedCount = review.rejectedCount;

  const handleCommitReviewClick = () => {
    if (!hasDecisions) return;
    if (!commitMsg) {
      setCommitMsg(`Review: accept ${acceptedCount} hunk(s), reject ${rejectedCount} hunk(s)`);
    }
    setCommitError(null);
    setCommitSuccess(null);
    // P4 — 内嵌提交框：聚焦 message 输入而非弹对话框
    textareaRef.current?.focus();
  };

  const handleCommitConfirm = async () => {
    if (!commitMsg.trim()) {
      setCommitError('Commit message is required.');
      textareaRef.current?.focus();
      return;
    }
    setCommitError(null);
    try {
      const result = await review.commitReview(commitMsg.trim());
      setCommitSuccess({
        commit: result.commit,
        files: result.files,
        message: commitMsg.trim(),
      });
      setCommitMsg('');
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={`rvw-container${isDock ? ' rvw-container--dock' : ''}`} role="region" aria-label="审阅面板">
      {/* Commit success toast */}
      {commitSuccess && (
        <div className="wt-commit-success" role="status">
          <span>
            <strong>已提交</strong>
            {commitSuccess.commit && (
              <span className="wt-commit-hash"> {commitSuccess.commit.slice(0, 7)}</span>
            )}
            {' — '}
            {commitSuccess.files.length} 个文件
          </span>
          <button
            type="button"
            className="wt-commit-success-close"
            onClick={() => setCommitSuccess(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* 顶部 summary 条 + 审阅进度细条 */}
      <header className="rvw-summary">
        <div className="rvw-summary-left">
          <span className="wt-title">审阅</span>
          {/* BLOCK-29 — 改动 / 历史分区切换 */}
          <div className="rvw-view-switch" role="tablist" aria-label="审阅分区">
            <button
              type="button"
              role="tab"
              aria-selected={review.historyView === 'changes'}
              className={`rvw-view-switch-btn${review.historyView === 'changes' ? ' active' : ''}`}
              onClick={() => review.setHistoryView('changes')}
            >
              改动
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={review.historyView === 'history'}
              className={`rvw-view-switch-btn${review.historyView === 'history' ? ' active' : ''}`}
              onClick={() => {
                review.setHistoryView('history');
                void review.loadHistory();
                void review.loadBranches();
                void review.loadStashesAndTags();
              }}
            >
              历史
            </button>
          </div>
          {review.historyView === 'changes' ? (
            <span className="rvw-summary-stats" data-testid="rvw-summary-stats">
              <span>{review.status?.totalFiles ?? 0} 个文件</span>
              {review.diff && (
                <span className="rvw-stat-add">+{review.diff.summary.added}</span>
              )}
              {review.diff && (
                <span className="rvw-stat-del">−{review.diff.summary.removed}</span>
              )}
              <span className="rvw-review-progress" data-testid="rvw-review-progress">
                {reviewedCount}/{totalFiles} 已审
              </span>
            </span>
          ) : (
            /* UI-235 — 历史分区：工作区统计不适用，改显分支/标签 + 已加载提交数 + 合计 */
            <span className="rvw-summary-stats" data-testid="rvw-history-summary-stats">
              <span>{review.activeBranch ?? '当前分支'}</span>
              <span>已加载 {review.commits?.length ?? 0} 条提交</span>
              {historyAggregate && (
                <>
                  <span>合计</span>
                  <span className="rvw-stat-add">+{historyAggregate.added}</span>
                  <span className="rvw-stat-del">−{historyAggregate.removed}</span>
                </>
              )}
            </span>
          )}
          {review.taskId && <span className="wt-task-id">task: {review.taskId}</span>}
        </div>
        <div className="rvw-summary-actions">
          {/* BLOCK-29.6 UI-243 — 快捷键提示收进 info tooltip，不再常驻占地 */}
          <span
            className="rvw-help-btn"
            title="快捷键：A/Y 接受 · R 拒绝 · ↑↓ 切换 hunk · Esc 退出"
            aria-label="快捷键说明"
          >
            <Icon name="info" size={13} />
          </span>
          {/* BLOCK-29.6 UI-243 — 刷新 icon 化 */}
          <button
            type="button"
            className="wt-icon-btn"
            onClick={() => void review.refresh()}
            title="刷新工作区差异"
            aria-label="刷新"
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            type="button"
            className="wt-btn wt-btn-danger"
            onClick={() => void review.revertAll()}
            disabled={!review.status || review.status.files.length === 0}
          >
            全部还原
          </button>
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!hasDecisions ? ' wt-btn-disabled' : ''}`}
            onClick={handleCommitReviewClick}
            disabled={!hasDecisions}
            title={
              hasDecisions
                ? `提交 ${decisionCount} 个决策：${acceptedCount} 接受，${rejectedCount} 拒绝`
                : '请先审阅（接受或拒绝 hunk）'
            }
          >
            提交审阅{hasDecisions ? ` (${decisionCount})` : ''}
          </button>
          {/* BLOCK-29.6 UI-243 — 退出属面板导航，icon-only 靠右 */}
          <button
            type="button"
            className="wt-icon-btn rvw-exit-btn"
            onClick={() => (isDock && onClose ? onClose() : exitReviewMode())}
            title={isDock ? '关闭审阅面板 (Esc)' : '退出审阅模式'}
            aria-label="退出审阅"
            data-testid="rvw-exit-button"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </header>
      {totalFiles > 0 && (
        <div className="rvw-progress-track" aria-hidden="true">
          <div
            className="rvw-progress-fill"
            style={{ width: `${totalFiles ? (reviewedCount / totalFiles) * 100 : 0}%` }}
          />
        </div>
      )}

      {review.error && (
        <div className="wt-error" role="alert">{review.error}</div>
      )}

      <div className={`rvw-body${isDock ? ' rvw-body--dock' : ''}`}>
        {review.historyView === 'history' && (
          review.compareMode && (review.compareDiff || review.compareError) ? (
            <>
              {/* BLOCK-29.5 — 区间对比：A..B 文件条 + 只读 diff */}
              <div className="rvw-commit-info" data-testid="rvw-compare-info">
                <div className="rvw-commit-info-head">
                  <span className="rvw-commit-subject">对比 {review.compareFrom?.shortSha}..{review.compareTo?.shortSha}</span>
                  <span className="rvw-commit-summary">
                    {(review.compareDiff?.files ?? []).length} 文件
                    <span className="rvw-stat-add">+{review.compareDiff?.summary.added ?? 0}</span>
                    <span className="rvw-stat-del">−{review.compareDiff?.summary.removed ?? 0}</span>
                  </span>
                  {review.compareError && <span className="wt-diff-error" role="alert">区间差异加载失败：{review.compareError}</span>}
                  <button type="button" className="rvw-viewmode-btn" onClick={review.exitCompareMode}>
                    退出对比
                  </button>
                </div>
              </div>
              <div className="rvw-filestrip" role="tablist" aria-label="对比改动文件">
                {(review.compareDiff?.files ?? []).map((f) => {
                  const stats = computeFileDiffStats(f);
                  const selected = review.compareFilePath === f.path;
                  const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                  return (
                    <button
                      key={f.path}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`rvw-filechip${selected ? ' active' : ''}`}
                      onClick={() => review.setCompareFilePath(f.path)}
                      title={f.path}
                    >
                      <span className="rvw-filechip-name">{fileName}</span>
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
              <main className="rvw-diff-area" data-testid="rvw-compare-diff-area">
                {!review.compareError && (() => {
                  const file = (review.compareDiff?.files ?? []).find((f) => f.path === review.compareFilePath) || null;
                  if (!file) {
                    return <div className="wt-empty">该区间没有可显示的文件差异（两提交间无差异）。</div>;
                  }
                  return (
                    <div className="rvw-file">
                      <div className="wt-file-header rvw-file-header">
                        <span className="rvw-history-sha">{review.compareFrom?.shortSha}..{review.compareTo?.shortSha}</span>
                        <span className="wt-file-path">{file.path}</span>
                        <span className="rvw-file-stats">
                          <span className="rvw-stat-add">+{computeFileDiffStats(file).added}</span>
                          <span className="rvw-stat-del">−{computeFileDiffStats(file).removed}</span>
                        </span>
                        <span className="wt-file-hunk-count">{file.hunks.length} 个 hunk</span>
                      </div>
                      <CommitDiffFileView
                        hash={review.compareTo?.sha ?? ''}
                        file={file}
                        fromRef={review.compareFrom?.sha ?? null}
                        toRef={review.compareTo?.sha ?? null}
                      />
                    </div>
                  );
                })()}
              </main>
            </>
          ) : (
            <div className="rvw-history-list" data-testid="rvw-history-list">
              {/* BLOCK-29.2 — 历史头部：文件过滤徽标 + 撤销上次提交 */}
              {/* BLOCK-29.6 UI-243 — 左组（过滤+分支+对比）右组（⋯ 溢出菜单收纳撤销），破坏性动作不再与只读控件平权 */}
              <div className="rvw-history-head">
                <div className="rvw-history-tools">
                  {review.historyFileFilter ? (
                    <span className="rvw-history-filter" title="仅显示该文件的提交">
                      文件: {review.historyFileFilter}
                      <span
                        role="button"
                        tabIndex={-1}
                        className="rvw-history-filter-clear"
                        aria-label="清除文件过滤"
                        title="清除过滤"
                        onClick={() => void review.loadHistory({ file: null })}
                      >
                        <Icon name="x" size={10} />
                      </span>
                    </span>
                  ) : null}
                  {/* BLOCK-29.5 — 分支选择器：只读查看其他分支历史，不切换工作区分支 */}
                  <select
                    className="rvw-branch-select"
                    aria-label="提交历史分支"
                    value={review.activeBranch ?? ''}
                    onChange={(e) => void review.switchBranch(e.target.value || null)}
                    title="查看其他分支的提交历史（只读，不切换工作区分支）"
                  >
                    <option value="">当前分支 (HEAD)</option>
                    {(review.branches ?? []).map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.current ? '（当前）' : ''}
                      </option>
                    ))}
                    {review.tags && review.tags.length > 0 && (
                      <optgroup label="标签">
                        {review.tags.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}（tag）
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {/* BLOCK-29.5 — 两提交对比模式（只读区间 diff） */}
                  <button
                    type="button"
                    className="wt-btn"
                    onClick={() => (review.compareMode ? review.exitCompareMode() : review.enterCompareMode())}
                    title="选两个提交对比区间差异（只读）"
                  >
                    {review.compareMode ? '退出对比' : '对比'}
                  </button>
                  {review.compareMode && (
                    <span className="rvw-compare-hint" title="对比模式">
                      {review.compareBase
                        ? `已选基准 ${review.compareBase.shortSha}，点选目标提交`
                        : '对比模式：点选基准提交'}
                    </span>
                  )}
                </div>
                <div className="rvw-history-more">
                  <button
                    type="button"
                    className="wt-icon-btn"
                    aria-label="更多历史操作"
                    aria-haspopup="menu"
                    aria-expanded={historyMenuOpen}
                    title="更多操作"
                    onClick={() => setHistoryMenuOpen((open) => !open)}
                  >
                    ⋯
                  </button>
                  {historyMenuOpen && (
                    <>
                      <div
                        className="rvw-menu-backdrop"
                        onClick={() => setHistoryMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="rvw-overflow-menu" role="menu" aria-label="历史操作菜单">
                        <button
                          type="button"
                          role="menuitem"
                          className="rvw-overflow-menu-item rvw-overflow-menu-item--danger"
                          disabled={review.commitsLoading || !review.commits || review.commits.length === 0}
                          title="撤销最近一次提交（内容回到工作区）"
                          onClick={() => {
                            setHistoryMenuOpen(false);
                            if (window.confirm('撤销最近一次提交？提交内容将回到工作区，可重新审阅。')) {
                              void review.undoLastCommit();
                            }
                          }}
                        >
                          撤销上次提交
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* BLOCK-29.5 — stash 只读列表（有内容才显示，不含写操作） */}
              {review.stashes && review.stashes.length > 0 && (
                <div className="rvw-stash-list" data-testid="rvw-stash-list">
                  {review.stashes.map((s) => (
                    <div key={s.ref} className="rvw-stash-row" title={s.subject}>
                      <span className="rvw-blame-sha">{s.ref}</span>
                      <span className="rvw-history-subject">{s.subject}</span>
                      <span className="rvw-history-meta">{formatCommitDate(s.isoDate)}</span>
                    </div>
                  ))}
                </div>
              )}
              {review.commitsLoading && <div className="wt-diff-loading">提交历史加载中…</div>}
              {review.commits && review.commits.length === 0 && (
                <div className="wt-empty">{review.historyFileFilter ? '该文件暂无提交记录。' : '暂无提交记录。'}</div>
              )}
              {review.commits?.map((c) => {
                // UI-234 — 统计默认随 log 到达；展开回退（旧桥桩无 stats 时）仍走 commitSummaries
                const rowStats = c.stats ?? commitSummaries[c.sha] ?? null;
                return (
                <Fragment key={c.sha}>
                  <button
                    type="button"
                    className="rvw-history-row"
                    aria-expanded={expandedCommits.has(c.sha)}
                    onClick={() => {
                      if (review.compareMode) {
                        void review.handleCompareClick(c);
                        return;
                      }
                      setExpandedCommits((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.sha)) next.delete(c.sha);
                        else next.add(c.sha);
                        return next;
                      });
                    }}
                    title={c.subject}
                  >
                    <span className="rvw-history-sha">{c.shortSha}</span>
                    <span className="rvw-history-subject">{c.subject}</span>
                    {rowStats && (
                      <span className="rvw-history-row-stats" title="该提交改动统计">
                        {rowStats.files} 文件
                        <span className="rvw-stat-add">+{rowStats.added}</span>
                        <span className="rvw-stat-del">−{rowStats.removed}</span>
                      </span>
                    )}
                    <span className="rvw-history-meta">{c.author} · {formatCommitDate(c.isoDate)}</span>
                  </button>
                  {expandedCommits.has(c.sha) && (
                    <ExpandedCommitDetail
                      commit={c}
                      onSummary={(s) => setCommitSummaries((prev) => ({ ...prev, [c.sha]: s }))}
                    />
                  )}
                </Fragment>
                );
              })}
              {review.hasMoreHistory && !review.commitsLoading && (
                <button
                  type="button"
                  className="rvw-history-more"
                  onClick={() => void review.loadHistory({ skip: review.commits?.length ?? 0, append: true })}
                >
                  加载更多
                </button>
              )}
            </div>
          )
        )}
        {review.historyView === 'changes' && (<>
        {isDock ? (
          <div className="rvw-accordion" data-testid="rvw-file-list" role="list" aria-label="改动文件">
            {review.status && review.status.files.length === 0 && (
              <div className="wt-empty">暂无工作区改动。</div>
            )}
            {/* BLOCK-29.7 UI-244 — dock 手风琴升级目录分组树：结构与 /review 主区左树同构 */}
            {fileGroups.map((group) => {
              const collapsed = !!collapsedDirs[group.dir];
              return (
                <div key={group.dir || '/'} className="rvw-acc-group">
                  <button
                    type="button"
                    className="rvw-group-header"
                    onClick={() => toggleDir(group.dir)}
                    aria-expanded={!collapsed}
                    title={group.dir || '（根目录）'}
                  >
                    <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                      <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                    </span>
                    <span className="rvw-group-name">{groupDisplayName(group.dir)}</span>
                    <span className="rvw-group-count">{group.files.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="rvw-acc-group-files">
                      {group.files.map((f) => {
                        const diffFile = diffByPath.get(f.path);
                        const stats = computeFileDiffStats(diffFile);
                        const reviewed = isFileReviewed(diffFile, review.decisions);
                        const selected = review.selectedFilePath === f.path;
                        const expanded = expandedPaths.has(f.path);
                        const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                        return (
                          <div
                            key={f.path}
                            className={`rvw-acc-item rvw-acc-item--nested${selected ? ' active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                          >
                            <button
                              type="button"
                              className="rvw-acc-row"
                              aria-expanded={expanded}
                              onClick={() => toggleAccordionRow(f.path)}
                              title={f.path}
                            >
                              <span className={`rvw-caret${expanded ? '' : ' rvw-caret-collapsed'}`}>
                                <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                              </span>
                              <WorkspaceFileIcon name={f.path} type="file" />
                              <span className="rvw-acc-name">{fileName}</span>
                              {reviewed ? (
                                <span className="rvw-reviewed-mark"><Icon name="check" size={12} /></span>
                              ) : (stats.added > 0 || stats.removed > 0) ? (
                                <span className="rvw-file-stats">
                                  {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                                  {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                                </span>
                    ) : null}
                    {/* BLOCK-29.2 — 行内操作：查看该文件历史 / 放弃更改（span 嵌于按钮行内） */}
                    {/* BLOCK-29.6 UI-243 — 行内「编辑」取代原 summary 全局按钮（已知二进制才隐藏） */}
                    {!diffFile?.binary && (
                      <span
                        role="button"
                        tabIndex={-1}
                        className="rvw-acc-action rvw-acc-action-edit"
                        title={`在行内编辑器中打开 ${fileName}`}
                        aria-label={`编辑 ${fileName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditDrawerOpen(true);
                        }}
                      >
                        <Icon name="wrench" size={12} />
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rvw-acc-action"
                      title="查看该文件的历史提交"
                      aria-label={`查看 ${fileName} 的历史提交`}
                      onClick={(e) => {
                        e.stopPropagation();
                        review.setHistoryView('history');
                        void review.loadHistory({ file: f.path });
                      }}
                    >
                      <Icon name="clock" size={12} />
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rvw-acc-action rvw-acc-action-danger"
                      title="放弃更改（未跟踪文件将被删除）"
                      aria-label={`放弃对 ${fileName} 的更改`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`放弃对 ${fileName} 的更改？未跟踪文件将被删除，此操作不可撤销。`)) {
                          void review.discardFile(f.path);
                        }
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="rvw-acc-diff">
                      {diffFile ? (
                        <CodeMirrorDiffView
                          filePath={f.path}
                          isBinary={diffFile.binary}
                          hunks={diffFile.hunks}
                          hunkDecisions={diffFile.hunks.map(
                            (_, i) => review.decisions[`${f.path}#${i}`] ?? null,
                          )}
                          onAcceptHunk={(i) => void review.decideHunk(f.path, i, 'accept')}
                          onRejectHunk={(i) => void review.decideHunk(f.path, i, 'reject')}
                        />
                      ) : (
                        <UntrackedFilePreview path={f.path} />
                      )}
                    </div>
                  )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
        <aside className="rvw-sidebar" data-testid="rvw-file-list">
          <div className="wt-file-list-title">
            文件 ({review.status?.totalFiles ?? 0})
          </div>
          {review.status && review.status.files.length === 0 && (
            <div className="wt-empty">暂无工作区改动。</div>
          )}
          {fileGroups.map((group) => {
            const collapsed = !!collapsedDirs[group.dir];
            return (
              <div key={group.dir || '/'} className="rvw-group">
                <button
                  type="button"
                  className="rvw-group-header"
                  onClick={() => toggleDir(group.dir)}
                  aria-expanded={!collapsed}
                >
                  <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                    <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                  </span>
                  <span className="rvw-group-name">{groupDisplayName(group.dir)}</span>
                  <span className="rvw-group-count">{group.files.length}</span>
                </button>
                {!collapsed &&
                  group.files.map((f) => {
                    const diffFile = diffByPath.get(f.path);
                    const stats = computeFileDiffStats(diffFile);
                    const reviewed = isFileReviewed(diffFile, review.decisions);
                    const summary = fileDecisionSummary(f.path);
                    const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                    return (
                      <button
                        key={f.path}
                        type="button"
                        className={`wt-file-list-item rvw-file-row ${review.selectedFilePath === f.path ? 'active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                        onClick={() => review.setSelectedFilePath(f.path)}
                        title={f.path}
                      >
                        <span className={`wt-file-status wt-file-status-${f.status}`}>{f.status}</span>
                        <span className="rvw-file-icon"><Icon name="file" size={13} /></span>
                        <span className="wt-file-list-path">{fileName}</span>
                        <span className="wt-file-list-badge">
                          {summary && summary.accepted > 0 && (
                            <span className="wt-badge-mini wt-badge-accept-mini">{summary.accepted}</span>
                          )}
                          {summary && summary.rejected > 0 && (
                            <span className="wt-badge-mini wt-badge-reject-mini">{summary.rejected}</span>
                          )}
                          {reviewed && (
                            <span className="rvw-reviewed-mark" title="Reviewed"><Icon name="check" size={12} /></span>
                          )}
                        </span>
                        {!reviewed && (stats.added > 0 || stats.removed > 0) && (
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
        )}

        {/* 右栏大空间 diff（仅 mode 变体；dock 为手风琴行内 diff） */}
        {!isDock && (
        <main className="rvw-diff-area" data-testid="rvw-diff-area">
          {!selectedFile && !review.loading && !review.error && (
            <div className="rvw-empty-state">
              <span className="rvw-empty-icon"><Icon name="git-branch" size={22} /></span>
              <span className="rvw-empty-title">审阅</span>
              <span className="rvw-empty-hint">
                在这里审阅工作区改动：接受或拒绝 hunk，然后提交。
                A/Y 接受 · R 拒绝 · ↑↓ 切换 hunk。
              </span>
            </div>
          )}
          {selectedFile && (
            <div className="rvw-file">
              <div className="wt-file-header rvw-file-header">
                <span className={`wt-file-status wt-file-status-${review.status?.files.find((s) => s.path === selectedFile.path)?.status ?? '?'}`}>
                  {review.status?.files.find((s) => s.path === selectedFile.path)?.status ?? '?'}
                </span>
                <span className="wt-file-path">{selectedFile.path}</span>
                {selectedFile.oldPath && selectedFile.oldPath !== selectedFile.path && (
                  <span className="wt-file-old-path">← {selectedFile.oldPath}</span>
                )}
                <span className="rvw-file-stats">
                  <span className="rvw-stat-add">+{computeFileDiffStats(selectedFile).added}</span>
                  <span className="rvw-stat-del">−{computeFileDiffStats(selectedFile).removed}</span>
                </span>
                <span className="wt-file-hunk-count">{selectedFile.hunks.length} 个 hunk</span>
                {/* BLOCK-29.6 UI-243 — 编辑动作移到文件头行内（选中非二进制才出现） */}
                {!selectedFile.binary && (
                  <button
                    type="button"
                    className="wt-btn rvw-inline-edit-btn"
                    onClick={() => setIsEditDrawerOpen(true)}
                    title={`在行内编辑器中打开 ${selectedFile.path}`}
                  >
                    编辑
                  </button>
                )}
              </div>
              <CodeMirrorDiffView
                filePath={selectedFile.path}
                isBinary={selectedFile.binary}
                hunks={selectedFile.hunks}
                hunkDecisions={selectedFile.hunks.map(
                  (_, i) => review.decisions[`${selectedFile.path}#${i}`] ?? null,
                )}
                onAcceptHunk={(i) => void review.decideHunk(selectedFile.path, i, 'accept')}
                onRejectHunk={(i) => void review.decideHunk(selectedFile.path, i, 'reject')}
              />
            </div>
          )}
        </main>
        )}
        </>)}
      </div>

      {/* BLOCK-28.9 — 底部提交条按需出现：有审阅决策才显示（单行紧凑条），
          无决策时隐藏底部输入框（用户反馈：不需要常驻输入框） */}
      {hasDecisions && (
        <footer className="rvw-commitbox" data-testid="rvw-commitbox">
          <div className="rvw-commitbox-meta">
            <span className="rvw-commitbox-stat">接受 {acceptedCount}</span>
            <span className="rvw-commitbox-stat rvw-commitbox-stat-reject">拒绝 {rejectedCount}</span>
            {review.pendingCount > 0 && <span className="rvw-commitbox-stat">待定 {review.pendingCount}</span>}
            {review.diff?.truncated && <span className="wt-warning">输出已截断</span>}
            {review.loading && <span>加载中…</span>}
            {commitError && (
              <span className="rvw-commitbox-error" role="alert">{commitError}</span>
            )}
          </div>
          <input
            ref={textareaRef}
            className="rvw-commitbox-input"
            type="text"
            value={commitMsg}
            onChange={(e) => {
              setCommitMsg(e.target.value);
              if (commitError) setCommitError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleCommitConfirm();
              }
            }}
            placeholder={`提交信息（⌘+Enter 提交：接受 ${acceptedCount}，拒绝 ${rejectedCount}）`}
            aria-label="提交信息"
          />
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!commitMsg.trim() ? ' wt-btn-disabled' : ''}`}
            onClick={() => void handleCommitConfirm()}
            disabled={!commitMsg.trim() || review.loading}
            title={`提交 ${decisionCount} 个决策：${acceptedCount} 接受，${rejectedCount} 拒绝`}
          >
            {review.loading ? '提交中…' : `提交 (${decisionCount})`}
          </button>
        </footer>
      )}

      {/* 行内编辑抽屉（复用，非旧侧边抽屉） */}
      <CodeReviewDrawer
        isOpen={isEditDrawerOpen}
        onClose={() => {
          setIsEditDrawerOpen(false);
          // Refresh working tree so the diff reflects the saved content
          void review.refresh();
        }}
        filePath={review.selectedFilePath}
        workspacePath={null}
      />
    </div>
  );
}
