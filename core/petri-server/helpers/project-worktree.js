'use strict';

/**
 * helpers/project-worktree.js — BLOCK-336 P2 项目层 worktreeOf（声明式副本）。
 *
 * 为什么单开一层：db.js 只该管行；git 调用与「副本目录/分支/登记」纪律放这里，
 * 与 P1 的 `worktree-contract.js`（纯函数 + registry IO）同源，不建第二份登记真相。
 *
 * 纪律（docs/worktree-governance.md §4/§6/§7）：
 *   - 副本目录 `<dataDir>/worktrees/<新的 projectId>`（一层，不由调用方指定）；
 *   - 分支 `worktree/<新的 projectId>`（一项目一分支，可追溯）；
 *   - 删除**不带 `--force`**；脏树必须显式 `confirmDirty` 才允许强删（然后把文件清单落审计）；
 *   - 删除只移除工作树目录，**分支保留**（合并动作永远留人工，§6）。
 *
 * 全部同步（execFileSync）：db.createProject/updateProject/deleteProject 是同步签名，
 * 不为此改成 async 传染整个调用面。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const contract = require('./worktree-contract');
// BLOCK-336 P3 — 生命周期事件（best-effort；本模块顶层不引 db，避免 db→project-worktree→db 成环）
const { recordWorktreeEvent } = require('./worktree-events');

const GIT_TIMEOUT_MS = 60_000;
const MAX_DIRTY_FILES = 50;

function git(args, cwd) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, stdout: String(stdout || ''), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || error.message || ''),
    };
  }
}

function fail(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

function worktreeBranchFor(projectId) {
  return `worktree/${projectId}`;
}

/** 源项目可用性：本地工作区 + 真 git 仓；ssh 项目不适用（远程无本地仓）。 */
function resolveSourceRoot(source) {
  if (!source) fail('worktree_source_not_found', 'worktreeOf 指向的项目不存在');
  if (source.workspace_kind === 'ssh') {
    fail('worktree_ssh_incompatible', 'ssh 项目没有本地 git 仓，不能作为副本源');
  }
  const root = source.workspace_path;
  if (!root || !fs.existsSync(root)) fail('worktree_source_not_git', '源项目没有可用的本地工作区');
  const probe = git(['rev-parse', '--show-toplevel'], root);
  if (!probe.ok) fail('worktree_source_not_git', '源项目工作区不是 git 仓库', { stderr: probe.stderr.trim().slice(0, 300) });
  return probe.stdout.trim();
}

/** 从副本目录反推主仓根（`<root>/.git` 的父目录）；失败返回 null。 */
function mainRepoRootOf(worktreeDir) {
  const common = git(['rev-parse', '--git-common-dir'], worktreeDir);
  if (!common.ok) return null;
  return path.dirname(path.resolve(worktreeDir, common.stdout.trim()));
}

/**
 * 挂副本：git worktree add + registry 登记 + 审计。返回 { path, branch }。
 * 失败一律抛错（**不插项目行**，由调用方事务外的顺序保证）。
 */
function attach({ dataDir, projectId, source, userId = null, database }) {
  const root = resolveSourceRoot(source);
  const branch = worktreeBranchFor(projectId);
  const dir = path.join(dataDir, contract.WORKTREES_DIRNAME, String(projectId));

  if (fs.existsSync(dir)) fail('worktree_dir_exists', `副本目录已存在：${dir}`);

  const registry = contract.loadRegistry(dataDir);
  const check = contract.checkContract(registry, { projectId, branch, dir });
  if (!check.ok) {
    fail('worktree_contract_violation', '违反 worktree 一一对应契约（governance §4）', { violations: check.violations });
  }

  const added = git(['worktree', 'add', '-b', branch, dir, 'HEAD'], root);
  if (!added.ok) {
    fail('git_worktree_add_failed', 'git worktree add 失败', { stderr: added.stderr.trim().slice(0, 500) });
  }

  const ordinal = contract.activeEntries(registry).length;
  const entry = {
    id: contract.newWorktreeId(),
    projectId,
    branch,
    baseRef: 'HEAD',
    path: dir,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    agentId: null,
    conversationId: null,
    packageId: null,
    note: '项目层 worktreeOf 副本（BLOCK-336 P2）',
    sourceProjectId: source.id,
    status: 'active',
    ports: contract.derivePortBase(process.env, ordinal),
    mergeRequests: [],
  };
  registry.entries.push(entry);
  contract.saveRegistry(dataDir, registry);
  contract.appendAudit(dataDir, {
    action: 'create',
    via: 'project-layer',
    worktreeId: entry.id,
    projectId,
    sourceProjectId: source.id,
    branch,
    path: dir,
    by: userId,
  });
  recordWorktreeEvent({
    database,
    worktreeId: entry.id,
    action: 'create',
    payload: { via: 'project-layer', projectId, sourceProjectId: source.id, branch, path: dir, by: userId },
  });
  return { path: dir, branch, entry };
}

