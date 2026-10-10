// BLOCK-148 #11 — 表单下拉可达性定向测试（零网络，复用 block73-hidden-files 路由级 harness 模式）。
// 契约：
//   1. tree 响应投影 inputExtensions，与上传白名单（multer fileFilter）单一真相同源；
//   2. ?recursive=1 有界递归：子目录文件带 workspace 相对 path 入列、深度上限、
//      产物目录（results/jobs/output/node_modules）排除、条目上限 truncated 显式标记；
//   3. 默认（flat）模式逐字节兼容：条目不新增 path 字段（增量字段只有 inputExtensions）。

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tempRoot = mkdtempSync(join(tmpdir(), 'block148-tree-'));
process.env.PETRI_DB_PATH = join(tempRoot, 'routes.db');
process.env.PETRI_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(require('node:path').resolve(migDir, f), 'utf8'));
  }
  boot.close();
}

const db = require('../core/petri-server/db');
const gateway = require('../core/petri-server/helpers/workspace-gateway');
const filesRoute = require('../core/petri-server/routes/files');
const express = require('express');

let server;
let baseUrl;
const app = express();
app.use(express.json());

// fake ssh 后端（零网络）：按目录路径返回固定子树——recursive 分支经 backend.list 逐层展开。
const sshTreeFixture = new Map([
  ['/srv/proj', [
    { name: 'd', type: 'dir', mtimeMs: 42 },
    { name: 'a.csv', type: 'file', size: 5, mtimeMs: 42 },
  ]],
  ['/srv/proj/d', [
    { name: 'inner.txt', type: 'file', size: 7, mtimeMs: 42 },
  ]],
]);
const fakeSshBackend = {
  async list(dirPath) { return sshTreeFixture.get(dirPath) || []; },
  async stat() { return { type: 'file', size: 5, mtimeMs: 42 }; },
  async read() { return Buffer.from('# hi', 'utf-8'); },
  async write() { return { type: 'file', size: 5, mtimeMs: 99 }; },
  async append() { return { type: 'file', size: 5, mtimeMs: 99 }; },
};
const origResolve = gateway.resolveWorkspaceBackend;

before(async () => {
  gateway.resolveWorkspaceBackend = (project) => {
    if (project?.workspace_kind === 'ssh') {
      return { backend: fakeSshBackend, root: project.remote_path };
    }
    return origResolve(project);
  };
  filesRoute(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  gateway.resolveWorkspaceBackend = origResolve;
  await server?.close();
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

async function req(pathname, init) {
  const r = await fetch(`${baseUrl}${pathname}`, init);
  return { status: r.status, body: await r.json() };
}

function localProject(name) {
  const p = db.createProject({ name });
  return p;
}

test('tree 响应投影 inputExtensions：与上传白名单常量单一真相同源', async (t) => {
  const p = localProject('b148-exts');
  writeFileSync(join(p.workspace_path, 'a.csv'), 'x');
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(tree.status, 200);
  assert.ok(Array.isArray(tree.body.inputExtensions), 'tree response carries inputExtensions array');
  assert.deepStrictEqual(
    tree.body.inputExtensions,
    filesRoute.UPLOAD_FILE_EXTENSIONS,
    'inputExtensions must equal the single-source upload whitelist exported by files.js',
  );
  assert.ok(tree.body.inputExtensions.includes('.txt'), '.txt（上传面允许）必须在白名单内');
  assert.ok(tree.body.inputExtensions.includes('.xlsx'), '.xlsx（上传面允许）必须在白名单内');
});

test('行为锚：/api/upload 拒绝白名单外扩展名、放行白名单内（与 tree 投影同清单）', async () => {
  const md = new FormData();
  md.append('file', new Blob(['# nope'], { type: 'text/markdown' }), 'bad.md');
  const mdResp = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: md });
  assert.ok(mdResp.status >= 400, `.md must be rejected by upload filter (got ${mdResp.status})`);

  const txt = new FormData();
  txt.append('file', new Blob(['hello'], { type: 'text/plain' }), 'good.txt');
  const txtResp = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: txt });
  assert.strictEqual(txtResp.status, 200);
  const txtBody = await txtResp.json();
  assert.strictEqual(txtBody.status, 'ok', '.txt must pass the same whitelist the tree projects');
});

