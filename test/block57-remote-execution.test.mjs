/**
 * BLOCK-57 P1 — 远程执行零网络单测
 *
 * 覆盖：ssh-config 解析 / 错误分类 / agent 命令面与版本钉扎 / 传输 argv 构建 /
 * 目标注册表 CRUD / 本地 stale-fail 的远程豁免 / zero-regression 静态守卫。
 * 不发起任何真实网络连接；SSH 全链路见 scripts/block57-live.cjs。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const { parseSshConfig, isValidHostAlias } = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/ssh-config-parser.js')
);
const { classifySshFailure } = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/error-classifier.js')
);
const {
  BIOF3_AGENT_SH,
  agentVersionHash,
  remoteAgentCommand,
} = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/node-agent.js')
);
const {
  buildSshArgv,
  remoteJobDirPath,
  assertJobId,
} = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/ssh-transport.js')
);
const { createTargetRegistry, newTargetId } = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/target-registry.js')
);
const { parseSha256SumManifest } = require(
  path.join(repoRoot, 'core/biof3-server/helpers/remote-execution/remote-job-runner.js')
);
const { markUnownedStaleJobs } = require(
  path.join(repoRoot, 'core/biof3-server/helpers/process-lifecycle.js')
);

function tempDb() {
  const Database = require(path.join(repoRoot, 'core/biof3-server/node_modules/better-sqlite3'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE execution_targets (
    id TEXT PRIMARY KEY, alias TEXT NOT NULL, label TEXT DEFAULT '',
    created_at BIGINT NOT NULL, last_probe_json TEXT, last_probe_at BIGINT,
    status TEXT DEFAULT 'unprobed', runtime_json TEXT)`);
  return db;
}

// ── ssh-config parser ────────────────────────────────────────

test('ssh-config parser extracts literal hosts and skips wildcard blocks', () => {
  const { hosts, warnings } = parseSshConfig([
    'Host aliyun',
    '  HostName 47.110.228.168',
    '  User root',
    '  Port 22',
    'Host *',
    '  Compression yes',
    'Host dell dell_local',
    '  HostName 192.168.1.4',
    'Host=equals-style',
    '  User ops',
  ].join('\n'));
  const aliases = hosts.map((h) => h.host);
  assert.deepEqual(aliases, ['aliyun', 'equals-style']);
  assert.equal(hosts[0].hostName, '47.110.228.168');
  assert.equal(hosts[0].user, 'root');
  assert.equal(hosts[0].port, '22');
  assert.ok(warnings.some((w) => w.includes('dell')), 'multi-alias block should warn');
});

test('ssh-config parser tolerates comments, blank lines, and garbage', () => {
  const { hosts } = parseSshConfig('# comment\n\n   \nHost ok # trailing\n  HostName h\nnot-a-kv-line\n');
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].host, 'ok');
});

test('host alias validation enforces command-safe charset', () => {
  assert.ok(isValidHostAlias('aliyun'));
  assert.ok(isValidHostAlias('gpu-07.lab'));
  assert.ok(!isValidHostAlias('bad host'));
  assert.ok(!isValidHostAlias('a;rm -rf'));
  assert.ok(!isValidHostAlias(''));
  assert.ok(!isValidHostAlias(null));
});

// ── error classifier (D8) ────────────────────────────────────

test('classifier maps network failures to retryable transport errors', () => {
  for (const stderr of [
    'ssh: Could not resolve hostname xyz: Name or service not known',
    'Connection timed out during banner exchange',
    'Connection refused',
  ]) {
    const result = classifySshFailure({ exitCode: 255, stderr });
    assert.equal(result.kind, 'transport.network');
    assert.equal(result.retryable, true);
  }
});

test('classifier maps auth and host-key failures to non-retryable config errors', () => {
  const auth = classifySshFailure({ exitCode: 255, stderr: 'Permission denied (publickey).' });
  assert.equal(auth.kind, 'transport.auth');
  assert.equal(auth.retryable, false);
  const hostKey = classifySshFailure({ exitCode: 255, stderr: 'Host key verification failed.' });
  assert.equal(hostKey.kind, 'transport.host_key');
  assert.equal(hostKey.retryable, false);
});

test('classifier never misreads remote command failure as transport failure', () => {
  const result = classifySshFailure({ exitCode: 64, stderr: 'agent_error: runtime_missing:Rscript' });
  assert.equal(result.kind, 'remote.command_failed');
  assert.equal(result.retryable, false);
});

test('classifier treats unknown 255 stderr as conservatively retryable', () => {
  const result = classifySshFailure({ exitCode: 255, stderr: 'weird unexpected text' });
  assert.equal(result.kind, 'transport.unknown');
  assert.equal(result.retryable, true);
  assert.equal(classifySshFailure({ timedOut: true }).kind, 'transport.timeout');
  assert.equal(classifySshFailure({ exitCode: 0, stderr: '' }).kind, 'ok');
});

// ── node agent (D1/D2) ───────────────────────────────────────

test('agent script version hash is stable and non-empty', () => {
  const hash = agentVersionHash();
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hash, agentVersionHash(BIOF3_AGENT_SH));
});

test('remote agent command quotes fixed verbs and rejects unsafe args', () => {
  const cmd = remoteAgentCommand(['status', 'job_abc123']);
  assert.ok(cmd.startsWith('bash "$HOME/.biof3-agent/bin/biof3-agent.sh"'));
  assert.ok(cmd.includes('"status"'));
  assert.ok(cmd.includes('"job_abc123"'));
  assert.throws(() => remoteAgentCommand(['status', 'job; rm -rf /']));
  assert.throws(() => remoteAgentCommand(['status', 'job$(id)']));
  assert.throws(() => remoteAgentCommand(['status', 42]));
});

test('transport builds argv-array ssh commands with BatchMode and alias last', () => {
  const argv = buildSshArgv('aliyun', 'echo hi');
  // 返回值不含命令名本身（调用方统一 spawn('ssh', args)）——回归护栏：
  // 曾经因 argv 重复 'ssh'，ssh 把 'ssh' 当目标主机名（D2 修复）
  assert.notEqual(argv[0], 'ssh');
  assert.ok(argv.includes('-o'));
  assert.ok(argv.includes('BatchMode=yes'));
  assert.ok(argv.some((arg) => String(arg).startsWith('ConnectTimeout=')));
  const sep = argv.indexOf('--');
  assert.equal(argv[sep + 1], 'aliyun');
  assert.equal(argv[sep + 2], 'echo hi');
  assert.throws(() => buildSshArgv('bad host', 'echo'));
  assert.throws(() => remoteJobDirPath('job;id'));
  assert.equal(remoteJobDirPath('job_abc'), '$HOME/.biof3-agent/jobs/job_abc');
  assert.equal(assertJobId('job_abc'), 'job_abc');
});

// ── transfer manifest parsing (D7) ───────────────────────────

test('sha256sum manifest parser keeps relative paths and rejects traversal', () => {
  const h1 = 'a'.repeat(64);
  const h2 = 'b'.repeat(64);
  const entries = parseSha256SumManifest(
    `${h1}  output/plot.png\n`
    + `${h2}  output/sub/table.csv\n`
    + `${'c'.repeat(64)}  ../escape.txt\n`
    + `${'d'.repeat(64)}  /etc/passwd\n`
    + 'not-a-hash-line\n'
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { sha256: h1, path: 'output/plot.png' });
  assert.equal(entries[1].path, 'output/sub/table.csv');
});

// ── target registry CRUD ─────────────────────────────────────

test('target registry registers, dedupes, fetches, and removes targets', async () => {
  const db = tempDb();
  const registry = createTargetRegistry({ db });
  assert.equal((await registry.register({ alias: 'bad alias' })).ok, false);
  const added = await registry.register({ alias: 'aliyun', label: '阿里云' });
  assert.equal(added.ok, true);
  assert.match(added.id, /^tgt_[0-9a-f]{12}$/);
  const dup = await registry.register({ alias: 'aliyun' });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'alias_already_registered');
  const row = await registry.getById({ id: added.id });
  assert.equal(row.alias, 'aliyun');
  assert.equal(row.status, 'unprobed');
  assert.equal((await registry.getByAlias({ alias: 'aliyun' })).id, added.id);
  assert.equal((await registry.remove({ id: added.id })).ok, true);
  assert.equal(await registry.getById({ id: added.id }), undefined);
  // 目标级运行时覆盖：合法绝对路径入库，含空白路径拒绝
  const withRt = await registry.register({ alias: 'dell', runtime: { r: '/opt/R/bin/Rscript' } });
  assert.equal(withRt.ok, true);
  assert.equal((await registry.getById({ id: withRt.id })).runtime_json, JSON.stringify({ r: '/opt/R/bin/Rscript' }));
  assert.equal((await registry.register({ alias: 'badrt', runtime: { r: '/opt/R bin' } })).error, 'invalid_runtime_override');
  assert.equal(newTargetId('a'), newTargetId('a'));
  assert.notEqual(newTargetId('a'), newTargetId('b'));
});

// ── local stale-fail must exempt remote jobs (D5.3) ─────────

test('markUnownedStaleJobs excludes remote-target jobs when asked', async () => {
  const Database = require(path.join(repoRoot, 'core/biof3-server/node_modules/better-sqlite3'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY, status TEXT, error TEXT, completed_at BIGINT, heartbeat_at BIGINT,
    created_at BIGINT, execution_target_id TEXT)`);
  const now = Date.now();
  const stale = now - 60 * 60 * 1000;
  db.prepare("INSERT INTO tool_jobs (id, status, created_at, execution_target_id) VALUES ('local', 'running', ?, NULL)").run(stale);
  db.prepare("INSERT INTO tool_jobs (id, status, created_at, execution_target_id) VALUES ('remote', 'running', ?, 'tgt_x')").run(stale);
  const result = await markUnownedStaleJobs({ db, cutoff: now - 10 * 60 * 1000, excludeRemoteTargets: true });
  assert.equal(result.changes, 1);
  assert.equal(db.prepare("SELECT status FROM tool_jobs WHERE id='local'").get().status, 'failed');
  assert.equal(db.prepare("SELECT status FROM tool_jobs WHERE id='remote'").get().status, 'running');
  // 不带豁免时保持既有行为（存量调用方兼容）
  const all = await markUnownedStaleJobs({ db, cutoff: now - 10 * 60 * 1000 });
  assert.equal(all.changes, 1);
  assert.equal(db.prepare("SELECT status FROM tool_jobs WHERE id='remote'").get().status, 'failed');
});

// ── zero-regression static guards (D9) ───────────────────────

test('tools-executor keeps local path untouched and remote branch additive', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'core/biof3-server/helpers/tools-executor.js'), 'utf8'
  );
  // 本地运行时块仅在无远程目标时进入
  assert.match(src, /if \(!remoteDispatch\) \{\s*\n\s*const \{ getExecutor \}/);
  // 远程分派只由 execution_target_id 触发
  assert.match(src, /if \(job\.execution_target_id\) \{\s*\n\s*remoteDispatch = await resolveRemoteTargetForJob/);
  // 本地 execFile 仍存在（远程路径不替换本地执行器）
  assert.match(src, /const child = execFile\(/);
  // 远程作业豁免本地 zombie stale-fail
  assert.match(src, /excludeRemoteTargets: true/);
  // 保留键剥离：params.json 零污染
  assert.match(src, /'executionTargetId' in params/);
  // 收尾工厂单一真相
  assert.equal(src.split('function createJobRunFinalizer').length - 1, 1);
});

test('handleToolRun unknown execution target fails closed before job creation', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'core/biof3-server/helpers/tools-executor.js'), 'utf8'
  );
  const gate = src.indexOf("error: 'unknown_execution_target'");
  const insert = src.indexOf('INSERT INTO tool_jobs');
  assert.ok(gate > -1 && insert > -1 && gate < insert, 'target check must precede job INSERT');
});
