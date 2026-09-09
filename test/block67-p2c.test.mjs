/**
 * BLOCK-67 P2c — D7/D8 作业执行面 + system_info 远程真相 零网络测试。
 * 覆盖：resolveProjectRunLayout ssh staging 回落（本地路径拒绝不变）+
 * tool_system_info ssh 分支（fake gateway backend）+ 本机分支零回归。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block67-p2c-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'p2c.db');
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
const { resolveProjectRunLayout } = require('../core/shared-backend/project-run-layout');
const { tool_system_info } = require('../core/biof3-server/agent-tools/system-info-tools');
const gateway = require('../core/biof3-server/helpers/workspace-gateway');

test('D7/D8: ssh 项目 jobDir 落本地 staging（remote-projects/<id>），workspace_path 仍为 NULL', () => {
  const p = db.createProject({ name: 'p2c-ssh', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/x' });
  assert.strictEqual(p.workspace_path, null);
  const layout = resolveProjectRunLayout({
    projectId: p.id, toolJobId: 'tj_p2c_1', db, userId: null, skipPermissionCheck: true, ensureDirs: true,
  });
  assert.ok(layout.workspaceRoot.includes('remote-projects'));
  assert.ok(layout.workspaceRoot.includes(p.id));
  assert.ok(!layout.workspaceRoot.includes('srv'), '不落远程路径');
  assert.ok(statSync(layout.jobRoot).isDirectory(), 'jobDir 可建');
});

test('D7/D8: local 项目 layout 语义不变（workspace_path 原样）', () => {
  const p = db.createProject({ name: 'p2c-local' });
  const layout = resolveProjectRunLayout({
    projectId: p.id, toolJobId: 'tj_p2c_2', db, userId: null, skipPermissionCheck: true, ensureDirs: true,
  });
  assert.strictEqual(layout.workspaceRoot, p.workspace_path);
  assert.ok(!layout.workspaceRoot.includes('remote-projects'));
});

test('system_info: ssh 项目返回远程真相（fake backend exec）+ 工具链解析', async (t) => {
  const orig = gateway.resolveWorkspaceBackend;
  gateway.resolveWorkspaceBackend = (project) => ({
    backend: {
      kind: 'ssh',
      async exec(cmd, cwd, timeoutS) {
        return {
          code: 0,
          stdout: 'Linux 6.8.0-57-generic\nx86_64\nshell=/bin/bash\nPython 3.12.3\ngit version 2.43.0\nv22.9.0\n',
          stderr: '',
        };
      },
    },
    root: project.remote_path,
  });
  t.after(() => { gateway.resolveWorkspaceBackend = orig; });

  const p = db.createProject({ name: 'p2c-sysinfo', workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: '/srv/y' });
  const r = await tool_system_info({}, { projectId: p.id, userId: 'u' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.workspace.kind, 'ssh');
  assert.strictEqual(r.workspace.host, 'aliyun');
  assert.strictEqual(r.shell, '/bin/bash');
  assert.strictEqual(r.pathSeparator, '/');
  assert.strictEqual(r.os.detail, 'Linux 6.8.0-57-generic');
  assert.strictEqual(r.os.arch, 'x86_64');
  assert.strictEqual(r.toolchain.python, 'Python 3.12.3');
  assert.strictEqual(r.toolchain.git, 'git version 2.43.0');
  assert.ok(r.note.includes('远程主机 aliyun'));
});

test('system_info: ssh 项目探测失败诚实返回 remote_probe_failed + 重试指引', async (t) => {
  const orig = gateway.resolveWorkspaceBackend;
  gateway.resolveWorkspaceBackend = () => ({
    backend: {
      kind: 'ssh',
      async exec() { throw Object.assign(new Error('ssh_transport: transport.network'), { classified: { kind: 'transport.network', retryable: true } }); },
    },
    root: '/r',
  });
  t.after(() => { gateway.resolveWorkspaceBackend = orig; });
  const p = db.createProject({ name: 'p2c-sysfail', workspaceKind: 'ssh', sshHost: 'dell', remotePath: '/r' });
  const r = await tool_system_info({}, { projectId: p.id });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'remote_probe_failed');
  assert.strictEqual(r.retryable, true);
  assert.ok(r.note.includes('workspace_list'));
});

test('system_info: 本机分支零回归（无 projectId 走 os 自省）', async () => {
  const r = await tool_system_info({}, {});
  assert.strictEqual(r.ok, true);
  assert.ok(r.os.platform);
  assert.ok(!r.workspace || r.workspace.kind !== 'ssh');
  assert.ok(r.note.includes('workspace_exec'));
});

after(() => { try { rmSync(tempRoot, { recursive: true, force: true }); } catch {} });
