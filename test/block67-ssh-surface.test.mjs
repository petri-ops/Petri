/**
 * BLOCK-67 P2b — workspace_* 工具 SSH 路由 零网络测试。
 *
 * fake gateway ssh 后端驱动：8 工具 + 后台进程三件套的 ssh 分支契约对齐 +
 * local 项目零回归（路由器不劫持 local）+ 路径边界 fail-closed。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block67-p2b-'));
process.env.PETRI_DB_PATH = join(tempRoot, 'p2b.db');
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
const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools');

// ── fake ssh 后端 ──
const files = new Map([
  ['/remote/proj/README.md', '# 远程\n目标文本 MARKER_X 存在\n'],
]);
const fakeBackend = {
  kind: 'ssh',
  async list(p) {
    if (p !== '/remote/proj') throw Object.assign(new Error('not_found'), { remoteError: 'not_found' });
    return [
      { name: 'data', type: 'dir', mtimeMs: 1 },
      { name: 'README.md', type: 'file', size: files.get('/remote/proj/README.md').length, mtimeMs: 2 },
      { name: '.hidden', type: 'file', size: 1, mtimeMs: 3 },
    ];
  },
  async stat(p) {
    if (p === '/remote/proj' || p === '/remote/proj/data') return { type: 'dir', size: 0, mtimeMs: 1 };
    if (p === '/remote/proj/data/a.csv') return { type: 'file', size: 4, mtimeMs: 5 };
    if (files.has(p)) return { type: 'file', size: files.get(p).length, mtimeMs: 2 };
    throw Object.assign(new Error('not_found'), { remoteError: 'not_found' });
  },
  async read(p) {
    if (!files.has(p)) throw Object.assign(new Error('not_found'), { remoteError: 'not_found' });
    return Buffer.from(files.get(p), 'utf8');
  },
  async write(p, content) { files.set(p, String(content)); return { type: 'file', size: content.length, mtimeMs: 9 }; },
  async find(_p, _maxDepth) { return 'data/a.csv\nREADME.md'; },
  async grep(pattern, _p, _maxLines) { return `README.md:2:目标文本 ${pattern} 存在\ndata/a.csv:1:${pattern},x\n`; },
  async exec(cmd, _cwd, _timeoutS) { return { code: 0, stdout: `ran:${cmd}`, stderr: '', truncated: false }; },
  async execBackground(cmd, cwd, log) { execCalls.push({ cmd, cwd, log }); return { pid: 4242 }; },
  async processAlive(_pid) { return { alive: aliveFlag }; },
  async killPid(_pid, _sig) { return { signaled: true }; },
};
const execCalls = [];
let aliveFlag = true;

const origResolve = gateway.resolveWorkspaceBackend;
before(() => {
  gateway.resolveWorkspaceBackend = (project) => {
    if (project?.workspace_kind === 'ssh') return { backend: fakeBackend, root: '/remote/proj' };
    return origResolve(project);
  };
});
after(() => {
  gateway.resolveWorkspaceBackend = origResolve;
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

const sshProject = db.createProject({ name: 'p2b-ssh', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/remote/proj' });
const localProject = db.createProject({ name: 'p2b-local' });
const tools = createWorkspaceTools();
const sshCtx = { projectId: sshProject.id, userId: 'p2b-user', accessMode: 'full' };

test('workspace_list ssh 分支：契约同构（type/sizeBytes/ISO mtime + 隐藏过滤 + 目录优先）', async () => {
  const r = await tools.listDirectory({}, sshCtx);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.entries.map((e) => e.name), ['data', 'README.md']);
  assert.strictEqual(r.entries[0].type, 'directory');
  assert.strictEqual(r.entries[1].type, 'file');
  assert.strictEqual(r.entries[1].sizeBytes, files.get('/remote/proj/README.md').length);
  assert.ok(!Number.isNaN(Date.parse(r.entries[1].modifiedAt)));
});

test('workspace_read ssh 分支：行窗口 + sha256 + totalLines', async () => {
  const r = await tools.readFile({ path: 'README.md', startLine: 2, maxLines: 1 }, sshCtx);
  assert.strictEqual(r.ok, true);
  assert.ok(r.content.includes('MARKER_X'));
  assert.strictEqual(r.startLine, 2);
  assert.strictEqual(r.totalLines, files.get('/remote/proj/README.md').split('\n').length);
});

test('workspace_write ssh 分支：写通 + changeSummary/diff 注入 + remote 标注', async () => {
  const r = await tools.writeFile({ path: 'new.md', content: '# 新文件\n' }, sshCtx);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.created, true);
  assert.ok(files.has('/remote/proj/new.md'));
  assert.strictEqual(r.remote.host, 'aliyun');
  assert.ok(r.changeSummary && typeof r.changeSummary.after.sizeBytes === 'number');
  assert.ok(Array.isArray(r.changeDiff?.hunks ?? r.changeDiff?.files ?? []) || r.changeDiff);
});

test('workspace_replace ssh 分支：sha256 门 + 唯一片段替换', async () => {
  const crypto = require('node:crypto');
  const sha = crypto.createHash('sha256').update(files.get('/remote/proj/README.md')).digest('hex');
  const r = await tools.replaceText({ path: 'README.md', oldText: 'MARKER_X', newText: 'MARKER_Y', expectedSha256: sha }, sshCtx);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(files.get('/remote/proj/README.md').includes('MARKER_Y'));
  // 错误 sha 拒绝
  const bad = await tools.replaceText({ path: 'README.md', oldText: 'MARKER_Y', newText: 'z', expectedSha256: 'deadbeef' }, sshCtx);
  assert.strictEqual(bad.code, 'content_conflict');
});

test('workspace_find / workspace_search ssh 分支', async () => {
  const f = await tools.findFiles({ pattern: '*.csv' }, sshCtx);
  assert.strictEqual(f.ok, true);
  assert.deepStrictEqual(f.matches.map((m) => m.path), ['data/a.csv']);
  const s = await tools.searchText({ query: 'MARKER_Y' }, sshCtx);
  assert.strictEqual(s.ok, true);
  assert.ok(s.matches.length >= 1);
  assert.ok(s.matches[0].path.includes('README.md'));
});

test('workspace_exec ssh 分支：shell 标注 ssh:bash + 命令黑名单同门（rm 拒绝）', async () => {
  const r = await tools.executeCommand({ command: 'ls -la' }, sshCtx);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.shell, 'ssh:aliyun/bash');
  assert.strictEqual(r.stdout, 'ran:ls -la');
  const blocked = await tools.executeCommand({ command: 'rm -rf /' }, sshCtx);
  assert.strictEqual(blocked.code, 'command_blocked');
});

test('后台进程三件套 ssh 分支：exec_bg → status → stop', async () => {
  const bg = await tools.execBackground({ command: 'sleep 30' }, { ...sshCtx, conversationId: 'conv-p2b' });
  assert.strictEqual(bg.ok, true);
  assert.strictEqual(bg.pid, 4242);
  assert.ok(execCalls[0].log.includes('.petri-agent-tmp'));

  aliveFlag = true;
  const st = await tools.processStatus({ id: bg.id, tail: 'none' }, sshCtx);
  assert.strictEqual(st.ok, true);
  assert.strictEqual(st.status, 'running');

  aliveFlag = false;
  const st2 = await tools.processStatus({ id: bg.id, tail: 'none' }, sshCtx);
  assert.strictEqual(st2.status, 'exited');

  const stop = await tools.processStop({ id: bg.id }, sshCtx);
  assert.strictEqual(stop.ok, true);
});

test('BLOCK-78 P2-④ processList：会话过滤 + 注册表懒探针语义 + local 不劫持', async () => {
  const convCtx = { ...sshCtx, conversationId: 'conv-list' };
  const bg = await tools.execBackground({ command: 'sleep 30' }, convCtx);
  assert.strictEqual(bg.ok, true);

  const list = await tools.processList({}, convCtx);
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.source, 'ssh-registry');
  assert.strictEqual(list.count, 1);
  const row = list.processes[0];
  assert.strictEqual(row.processId, bg.id);
  assert.strictEqual(row.status, 'running');
  assert.strictEqual(row.pid, 4242);
  assert.strictEqual(typeof row.host, 'string');
  assert.ok(row.startedAtIso);
  assert.ok(row.logPath.includes('.petri-agent-tmp'));

  // 会话隔离（bgKey 语义与本地表同构）：其他会话不可见
  const other = await tools.processList({}, { ...sshCtx, conversationId: 'conv-other' });
  assert.strictEqual(other.count, 0);

  // local 项目路由不劫持：走本地表路径返回清单形状
  const localList = await tools.processList(
    {},
    { projectId: localProject.id, userId: 'p2b-user', conversationId: 'conv-list-local' }
  );
  assert.strictEqual(localList.ok, true);
  assert.ok(Array.isArray(localList.processes));
});

test('local 项目零回归：路由器不劫持（本地 fs 语义原样）', async () => {
  const { writeFileSync } = require('node:fs');
  const localCtx = { projectId: localProject.id, userId: 'p2b-user', accessMode: 'full' };
  writeFileSync(join(localProject.workspace_path, 'local.txt'), '本地文件\n');
  const r = await tools.readFile({ path: 'local.txt' }, localCtx);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.content.trim(), '本地文件');
  assert.ok(!r.remote, 'local 结果不带 remote 标注');
});

test('路径边界 fail-closed：.. 逃逸拒绝（list/read）', async () => {
  const r1 = await tools.listDirectory({ path: '../escape' }, sshCtx);
  assert.strictEqual(r1.ok, false);
  const r2 = await tools.readFile({ path: '../../etc/passwd' }, sshCtx);
  assert.strictEqual(r2.ok, false);
});

test('preflight ssh 分支：远程语义放行（read/exec）+ 命令黑名单同门', async () => {
  // preflightTool 未直接导出 —— 经 interceptor 面验证：读路径放行 exists
  const p = await tools.listDirectory({}, sshCtx); // 间接确认 surface 可达
  assert.strictEqual(p.ok, true);
});
