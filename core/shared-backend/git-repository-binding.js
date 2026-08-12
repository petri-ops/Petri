'use strict';

/**
 * shared-backend/git-repository-binding.js
 *
 * G0-RS1 — 把一个 BioF3 项目安全地绑定到一个 Git 版本后端。
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md §4 风险矩阵
 *
 * 两种模式：
 * - `managed`：项目目录没有 Git，或用户选择只用 BioF3 托管历史。
 *   git 元数据放 `<workspace>/.biof3/git`，工作区仍是项目目录本身，
 *   因此用户浏览项目时看不到 `.git`。
 * - `existing`：项目目录本身在一个 Git 仓库里，用户同意接入。
 *   只操作显式声明的受管理路径，绝不碰用户的其他改动。
 *
 * 不变量：
 * - 绝不对用户目录执行 `git init`（那会把整个项目变成仓库）。
 * - 绝不自动 stage、stash、commit 或覆盖用户 WIP。
 * - 受管理路径与用户未提交改动相交时，返回 blocked，由调用方拒绝采用。
 * - 绝不 push / force push / rebase / 删除用户分支。
 * - git 不可用时诚实阻断，不降级为不可恢复编辑。
 */

const fs = require('fs');
const path = require('path');
const {
  GIT_ADAPTER_VERSION,
  GitAdapterError,
  createGitAdapter,
  detectGitRuntime,
  redactGitDiagnostic,
} = require('./git-adapter');
const { isPathContained } = require('./project-run-layout');

const REPOSITORY_BINDING_VERSION = 1;

const BINDING_MODES = Object.freeze(['managed', 'existing']);

const BINDING_STATUSES = Object.freeze([
  'ready',
  'blocked_git_unavailable',
  'blocked_dirty_conflict',
  'blocked_repository_state',
  'blocked_workspace_invalid',
]);

/** BioF3 私有目录名；托管 git 与 revision 元数据都在它下面。 */
const BIOF3_DIR = '.biof3';

/**
 * RS 受管理的相对路径。只有这些路径会进入版本控制。
 *
 * 说明：`results/` 不在其中。科学产物由 Artifact Store 负责，
 * 大型数据不进普通 Git（RS0 ADR-RS-1）。
 */
const MANAGED_RELATIVE_PATHS = Object.freeze([
  'analysis/scripts',
  'analysis/workflows',
]);

function relativePosix(root, target) {
  return path.relative(path.resolve(root), path.resolve(target)).split(path.sep).join('/');
}

/**
 * 向上查找包含 .git 的目录。
 *
 * @param {string} startDir
 * @returns {{ root: string, gitPath: string, isFile: boolean }|null}
 */
function findEnclosingGitRepository(startDir) {
  let current = path.resolve(startDir);
  const { root: filesystemRoot } = path.parse(current);
  for (;;) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      let isFile = false;
      try { isFile = fs.statSync(gitPath).isFile(); } catch { isFile = false; }
      return { root: current, gitPath, isFile };
    }
    if (current === filesystemRoot) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 解析 `.git` 文件（linked worktree / submodule）指向的真实 gitdir。
 */
function resolveGitDirFromFile(gitFilePath) {
  try {
    const content = fs.readFileSync(gitFilePath, 'utf8');
    const match = /^gitdir:\s*(.+)\s*$/m.exec(content);
    if (!match) return null;
    const target = match[1].trim();
    return path.isAbsolute(target) ? target : path.resolve(path.dirname(gitFilePath), target);
  } catch {
    return null;
  }
}

/**
 * 探测项目工作目录当前的 Git 状况，不做任何写操作。
 *
 * @param {{ workspaceRoot: string, gitBin?: string }} options
 */
