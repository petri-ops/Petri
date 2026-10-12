'use strict';

/**
 * helpers/workspace-checkpoint.js — 工作树 checkpoint 安全网（BLOCK-176 CP-17）。
 *
 * 机制：git 仓库工作空间用 `git stash create` 产生**无副作用**快照 commit
 * （工作树/索引保持不动），返回 stash 式 ref 登记在内存/磁盘；回滚 =
 * `git checkout <ref> -- .`（跟踪文件恢复到快照态）+ 清理未跟踪新增文件。
 * - 快照只增不删（登记文件保留审计）；回滚后登记条目标记 rolled-back。
 * - 诚实边界：仅支持 git 仓库工作空间；非 git/无 git 二进制=诚实拒绝。
 * - 安全语义：不触碰已暂存内容之外的 HEAD 历史；未跟踪新文件在快照时
 *   `add -N` 纳入意图登记，回滚时删除。
 */

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const checkpoints = new Map(); // workspaceRoot -> [{ ref, createdAt, rolledBack }]
const MAX_CHECKPOINTS_PER_WORKSPACE = 10;

function runGitEnv(cwd, envExtra, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...envExtra } }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

/** 工作空间是否为 git 仓库（.git 目录/文件在根或任一祖先——git 自行发现）。 */
async function isGitWorkspace(workspaceRoot) {
  const probe = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
  return probe.ok && probe.stdout.trim() === 'true';
}

/**
 * 创建 checkpoint：plumbing 三步（临时索引 write-tree + commit-tree）——
 * 全程**无副作用**（不动真实索引/工作树/HEAD），且捕获未跟踪文件。
 * 纯净工作树=created:false（诚实无快照）。
 */
async function createCheckpoint(workspaceRoot) {
  if (!await isGitWorkspace(workspaceRoot)) {
    return { ok: false, code: 'not_a_git_repo', message: '工作空间不是 git 仓库，checkpoint 仅支持 git 工作空间' };
  }
  const tmpIndex = path.join(os.tmpdir(), `petri-ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const withTmpIndex = (args) => {
    const merged = ['--git-dir', path.join(workspaceRoot, '.git'), '--work-tree', workspaceRoot];
    // read-tree/add/write-tree 走临时索引（env 级隔离，真实索引零接触）
    return runGitEnv(workspaceRoot, { GIT_INDEX_FILE: tmpIndex }, args, merged);
  };
  try {
    const headExists = (await runGit(workspaceRoot, ['rev-parse', '--verify', 'HEAD'])).ok;
    if (headExists) {
      await withTmpIndex(['read-tree', 'HEAD']);
    }
    await withTmpIndex(['add', '-A', '.']);
    const tree = await withTmpIndex(['write-tree']);
    if (!tree.ok) return { ok: false, code: 'checkpoint_failed', message: tree.stderr };
    const treeSha = tree.stdout.trim();
    // 纯净工作树检测：树与 HEAD 树一致=无变更（诚实 created:false，不产空 checkpoint）
    if (headExists) {
      const headTree = await runGit(workspaceRoot, ['rev-parse', 'HEAD^{tree}']);
      if (headTree.ok && headTree.stdout.trim() === treeSha) {
        return { ok: true, created: false, ref: null, message: '工作树与 HEAD 一致，无需快照' };
      }
    }
    const parents = headExists ? ['-p', 'HEAD'] : [];
    // commit-tree 不带 -m 会挂起等 stdin——必须显式给消息
    const commit = await runGit(workspaceRoot, ['commit-tree', treeSha, ...parents, '-m', 'petri checkpoint (BLOCK-176 CP-17)']);
    if (!commit.ok) return { ok: false, code: 'checkpoint_failed', message: commit.stderr };
    const ref = commit.stdout.trim();
    if (!ref) return { ok: false, code: 'checkpoint_failed', message: 'commit-tree 无输出' };
    const list = checkpoints.get(workspaceRoot) || [];
    list.unshift({ ref, createdAt: new Date().toISOString(), rolledBack: false });
    while (list.length > MAX_CHECKPOINTS_PER_WORKSPACE) list.pop();
    checkpoints.set(workspaceRoot, list);
    return { ok: true, created: true, ref };
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch { /* 临时索引已自清理 */ }
  }
}

/** 回滚到指定（或最新）checkpoint：checkout 快照树 + 清理快照后新增的未跟踪文件。 */
async function rollbackToCheckpoint(workspaceRoot, ref) {
  const list = checkpoints.get(workspaceRoot);
  const target = ref
    ? (list || []).find((entry) => entry.ref === ref)
    : (list || []).find((entry) => !entry.rolledBack);
  if (!target) return { ok: false, code: 'checkpoint_not_found', message: 'checkpoint 不存在或已回滚' };
  // 恢复跟踪文件到快照树
  const checkout = await runGit(workspaceRoot, ['checkout', target.ref, '--', '.']);
  if (!checkout.ok) return { ok: false, code: 'rollback_failed', message: checkout.stderr };
  // 删除快照之后新增的未跟踪文件（不含 .petri 与 .git）
  const clean = await runGit(workspaceRoot, ['clean', '-fd', '--', '.']);
  target.rolledBack = true;
  return { ok: checkout.ok && clean.ok, ref: target.ref };
}

function listCheckpoints(workspaceRoot) {
  return (checkpoints.get(workspaceRoot) || []).map((entry) => ({ ...entry }));
}

module.exports = {
  isGitWorkspace,
  createCheckpoint,
  rollbackToCheckpoint,
  listCheckpoints,
  _checkpoints: checkpoints,
};
