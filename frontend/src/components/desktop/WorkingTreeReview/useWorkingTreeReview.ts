// ============================================================
// useWorkingTreeReview — BLOCK-16 thin-slice hook
//
// 持有 working tree review 的全局状态：元数据、文件列表、当前选中文件、
// hunk 决策（pending/accept/reject）、任务上下文。
// 订阅 agent:task-done 事件实现自动弹出。
// 严格通过 desktopBridge / biof3Desktop.workingTreeReview 通道访问 IPC。
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getBridge } from '@/lib/desktopBridge';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';

export type HunkDecision = 'pending' | 'accept' | 'reject';

export interface HunkLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: HunkLine[];
  truncated?: boolean;
}

/**
 * BLOCK-20 — 把单个 hunk 转换为标准 unified diff 单 hunk 文本（带 ---/+++ 与 @@ header）。
 * 与 src/ipc/working-tree-review.js 里 `buildReversePatchForReject` 互为反向；
 * 本函数输出"正向 patch"（add → `+`、`del` → `-`），由 `applyInverseHunk` 内部 invert。
 */
function buildForwardPatchForReject({ file, hunk }: { file: string; hunk: Hunk }): string {
  const oldStart = hunk.oldStart || 0;
  const newStart = hunk.newStart || 0;
  const oldCount = hunk.lines.filter((l) => l.type !== 'add').length;
  const newCount = hunk.lines.filter((l) => l.type !== 'del').length;
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
  let body = '';
  for (const line of hunk.lines) {
    if (line.type === 'add') body += `+${line.text}\n`;
    else if (line.type === 'del') body += `-${line.text}\n`;
    else body += ` ${line.text}\n`;
  }
  return header + body;
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  binary: boolean;
  hunks: Hunk[];
}

export interface DiffResult {
  files: DiffFile[];
  truncated: boolean;
  summary: { added: number; removed: number };
}

/** BLOCK-29.5 — 本地分支（for-each-ref refs/heads，历史分区选择器，只读）。 */
export interface BranchInfo {
  name: string;
  shortSha: string;
  isoDate: string;
  current: boolean;
}

/** BLOCK-29.5 — stash 条目（只读列表，不含写操作）。 */
export interface StashEntry {
  ref: string;
  shortSha: string;
  isoDate: string;
  subject: string;
}

/** BLOCK-29.5 — 标签（只读列表）。 */
export interface TagEntry {
  name: string;
  shortSha: string;
  isoDate: string;
}

/** BLOCK-29 — git log 单条提交（NUL 分隔解析，见 git-adapter.log）。 */
export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  isoDate: string;
  subject: string;
  /** BLOCK-29.3 — 完整提交说明（%b，body 为空时为空串）。 */
  message: string;
  /** UI-234 — 改动统计（--shortstat，随 log 一次取回；空提交为 null）。 */
  stats?: { files: number; added: number; removed: number } | null;
}

export interface WorkingTreeStatus {
  files: Array<{
    path: string;
    oldPath: string | null;
    status: string;
    untracked: boolean;
    conflicted: boolean;
    /** BLOCK-41 — porcelain X（index 状态非空 → 已暂存），两栏分组依据 */
    staged: boolean;
    /** BLOCK-41 — porcelain X / Y 原始状态字符 */
    indexStatus: string;
    worktreeStatus: string;
  }>;
  totalFiles: number;
  hasUntracked: boolean;
  hasConflict: boolean;
}