function inspectWorkspaceGit(options = {}) {
  const { workspaceRoot } = options;
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    throw new GitAdapterError('workspace_root_required', 'workspaceRoot is required.');
  }
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const runtime = detectGitRuntime({ gitBin: options.gitBin });
  const managedGitDir = path.join(resolvedWorkspace, BIOF3_DIR, 'git');
  const managedExists = fs.existsSync(path.join(managedGitDir, 'HEAD'));
  const enclosing = findEnclosingGitRepository(resolvedWorkspace);

  return {
    repositoryBindingVersion: REPOSITORY_BINDING_VERSION,
    workspaceRoot: resolvedWorkspace,
    workspaceExists: fs.existsSync(resolvedWorkspace),
    runtime,
    managed: { gitDir: managedGitDir, exists: managedExists },
    existing: enclosing
      ? {
        repositoryRoot: enclosing.root,
        gitPath: enclosing.gitPath,
        // `.git` 是文件 → linked worktree 或 submodule。
        indirect: enclosing.isFile,
        resolvedGitDir: enclosing.isFile ? resolveGitDirFromFile(enclosing.gitPath) : enclosing.gitPath,
        // 项目目录本身是仓库根，还是仓库的子目录。
        isRepositoryRoot: path.resolve(enclosing.root) === resolvedWorkspace,
        workspaceRelativeToRepository: relativePosix(enclosing.root, resolvedWorkspace) || '.',
      }
      : null,
  };
}

/**
 * 只读判断用户既有仓库是否包含未提交改动。
 *
 * 仅返回布尔值，避免把用户文件路径带到 API/UI；status 使用
 * `untracked=all`，确保未跟踪目录不会被折叠后漏判。
 */
function inspectExistingRepositoryDirty(options = {}) {
  const inspection = options.inspection || inspectWorkspaceGit(options);
  if (!inspection.existing) return false;

  const existing = inspection.existing;
  if (!existing.resolvedGitDir || !fs.existsSync(existing.resolvedGitDir)) {
    throw new GitAdapterError('existing_gitdir_unresolved', 'Existing Git directory could not be resolved.');
  }

  const adapter = createGitAdapter({
    gitDir: existing.resolvedGitDir,
    workTree: existing.repositoryRoot,
    gitBin: options.gitBin,
  });
  const status = adapter.repositoryStatus({ untracked: 'all' });
  return status.dirty || status.hasUntracked;
}

/**
 * 计算受管理路径（相对仓库根）。
 *
 * managed 模式下工作区就是仓库根；existing 模式下需要加上项目目录
 * 相对仓库根的前缀，否则 pathspec 会指错位置。
 */
function resolveManagedPaths({ mode, inspection, managedRelativePaths = MANAGED_RELATIVE_PATHS }) {
  const prefix = mode === 'existing' && inspection.existing && !inspection.existing.isRepositoryRoot
    ? inspection.existing.workspaceRelativeToRepository
    : '';
  return managedRelativePaths.map((relative) => {
    const joined = prefix && prefix !== '.' ? path.posix.join(prefix, relative) : relative;
    return joined;
  });
}

/**
 * 判断受管理路径是否与用户未提交改动相交。
 *
 * 相交即 blocked：RS 不覆盖、不 stash、不自动提交用户 WIP。
 */
