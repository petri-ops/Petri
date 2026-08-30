// ============================================================
// useWorkingTreeReview — BLOCK-16 thin-slice hook
//
// 持有 working tree review 的全局状态：元数据、文件列表、当前选中文件、
// hunk 决策（pending/accept/reject）、任务上下文。
// 订阅 agent:task-done 事件实现自动弹出。
// 严格通过 desktopBridge / biof3Desktop.workingTreeReview 通道访问 IPC。
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
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

export interface WorkingTreeStatus {
  files: Array<{ path: string; oldPath: string | null; status: string; untracked: boolean; conflicted: boolean }>;
  totalFiles: number;
  hasUntracked: boolean;
  hasConflict: boolean;
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
}

export function useWorkingTreeReview(options: UseWorkingTreeReviewOptions = {}): UseWorkingTreeReviewReturn {
  const [open, setOpenState] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkingTreeStatus | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const taskIdRef = useRef<string | null>(null);
  taskIdRef.current = taskId;

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
      const [statusRes, diffRes] = await Promise.all([bridge.status(), bridge.diff({})]);
      if (statusRes.ok && statusRes.data) {
        setStatus(statusRes.data);
      } else {
        setStatus({ files: [], totalFiles: 0, hasUntracked: false, hasConflict: false });
      }
      if (diffRes.ok && diffRes.data) {
        setDiff(diffRes.data);
        if (diffRes.data.files.length > 0 && !selectedFilePath) {
          const first = diffRes.data.files[0];
          setSelectedFilePath(first.path);
        }
      } else {
        setDiff({ files: [], truncated: false, summary: { added: 0, removed: 0 } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedFilePath]);

  const decideHunk = useCallback(async (file: string, hunkIndex: number, action: 'accept' | 'reject', feedback?: string) => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    const hunk = diff?.files.find((f) => f.path === file)?.hunks[hunkIndex];
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
    const hunk = diff?.files.find((f) => f.path === file)?.hunks[hunkIndex];
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
      const res = await bridge.revert({ paths: status.files.map((f) => f.path) });
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
      const res = await bridge.commitReview({ decisions, message });
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
  };
}
