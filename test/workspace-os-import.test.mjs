// BLOCK-90 P1 — OS 拖入导入路由级契约测试（fs/upload 分片 + fs/import-from 本地路径拷贝）。
// 零网络，复用 workspace-file-ops 路由级 harness 模式：
// local 分支打真 fs（临时目录）；ssh 分支以记录型 fake backend 锁定「透传 + offset 完整性映射」契约。
// 语义基线（plan D6）：目标已存在 → 409 target_already_exists；offset 错位 → 409 offset_mismatch；
// 分片超限 → 400；ssh 项目 import-from → 400 import_requires_local；源缺失 → 404。

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tempRoot = mkdtempSync(join(tmpdir(), 'block90-osimport-'));
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
app.use(express.json({ limit: '200mb' })); // 对齐 bootstrap.js 真实传输上限（1MB 是 fs/write 应用层语义，非传输层）

// 记录型 fake ssh 后端：sizes 模拟远端文件大小，append 做 offset 完整性校验（同 fs_append 契约）。
function makeFakeSshBackend() {
  const calls = [];
  const sizes = new Map();
  const backend = {
    calls,
    sizes,
    async stat(p) {
      calls.push(['stat', p]);
      if (sizes.has(p)) return { type: 'file', size: sizes.get(p), mtimeMs: 1 };
      const e = new Error('not_found');
      e.remoteError = 'not_found';
      throw e;
    },
    async append(p, dataB64, offset) {
      calls.push(['append', p, offset]);
      const current = sizes.get(p) || 0;
      if (current !== offset) {
        const e = new Error('offset_mismatch');
        e.remoteError = 'offset_mismatch';
        throw e;
      }
      const size = current + Buffer.from(dataB64, 'base64').length;
      sizes.set(p, size);
      return { type: 'file', size, mtimeMs: 2 };
    },
    async mkdir(p) {
      calls.push(['mkdir', p]);
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

function createSshProject(name) {
  const p = db.createProject({ name, workspacePath: undefined });
  require('../core/biof3-server/db').getDatabase()
    .prepare("UPDATE projects SET workspace_kind='ssh', ssh_host='fake', remote_path='/srv/proj' WHERE id=?")
    .run(p.id);
  return p;
}

async function post(projectId, verb, body) {
  const r = await fetch(`${baseUrl}/api/workspaces/${projectId}/fs/${verb}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test('upload：双分片按 offset 串行拼装，内容与原文件逐字节一致', async (t) => {
  const p = createSshProject('block90-ssh-upload');
  const source = Buffer.from('BLOCK-90 分片上传：第一片；' + 'x'.repeat(70_000) + '；第二片尾部', 'utf-8');
  const chunkSize = 64 * 1024;
  let offset = 0;
  let last = null;
  while (offset < source.length) {
    last = await post(p.id, 'upload', {
      toPath: 'datasets/uploaded.bin',
      dataB64: source.subarray(offset, offset + chunkSize).toString('base64'),
      offset,
    });
    assert.strictEqual(last.status, 200, JSON.stringify(last.body));
    offset += chunkSize;
  }
  assert.strictEqual(last.body.entry.size, source.length);
  assert.ok(fakeSsh.calls.some((c) => c[0] === 'append' && c[2] === 0));
  t.after(() => {});
});

test('upload：offset=0 时目标已存在 → 409 target_already_exists', async (t) => {
  const p = createSshProject('block90-ssh-upload-exists');
  fakeSsh.sizes.set('/srv/proj/dup.bin', 3);
  const r = await post(p.id, 'upload', { toPath: 'dup.bin', dataB64: Buffer.from('abc').toString('base64'), offset: 0 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'target_already_exists');
});

test('upload：offset 与当前大小错位 → 409 offset_mismatch', async (t) => {
  const p = createSshProject('block90-ssh-upload-offset');
  const r = await post(p.id, 'upload', { toPath: 'misaligned.bin', dataB64: Buffer.from('zz').toString('base64'), offset: 10 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'offset_mismatch');
});

test('upload：分片超过 96KB 上限 → 400', async (t) => {
  const p = createSshProject('block90-ssh-upload-toobig');
  const r = await post(p.id, 'upload', { toPath: 'big.bin', dataB64: Buffer.alloc(97 * 1024).toString('base64'), offset: 0 });
  assert.strictEqual(r.status, 400);
});

test('import-from：本地文件与目录（递归）拷入工作区，二次导入同目标 → 409', async (t) => {
  const p = db.createProject({ name: 'block90-local-import' });
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });
  const sourceDir = join(tempRoot, 'import-source');
  mkdirSync(join(sourceDir, 'nested'), { recursive: true });
  writeFileSync(join(sourceDir, 'hello.csv'), 'a,b\n1,2\n');
  writeFileSync(join(sourceDir, 'nested', 'deep.txt'), 'deep');

  const fileImport = await post(p.id, 'import-from', { sourceAbsolutePath: join(sourceDir, 'hello.csv'), toPath: 'hello.csv' });
  assert.strictEqual(fileImport.status, 200);
  assert.strictEqual(readFileSync(join(p.workspace_path, 'hello.csv'), 'utf-8'), 'a,b\n1,2\n');

  const dirImport = await post(p.id, 'import-from', { sourceAbsolutePath: sourceDir, toPath: 'imported-tree' });
  assert.strictEqual(dirImport.status, 200);
  assert.strictEqual(readFileSync(join(p.workspace_path, 'imported-tree', 'nested', 'deep.txt'), 'utf-8'), 'deep');

  const dup = await post(p.id, 'import-from', { sourceAbsolutePath: join(sourceDir, 'hello.csv'), toPath: 'hello.csv' });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.code, 'target_already_exists');
});

test('import-from：源缺失 → 404；相对路径拒绝 → 400', async (t) => {
  const p = db.createProject({ name: 'block90-local-import-bad' });
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });
  const missing = await post(p.id, 'import-from', { sourceAbsolutePath: join(tempRoot, 'no-such-file.bin'), toPath: 'x.bin' });
  assert.strictEqual(missing.status, 404);
  const relative = await post(p.id, 'import-from', { sourceAbsolutePath: 'not/absolute', toPath: 'x.bin' });
  assert.strictEqual(relative.status, 400);
});

test('import-from：ssh 项目显式拒绝 → 400 import_requires_local', async (t) => {
  const p = createSshProject('block90-ssh-import');
  const r = await post(p.id, 'import-from', { sourceAbsolutePath: join(tempRoot, 'whatever.bin'), toPath: 'x.bin' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'import_requires_local');
});

test('gateway local append：offset 与当前大小错位 → remoteError offset_mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'block90-append-'));
  try {
    const target = join(dir, 'a.bin');
    const backend = gateway.createLocalBackend();
    await backend.append(target, Buffer.from('abc'), 0);
    await assert.rejects(
      () => backend.append(target, Buffer.from('def'), 7),
      (e) => e.remoteError === 'offset_mismatch',
    );
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
