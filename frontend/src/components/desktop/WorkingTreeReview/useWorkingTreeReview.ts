// ============================================================
// useWorkingTreeReview — BLOCK-16 thin-slice hook
//
// 持有 working tree review 的全局状态：元数据、文件列表、当前选中文件、
// hunk 决策（pending/accept/reject）、任务上下文。
// 订阅 agent:task-done 事件实现自动弹出。
// 严格通过 desktopBridge / biof3Desktop.workingTreeReview 通道访问 IPC。
// ============================================================

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getBridge } from '@/lib/desktopBridge';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { hunkDecisionKey, hunkDecisionList } from './reviewModeHelpers';

// BLOCK-92 Wave B-3 — 类型定义外迁 ./useWorkingTreeReview/types.ts（原 15-207 行，纯搬运零行为变化）。
// 原导入路径保持全部类型 re-export：消费方 import 零改动。
import type {
  BranchInfo,
  CommitInfo,
  DiffResult,
  Hunk,
  HunkDecision,
  RemoteSyncStatus,
  StashEntry,
  TagEntry,
  UseWorkingTreeReviewOptions,
  UseWorkingTreeReviewReturn,
  WorkingTreeStatus,
} from "./useWorkingTreeReview/types";

export type {
  BranchInfo,
  CommitInfo,
  DiffFile,
  DiffResult,
  Hunk,
  HunkDecision,
  HunkLine,
  RemoteSyncStatus,
  StashEntry,
  TagEntry,
  UseWorkingTreeReviewOptions,
  UseWorkingTreeReviewReturn,
  WorkingTreeStatus,
} from "./useWorkingTreeReview/types";

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
    // BLOCK-147 #1 — 决策键内容寻址：无 hunk 载荷就无法锚定内容，
    // fail-closed 拒绝记账（宁可不记也不错位挂账），提示刷新后重试。
    if (!hunk) {
      setError('当前 diff 中找不到该 hunk，请刷新后重试。');
      return;
    }
    const key = hunkDecisionKey(file, hunk);
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
    // BLOCK-147 #1 — 决策键内容寻址（同 decideHunk 的 fail-closed 语义）
    if (!hunk) {
      setError('当前 diff 中找不到该 hunk，请刷新后重试。');
      return;
    }
    const key = hunkDecisionKey(file, hunk);
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
    const unsubscribe = subscribeGewuEvent(
      gewuEvents.agentTaskDone,
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
    return subscribeGewuEvent(gewuEvents.reviewOpenFile, (detail) => {
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

  // BLOCK-147 #2 — 未决 hunk 对账：当前 diff 的 hunk 全集 − 已决策键集合。
  // 判定基准与 UI 渲染同源（staged 行走 stagedDiff HEAD→index，unstaged 行走组合 diff，
  // diff 未覆盖的条目如纯 untracked 无 hunk 可决，不计入）；
  // 决策键内容寻址（BLOCK-147 #1）后 refresh 重解析不会串账。
  const pendingHunks = useMemo(() => {
    const out: Array<{ path: string; count: number }> = [];
    for (const f of status?.files ?? []) {
      const diffFile = f.staged
        ? stagedDiff?.files.find((d) => d.path === f.path) ?? diff?.files.find((d) => d.path === f.path)
        : diff?.files.find((d) => d.path === f.path);
      if (!diffFile || diffFile.binary) continue;
      const count = hunkDecisionList(diffFile, decisions).filter((d) => d === null).length;
      if (count > 0) out.push({ path: f.path, count });
    }
    return out;
  }, [status, diff, stagedDiff, decisions]);
  const pendingCount = pendingHunks.reduce((n, p) => n + p.count, 0);
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
    pendingHunks,
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