/** BLOCK-41 — 远程同步状态（ahead/behind；无 upstream 或离线时为 null）。 */
export interface RemoteSyncStatus {
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export interface UseWorkingTreeReviewOptions {
  /** External open trigger (e.g. manual toolbar button). */
  isOpen?: boolean;
  onClose?: () => void;
}

export interface UseWorkingTreeReviewReturn {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string | null;
  status: WorkingTreeStatus | null;
  diff: DiffResult | null;
  selectedFilePath: string | null;
  setSelectedFilePath: (path: string | null) => void;
  decisions: Record<string, HunkDecision>;
  pendingCount: number;
  appliedCount: number;
  rejectedCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  decideHunk: (file: string, hunkIndex: number, action: 'accept' | 'reject', feedback?: string) => Promise<void>;
  /**
   * BLOCK-20 — per-hunk reject via applyInverseHunk 通道。
   * 与 `decideHunk(file, hunkIndex, 'reject')` 行为等价，但走的是 BLOCK-20 的 `git:hunk-reject-inverse` IPC：
   *   1) 前端把 hunk 拼成正向 unified diff patch（带 ---/+++ 与 @@ header）
   *   2) 主进程 `applyInverseHunk` 内部 invert + 回退 working tree
   *   3) reject 清单写入走与 BLOCK-16 一致的 _writeRejectEntry 共享 helper
   * BLOCK-16 的 `decideHunk('reject')` 路径保留不动，本方法是 additive 替代入口。
   */
  rejectHunkByInverseHunk: (file: string, hunkIndex: number, patch: string, feedback?: string) => Promise<void>;
  revertAll: () => Promise<void>;
  commitReview: (message: string) => Promise<{
    commit: string | null;
    files: string[];
    rejectedFiles: string[];
    stats: { acceptedFiles: number; rejectedFiles: number; totalWorkingTree: number };
  }>;
  isDialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** BLOCK-29 — 提交历史分区状态与动作。 */
  historyView: 'changes' | 'history';
  setHistoryView: (view: 'changes' | 'history') => void;
  commits: CommitInfo[] | null;
  commitsLoading: boolean;
  historyFileFilter: string | null;
  hasMoreHistory: boolean;
  loadHistory: (opts?: { file?: string | null; skip?: number; append?: boolean }) => Promise<void>;
  /** BLOCK-29.5 — 分支选择器（只读查看其他分支历史）。 */
  loadBranches: () => Promise<void>;
  branches: BranchInfo[] | null;
  activeBranch: string | null;
  switchBranch: (name: string | null) => Promise<void>;
  /** BLOCK-29.5 — stash/标签只读列表。 */
  loadStashesAndTags: () => Promise<void>;
  stashes: StashEntry[] | null;
  tags: TagEntry[] | null;
  /** BLOCK-29.2 — 放弃单文件工作区改动（tracked 还原 / untracked 删除）。 */
  discardFile: (path: string) => Promise<boolean>;
  /** BLOCK-29.2 — 撤销最近一次提交（mixed reset，内容回工作区）。 */
  undoLastCommit: () => Promise<boolean>;
  /**
   * BLOCK-32 — 当前项目工作区不是 git 仓库（后端 `project_workspace_not_git`）。
   * true 时审阅应渲染诚实空态，不显示任何仓库数据。
   */
  workspaceNotGit: boolean;
  /** BLOCK-41 — staged 文件 diff（HEAD→index），随 refresh 一并取回；无 staged 文件时为 null。 */
  stagedDiff: DiffResult | null;
  /** BLOCK-41 — 暂存指定文件（git add）。 */
  stagePaths: (paths: string[]) => Promise<boolean>;
  /** BLOCK-41 — 取消暂存指定文件（git reset HEAD --）。 */
  unstagePaths: (paths: string[]) => Promise<boolean>;
  /** BLOCK-41 — 提交整个暂存区（无 pathspec，与 commitReview 的 --only 语义区分）。 */
  commitIndex: (message: string) => Promise<{ commit: string | null; files: number }>;
  /**
   * BLOCK-41 — 真实分支切换（git checkout）。脏树拒绝时返回冲突清单。
   * 与 switchBranch（历史查询 ref）语义不同：本方法写 refs 并刷新全部视野。
   */
  checkoutBranch: (name: string) => Promise<{ ok: boolean; message?: string; conflicts?: string[]; alreadyCurrent?: boolean }>;
  /** BLOCK-41 — 远程同步状态与 push/pull 动作。 */
  remoteSync: RemoteSyncStatus | null;
  loadRemoteStatus: () => Promise<void>;
  pushRemote: () => Promise<boolean>;
  pullRemote: () => Promise<boolean>;
}

export function useWorkingTreeReview(options: UseWorkingTreeReviewOptions = {}): UseWorkingTreeReviewReturn {
  // BLOCK-32 P2 — 项目级审阅隔离：projectId 取自当前路由（/project/:projectId）。
  // /review 独立路由无项目上下文 → null → 后端维持应用仓库旧行为（诚实边界）。
  const routeParams = useParams<{ projectId?: string }>();
  const projectId = routeParams.projectId ?? null;
  const [open, setOpenState] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkingTreeStatus | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [workspaceNotGit, setWorkspaceNotGit] = useState(false);
  // BLOCK-41 — staged diff（HEAD→index）与远程同步状态
  const [stagedDiff, setStagedDiff] = useState<DiffResult | null>(null);
  const [remoteSync, setRemoteSync] = useState<RemoteSyncStatus | null>(null);
  const stagedDiffRef = useRef<DiffResult | null>(null);
  stagedDiffRef.current = stagedDiff;
  const remoteSyncRef = useRef<RemoteSyncStatus | null>(null);
  remoteSyncRef.current = remoteSync;
  const taskIdRef = useRef<string | null>(null);
  taskIdRef.current = taskId;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const selectedFilePathRef = useRef<string | null>(null);
  selectedFilePathRef.current = selectedFilePath;

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) {
      options.onClose?.();
    }
  }, [options]);

  const refresh = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    setLoading(true);
    setError(null);
    try {
      const pid = projectIdRef.current ?? undefined;
      const [statusRes, diffRes] = await Promise.all([bridge.status({ projectId: pid }), bridge.diff({ projectId: pid })]);
      if (statusRes.ok && statusRes.data) {
        setStatus(statusRes.data);
        setWorkspaceNotGit(false);
      } else {
        // BLOCK-32 — 非 git 工作区诚实标记（审阅渲染空态），不回退显示应用仓库
        setWorkspaceNotGit(statusRes.error === 'project_workspace_not_git');
        setStatus({ files: [], totalFiles: 0, hasUntracked: false, hasConflict: false });
      }
      if (diffRes.ok && diffRes.data) {
        setDiff(diffRes.data);
        if (diffRes.data.files.length > 0 && !selectedFilePathRef.current) {
          const first = diffRes.data.files[0];
          setSelectedFilePath(first.path);
        }
      } else {
        setDiff({ files: [], truncated: false, summary: { added: 0, removed: 0 } });
      }
      // BLOCK-41 — staged 文件 diff（HEAD→index）：staged 文件存在时随 refresh 一并取回
      const stagedPaths = statusRes.ok && statusRes.data
        ? statusRes.data.files.filter((f) => f.staged).map((f) => f.path)
        : [];
      if (stagedPaths.length > 0) {
        const stagedRes = await bridge.diff({ paths: stagedPaths, staged: true });
        setStagedDiff(stagedRes.ok && stagedRes.data ? stagedRes.data : { files: [], truncated: false, summary: { added: 0, removed: 0 } });
      } else {
        setStagedDiff(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const decideHunk = useCallback(async (file: string, hunkIndex: number, action: 'accept' | 'reject', feedback?: string) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    // BLOCK-41 — staged 文件选中时 hunk 来自 stagedDiff（HEAD→index），优先匹配
    const hunk = (stagedDiffRef.current?.files.find((f) => f.path === file) ?? diff?.files.find((f) => f.path === file))?.hunks[hunkIndex];
    const key = `${file}#${hunkIndex}`;
    setDecisions((prev) => ({ ...prev, [key]: action === 'accept' ? 'accept' : 'reject' }));
    try {
      const res = await bridge.applyHunk({
        file,
        hunkIndex,
        action,
        hunk: hunk || undefined,
        feedback: feedback || undefined,
        taskId: taskIdRef.current || undefined,
        projectId: projectIdRef.current ?? undefined,
      });
      if (!res.ok) {
        setDecisions((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setError(res.message || res.error || 'apply hunk failed');
      }
    } catch (e) {
      setDecisions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [diff]);

  // BLOCK-20 — per-hunk reject via applyInverseHunk.
  // Mirror decideHunk 的乐观更新 + 失败回滚模式：先标 'reject'，失败再 delete。
  // 前端持有 diff.hunks 时优先拼 patch；没有时由调用方传入（splitSideDiff.diff 单 hunk 段）。
  const rejectHunkByInverseHunk = useCallback(async (file: string, hunkIndex: number, patch: string, feedback?: string) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    // BLOCK-41 — staged 文件选中时 hunk 来自 stagedDiff（HEAD→index），优先匹配
    const hunk = (stagedDiffRef.current?.files.find((f) => f.path === file) ?? diff?.files.find((f) => f.path === file))?.hunks[hunkIndex];
    const key = `${file}#${hunkIndex}`;
    setDecisions((prev) => ({ ...prev, [key]: 'reject' }));
    try {
      // 若调用方未传 patch 但 hunk 存在，前端兜底拼一份（与 splitSideDiff 输出兼容）
      const effectivePatch = patch && patch.length > 0
        ? patch
        : hunk
          ? buildForwardPatchForReject({ file, hunk })
          : '';
      if (!effectivePatch) {
        throw new Error('patch text is required for inverse-hunk reject.');
      }
      const res = await bridge.rejectHunkByInverseHunk({
        file,
        hunkIndex,
        patch: effectivePatch,
        hunk: hunk || undefined,
        feedback: feedback || undefined,
        taskId: taskIdRef.current || undefined,
        projectId: projectIdRef.current ?? undefined,
      });
      if (!res.ok) {
        setDecisions((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setError(res.message || res.error || 'reject-by-inverse-hunk failed');
      }
    } catch (e) {
      setDecisions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [diff]);

  const revertAll = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    if (!status || status.files.length === 0) return;
    setLoading(true);
    try {
      const res = await bridge.revert({ paths: status.files.map((f) => f.path), projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || 'revert failed');
      } else {
        setDecisions({});
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, refresh]);

  const commitReview = useCallback(async (message: string) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) throw new Error('bridge unavailable');
    if (Object.keys(decisions).length === 0) throw new Error('no decisions to commit');
    setLoading(true);
    setError(null);
    try {
      const res = await bridge.commitReview({ decisions, message, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        throw new Error(res.message || res.error || 'commit failed');
      }
      setDecisions({});
      await refresh();
      return {
        commit: res.data?.commit ?? null,
        files: res.data?.files ?? [],
        rejectedFiles: res.data?.rejectedFiles ?? [],
        stats: res.data?.stats ?? { acceptedFiles: 0, rejectedFiles: 0, totalWorkingTree: 0 },
      };
    } finally {
      setLoading(false);
    }
  }, [decisions, refresh]);

  // BLOCK-32 — 项目切换（路由 projectId 变化）时清空上一项目的审阅状态并重取。
  // refresh 已稳定（无依赖），本 effect 只在 projectId 变化时触发。
  useEffect(() => {
    setStatus(null);
    setDiff(null);
    setSelectedFilePath(null);
    setDecisions({});
    setWorkspaceNotGit(false);
    setStagedDiff(null);
    setRemoteSync(null);
    setCommits(null);
    setBranches(null);
    setStashes(null);
    setTags(null);
    setHistoryFileFilter(null);
    void refresh();
  }, [projectId, refresh]);

  // 订阅 agent:task-done（renderer 侧主路径）—— SSE done 派发的 biof3:agent-task-done
  // 会自动弹出浮层。preload 的 bridge.onTaskDone（main→renderer webContents.send）
  // 保留作为备用通道，给未来 main 真触发时使用。
  useEffect(() => {
    const unsubscribe = subscribeBioF3Event(
      biof3Events.agentTaskDone,
      (detail) => {
        const incoming = detail?.taskId || '';
        setTaskId(incoming);
        setOpenState(true);
        void refresh();
      }
    );
    return unsubscribe;
  }, [refresh]);

  // 订阅 preload agent:task-done 通道（main→renderer 通知的备用入口）
  useEffect(() => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    const unsubscribe = bridge.onTaskDone((info) => {
      setTaskId(info.taskId);
      setOpenState(true);
      void refresh();
    });
    return () => {
      try { unsubscribe?.(); } catch { /* unsubscribe may be undefined in non-desktop */ }
    };
  }, [refresh]);

  // BLOCK-28.7 — 聊天区改动卡片点击文件行：刷新并选中该文件。
  // 路径必须在当前工作区 status 里（防御外部乱传）；diff 未覆盖时先 refresh。
  useEffect(() => {
    return subscribeBioF3Event(biof3Events.reviewOpenFile, (detail) => {
      const target = detail?.filePath || '';
      if (!target) return;
      setSelectedFilePath((current) => (current === target ? current : target));
      void refresh();
    });
  }, [refresh]);

  // 外部 isOpen 触发（手动工具栏按钮）
  useEffect(() => {
    if (options.isOpen) {
      setOpenState(true);
      void refresh();
    }
  }, [options.isOpen, refresh]);

  // BLOCK-29 — 提交历史分区状态
  const [historyView, setHistoryView] = useState<'changes' | 'history'>('changes');
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [historyFileFilter, setHistoryFileFilter] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const historyFileFilterRef = useRef<string | null>(null);
  historyFileFilterRef.current = historyFileFilter;
  // BLOCK-29.5 — 分支选择器（只读查看其他分支历史，不切换工作区分支）
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const activeBranchRef = useRef<string | null>(null);
  activeBranchRef.current = activeBranch;

  const loadBranches = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    try {
      const res = await bridge.branchList({ projectId: projectIdRef.current ?? undefined });
      setBranches(res.ok && res.data ? res.data.branches ?? [] : []);
    } catch {
      setBranches([]);
    }
  }, []);

  // BLOCK-29.5 — stash/标签只读列表（历史分区展示）
  const [stashes, setStashes] = useState<StashEntry[] | null>(null);
  const [tags, setTags] = useState<TagEntry[] | null>(null);
  const loadStashesAndTags = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    try {
      const r = await bridge.stashList({ projectId: projectIdRef.current ?? undefined });
      setStashes(r.ok && r.data ? r.data.stashes ?? [] : []);
    } catch {
      setStashes([]);
    }
    try {
      const r2 = await bridge.tagList({ projectId: projectIdRef.current ?? undefined });
      setTags(r2.ok && r2.data ? r2.data.tags ?? [] : []);
    } catch {
      setTags([]);
    }
  }, []);

  const loadHistory = useCallback(async (opts: { file?: string | null; skip?: number; append?: boolean } = {}) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    const file = opts.file !== undefined ? opts.file : historyFileFilterRef.current;
    const skip = Math.max(0, opts.skip ?? 0);
    const append = opts.append === true;
    setCommitsLoading(true);
    try {
      const res = await bridge.commitLog({ limit: 50, skip, file, ref: activeBranchRef.current, projectId: projectIdRef.current ?? undefined });
      const list: CommitInfo[] = res.ok && res.data ? res.data.commits ?? [] : [];
      setCommits((prev) => (append && prev ? [...prev, ...list] : list));
      setHistoryFileFilter(file ?? null);
      setHasMoreHistory(list.length >= 50);
    } catch {
      if (!append) setCommits([]);
    } finally {
      setCommitsLoading(false);
    }
  }, []);

  /** BLOCK-29.5 — 切换历史查看分支（null = HEAD/当前分支）。只影响历史列表，不写 refs。 */
  const switchBranch = useCallback(async (name: string | null) => {
    activeBranchRef.current = name;
    setActiveBranch(name);
    await loadHistory({ file: null });
  }, [loadHistory]);

  // UI-249 — BLOCK-29.5 两提交对比模式已按用户裁决移除（低频且入口语义不自明）。
  // `git:commit-diff` IPC 保留：历史提交行内展开详情仍消费。

  // BLOCK-29.2 — 放弃单文件工作区改动（tracked 还原 / untracked 删除）
  const discardFile = useCallback(async (path: string) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return false;
    try {
      const res = await bridge.discardFile({ path, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '放弃更改失败。');
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [refresh]);

  // BLOCK-29.2 — 撤销最近一次提交（mixed reset，提交内容回工作区重新审阅）
  const undoLastCommit = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return false;
    try {
      const res = await bridge.undoLastCommit({ projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '撤销提交失败。');
        return false;
      }
      await refresh();
      await loadHistory({});
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [refresh, loadHistory]);

  // ============================================================
  // BLOCK-41 — git 写操作三期：暂存 / 取消暂存 / 提交暂存区 / 真实分支切换 / push-pull
  // 全部走 resolveGitAdapter(projectId) 项目级隔离（P2 IPC 已定契约）。
  // ============================================================

  const stagePaths = useCallback(async (paths: string[]): Promise<boolean> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge || paths.length === 0) return false;
    try {
      const res = await bridge.stagePaths({ paths, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '暂存失败。');
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [refresh]);

  const unstagePaths = useCallback(async (paths: string[]): Promise<boolean> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge || paths.length === 0) return false;
    try {
      const res = await bridge.unstagePaths({ paths, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '取消暂存失败。');
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [refresh]);

  // BLOCK-41 — 远程同步状态（stable；push 首推时读 upstream 判定是否 -u）
  const loadRemoteStatus = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    try {
      const res = await bridge.remoteStatus({ projectId: projectIdRef.current ?? undefined });
      setRemoteSync(res.ok && res.data ? { upstream: res.data.upstream ?? null, ahead: res.data.ahead ?? null, behind: res.data.behind ?? null } : null);
    } catch {
      setRemoteSync(null);
    }
  }, []);

  const commitIndex = useCallback(async (message: string): Promise<{ commit: string | null; files: number }> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) throw new Error('bridge unavailable');
    const res = await bridge.commitIndex({ message, projectId: projectIdRef.current ?? undefined });
    if (!res.ok) {
      throw new Error(res.message || res.error || '提交暂存区失败。');
    }
    await refresh();
    await loadHistory({ file: null });
    await loadRemoteStatus();
    return { commit: res.data?.commit ?? null, files: res.data?.remaining ?? 0 };
  }, [refresh, loadHistory, loadRemoteStatus]);

  const checkoutBranch = useCallback(async (name: string): Promise<{ ok: boolean; message?: string; conflicts?: string[]; alreadyCurrent?: boolean }> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return { ok: false, message: 'bridge unavailable' };
    try {
      const res = await bridge.checkoutBranch({ name, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        return {
          ok: false,
          message: res.message || res.error || `切换到分支 '${name}' 失败。`,
          conflicts: res.detail?.conflicts ?? [],
        };
      }
      if (res.data?.switched === false) {
        return { ok: true, alreadyCurrent: true };
      }
      // 切换成功：工作区 / 暂存区 / 历史 / 远程状态全部刷新
      setSelectedFilePath(null);
      await refresh();
      await loadBranches();
      await loadHistory({ file: null });
      await loadRemoteStatus();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [refresh, loadBranches, loadHistory, loadRemoteStatus]);

  const pushRemote = useCallback(async (): Promise<boolean> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return false;
    try {
      // 无 upstream 时自动 -u 建立跟踪（首推场景）；否则纯 push
      const setUpstream = remoteSyncRef.current?.upstream == null;
      const res = await bridge.push({ setUpstream, projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '推送失败。');
        return false;
      }
      await loadRemoteStatus();
      await loadHistory({ file: null });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [loadRemoteStatus, loadHistory]);

  const pullRemote = useCallback(async (): Promise<boolean> => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return false;
    try {
      const res = await bridge.pull({ projectId: projectIdRef.current ?? undefined });
      if (!res.ok) {
        setError(res.message || res.error || '拉取失败。');
        return false;
      }
      await refresh();
      await loadRemoteStatus();
      await loadHistory({ file: null });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [refresh, loadRemoteStatus, loadHistory]);

  const pendingCount = Object.values(decisions).filter((d) => d === 'pending').length;
  const appliedCount = Object.values(decisions).filter((d) => d === 'accept').length;
  const rejectedCount = Object.values(decisions).filter((d) => d === 'reject').length;

  return {
    open,
    setOpen,
    taskId,
    status,
    diff,
    selectedFilePath,
    setSelectedFilePath,
    decisions,
    pendingCount,
    appliedCount,
    rejectedCount,
    loading,
    error,
    refresh,
    decideHunk,
    rejectHunkByInverseHunk,
    revertAll,
    commitReview,
    isDialogOpen,
    setDialogOpen,
    historyView,
    setHistoryView,
    commits,
    commitsLoading,
    historyFileFilter,
    hasMoreHistory,
    loadHistory,
    loadBranches,
    branches,
    activeBranch,
    switchBranch,
    loadStashesAndTags,
    stashes,
    tags,
    discardFile,
    undoLastCommit,
    workspaceNotGit,
    stagedDiff,
    stagePaths,
    unstagePaths,
    commitIndex,
    checkoutBranch,
    remoteSync,
    loadRemoteStatus,
    pushRemote,
    pullRemote,
  };
}
