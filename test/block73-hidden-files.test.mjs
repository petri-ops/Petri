// BLOCK-73 / UI-322 — 文件树「显示隐藏文件」开关定向测试（零网络，复用 block67-routes 路由级 harness 模式）
// local 分支：默认过滤点开头条目；?showHidden=1 跳过过滤。
// ssh 分支：参数为 no-op（node-agent 过滤在 BLOCK-67 面，本包不动——契约锁定防回归）。

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tempRoot = mkdtempSync(join(tmpdir(), 'block73-hidden-'));
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
const express = require('express');

let server;
let baseUrl;
const app = express();
app.use(express.json());

// fake ssh 后端（零网络）：返回固定条目（含点文件——模拟未来放开后的 upstream 形态）
const fakeSshBackend = {
  async list() {
    return [
      { name: '.hidden-dir', type: 'dir', mtimeMs: 42 },
      { name: 'd', type: 'dir', mtimeMs: 42 },
      { name: 'a.md', type: 'file', size: 5, mtimeMs: 42 },
    ];
  },
  async stat() { return { type: 'file', size: 5, mtimeMs: 42 }; },
  async read() { return Buffer.from('# hi', 'utf-8'); },
  async write() { return { type: 'file', size: 5, mtimeMs: 99 }; },
};
const origResolve = gateway.resolveWorkspaceBackend;

before(async () => {
  const files = require('../core/petri-server/routes/files');
  gateway.resolveWorkspaceBackend = (project) => {
    if (project?.workspace_kind === 'ssh') {
      return { backend: fakeSshBackend, root: project.remote_path };
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

async function req(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`);
  return { status: r.status, body: await r.json() };
}

test('local tree: 默认过滤点开头条目（现状体感不变）', async (t) => {
  const p = db.createProject({ name: 'block73-local' });
  writeFileSync(join(p.workspace_path, 'visible.md'), 'v');
  writeFileSync(join(p.workspace_path, '.gitignore'), 'node_modules');
  mkdirSync(join(p.workspace_path, '.claude'));
  mkdirSync(join(p.workspace_path, 'sub'));
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(tree.status, 200);
  assert.deepStrictEqual(tree.body.entries.map((e) => e.name), ['sub', 'visible.md']);
});

test('local tree: showHidden=1 显示全部点文件/点文件夹', async (t) => {
  const p = db.createProject({ name: 'block73-local-hidden' });
  writeFileSync(join(p.workspace_path, 'visible.md'), 'v');
  writeFileSync(join(p.workspace_path, '.gitignore'), 'node_modules');
  mkdirSync(join(p.workspace_path, '.claude'));
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const tree = await req(`/api/workspaces/${p.id}/tree?showHidden=1`);
  assert.strictEqual(tree.status, 200);
  const names = tree.body.entries.map((e) => e.name).sort();
  assert.ok(names.includes('.gitignore'), '.gitignore visible with showHidden=1');
  assert.ok(names.includes('.claude'), '.claude visible with showHidden=1');
  assert.ok(names.includes('visible.md'), 'normal entries still present');
  // 默认请求仍过滤（同项目两条路径互不干扰）
  const def = await req(`/api/workspaces/${p.id}/tree`);
  assert.ok(!def.body.entries.map((e) => e.name).includes('.gitignore'), 'default request stays filtered');
});

test('ssh tree: showHidden 参数为 no-op（契约锁定：node-agent 过滤在 BLOCK-67 面）', async (t) => {
  const p = db.createProject({ name: 'block73-ssh', workspacePath: undefined });
  // 以 ssh 形态建项目（与 block67-routes 同构：直接改列）
  require('../core/petri-server/db').getDatabase()
    .prepare("UPDATE projects SET workspace_kind='ssh', ssh_host='fake', remote_path='/srv/proj' WHERE id=?")
    .run(p.id);
  t.after(() => { try { rmSync(p.workspace_path, { recursive: true, force: true }); } catch {} });

  const plain = await req(`/api/workspaces/${p.id}/tree`);
  assert.strictEqual(plain.status, 200);

  const withParam = await req(`/api/workspaces/${p.id}/tree?showHidden=1`);
  assert.strictEqual(withParam.status, 200);
  // 本包不动 ssh 分支：条目映射与 P1c 契约一致（参数 no-op，不因参数引入行为变化）
  assert.deepStrictEqual(withParam.body.entries, plain.body.entries, 'showHidden must be no-op on ssh branch in this package');
});
