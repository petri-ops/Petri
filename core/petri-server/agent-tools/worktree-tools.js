'use strict';

/**
 * agent-tools/worktree-tools.js — BLOCK-336 P1 worktree 工具面四件。
 *
 * 纪律翻译（docs/worktree-governance.md → 代码）：
 *   create：§4 契约机械校验（helpers/worktree-contract.checkContract）后才 `git worktree add`；
 *   list：登记表 + 实时 git 真相（脏树 / 相对 baseRef 的 ahead-behind / 目录是否仍在）对账；
 *   remove：§7 四步前置（登记在 / 目录在 / 干净树 / 无未合并提交或显式确认）全过才 `git worktree remove`，
 *           **不带 --force**，脏树 fail-closed 把文件清单报明；
 *   merge_request：§6 只出摘要（ahead/behind、提交列表、diff --stat、文件状态）+ 登记表留痕，**绝不 merge**。
 * 所有 git 调用 execFile（无 shell），分支名经白名单校验（禁 `-` 开头）防参数注入；
 * 不触碰 `.git` 对象库；审批四档由 tool-metadata（needsApproval）+ 既有 policy 层统一执行。
 * 核心操作以 `(core, args)` 形式导出供契约测试在真 git 临时仓里红绿（不经 DB）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const db = require('../db');
const { authorizeProject } = require('./workspace-tools/internals');
const { resolveDataDir } = require('../../shared-backend/data-paths');
const contract = require('../helpers/worktree-contract');
// BLOCK-336 P3 — 生命周期事件（task_events 可观测流，best-effort；治理证据仍是 audit jsonl）
const { recordWorktreeEvent } = require('../helpers/worktree-events');

const GIT_TIMEOUT_MS = 20_000;
const MAX_LOG_LINES = 50;
const MAX_DIRTY_FILES = 20;

function runGit(args, cwd, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, code: typeof error.code === 'number' ? error.code : null, stdout: String(stdout || ''), stderr: String(stderr || error.message || '') });
        return;
      }
      resolve({ ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function fail(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

async function projectWorkspace(ctx = {}) {
  const projectId = typeof ctx.projectId === 'string' ? ctx.projectId.trim() : '';
  if (!projectId) return { error: fail('project_required', 'worktree 操作需要项目工作区。') };
  const project = db.getProject(projectId);
  if (!project) return { error: fail('project_not_found', '项目不存在') };
  try {
    authorizeProject(project, ctx.userId, db);
  } catch (error) {
    return { error: fail(error.code || 'permission_denied', error.message) };
  }
  if (project.workspace_kind && project.workspace_kind !== 'local') {
    return { error: fail('worktree_requires_local_workspace', 'worktree 只支持本地 git 工作区（ssh 项目不适用）。') };
  }
  if (!project.workspace_path) return { error: fail('workspace_path_missing', '项目没有工作区路径') };
  return { project, root: project.workspace_path };
}

/** 构造核心操作上下文（工具包装与测试共用）。 */
function buildCore({ root, projectId, dataDir, actor, database }) {
  return {
    root,
    projectId,
    dataDir: dataDir || resolveDataDir(),
    // BLOCK-336 P3：生命周期事件写入器需要连接（零项目依赖的注入点；测试可传坏连接验降级）
    database: database || db.getDatabase(),
    actor: {
      userId: (actor && actor.userId) || 'agent',
      agentId: (actor && actor.agentId) || null,
      conversationId: (actor && actor.conversationId) || null,
    },
  };
}

async function assertGitRepo(root) {
  if (!root || !fs.existsSync(root)) return fail('workspace_missing', `工作区目录不存在：${root}`);
  const top = await runGit(['rev-parse', '--show-toplevel'], root);
  if (!top.ok) return fail('not_a_git_repository', '工作区不是 git 仓库（worktree 需要 git 仓）。', { stderr: top.stderr.trim().slice(0, 300) });
  return { ok: true, toplevel: top.stdout.trim() };
}

async function branchExists(root, branch) {
  const r = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root);
  return r.ok;
}

async function aheadBehind(root, baseRef, ref) {
  // left=base 独有（behind），right=ref 独有（ahead）
  const r = await runGit(['rev-list', '--left-right', '--count', `${baseRef}...${ref}`], root);
  if (!r.ok) return { ok: false, ahead: null, behind: null, stderr: r.stderr.trim().slice(0, 200) };
  const [behind, ahead] = r.stdout.trim().split(/\s+/).map((n) => Number(n));
  return { ok: true, ahead: Number.isFinite(ahead) ? ahead : null, behind: Number.isFinite(behind) ? behind : null };
}