test('recursive=1：子目录文件带 workspace 相对 path 入列；产物目录排除；点文件默认过滤', async (t) => {
  const p = localProject('b148-recursive');
  const wp = p.workspace_path;
  writeFileSync(join(wp, 'a.csv'), 'x');
  writeFileSync(join(wp, '.hidden.csv'), 'x');
  mkdirSync(join(wp, 'sub'));
  writeFileSync(join(wp, 'sub', 'inner.xlsx'), 'x');
  mkdirSync(join(wp, 'sub', 'nested'));
  writeFileSync(join(wp, 'sub', 'nested', 'deep.txt'), 'x');
  mkdirSync(join(wp, 'results'));
  writeFileSync(join(wp, 'results', 'out.csv'), 'x');
  mkdirSync(join(wp, 'jobs'));
  writeFileSync(join(wp, 'jobs', 'job1.log'), 'x');
  t.after(() => { try { rmSync(wp, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree?recursive=1`);
  assert.strictEqual(tree.status, 200);
  const paths = tree.body.entries.map((e) => e.path);
  assert.ok(paths.includes('a.csv'), 'top-level file listed');
  assert.ok(paths.includes('sub/inner.xlsx'), 'sub-directory file listed with workspace-relative path');
  assert.ok(paths.includes('sub/nested/deep.txt'), '3-segment deep file listed');
  assert.ok(!paths.includes('.hidden.csv'), 'dot entries stay filtered by default');
  assert.ok(!paths.some((x) => x === 'results' || x.startsWith('results/')), 'results/ product dir excluded');
  assert.ok(!paths.some((x) => x === 'jobs' || x.startsWith('jobs/')), 'jobs/ product dir excluded');
  // 文件条目形状：name/type/size/modifiedAt/path
  const inner = tree.body.entries.find((e) => e.path === 'sub/inner.xlsx');
  assert.strictEqual(inner.name, 'inner.xlsx');
  assert.strictEqual(inner.type, 'file');
  assert.strictEqual(typeof inner.size, 'number');
  // 截断显式标记（本例未触顶）
  assert.strictEqual(tree.body.truncated, false);
  // recursive 响应同样携带白名单投影
  assert.deepStrictEqual(tree.body.inputExtensions, filesRoute.UPLOAD_FILE_EXTENSIONS);
});

test('recursive=1：深度上限（第 4 层不再展开）与 limit 参数并存（recursive 自带上限）', async (t) => {
  const p = localProject('b148-depth');
  const wp = p.workspace_path;
  mkdirSync(join(wp, 'd1', 'd2', 'd3', 'd4'), { recursive: true });
  writeFileSync(join(wp, 'd1', 'd2', 'leaf.txt'), 'x');
  writeFileSync(join(wp, 'd1', 'd2', 'd3', 'buried.csv'), 'x');
  writeFileSync(join(wp, 'top.csv'), 'x');
  t.after(() => { try { rmSync(wp, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree?recursive=1&limit=1`);
  assert.strictEqual(tree.status, 200);
  const paths = tree.body.entries.map((e) => e.path);
  assert.ok(paths.includes('d1/d2/leaf.txt'), '3-segment file listed');
  assert.ok(!paths.includes('d1/d2/d3/buried.csv'), '4-segment file beyond depth bound must NOT be listed');
  assert.ok(paths.length > 1, 'recursive mode applies its own cap (limit param not applied as page size)');
});

test('recursive=1：条目上限 500 触顶 → truncated 显式标记', async (t) => {
  const p = localProject('b148-cap');
  const wp = p.workspace_path;
  for (let i = 0; i < 505; i += 1) writeFileSync(join(wp, `f${String(i).padStart(3, '0')}.csv`), 'x');
  t.after(() => { try { rmSync(wp, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree?recursive=1`);
  assert.strictEqual(tree.status, 200);
  assert.strictEqual(tree.body.entries.length, 500, 'entry cap = 500');
  assert.strictEqual(tree.body.truncated, true, 'truncated flag must be explicit at cap');
  assert.strictEqual(tree.body.total, 500);
});

test('flat 模式逐字节兼容：条目无 path 字段（增量字段只有 inputExtensions）', async (t) => {
  const p = localProject('b148-flat');
  writeFileSync(join(p.workspace_path, 'z.md'), 'z');
  mkdirSync(join(p.workspace_path, 'sub'));
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(tree.status, 200);
  for (const entry of tree.body.entries) {
    assert.ok(!('path' in entry), `flat entry must not carry path (got ${JSON.stringify(entry)})`);
  }
  assert.deepStrictEqual(tree.body.entries.map((e) => e.name), ['sub', 'z.md']);
});

test('ssh 分支 recursive：经 backend.list 逐层展开，条目带 path；flat 响应同样携带白名单投影', async (t) => {
  const p = db.createProject({ name: 'b148-ssh' });
  require('../core/petri-server/db').getDatabase()
    .prepare("UPDATE projects SET workspace_kind='ssh', ssh_host='fake', remote_path='/srv/proj' WHERE id=?")
    .run(p.id);
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const flat = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(flat.status, 200);
  assert.deepStrictEqual(flat.body.inputExtensions, filesRoute.UPLOAD_FILE_EXTENSIONS, 'ssh flat response projects the whitelist too');

  const rec = await req(`/api/workspaces/${p.id}/tree?recursive=1`);
  assert.strictEqual(rec.status, 200);
  const paths = rec.body.entries.map((e) => e.path);
  assert.ok(paths.includes('a.csv'), 'ssh root file listed');
  assert.ok(paths.includes('d/inner.txt'), 'ssh sub-directory file listed via per-level backend.list');
  assert.strictEqual(rec.body.truncated, false);
  assert.deepStrictEqual(rec.body.inputExtensions, filesRoute.UPLOAD_FILE_EXTENSIONS);
});
