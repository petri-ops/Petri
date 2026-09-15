// BLOCK-89 P1c — 工作区文件操作（move/copy/delete/mkdir）路由级契约测试。
// 零网络，复用 block67-routes / block73-hidden-files 路由级 harness 模式：
// local 分支打真 fs（临时目录）；ssh 分支以记录型 fake backend 锁定「路由透传 + 错误映射」契约。
// 语义基线（plan D4）：目标已存在 → 409 target_already_exists；路径越界 → 400；源缺失 → 404。

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tempRoot = mkdtempSync(join(tmpdir(), 'block89-fileops-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'routes.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.BIOF3_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(require('node:path').resolve(migDir, f), 'utf8'));
  }
  boot.close();
}

const db = require('../core/biof3-server/db');
const gateway = require('../core/biof3-server/helpers/workspace-gateway');
const express = require('express');

let server;
let baseUrl;
const app = express();
app.use(express.json());

// 记录型 fake ssh 后端：exists 集合控制存在性，calls 记录方法调用断言透传。
function makeFakeSshBackend() {
  const calls = [];
  const backend = {
    calls,
    exists: new Set(),
    async stat(p) {
      calls.push(['stat', p]);
      if (backend.exists.has(p)) return { type: 'file', size: 1, mtimeMs: 1 };
      const e = new Error('not_found');
      e.remoteError = 'not_found';
      throw e;
    },
    async mv(src, dst) {
      calls.push(['mv', src, dst]);
      backend.exists.delete(src);
      backend.exists.add(dst);
      return { type: 'file', size: 1, mtimeMs: 2 };
    },
    async cp(src, dst) {
      calls.push(['cp', src, dst]);
      backend.exists.add(dst);
      return { type: 'file', size: 1, mtimeMs: 3 };
    },
    async rm(p) {
      calls.push(['rm', p]);
      backend.exists.delete(p);
      return { removed: true };
    },
    async mkdir(p) {
      calls.push(['mkdir', p]);
      backend.exists.add(p);
      return { type: 'dir', size: 0, mtimeMs: 4 };
    },
  };
  return backend;
}

const fakeSsh = makeFakeSshBackend();
const origResolve = gateway.resolveWorkspaceBackend;