function findEntry(registry, projectId, args) {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const branch = typeof args.branch === 'string' ? args.branch.trim() : '';
  if (!id && !branch) return { error: fail('worktree_ref_required', '需要 id 或 branch 指定 worktree') };
  const entry = registry.entries.find((e) => e && e.projectId === projectId && e.status === 'active' && (id ? e.id === id : e.branch === branch));
  if (!entry) return { error: fail('worktree_not_found', `未登记的活动 worktree：${id || branch}`) };
  return { entry };
}

// ---------------------------------------------------------------------------
// 核心操作（导出供测试）
// ---------------------------------------------------------------------------

async function createWorktree(core, args = {}) {
  const branchCheck = contract.validateBranchName(args.branch);
  if (!branchCheck.ok) return fail(branchCheck.error, branchCheck.message);
  const branch = branchCheck.value;
  const baseRef = typeof args.baseRef === 'string' && args.baseRef.trim() ? args.baseRef.trim() : 'HEAD';
  if (baseRef.startsWith('-')) return fail('base_ref_invalid', 'baseRef 不能以 - 开头');
  const packageId = typeof args.packageId === 'string' && args.packageId.trim() ? args.packageId.trim().slice(0, 80) : null;
  const note = typeof args.note === 'string' ? args.note.trim().slice(0, 300) : '';

  const repo = await assertGitRepo(core.root);
  if (!repo.ok) return repo;

  const registry = contract.loadRegistry(core.dataDir);
  const dir = contract.worktreeDirFor(core.dataDir, core.projectId, branch);
  const agentId = core.actor.agentId || core.actor.conversationId || null;
  const check = contract.checkContract(registry, { projectId: core.projectId, branch, dir, agentId, packageId });
  if (!check.ok) return fail('worktree_contract_violation', '违反 worktree 一一对应契约（governance §4）', { violations: check.violations });
  if (fs.existsSync(dir)) return fail('worktree_dir_exists', `约定目录已存在：${dir}`);

  const exists = await branchExists(core.root, branch);
  const gitArgs = exists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', '-b', branch, dir, baseRef];
  const added = await runGit(gitArgs, core.root, 60_000);
  if (!added.ok) return fail('git_worktree_add_failed', 'git worktree add 失败', { stderr: added.stderr.trim().slice(0, 500), branchExisted: exists });

  const ordinal = contract.activeEntries(registry).length;
  const entry = {
    id: contract.newWorktreeId(),
    projectId: core.projectId,
    branch,
    baseRef,
    path: dir,
    createdAt: new Date().toISOString(),
    createdBy: core.actor.userId,
    agentId,
    conversationId: core.actor.conversationId,
    packageId,
    note,
    status: 'active',
    ports: contract.derivePortBase(process.env, ordinal),
    mergeRequests: [],
  };
  registry.entries.push(entry);
  contract.saveRegistry(core.dataDir, registry);
  contract.appendAudit(core.dataDir, { action: 'create', worktreeId: entry.id, projectId: core.projectId, branch, path: dir, baseRef, by: core.actor.userId, agentId, packageId });
  recordWorktreeEvent({
    database: core.database,
    worktreeId: entry.id,
    action: 'create',
    payload: { via: 'agent-tool', projectId: core.projectId, branch, path: dir, baseRef, packageId, agentId, by: core.actor.userId },
  });
  return { ok: true, worktree: entry, branchExisted: exists };
}

async function inspectEntry(core, entry) {
  const exists = fs.existsSync(entry.path);
  if (!exists) return { exists: false, dirty: null, modified: [], untracked: [], ahead: null, behind: null };
  const status = await runGit(['status', '--porcelain=v1', '-b'], entry.path);
  const parsed = status.ok ? contract.parsePorcelain(status.stdout) : { dirty: null, modified: [], untracked: [], branch: null };
  const ab = await aheadBehind(core.root, entry.baseRef || 'HEAD', entry.branch);
  return {
    exists: true,
    dirty: parsed.dirty,
    modified: parsed.modified.slice(0, MAX_DIRTY_FILES),
    untracked: parsed.untracked.slice(0, MAX_DIRTY_FILES),
    dirtyCount: parsed.modified.length + parsed.untracked.length,
    currentBranch: parsed.branch,
    ahead: ab.ahead,
    behind: ab.behind,
  };
}

