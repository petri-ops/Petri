/**
 * BLOCK-67 P1c — 文件面远程路由 零网络测试（fake Gateway ssh 后端）。
 *
 * 覆盖：tree/file GET/PUT 的 ssh 分支（条目同构/Content-Type/409 冲突/502 断线）+
 * local 项目零回归（走原 fs 路径）+ ssh-projects validate 端点（fake backend）。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block67-routes-'));
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

// fake ssh 后端（零网络）
const fakeSshBackend = {
  kind: 'ssh',
  calls: [],
  async list(p) { this.calls.push(['list', p]); return [{ name: 'd', type: 'dir', mtimeMs: 42 }, { name: 'a.md', type: 'file', size: 5, mtimeMs: 42 }]; },
  async stat(p) { this.calls.push(['stat', p]); return { type: p.endsWith('.md') ? 'file' : 'dir', size: 5, mtimeMs: 42 }; },
  async read(p) { this.calls.push(['read', p]); return Buffer.from('# hi', 'utf-8'); },
  async write(p, c, opts) { this.calls.push(['write', p, c]); return { type: 'file', size: c.length, mtimeMs: 99 }; },
};
const origResolve = gateway.resolveWorkspaceBackend;

before(async () => {
  const files = require('../core/biof3-server/routes/files');
  // 注入 fake ssh 后端：只对 ssh 项目生效，local 保持真实现。
  gateway.resolveWorkspaceBackend = (project) => {
    if (project?.workspace_kind === 'ssh') {
      if (project.ssh_host === 'broken') {
        const e = new Error('ssh_transport: transport.network');
        e.classified = { kind: 'transport.network', retryable: true };
        return { backend: { async list() { throw e; }, async stat() { throw e; }, async read() { throw e; }, async write() { throw e; } }, root: project.remote_path };
      }
      if (project.ssh_host === 'conflict') {
        return { backend: { async stat() { return { type: 'file', mtimeMs: 1 }; }, async write() { const err = new Error('remote_file_changed'); err.code = 'remote_file_changed'; throw err; } }, root: project.remote_path };
      }
      return { backend: fakeSshBackend, root: project.remote_path };
    }
    return origResolve(project);
  };
  files(app);

  app.get('/__ping', (_req, res) => res.json({ ok: true }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  gateway.resolveWorkspaceBackend = origResolve;
  await server?.close();
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

async function req(pathname, { method = 'GET', body } = {}) {
  const r = await fetch(`${baseUrl}${pathname}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

test('tree: ssh 项目条目契约与本地同构（size/modifiedAt 映射）', async () => {
  const p = db.createProject({ name: 'r1', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/p1' });
  const r = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.entries.length, 2);
  assert.deepStrictEqual(r.body.entries[0], { name: 'd', type: 'dir', modifiedAt: 42 });
  assert.deepStrictEqual(r.body.entries[1], { name: 'a.md', type: 'file', size: 5, modifiedAt: 42 });
});

test('tree: 非法相对路径（..）400', async () => {
  const p = db.createProject({ name: 'r2', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/p2' });
  const r = await req(`/api/workspaces/${p.id}/tree?prefix=${encodeURIComponent('../escape')}`);
  assert.strictEqual(r.status, 400);
});

test('file GET: ssh 项目读远程（Content-Type 按扩展名）', async () => {
  const p = db.createProject({ name: 'r3', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/p3' });
  const r = await req(`/api/workspaces/${p.id}/file?path=docs/a.md`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'text/markdown');
  assert.strictEqual(r.body.toString(), '# hi');
});

test('file PUT: ssh 项目写远程 + local 项目拒绝（沿用 IPC）', async () => {
  const sshP = db.createProject({ name: 'r4', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/p4' });
  const ok = await req(`/api/workspaces/${sshP.id}/file?path=docs/a.md`, { method: 'PUT', body: { content: 'new' } });
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.body.ok);

  const localP = db.createProject({ name: 'r5' });
  const rejected = await req(`/api/workspaces/${localP.id}/file?path=x.md`, { method: 'PUT', body: { content: 'x' } });
  assert.strictEqual(rejected.status, 400);
});

test('file PUT: mtime 冲突 409（D3 不静默覆盖）', async () => {
  const p = db.createProject({ name: 'r6', workspaceKind: 'ssh', sshHost: 'conflict', remotePath: '/srv/p6' });
  const r = await req(`/api/workspaces/${p.id}/file?path=a.md`, { method: 'PUT', body: { content: 'v2', expectedMtimeMs: 1 } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'remote_file_changed');
});

test('tree/file: 断线诚实 502 + retryable 标注（D5）', async () => {
  const p = db.createProject({ name: 'r7', workspaceKind: 'ssh', sshHost: 'broken', remotePath: '/srv/p7' });
  const tree = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(tree.status, 502);
  assert.strictEqual(tree.body.retryable, true);
  const file = await req(`/api/workspaces/${p.id}/file?path=a.md`);
  assert.strictEqual(file.status, 502);
});

test('local 项目零回归：tree/file 仍走本地 fs', async (t) => {
  const p = db.createProject({ name: 'local-zero' });
  writeFileSync(join(p.workspace_path, 'z.md'), '本地');
  mkdirSync(join(p.workspace_path, 'sub'));
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });
  const tree = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(tree.status, 200);
  assert.deepStrictEqual(tree.body.entries.map((e) => e.name), ['sub', 'z.md']);
  const file = await req(`/api/workspaces/${p.id}/file?path=z.md`);
  assert.strictEqual(file.body.toString(), '本地');
});
