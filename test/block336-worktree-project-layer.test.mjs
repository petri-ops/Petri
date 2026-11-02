/**
 * BLOCK-336 P2 — 项目层 worktreeOf（声明式副本）。
 *
 * 契约（plan frontmatter P2）：
 *   createProject/updateProject 接受 `worktreeOf:<projectId>`——校验源仓是 git 仓、自动
 *   `git worktree add`、副本目录 `<dataDir>/worktrees/<新的 projectId>`、workspace_path 指向副本；
 *   deleteProject 联动清理副本，**脏树需显式确认**（否则 fail-closed 并列出文件）。
 *
 * 设计裁决（本包收窄，见 plan §6）：
 *   - 挂副本只在**新建项目**时发生；updateProject 的 worktreeOf 仅支持「同值幂等」与「置 null 解除声明」，
 *     改挂到别的源必须新建项目（防 workspace_path 归属被静默改写）。
 *   - 删除一律用同步 git（`execFileSync`），与 DB 层同步签名一致；**不带 `--force`**，分支保留。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const tempRoot = mkdtempSync(path.join(tmpdir(), 'block336-p2-'));
process.env.PETRI_DB_PATH = path.join(tempRoot, 'p2.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
const dataDir = process.env.PETRI_LOCAL_DATA_DIR;

// DB 自举（同 block67-routes / block109 姿势）
{
  const Database = require('better-sqlite3');
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = path.join(ROOT, 'src', 'migrations');
  for (const file of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(path.join(migDir, file), 'utf8'));
  }
  boot.close();
}

const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
const contract = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'worktree-contract.js'));

after(() => {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
});

const GIT_IDENTITY = ['-c', 'user.email=block336-p2@example.test', '-c', 'user.name=block336-p2'];

function git(args, cwd) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeSourceRepo(label) {
  const dir = mkdtempSync(path.join(tempRoot, `src-${label}-`));
  writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(['init', '-q'], dir);
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `期望 code=${code}，实际=${error.code}（${error.message}）`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 数据层
// ---------------------------------------------------------------------------

test('BLOCK-336 P2 迁移：projects 表新增 worktree_of 列（可空）', () => {
  const columns = db.getDatabase().prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  assert.ok(columns.includes('worktree_of'), `projects 缺 worktree_of 列：${columns.join(',')}`);
});

test('BLOCK-336 P2 createProject(worktreeOf)：自动建副本、workspace_path 指向副本、登记 + 审计', () => {
  const repo = makeSourceRepo('create');
  const source = db.createProject({ name: '源项目-create', workspacePath: repo });

  const child = db.createProject({ name: '副本项目-create', worktreeOf: source.id });
  assert.equal(child.worktree_of, source.id);
  assert.equal(child.workspace_kind, 'local');
  assert.equal(child.workspace_path, path.join(dataDir, 'worktrees', child.id), '副本目录按 <dataDir>/worktrees/<projectId> 约定');
  assert.ok(existsSync(child.workspace_path), '副本目录应已创建');
  assert.ok(existsSync(path.join(child.workspace_path, 'README.md')), '副本应检出源仓内容');

  const branch = `worktree/${child.id}`;
  assert.ok(git(['branch', '--list', branch], repo).includes(branch), '源仓应有副本分支');
  const listed = git(['worktree', 'list', '--porcelain'], repo);
  assert.ok(listed.includes(child.workspace_path) || listed.includes(require('node:fs').realpathSync(child.workspace_path)), 'git 应认领该副本');

  const entry = contract.loadRegistry(dataDir).entries.find((e) => e.projectId === child.id);
  assert.ok(entry, 'registry 应有副本条目');
  assert.equal(entry.status, 'active');
  assert.equal(entry.branch, branch);
  assert.equal(entry.path, child.workspace_path);
  assert.ok(existsSync(contract.auditPath(dataDir)), '审计 jsonl 应已写入');
});

test('BLOCK-336 P2 createProject(worktreeOf) fail-closed：源不存在 / 非 git 仓 / ssh 不兼容', () => {
  expectCode(() => db.createProject({ name: '坏源', worktreeOf: 'p_not_exist' }), 'worktree_source_not_found');

  const plain = mkdtempSync(path.join(tempRoot, 'plain-'));
  const plainProject = db.createProject({ name: '非 git 源', workspacePath: plain });
  expectCode(() => db.createProject({ name: '坏源2', worktreeOf: plainProject.id }), 'worktree_source_not_git');

  const sshSource = db.createProject({ name: 'ssh 源', workspaceKind: 'ssh', sshHost: 'host', remotePath: '/srv/x' });
  expectCode(() => db.createProject({ name: '副本 of ssh', worktreeOf: sshSource.id }), 'worktree_ssh_incompatible');
});

test('BLOCK-336 P2 updateProject(worktreeOf)：改挂拒绝、同值幂等、null 解除声明但不删目录', () => {
  const repoA = makeSourceRepo('updA');
  const repoB = makeSourceRepo('updB');
  const sourceA = db.createProject({ name: '源A', workspacePath: repoA });
  const sourceB = db.createProject({ name: '源B', workspacePath: repoB });
  const child = db.createProject({ name: '副本-upd', worktreeOf: sourceA.id });

  expectCode(() => db.updateProject(child.id, { worktreeOf: sourceB.id }), 'worktree_rebind_requires_new_project');

  const same = db.updateProject(child.id, { worktreeOf: sourceA.id });
  assert.equal(same.worktree_of, sourceA.id, '同值幂等应通过');
  assert.equal(same.workspace_path, child.workspace_path, '幂等不改路径');

  const cleared = db.updateProject(child.id, { worktreeOf: null });
  assert.equal(cleared.worktree_of, null, 'null 解除声明');
  assert.equal(cleared.workspace_path, child.workspace_path, '解除声明不动 workspace_path');
  assert.ok(existsSync(child.workspace_path), '解除声明不删副本目录（目录归 git/用户处置）');
});

test('BLOCK-336 P2 deleteProject：干净副本联动清理（分支保留、registry 转 removed）', () => {
  const repo = makeSourceRepo('delClean');
  const source = db.createProject({ name: '源-delClean', workspacePath: repo });
  const child = db.createProject({ name: '副本-delClean', worktreeOf: source.id });
  const childWorkspace = child.workspace_path;

  db.deleteProject(child.id);
  assert.equal(db.getProject(child.id), null, '项目行应删除');
  assert.equal(existsSync(childWorkspace), false, '副本目录应移除');
  assert.ok(git(['branch', '--list', `worktree/${child.id}`], repo).includes(`worktree/${child.id}`), '分支必须保留');
  const entry = contract.loadRegistry(dataDir).entries.find((e) => e.projectId === child.id);
  assert.equal(entry.status, 'removed');
  assert.ok(entry.removedAt);
});

test('BLOCK-336 P2 deleteProject：脏树未确认 fail-closed（列文件、项目与目录都在），确认后才清', () => {
  const repo = makeSourceRepo('delDirty');
  const source = db.createProject({ name: '源-delDirty', workspacePath: repo });
  const child = db.createProject({ name: '副本-delDirty', worktreeOf: source.id });
  writeFileSync(path.join(child.workspace_path, 'dirty.txt'), 'dirty\n');

  assert.throws(
    () => db.deleteProject(child.id),
    (error) => {
      assert.equal(error.code, 'worktree_dirty');
      assert.ok(Array.isArray(error.dirtyFiles) && error.dirtyFiles.includes('dirty.txt'), '错误里应列出脏文件');
      return true;
    }
  );
  assert.ok(db.getProject(child.id), '脏树未确认时项目必须仍在');
  assert.ok(existsSync(child.workspace_path), '脏树未确认时目录必须仍在');

  db.deleteProject(child.id, { confirmDirty: true });
  assert.equal(db.getProject(child.id), null);
  assert.equal(existsSync(child.workspace_path), false);
});

test('BLOCK-336 P2 deleteProject：非副本项目零回归（不碰 git、不报错）', () => {
  const plain = mkdtempSync(path.join(tempRoot, 'reg-'));
  const project = db.createProject({ name: '普通项目', workspacePath: plain });
  db.deleteProject(project.id);
  assert.equal(db.getProject(project.id), null);
});

// ---------------------------------------------------------------------------
// REST 腿（POST/PUT/DELETE /api/data/projects）
// ---------------------------------------------------------------------------

test('BLOCK-336 P2 REST：POST 透传 worktreeOf / PUT 改挂 400 / DELETE 脏树 409 与确认 200', async () => {
  const express = require('express');
  // conversations 表由 helper 模块加载即建（生产路径同源）；缺它 DELETE 会 500「no such table」
  require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'conversations.js'));
  const router = require(path.join(ROOT, 'core', 'petri-server', 'api-data.js'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u-test', role: 'admin' }; next(); });
  app.use('/api/data', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/data`;

  try {
    const repo = makeSourceRepo('rest');
    const sourceRes = await fetch(`${base}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'REST 源', workspacePath: repo }),
    });
    const source = (await sourceRes.json()).project;

    const createRes = await fetch(`${base}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'REST 副本', worktreeOf: source.id }),
    });
    assert.equal(createRes.status, 200);
    const child = (await createRes.json()).project;
    assert.equal(child.worktree_of, source.id);
    assert.equal(child.workspace_path, path.join(dataDir, 'worktrees', child.id));

    const otherRepo = makeSourceRepo('restB');
    const otherRes = await fetch(`${base}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'REST 源B', workspacePath: otherRepo }),
    });
    const other = (await otherRes.json()).project;
    const rebind = await fetch(`${base}/projects/${child.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worktreeOf: other.id }),
    });
    assert.equal(rebind.status, 400, '改挂必须 400');

    writeFileSync(path.join(child.workspace_path, 'dirty.txt'), 'dirty\n');
    const denied = await fetch(`${base}/projects/${child.id}`, { method: 'DELETE' });
    assert.equal(denied.status, 409, '脏树未确认应 409');
    const deniedBody = await denied.json();
    assert.ok((deniedBody.dirtyFiles || []).includes('dirty.txt'), '409 应回传脏文件清单');
    assert.ok(db.getProject(child.id), '409 后项目仍在');

    const confirmed = await fetch(`${base}/projects/${child.id}?confirmWorktreeDirty=1`, { method: 'DELETE' });
    assert.equal(confirmed.status, 200);
    assert.equal(db.getProject(child.id), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
