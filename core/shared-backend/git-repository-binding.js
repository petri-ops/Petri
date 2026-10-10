'use strict';

/**
 * shared-backend/git-repository-binding.js
 *
 * G0-RS1 — 把一个 Petri 项目安全地绑定到一个 Git 版本后端。
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md §4 风险矩阵。
 * 2026-10-03 用户裁决（UI-462）：Result Studio 历史只进受管理私有仓库，
 * 「接入用户自有仓库」能力整体退役——因此只剩 managed 一种绑定模式。
 *
 * managed：git 元数据放 `<workspace>/.petri/git`，工作区仍是项目目录本身，
 * 因此用户浏览项目时看不到 `.git`。用户项目目录自身的 Git 仓库（若有）
 * 与本绑定完全无关：不读、不写、不在任何 UI 提示。
 *
 * 不变量：
 * - 绝不对用户目录执行 `git init`（那会把整个项目变成仓库）。
 * - 绝不自动 stage、stash、commit 或覆盖用户 WIP。
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

const BINDING_STATUSES = Object.freeze([
  'ready',
  'blocked_git_unavailable',
  'blocked_repository_state',
  'blocked_workspace_invalid',
]);

/** Petri 私有目录名；托管 git 与 revision 元数据都在它下面。 */
const PETRI_DIR = '.petri';

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

/**
 * 探测项目工作目录当前的 Git 状况，不做任何写操作。
 *
 * 只关心受管理仓库与 git 运行时；用户自有仓库不在探测范围内。
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
  const managedGitDir = path.join(resolvedWorkspace, PETRI_DIR, 'git');
  const managedExists = fs.existsSync(path.join(managedGitDir, 'HEAD'));

  return {
    repositoryBindingVersion: REPOSITORY_BINDING_VERSION,
    workspaceRoot: resolvedWorkspace,
    workspaceExists: fs.existsSync(resolvedWorkspace),
    runtime,
    managed: { gitDir: managedGitDir, exists: managedExists },
  };
}

/**
 * 绑定项目到 Git 版本后端。
 *
 * @param {{
 *   workspaceRoot: string,
 *   projectId: string,
 *   createManagedIfMissing?: boolean,
 *   managedRelativePaths?: string[],
 *   gitBin?: string,
 *   identity?: { name: string, email: string }|null
 * }} options
 * @returns {{ status: string, mode: 'managed', ... }}
 */
function bindProjectRepository(options = {}) {
  const {
    workspaceRoot,
    projectId,
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
    mode: 'managed',
    adapter: null,
    managedPaths: managedRelativePaths,
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

  if (!inspection.managed.exists && !createManagedIfMissing) {
    return { ...base, status: 'blocked_repository_state', reason: 'managed_repository_absent' };
  }
  const adapter = createGitAdapter({
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
        status: 'blocked_repository_state',
        reason: 'managed_repository_init_failed',
        diagnostics: [redactGitDiagnostic(error.message, { workTree: inspection.workspaceRoot })],
      };
    }
  }

  const state = adapter.repositoryState();

  // 中途操作、索引锁一律先阻断，不猜测用户意图，也不删锁。
  if (state.hasIndexLock) {
    return { ...base, adapter, status: 'blocked_repository_state', reason: 'index_lock_present' };
  }
  if (state.midOperation) {
    return { ...base, adapter, status: 'blocked_repository_state', reason: 'repository_mid_operation' };
  }

  // 受管理路径必须落在工作区内。
  for (const managed of managedRelativePaths) {
    const absolute = path.resolve(adapter.workTree, managed);
    if (!isPathContained(adapter.workTree, absolute)) {
      return { ...base, adapter, status: 'blocked_workspace_invalid', reason: 'managed_path_escape' };
    }
  }

  // 托管仓库的工作区包含科学数据，整仓 status 既慢又无意义，
  // 因此不做 dirty 冲突检测——托管路径内的变更本就由 RS 版本化。

  return {
    ...base,
    adapter,
    repositoryState: state,
    status: 'ready',
    reason: null,
  };
}

/**
 * 托管元数据落点。全部锚定 workspaceRoot，与 project-run-layout 同源。
 */
function resolvePetriMetadataLayout(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const petriDir = path.join(root, PETRI_DIR);
  return {
    workspaceRoot: root,
    petriDir,
    managedGitDir: path.join(petriDir, 'git'),
    revisionDir: path.join(petriDir, 'revision'),
    checkpointDir: path.join(petriDir, 'checkpoints'),
    objectsDir: path.join(petriDir, 'objects'),
  };
}

module.exports = {
  REPOSITORY_BINDING_VERSION,
  BINDING_STATUSES,
  PETRI_DIR,
  MANAGED_RELATIVE_PATHS,
  inspectWorkspaceGit,
  bindProjectRepository,
  resolvePetriMetadataLayout,
};