/** 脏树探测（副本目录）：{ dirty, files }。目录不在时视为不脏。 */
function inspectDirty(worktreeDir) {
  if (!worktreeDir || !fs.existsSync(worktreeDir)) return { dirty: false, files: [], missing: true };
  const status = git(['status', '--porcelain=v1'], worktreeDir);
  if (!status.ok) return { dirty: false, files: [], unknown: true };
  const parsed = contract.parsePorcelain(status.stdout);
  const files = [...parsed.modified, ...parsed.untracked].slice(0, MAX_DIRTY_FILES);
  return { dirty: parsed.dirty, files, total: parsed.modified.length + parsed.untracked.length };
}

/**
 * 拆副本：脏树未确认 → 抛 worktree_dirty（带 dirtyFiles）；确认后 `--force` 移除目录。
 * 分支永远保留；目录已不在时只收登记（不假装 git 成功）。
 */
function detach({ dataDir, project, confirmDirty = false, userId = null, database }) {
  if (!project || !project.worktree_of) return { removed: false, skipped: 'not_a_worktree' };
  const dir = project.workspace_path;
  const registry = contract.loadRegistry(dataDir);
  const entry = registry.entries.find((e) => e && e.projectId === project.id && e.status === 'active') || null;

  const markRemoved = (reason) => {
    if (entry) {
      entry.status = 'removed';
      entry.removedAt = new Date().toISOString();
      entry.removedBy = userId;
      entry.removedReason = reason;
      contract.saveRegistry(dataDir, registry);
    }
    contract.appendAudit(dataDir, {
      action: 'remove',
      via: 'project-layer',
      worktreeId: entry ? entry.id : null,
      projectId: project.id,
      branch: worktreeBranchFor(project.id),
      by: userId,
      reason,
    });
    recordWorktreeEvent({
      database,
      worktreeId: entry ? entry.id : project.id,
      action: 'remove',
      payload: { via: 'project-layer', projectId: project.id, branch: worktreeBranchFor(project.id), reason, by: userId },
    });
  };

  if (!dir || !fs.existsSync(dir)) {
    markRemoved('dir_missing');
    return { removed: false, reason: 'dir_missing' };
  }

  const state = inspectDirty(dir);
  if (state.dirty && !confirmDirty) {
    fail('worktree_dirty', '副本工作树有未提交改动，拒绝删除（governance §7：先 commit/快照）', {
      dirtyFiles: state.files,
      dirtyCount: state.total || state.files.length,
    });
  }

  const root = mainRepoRootOf(dir);
  const args = ['worktree', 'remove'];
  if (state.dirty && confirmDirty) args.push('--force');
  args.push(dir);
  const removed = root ? git(args, root) : { ok: false, stderr: 'main repo root not resolvable' };

  if (!removed.ok) {
    // git 侧失败（权限/锁/目录被占）：保持登记不动，让调用方看到真因
    fail('git_worktree_remove_failed', 'git worktree remove 失败', { stderr: String(removed.stderr || '').trim().slice(0, 500) });
  }

  markRemoved(confirmDirty && state.dirty ? 'confirmed_dirty' : 'clean');

  if (root) git(['worktree', 'prune'], root);
  return { removed: true, branchKept: true, forced: Boolean(state.dirty && confirmDirty) };
}

/**
 * 旧库（未跑 021 迁移）加载期自愈加列：带 worktree_of 的 prepared 语句在缺列时会直接
 * prepare 失败并炸掉整个 db 模块（legacy 库测试实测）。与迁移 021 幂等共存。
 */
function ensureProjectWorktreeColumn(database) {
  try {
    const columns = database.prepare('PRAGMA table_info(projects)').all().map((column) => column.name);
    if (!columns.includes('worktree_of')) database.exec('ALTER TABLE projects ADD COLUMN worktree_of TEXT');
  } catch {
    // projects 表尚不存在（全新库由迁移建表）→ 交给迁移
  }
}

/**
 * updateProject 的 worktreeOf 语义（收窄设计，见 plan §6）：
 *   - `null`/空串 → 解除声明（返回 null）
 *   - 同值 → 幂等（返回 undefined = 不写库）
 *   - 改挂到别的源 → 抛 worktree_rebind_requires_new_project
 */
function resolveWorktreeOfUpdate(current, requested) {
  if (requested === undefined) return undefined;
  if (requested === null || requested === '') return null;
  if (requested === current.worktree_of) return undefined;
  fail('worktree_rebind_requires_new_project', '不能把已有项目改挂到另一个 worktree 源；请新建项目（副本归属一旦建立不可静默改写）');
  return undefined;
}

module.exports = {
  worktreeBranchFor,
  resolveSourceRoot,
  mainRepoRootOf,
  attach,
  inspectDirty,
  detach,
  ensureProjectWorktreeColumn,
  resolveWorktreeOfUpdate,
};
