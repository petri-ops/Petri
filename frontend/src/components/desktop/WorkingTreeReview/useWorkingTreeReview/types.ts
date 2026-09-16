// BLOCK-92 Wave B-3 — useWorkingTreeReview 类型定义外迁（原 15-207 行，纯搬运零行为变化）。
// 原导入路径 './useWorkingTreeReview' 经主文件 re-export 保持兼容。

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