before(async () => {
  const files = require('../core/biof3-server/routes/files');
  gateway.resolveWorkspaceBackend = (project) => {
    if (project?.workspace_kind === 'ssh') {
      return { backend: fakeSsh, root: project.remote_path };
    }
    return origResolve(project);
  };
  files(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  gateway.resolveWorkspaceBackend = origResolve;
  await server?.close();
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

async function post(projectId, verb, body) {
  const r = await fetch(`${baseUrl}/api/workspaces/${projectId}/fs/${verb}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function createLocalProject(name) {
  const p = db.createProject({ name });
  return p;
}

function createSshProject(name) {
  const p = db.createProject({ name, workspacePath: undefined });
  require('../core/biof3-server/db').getDatabase()
    .prepare("UPDATE projects SET workspace_kind='ssh', ssh_host='fake', remote_path='/srv/proj' WHERE id=?")
    .run(p.id);
  return p;
}

// ── local：真 fs 全操作链 ────────────────────────────────────────────

test('local mkdir: 建目录成功 + 重复建 409', async (t) => {
  const p = createLocalProject('block89-local-mkdir');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const ok = await post(p.id, 'mkdir', { path: 'datasets/raw' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.ok, true);
  assert.strictEqual(ok.body.entry.type, 'dir');
  assert.ok(existsSync(join(p.workspace_path, 'datasets', 'raw')));

  const dup = await post(p.id, 'mkdir', { path: 'datasets/raw' });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.code, 'target_already_exists');
});

test('local move: 文件移动（目标父目录自动建）+ 内容保留 + 源消失', async (t) => {
  const p = createLocalProject('block89-local-move');
  writeFileSync(join(p.workspace_path, 'a.txt'), 'move me');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const ok = await post(p.id, 'move', { fromPath: 'a.txt', toPath: 'sub/dir/b.txt' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.entry.type, 'file');
  assert.ok(!existsSync(join(p.workspace_path, 'a.txt')));
  assert.strictEqual(readFileSync(join(p.workspace_path, 'sub', 'dir', 'b.txt'), 'utf-8'), 'move me');
});

test('local move: 目录递归迁移 + 目标在源内部 400', async (t) => {
  const p = createLocalProject('block89-local-movedir');
  mkdirSync(join(p.workspace_path, 'src', 'inner'), { recursive: true });
  writeFileSync(join(p.workspace_path, 'src', 'inner', 'deep.txt'), 'd');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const ok = await post(p.id, 'move', { fromPath: 'src', toPath: 'dst' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.entry.type, 'dir');
  assert.strictEqual(readFileSync(join(p.workspace_path, 'dst', 'inner', 'deep.txt'), 'utf-8'), 'd');

  const inward = await post(p.id, 'move', { fromPath: 'dst', toPath: 'dst/inner/evil' });
  assert.strictEqual(inward.status, 400);
});

test('local copy: 文件与目录递归复制，源保留', async (t) => {
  const p = createLocalProject('block89-local-copy');
  writeFileSync(join(p.workspace_path, 'a.txt'), 'copy me');
  mkdirSync(join(p.workspace_path, 'srcdir'), { recursive: true });
  writeFileSync(join(p.workspace_path, 'srcdir', 'x.txt'), 'x');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const file = await post(p.id, 'copy', { fromPath: 'a.txt', toPath: 'copy/a.txt' });
  assert.strictEqual(file.status, 200);
  assert.strictEqual(readFileSync(join(p.workspace_path, 'copy', 'a.txt'), 'utf-8'), 'copy me');
  assert.strictEqual(readFileSync(join(p.workspace_path, 'a.txt'), 'utf-8'), 'copy me', 'source kept');

  const dir = await post(p.id, 'copy', { fromPath: 'srcdir', toPath: 'copy/srcdir' });
  assert.strictEqual(dir.status, 200);
  assert.strictEqual(readFileSync(join(p.workspace_path, 'copy', 'srcdir', 'x.txt'), 'utf-8'), 'x');
});

test('local delete: 多路径批量真删（文件+目录）', async (t) => {
  const p = createLocalProject('block89-local-delete');
  writeFileSync(join(p.workspace_path, 'a.txt'), 'a');
  mkdirSync(join(p.workspace_path, 'dir'), { recursive: true });
  writeFileSync(join(p.workspace_path, 'dir', 'b.txt'), 'b');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const ok = await post(p.id, 'delete', { paths: ['a.txt', 'dir'] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.removed, 2);
  assert.ok(!existsSync(join(p.workspace_path, 'a.txt')));
  assert.ok(!existsSync(join(p.workspace_path, 'dir')));
});

test('local 冲突与边界: 409 已存在 / 404 源缺失 / 400 越界与缺参', async (t) => {
  const p = createLocalProject('block89-local-edge');
  writeFileSync(join(p.workspace_path, 'a.txt'), 'A');
  writeFileSync(join(p.workspace_path, 'b.txt'), 'B');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const conflict = await post(p.id, 'copy', { fromPath: 'a.txt', toPath: 'b.txt' });
  assert.strictEqual(conflict.status, 409);
  assert.strictEqual(conflict.body.code, 'target_already_exists');
  assert.strictEqual(readFileSync(join(p.workspace_path, 'b.txt'), 'utf-8'), 'B', 'conflict leaves target untouched');

  const moveConflict = await post(p.id, 'move', { fromPath: 'a.txt', toPath: 'b.txt' });
  assert.strictEqual(moveConflict.status, 409);

  const missing = await post(p.id, 'move', { fromPath: 'nope.txt', toPath: 'x.txt' });
  assert.strictEqual(missing.status, 404);

  const delMissing = await post(p.id, 'delete', { paths: ['nope.txt'] });
  assert.strictEqual(delMissing.status, 404);

  const escape = await post(p.id, 'delete', { paths: ['../escape.txt'] });
  assert.strictEqual(escape.status, 400);

  const noArgs = await post(p.id, 'move', { fromPath: 'a.txt' });
  assert.strictEqual(noArgs.status, 400);
});

// ── ssh：fake backend 透传 + 错误映射契约（与 local 同构，D1） ─────────

test('ssh move/copy/delete/mkdir: 路由透传 backend 方法（零本地 fs 触碰）', async (t) => {
  const p = createSshProject('block89-ssh-ops');
  fakeSsh.calls.length = 0;
  fakeSsh.exists.clear();
  fakeSsh.exists.add('/srv/proj/a.txt');

  const mv = await post(p.id, 'move', { fromPath: 'a.txt', toPath: 'b.txt' });
  assert.strictEqual(mv.status, 200);
  const cp = await post(p.id, 'copy', { fromPath: 'b.txt', toPath: 'c.txt' });
  assert.strictEqual(cp.status, 200);
  const del = await post(p.id, 'delete', { paths: ['c.txt'] });
  assert.strictEqual(del.status, 200);
  const mk = await post(p.id, 'mkdir', { path: 'newdir' });
  assert.strictEqual(mk.status, 200);

  const verbs = fakeSsh.calls.map((c) => c[0]);
  assert.deepStrictEqual(
    verbs,
    ['stat', 'stat', 'mv', 'stat', 'stat', 'cp', 'stat', 'rm', 'stat', 'mkdir'],
    'each op = source/target stat precheck + backend call'
  );
  assert.ok(fakeSsh.calls.every((c) => String(c[1]).startsWith('/srv/proj')), 'all ops stay under remote root');
});

test('ssh 错误映射: 目标已存在 409 / classified 502 / 源缺失 404（与 local 同语义）', async (t) => {
  const p = createSshProject('block89-ssh-errors');
  fakeSsh.calls.length = 0;
  fakeSsh.exists.clear();
  fakeSsh.exists.add('/srv/proj/a.txt');
  fakeSsh.exists.add('/srv/proj/b.txt');

  const conflict = await post(p.id, 'copy', { fromPath: 'a.txt', toPath: 'b.txt' });
  assert.strictEqual(conflict.status, 409);
  assert.strictEqual(conflict.body.code, 'target_already_exists');

  // classified 连接错误 → 502
  const errBackend = {
    async stat() { const e = new Error('boom'); e.classified = { kind: 'auth_failed', retryable: false }; throw e; },
  };
  gateway.resolveWorkspaceBackend = (project) => (
    project?.workspace_kind === 'ssh' ? { backend: errBackend, root: project.remote_path } : origResolve(project)
  );
  try {
    const connFail = await post(p.id, 'move', { fromPath: 'a.txt', toPath: 'x.txt' });
    assert.strictEqual(connFail.status, 502);
    assert.match(connFail.body.error, /远程连接失败/);
  } finally {
    gateway.resolveWorkspaceBackend = (project) => (
      project?.workspace_kind === 'ssh' ? { backend: fakeSsh, root: project.remote_path } : origResolve(project)
    );
  }

  fakeSsh.exists.clear();
  const missing = await post(p.id, 'move', { fromPath: 'nope.txt', toPath: 'x.txt' });
  assert.strictEqual(missing.status, 404);

  const escape = await post(p.id, 'mkdir', { path: '../../etc' });
  assert.strictEqual(escape.status, 400);
});