async function listWorktrees(core) {
  const repo = await assertGitRepo(core.root);
  if (!repo.ok) return repo;
  const registry = contract.loadRegistry(core.dataDir);
  const known = await runGit(['worktree', 'list', '--porcelain'], core.root);
  // macOS `/var` → `/private/var` 等符号链接会让 registry 路径与 git 输出字面不等；
  // 两侧都 realpath 归一后再比对，否则 gitKnown 在合法 worktree 上恒为 false（BLOCK-336 P1 抓真）。
  const normalizePath = (target) => {
    try { return fs.realpathSync(target); } catch { return path.resolve(target); }
  };
  const gitPaths = new Set(
    known.ok ? known.stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => normalizePath(l.slice('worktree '.length))) : [],
  );
  const items = [];
  for (const entry of contract.activeEntries(registry, core.projectId)) {
    const live = await inspectEntry(core, entry);
    items.push({
      id: entry.id, branch: entry.branch, baseRef: entry.baseRef, path: entry.path, packageId: entry.packageId, agentId: entry.agentId,
      createdAt: entry.createdAt, createdBy: entry.createdBy, ports: entry.ports, mergeRequests: entry.mergeRequests?.length || 0,
      gitKnown: gitPaths.has(normalizePath(entry.path)), ...live,
    });
  }
  return { ok: true, worktrees: items, total: items.length, registry: contract.registryPath(core.dataDir) };
}

async function removeWorktree(core, args = {}) {
  const repo = await assertGitRepo(core.root);
  if (!repo.ok) return repo;
  const registry = contract.loadRegistry(core.dataDir);
  const found = findEntry(registry, core.projectId, args);
  if (found.error) return found.error;
  const { entry } = found;
  if (!fs.existsSync(entry.path)) {
    // 目录已不在（外部删除）：只收登记，不假装 git 成功
    entry.status = 'removed'; entry.removedAt = new Date().toISOString(); entry.removedBy = core.actor.userId; entry.removedReason = 'dir_missing';
    contract.saveRegistry(core.dataDir, registry);
    contract.appendAudit(core.dataDir, { action: 'remove', worktreeId: entry.id, projectId: core.projectId, branch: entry.branch, by: core.actor.userId, reason: 'dir_missing' });
    await runGit(['worktree', 'prune'], core.root);
    recordWorktreeEvent({ database: core.database, worktreeId: entry.id, action: 'remove', payload: { via: 'agent-tool', projectId: core.projectId, branch: entry.branch, reason: 'dir_missing' } });
    return { ok: true, removed: entry.id, note: '目录已不存在，仅收回登记并 prune。' };
  }
  const live = await inspectEntry(core, entry);
  if (live.dirty) {
    return fail('worktree_dirty', '工作树有未提交改动，拒绝删除（governance §7：先 commit/快照）。', {
      modified: live.modified, untracked: live.untracked, dirtyCount: live.dirtyCount,
    });
  }
  if ((live.ahead || 0) > 0 && args.allowUnmergedAhead !== true) {
    return fail('worktree_unmerged_ahead', `分支比 ${entry.baseRef} 多 ${live.ahead} 个未合并提交；先 merge_request 评审合并，或显式 allowUnmergedAhead=true 表示有意保留分支只删目录。`, {
      ahead: live.ahead, behind: live.behind,
    });
  }
  const removed = await runGit(['worktree', 'remove', entry.path], core.root, 60_000);
  if (!removed.ok) return fail('git_worktree_remove_failed', 'git worktree remove 失败（未使用 --force）', { stderr: removed.stderr.trim().slice(0, 500) });
  entry.status = 'removed'; entry.removedAt = new Date().toISOString(); entry.removedBy = core.actor.userId;
  entry.removedWithUnmergedAhead = (live.ahead || 0) > 0;
  contract.saveRegistry(core.dataDir, registry);
  contract.appendAudit(core.dataDir, { action: 'remove', worktreeId: entry.id, projectId: core.projectId, branch: entry.branch, by: core.actor.userId, ahead: live.ahead, behind: live.behind });
  recordWorktreeEvent({
    database: core.database,
    worktreeId: entry.id,
    action: 'remove',
    payload: { via: 'agent-tool', projectId: core.projectId, branch: entry.branch, reason: entry.removedWithUnmergedAhead ? 'allow_unmerged_ahead' : 'clean', ahead: live.ahead, behind: live.behind },
  });
  return { ok: true, removed: entry.id, branch: entry.branch, branchKept: true, note: '分支保留；只移除工作树目录。' };
}

