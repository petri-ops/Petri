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
// 本文件验证 thin per-call 语义（fake runSshOp）——禁用 D1.1 多路复用（mux 协议另有专项测试）
process.env.BIOF3_SSH_MUX = '0';

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
  // BLOCK-96 F2 契约：fs_list 载荷 = 单行 base64(NUL 记录流 <type>\t<size>\t<mtime>\t<name>\0)。
  // 夹具含特殊文件名（引号/反斜杠/换行/制表符）——NUL 记录协议下必须原样存活，
  // 旧 printf JSON「坏行静默丢文件」缺陷由此回归锁定。
  const fakeListRecords = [
    'f\t2\t1\tb.md',
    'd\t0\t1\tadir',
    'f\t7\t1\tquo"te.txt',
    'f\t7\t1\tback\\slash.txt',
    'f\t7\t1\tnew\nline.txt',
    'f\t7\t1\tta\tb.txt',
  ].map((r) => `${r}\0`).join('');
  const fakeListPayload = Buffer.from(fakeListRecords, 'utf8').toString('base64');
  actual.runSshOp = async (params) => {
    calls.push(params);
    const stdout = params.remoteCommand.includes('"fs_list"')
      ? fakeListPayload
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
  assert.strictEqual(entries[0].name, 'adir'); // 目录优先
  assert.strictEqual(entries.length, 6);
  assert.strictEqual(entries.find((e) => e.name === 'b.md').size, 2);
  // 特殊文件名逐字回填（含名称内制表符——前三个 \t 是字段分隔，其余归名称）
  for (const hostile of ['quo"te.txt', 'back\\slash.txt', 'new\nline.txt', 'ta\tb.txt']) {
    assert.ok(entries.some((e) => e.name === hostile), `hostile name survives: ${JSON.stringify(hostile)}`);
  }
  // BLOCK-96 F2 — 服务端分页切片契约（total/truncated 显式标记）
  const page = await backend.listPage('/remote/proj', { limit: 2, offset: 1 });
  assert.strictEqual(page.total, 6);
  assert.strictEqual(page.entries.length, 2);
  assert.strictEqual(page.truncated, true);
  const full = await backend.listPage('/remote/proj', { limit: 0 });
  assert.strictEqual(full.entries.length, 6);
  assert.strictEqual(full.truncated, false);

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

test('ssh 后端: mux 会话死亡对幂等只读 verb 透明重试一次；写类不重试（BLOCK-96 F1）', async (t) => {
  const muxModule = require('../core/biof3-server/helpers/remote-execution/ssh-multiplexer');
  const origRunOnMux = muxModule.runOnMux;
  const origMuxEnv = process.env.BIOF3_SSH_MUX;
  process.env.BIOF3_SSH_MUX = '1';
  const runner = require('../core/biof3-server/helpers/remote-execution/remote-job-runner');
  const origCreate = runner.createRemoteJobRunner;
  runner.createRemoteJobRunner = () => ({ ensureAgent: async () => ({ ok: true }) });
  t.after(() => {
    muxModule.runOnMux = origRunOnMux;
    if (origMuxEnv === undefined) delete process.env.BIOF3_SSH_MUX; else process.env.BIOF3_SSH_MUX = origMuxEnv;
    runner.createRemoteJobRunner = origCreate;
  });

  const muxError = () => Object.assign(new Error('ssh_mux: 连接已断开'), { classified: { kind: 'transport.network', retryable: true } });
  const okPayload = (records) => ({ ok: true, code: 0, stdout: Buffer.from(records, 'utf8').toString('base64') });

  // 幂等只读（fs_list）：首次死亡 → 重建重试成功
  let listCalls = 0;
  muxModule.runOnMux = async () => {
    listCalls += 1;
    if (listCalls === 1) throw muxError();
    return okPayload('f\t2\t1\tok.txt\0');
  };
  const backend = gateway.createSshBackend({ alias: 'retry-host' });
  const entries = await backend.list('/x');
  assert.strictEqual(listCalls, 2, 'retried exactly once');
  assert.deepStrictEqual(entries.map((e) => e.name), ['ok.txt']);

  // 写类（fs_write）：死亡即诚实失败，不自动重试
  let writeCalls = 0;
  muxModule.runOnMux = async () => {
    writeCalls += 1;
    throw muxError();
  };
  await assert.rejects(() => backend.write('/x/w.txt', 'data'), (e) => e.classified?.kind === 'transport.network');
  assert.strictEqual(writeCalls, 1, 'write verbs never auto-retry');
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
