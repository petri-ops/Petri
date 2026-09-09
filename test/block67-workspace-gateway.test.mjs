/**
 * BLOCK-67 P1b — Workspace Gateway + ssh 项目模型 零网络测试。
 *
 * 覆盖：safeRemoteJoin 边界 / local 后端与 fs 语义等价 / ssh 后端命令构造（不触网，
 * 以注入 fake runSshOp 断言 verb+base64 载荷）/ createProject ssh 字段 fail-closed /
 * local 项目零回归（workspace_path 补缺省 + 目录创建不变）。
 * DB 自举：临时库 + 全量 migrations（g0-api-route 同款）；better-sqlite3 用
 * core/biof3-server 的 ABI（根 node_modules 为 Electron ABI）。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block67-gw-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'gw.db');
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

test('safeRemoteJoin: 边界（.. / 绝对 / 空段 / 合法拼接）', () => {
  assert.strictEqual(gateway.safeRemoteJoin('/remote/proj', 'a/b.txt'), '/remote/proj/a/b.txt');
  assert.strictEqual(gateway.safeRemoteJoin('/remote/proj/', '/a//b/'), '/remote/proj/a/b');
  assert.strictEqual(gateway.safeRemoteJoin('/remote/proj', '../escape'), null);
  assert.strictEqual(gateway.safeRemoteJoin('/remote/proj', 'a/../../escape'), null);
  assert.strictEqual(gateway.safeRemoteJoin('', 'a'), null);
  assert.strictEqual(gateway.safeRemoteJoin('/remote/proj', 'a\0b'), null);
});

test('local 后端: list/read/write/mv/rm 与 fs 语义等价（含隐藏过滤+目录优先排序）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'block67-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const backend = gateway.createLocalBackend();
  writeFileSync(join(dir, 'z.txt'), 'zzz');
  mkdirSync(join(dir, 'adir'));
  writeFileSync(join(dir, '.dotfile'), 'x');

  const entries = await backend.list(dir);
  assert.deepStrictEqual(entries.map((e) => e.name), ['adir', 'z.txt']);
  assert.strictEqual(entries[1].size, 3);
  assert.strictEqual((await backend.read(join(dir, 'z.txt'))).toString(), 'zzz');

  await backend.write(join(dir, 'sub', 'w.md'), '# 中文');
  assert.strictEqual((await backend.read(join(dir, 'sub', 'w.md'))).toString(), '# 中文');
  const st = await backend.stat(join(dir, 'sub', 'w.md'));
  assert.strictEqual(st.type, 'file');

  await backend.mv(join(dir, 'sub', 'w.md'), join(dir, 'w2.md'));
  assert.ok(statSync(join(dir, 'w2.md')));
  await backend.rm(join(dir, 'sub'));
  assert.throws(() => statSync(join(dir, 'sub')));
});

test('local 后端: write mtime 冲突检测（D3 不静默覆盖）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'block67-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const backend = gateway.createLocalBackend();
  const file = join(dir, 'c.txt');
  await backend.write(file, 'v1');
  const stale = (await backend.stat(file)).mtimeMs;
  await new Promise((r) => setTimeout(r, 15));
  await backend.write(file, 'v2');
  await assert.rejects(() => backend.write(file, 'v3', { expectedMtimeMs: stale }), /remote_file_changed/);
  assert.strictEqual((await backend.read(file)).toString(), 'v2');
});

test('ssh 后端: 命令构造走 base64 fs verbs（fake runSshOp，零网络）', async (t) => {
  const calls = [];
  const actual = require('../core/biof3-server/helpers/remote-execution/ssh-transport');
  const original = actual.runSshOp;
  // ssh-transport 导出对象属性可替换（module.exports 对象字面量）。
  actual.runSshOp = async (params) => {
    calls.push(params);
    const stdout = params.remoteCommand.includes('"fs_list"')
      ? '{"name":"b.md","type":"file","size":2,"mtimeMs":1}\n{"name":"adir","type":"dir","mtimeMs":1}\n'
      : params.remoteCommand.includes('"fs_read"')
        ? Buffer.from('hello 远程').toString('base64')
        : '{"type":"file","size":9,"mtimeMs":123}';
    return { code: 0, signal: null, stdout, stderr: '', timedOut: false, classified: { kind: 'ok' } };
  };
  t.after(() => { actual.runSshOp = original; });

  const backend = gateway.createSshBackend({ alias: 'aliyun' });
  // 绕过真实 ensureAgent：直接预置 ensured 集不可行（闭包内），改由 fake deploy。
  const runner = require('../core/biof3-server/helpers/remote-execution/remote-job-runner');
  const origCreate = runner.createRemoteJobRunner;
  runner.createRemoteJobRunner = () => ({ ensureAgent: async () => ({ ok: true }) });
  t.after(() => { runner.createRemoteJobRunner = origCreate; });

  const entries = await backend.list('/remote/proj');
  assert.deepStrictEqual(entries.map((e) => e.name), ['adir', 'b.md']); // 目录优先
  const content = await backend.read('/remote/proj/b.md');
  assert.strictEqual(content.toString('utf-8'), 'hello 远程');
  await backend.write('/remote/proj/b.md', 'x');
  const writeCall = calls.find((c) => c.remoteCommand.includes('"fs_write"'));
  assert.ok(writeCall, 'fs_write call made');
  assert.ok(writeCall.remoteCommand.includes(Buffer.from('/remote/proj/b.md').toString('base64')));
  assert.strictEqual(writeCall.alias, 'aliyun');
});

test('ssh 后端: transport 失败诚实抛出（分类信息保留）', async (t) => {
  const actual = require('../core/biof3-server/helpers/remote-execution/ssh-transport');
  const original = actual.runSshOp;
  actual.runSshOp = async () => ({ code: 255, stdout: '', stderr: 'refused', classified: { kind: 'transport.network', retryable: true } });
  t.after(() => { actual.runSshOp = original; });
  const runner = require('../core/biof3-server/helpers/remote-execution/remote-job-runner');
  const origCreate = runner.createRemoteJobRunner;
  runner.createRemoteJobRunner = () => ({ ensureAgent: async () => ({ ok: true }) });
  t.after(() => { runner.createRemoteJobRunner = origCreate; });

  const backend = gateway.createSshBackend({ alias: 'dell' });
  await assert.rejects(() => backend.list('/x'), (e) => e.classified?.kind === 'transport.network');
});

test('createProject: ssh 字段 fail-closed + 落库形态', () => {
  assert.throws(() => db.createProject({ name: 'bad1', workspaceKind: 'ssh', sshHost: 'bad host!', remotePath: '/x' }), /invalid_ssh_host/);
  assert.throws(() => db.createProject({ name: 'bad2', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: 'relative' }), /invalid_remote_path/);
  assert.throws(() => db.createProject({ name: 'bad3', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/a/../b' }), /invalid_remote_path/);

  const p = db.createProject({ name: '远程项目 甲', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/proj' });
  assert.strictEqual(p.workspace_kind, 'ssh');
  assert.strictEqual(p.ssh_host, 'aliyun');
  assert.strictEqual(p.remote_path, '/srv/proj');
  assert.strictEqual(p.workspace_path, null, 'ssh 项目不落本地 workspace');

  // hydrate 不给 ssh 项目补缺省本地目录。
  const again = db.getProject(p.id);
  assert.strictEqual(again.workspace_path, null);
});

test('createProject: local 项目零回归（补缺省 workspace + 目录创建）', () => {
  const p = db.createProject({ name: '本地回归' });
  assert.strictEqual(p.workspace_kind, 'local');
  assert.ok(p.workspace_path && p.workspace_path.startsWith(tempRoot), '缺省 workspace 落 local-data 根下');
  assert.ok(statSync(p.workspace_path).isDirectory());
});

test('resolveWorkspaceBackend: 形态路由', () => {
  const sshProject = { workspace_kind: 'ssh', ssh_host: 'aliyun', remote_path: '/r' };
  const r1 = gateway.resolveWorkspaceBackend(sshProject);
  assert.strictEqual(r1.backend.kind, 'ssh');
  assert.strictEqual(r1.root, '/r');
  const r2 = gateway.resolveWorkspaceBackend({ workspace_kind: 'local', workspace_path: '/tmp/x' });
  assert.strictEqual(r2.backend.kind, 'local');
  assert.strictEqual(gateway.resolveWorkspaceBackend(null).error, 'project_not_found');
  assert.strictEqual(gateway.resolveWorkspaceBackend({ workspace_kind: 'ssh' }).error, 'ssh_project_misconfigured');
});

after(() => {
  // Windows 下 sqlite 连接未释放可能 EPERM；清理尽力而为，不作为断言面。
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