function pathsOverlap(candidate, managed) {
  // git 会用尾斜杠表示目录条目；比较前统一去掉。
  const left = String(candidate || '').replace(/\/+$/, '');
  const right = String(managed || '').replace(/\/+$/, '');
  if (!left || !right) return false;
  // 双向前缀：受管理路径在条目之下（文件命中），或条目是受管理路径的祖先目录
  // （git 把整个未跟踪目录折叠成一条时会出现）。
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function detectDirtyConflict({ adapter, managedPaths }) {
  // 必须用 untracked='all'：`normal` 把完全未跟踪的目录折叠成单条
  // （新建的 analysis/scripts/x.R 只报告 analysis/），
  // 会让受管理路径下的用户新建文件漏判，RS 随后可能覆盖它。
  const repository = adapter.repositoryStatus({ untracked: 'all' });
  const conflicting = repository.entries.filter((entry) => {
    const candidates = [entry.path, entry.originalPath].filter(Boolean);
    return candidates.some((candidate) => managedPaths.some((managed) => pathsOverlap(candidate, managed)));
  });
  return {
    dirty: repository.dirty,
    hasUntracked: repository.hasUntracked,
    hasConflict: repository.hasConflict,
    truncated: repository.truncated,
    // 只暴露受管理范围内的冲突路径；用户其他 WIP 不进入返回值。
    conflictingManagedPaths: [...new Set(conflicting.map((entry) => entry.path))],
    userWipOutsideManagedPaths: repository.entries.length - conflicting.length,
  };
}

/**
 * 绑定项目到 Git 版本后端。
 *
 * @param {{
 *   workspaceRoot: string,
 *   projectId: string,
 *   preferManaged?: boolean,
 *   allowExistingRepository?: boolean,
 *   createManagedIfMissing?: boolean,
 *   managedRelativePaths?: string[],
 *   gitBin?: string,
 *   identity?: { name: string, email: string }|null
 * }} options
 * @returns {{ status: string, mode: string|null, ... }}
 */
function bindProjectRepository(options = {}) {
  const {
    workspaceRoot,
    projectId,
    preferManaged = false,
    allowExistingRepository = false,
    createManagedIfMissing = true,
    managedRelativePaths = MANAGED_RELATIVE_PATHS,
    gitBin,
    identity = null,
  } = options;

  if (!projectId || typeof projectId !== 'string') {
    throw new GitAdapterError('project_id_required', 'projectId is required.');
  }

  const inspection = inspectWorkspaceGit({ workspaceRoot, gitBin });

  const base = {
    repositoryBindingVersion: REPOSITORY_BINDING_VERSION,
    gitAdapterVersion: GIT_ADAPTER_VERSION,
    projectId,
    workspaceRoot: inspection.workspaceRoot,
    inspection,
    mode: null,
    adapter: null,
    managedPaths: [],
    reason: null,
    diagnostics: [],
  };

  if (!inspection.workspaceExists) {
    return { ...base, status: 'blocked_workspace_invalid', reason: 'workspace_missing' };
  }
  if (!inspection.runtime.available) {
    return { ...base, status: 'blocked_git_unavailable', reason: inspection.runtime.reason || 'git_unavailable' };
  }
  if (!inspection.runtime.meetsMinimum) {
    return { ...base, status: 'blocked_git_unavailable', reason: 'git_version_below_minimum' };
  }

  // 模式选择：已有托管仓库 → 继续托管；用户偏好托管 → 托管；
  // 否则若存在既有仓库且允许接入 → existing；其余 → 新建托管。
  const existingRepositoryNotAttached = !!inspection.existing
    && !allowExistingRepository
    && !preferManaged
    && !inspection.managed.exists;
  const canUseExisting = allowExistingRepository
    && !!inspection.existing
    && !preferManaged
    && !inspection.managed.exists;

  const mode = canUseExisting ? 'existing' : 'managed';
  if (existingRepositoryNotAttached) {
    base.diagnostics.push('existing_repository_not_attached_without_consent');
  }
  const managedPaths = resolveManagedPaths({ mode, inspection, managedRelativePaths });

  let adapter;
  if (mode === 'managed') {
    if (!inspection.managed.exists && !createManagedIfMissing) {
      return { ...base, mode, managedPaths, status: 'blocked_repository_state', reason: 'managed_repository_absent' };
    }
    adapter = createGitAdapter({
      gitDir: inspection.managed.gitDir,
      workTree: inspection.workspaceRoot,
      gitBin,
      identity,
    });
    if (!inspection.managed.exists) {
      try {
        adapter.initManaged();
      } catch (error) {
        return {
          ...base,
          mode,
          managedPaths,
          status: 'blocked_repository_state',
          reason: 'managed_repository_init_failed',
          diagnostics: [redactGitDiagnostic(error.message, { workTree: inspection.workspaceRoot })],
        };
      }
    }
  } else {
    const existing = inspection.existing;
    const gitDir = existing.resolvedGitDir;
    if (!gitDir || !fs.existsSync(gitDir)) {
      return { ...base, mode, managedPaths, status: 'blocked_repository_state', reason: 'existing_gitdir_unresolved' };
    }
    adapter = createGitAdapter({
      gitDir,
      workTree: existing.repositoryRoot,
      gitBin,
      identity,
    });
  }

  const state = adapter.repositoryState();

  // 中途操作、索引锁、submodule 与 linked worktree 一律先阻断，
  // 不猜测用户意图，也不删锁。
  if (state.hasIndexLock) {
    return { ...base, mode, managedPaths, adapter, status: 'blocked_repository_state', reason: 'index_lock_present' };
  }
  if (state.midOperation) {
    return { ...base, mode, managedPaths, adapter, status: 'blocked_repository_state', reason: 'repository_mid_operation' };
  }
  if (mode === 'existing') {
    if (inspection.existing.indirect) {
      return { ...base, mode, managedPaths, adapter, status: 'blocked_repository_state', reason: 'linked_worktree_or_submodule' };
    }
    if (state.hasSubmodules) {
      return { ...base, mode, managedPaths, adapter, status: 'blocked_repository_state', reason: 'submodules_present' };
    }
    if (state.linkedWorktreeCount > 0) {
      return { ...base, mode, managedPaths, adapter, status: 'blocked_repository_state', reason: 'linked_worktrees_present' };
    }
  }

  // 受管理路径必须落在工作区内。
  for (const managed of managedPaths) {
    const absolute = path.resolve(adapter.workTree, managed);
    if (!isPathContained(adapter.workTree, absolute)) {
      return { ...base, mode, managedPaths, adapter, status: 'blocked_workspace_invalid', reason: 'managed_path_escape' };
    }
  }

  let dirty = null;
  if (mode === 'existing') {
    // 只有接入用户既有仓库时才需要判断 WIP 冲突；
    // 托管仓库的工作区包含科学数据，整仓 status 既慢又无意义。
    try {
      dirty = detectDirtyConflict({ adapter, managedPaths });
    } catch (error) {
      return {
        ...base,
        mode,
        managedPaths,
        adapter,
        status: 'blocked_repository_state',
        reason: 'repository_status_failed',
        diagnostics: [redactGitDiagnostic(error.message, { workTree: adapter.workTree })],
      };
    }
    if (dirty.conflictingManagedPaths.length > 0) {
      return {
        ...base,
        mode,
        managedPaths,
        adapter,
        dirty,
        status: 'blocked_dirty_conflict',
        reason: 'managed_paths_have_uncommitted_changes',
      };
    }
  }

  return {
    ...base,
    mode,
    adapter,
    managedPaths,
    dirty,
    repositoryState: state,
    status: 'ready',
    reason: null,
  };
}

/**
 * 托管元数据落点。全部锚定 workspaceRoot，与 project-run-layout 同源。
 */
function resolveBiof3MetadataLayout(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const biof3Dir = path.join(root, BIOF3_DIR);
  return {
    workspaceRoot: root,
    biof3Dir,
    managedGitDir: path.join(biof3Dir, 'git'),
    revisionDir: path.join(biof3Dir, 'revision'),
    checkpointDir: path.join(biof3Dir, 'checkpoints'),
    objectsDir: path.join(biof3Dir, 'objects'),
  };
}

module.exports = {
  REPOSITORY_BINDING_VERSION,
  BINDING_MODES,
  BINDING_STATUSES,
  BIOF3_DIR,
  MANAGED_RELATIVE_PATHS,
  findEnclosingGitRepository,
  resolveGitDirFromFile,
  inspectWorkspaceGit,
  inspectExistingRepositoryDirty,
  resolveManagedPaths,
  pathsOverlap,
  detectDirtyConflict,
  bindProjectRepository,
  resolveBiof3MetadataLayout,
};