async function mergeRequest(core, args = {}) {
  const repo = await assertGitRepo(core.root);
  if (!repo.ok) return repo;
  const registry = contract.loadRegistry(core.dataDir);
  const found = findEntry(registry, core.projectId, args);
  if (found.error) return found.error;
  const { entry } = found;
  const baseRef = typeof args.baseRef === 'string' && args.baseRef.trim() ? args.baseRef.trim() : (entry.baseRef || 'HEAD');
  if (baseRef.startsWith('-')) return fail('base_ref_invalid', 'baseRef 不能以 - 开头');
  const live = await inspectEntry(core, entry);
  const ab = await aheadBehind(core.root, baseRef, entry.branch);
  const log = await runGit(['log', '--oneline', `--max-count=${MAX_LOG_LINES}`, `${baseRef}..${entry.branch}`], core.root);
  const stat = await runGit(['diff', '--stat', `${baseRef}...${entry.branch}`], core.root);
  const names = await runGit(['diff', '--name-status', `${baseRef}...${entry.branch}`], core.root);
  const summary = {
    id: entry.id, branch: entry.branch, baseRef,
    ahead: ab.ahead, behind: ab.behind,
    commits: log.ok ? log.stdout.trim().split(/\r?\n/).filter(Boolean) : [],
    diffStat: stat.ok ? stat.stdout.trim().slice(0, 4000) : '',
    files: names.ok ? names.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [s, ...p] = l.split(/\t/); return { status: s, path: p.join('\t') }; }) : [],
    worktreeDirty: live.dirty,
    dirtyCount: live.dirtyCount || 0,
    merged: false,
    note: '只生成评审摘要；合并动作留人工（governance §6：经 git 提交/评审流，不自动 merge）。',
    at: new Date().toISOString(),
  };
  entry.mergeRequests = Array.isArray(entry.mergeRequests) ? entry.mergeRequests : [];
  entry.mergeRequests.push({ at: summary.at, baseRef, ahead: summary.ahead, behind: summary.behind, files: summary.files.length, worktreeDirty: summary.worktreeDirty });
  contract.saveRegistry(core.dataDir, registry);
  contract.appendAudit(core.dataDir, { action: 'merge_request', worktreeId: entry.id, projectId: core.projectId, branch: entry.branch, baseRef, ahead: summary.ahead, behind: summary.behind, by: core.actor.userId });
  recordWorktreeEvent({
    database: core.database,
    worktreeId: entry.id,
    action: 'merge_request',
    payload: { via: 'agent-tool', projectId: core.projectId, branch: entry.branch, baseRef, ahead: summary.ahead, behind: summary.behind, files: summary.files.length, merged: false },
  });
  return { ok: true, mergeRequest: summary };
}

// ---------------------------------------------------------------------------
// agent 工具包装（经 DB 解析项目 + 授权）
// ---------------------------------------------------------------------------

async function withCore(ctx, fn) {
  const ws = await projectWorkspace(ctx);
  if (ws.error) return ws.error;
  const core = buildCore({
    root: ws.root,
    projectId: ws.project.id,
    actor: { userId: ctx.userId, agentId: ctx.agentId || null, conversationId: ctx.conversationId || null },
  });
  return fn(core);
}

async function tool_workspace_worktree_create(args = {}, ctx = {}) {
  return withCore(ctx, (core) => createWorktree(core, args));
}
async function tool_workspace_worktree_list(_args = {}, ctx = {}) {
  return withCore(ctx, (core) => listWorktrees(core));
}
async function tool_workspace_worktree_remove(args = {}, ctx = {}) {
  return withCore(ctx, (core) => removeWorktree(core, args));
}
async function tool_workspace_worktree_merge_request(args = {}, ctx = {}) {
  return withCore(ctx, (core) => mergeRequest(core, args));
}

module.exports = {
  tool_workspace_worktree_create,
  tool_workspace_worktree_list,
  tool_workspace_worktree_remove,
  tool_workspace_worktree_merge_request,
  // 测试/消费者直连面（不经 DB）
  buildCore,
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeRequest,
};
