// BLOCK-176 CP-17 — 工作树 checkpoint 安全网契约（git stash create 无副作用快照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { execFileSync } = require('node:child_process');

const {
  isGitWorkspace,
  createCheckpoint,
  rollbackToCheckpoint,
  listCheckpoints,
} = require('../core/shared-backend/workspace-checkpoint.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b176-ckpt-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  git(root, ['config', 'user.email', 'probe@petri.local']);
  git(root, ['config', 'user.name', 'probe']);
  fs.writeFileSync(path.join(root, 'data.csv'), 'gene,fc\nA,1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  return root;
}

test('CP-17：checkpoint 创建无副作用（工作树保持脏态），回滚恢复到快照态', async () => {
  const root = makeRepo();
  // 先弄脏（模拟 agent 已写入的工作态），再建 checkpoint——安全网捕获「当前工作态」
  fs.writeFileSync(path.join(root, 'data.csv'), 'gene,fc\nA,999\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'new');

  const created = await createCheckpoint(root);
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.match(created.ref, /^[0-9a-f]{40}$/);

  // 快照无副作用：checkpoint 后的进一步破坏不被快照触碰
  fs.writeFileSync(path.join(root, 'data.csv'), 'gene,fc\nA,555\n');
  assert.equal(fs.readFileSync(path.join(root, 'data.csv'), 'utf8'), 'gene,fc\nA,555\n', '快照无副作用');

  // 回滚：恢复到 checkpoint 时刻内容（A,999），而非更早的 HEAD（A,1）
  const rolled = await rollbackToCheckpoint(root, created.ref);
  assert.equal(rolled.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'data.csv'), 'utf8'), 'gene,fc\nA,999\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('CP-17：纯工作树=created:false（诚实无快照）；非 git=拒绝', async () => {
  const root = makeRepo();
  const empty = await createCheckpoint(root);
  assert.equal(empty.ok, true);
  assert.equal(empty.created, false);

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b176-plain-'));
  const notGit = await createCheckpoint(plain);
  assert.equal(notGit.ok, false);
  assert.equal(notGit.code, 'not_a_git_repo');
  fs.rmSync(plain, { recursive: true, force: true });
});

test('CP-17：回滚未知 ref=checkpoint_not_found；清单可见', async () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'x.txt'), 'x');
  await createCheckpoint(root);
  const missing = await rollbackToCheckpoint(root, 'deadbeef');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'checkpoint_not_found');
  assert.equal(listCheckpoints(root).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('CP-17：isGitWorkspace 非仓库目录=false', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b176-plain2-'));
  assert.equal(await isGitWorkspace(plain), false);
  fs.rmSync(plain, { recursive: true, force: true });
});
