/**
 * M5（BLOCK-431）安全与正确性判据 · HK-01 红绿先行。
 * 首跑实现未落盘 → ERR_MODULE_NOT_FOUND 必红；实现后 → 全绿。
 * 所有植入样例均为合成数据，不含真实凭据/密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBootToken,
  adjudicateLocalRequest,
  adjudicateMcpCommand,
  adjudicateDragPath,
  adjudicateFrameNavigation,
  adjudicatePermissionSessions,
  adjudicateTarEntry,
  cleanupPlan,
  failureEnvelope,
  ddlOutcome,
  adjudicateGitGrepResult,
  redactLog,
  adjudicatePaging,
  atomicWritePlan,
} from '../core/petri-server/agent-tools/security-boundaries.js';

test('M5-2 per-boot 随机 token：两次启动不同，常量 Bearer 被拒', () => {
  const a = createBootToken({ seed: 1 });
  const b = createBootToken({ seed: 2 });
  assert.notEqual(a, b);
  assert.ok(a.length >= 16);
  assert.equal(adjudicateLocalRequest({ origin: '', method: 'GET', token: null, bootToken: a, trusted: true }).ok, false);
  assert.equal(adjudicateLocalRequest({ origin: '', method: 'GET', token: 'desktop-local', bootToken: a, trusted: true }).ok, false, '废弃常量 Bearer 必须拒');
  assert.equal(adjudicateLocalRequest({ origin: '', method: 'POST', token: a, bootToken: a, trusted: true }).ok, true);
});

test('M5-1/2 伪造 Origin 与任意 stdio command 必拒', () => {
  const boot = createBootToken({ seed: 3 });
  assert.equal(adjudicateLocalRequest({ origin: 'https://evil.example', method: 'POST', token: boot, bootToken: boot }).ok, false);
  assert.equal(adjudicateMcpCommand({ command: '/bin/sh', args: ['-lc', 'rm -rf /'] }).ok, false);
  assert.equal(adjudicateMcpCommand({ command: 'node', args: ['server.js'], allowlisted: ['node'] }).ok, true);
});

test('M5-3 file:start-drag：SSH key 与 ../ 穿越植入必红', () => {
  const ok = adjudicateDragPath({ localPath: '/workspace/project/a.txt', registeredRoots: ['/workspace/project'], realpath: '/workspace/project/a.txt', name: 'a.txt', bytes: 100 });
  assert.equal(ok.ok, true);
  const ssh = adjudicateDragPath({ localPath: '/Users/me/.ssh/id_rsa', registeredRoots: ['/workspace/project'], realpath: '/Users/me/.ssh/id_rsa', name: 'id_rsa', bytes: 100 });
  assert.equal(ssh.ok, false);
  assert.ok(ssh.reasonCode.includes('ROOT'));
  const traversal = adjudicateDragPath({ localPath: '/workspace/project/../../etc/passwd', registeredRoots: ['/workspace/project'], realpath: '/etc/passwd', name: '../../etc/passwd', bytes: 100 });
  assert.equal(traversal.ok, false);
  assert.equal(adjudicateDragPath({ localPath: '/workspace/project/a.txt', registeredRoots: ['/workspace/project'], realpath: '/workspace/project/a.txt', name: 'a.txt', bytes: 21 * 1024 * 1024 }).ok, false, '内容长度上限');
});

test('M5-4 权限降级覆盖所有 session + 帧导航 allowlist', () => {
  const out = adjudicatePermissionSessions({ sessions: ['defaultSession', 'persist:petri-browser'], sessionCreatedHook: true, denied: ['defaultSession', 'persist:petri-browser'] });
  assert.equal(out.ok, true);
  assert.equal(adjudicatePermissionSessions({ sessions: ['defaultSession', 'persist:petri-browser'], sessionCreatedHook: false, denied: ['defaultSession'] }).ok, false);
  assert.equal(adjudicateFrameNavigation({ url: 'https://evil.example', allowlist: ['https://trusted.example'] }).ok, false);
  assert.equal(adjudicateFrameNavigation({ url: 'https://user:pw@trusted.example/path', allowlist: ['https://trusted.example'] }).ok, false, 'userinfo 必拒');
});

test('M5-5 tar 条目 ../ / 绝对路径 / 符号链接必红；zip 失败清理计划', () => {
  assert.equal(adjudicateTarEntry({ path: '../etc/passwd' }).ok, false);
  assert.equal(adjudicateTarEntry({ path: '/etc/passwd' }).ok, false);
  assert.equal(adjudicateTarEntry({ path: 'lib/link', type: 'symlink', linkname: '../../etc' }).ok, false);
  assert.equal(adjudicateTarEntry({ path: 'lib/a.txt', type: 'file' }).ok, true);
  assert.deepEqual(cleanupPlan({ destDir: '/tmp/plugin-x', failed: true }), { remove: '/tmp/plugin-x', reason: 'ZIP_FAILED' });
  assert.deepEqual(cleanupPlan({ destDir: '/tmp/plugin-x', failed: false }), { remove: null, reason: null });
});

test('M5-6 假成功治理：异常必得 ok:false + 具名 code，拒绝全 0 统计', () => {
  const env = failureEnvelope({ error: new Error('EACCES'), operation: 'read_config' });
  assert.equal(env.ok, false);
  assert.ok(env.code && env.code.length > 0);
  assert.equal(env.stats, null, '不得返回全 0 统计冒充成功');
  assert.equal(ddlOutcome({ succeeded: false, suppressed: true }).ok, false, '静默 DDL 失败不得判成功');
  assert.equal(ddlOutcome({ succeeded: true, suppressed: false }).ok, true);
});

test('M5-7 git grep 错误 fail-closed：只有 exit 1 才是无命中', () => {
  assert.equal(adjudicateGitGrepResult({ exitCode: 1, stderr: '' }).status, 'no-match');
  assert.equal(adjudicateGitGrepResult({ exitCode: 128, stderr: 'fatal: not a git repository' }).status, 'fail-closed');
  assert.equal(adjudicateGitGrepResult({ exitCode: -1, stderr: 'ENOENT git' }).status, 'fail-closed', 'git 缺席不得静默 PASS');
  assert.ok(!redactLog('token=FAKE-TEST-TOKEN-123').includes('FAKE-TEST-TOKEN-123'));
});

test('M5-8 limit/offset 断言 + 原子写 tmp+rename + 下载失败清理', () => {
  assert.equal(adjudicatePaging({ limit: 200, offset: 0 }).ok, true);
  assert.equal(adjudicatePaging({ limit: -1 }).ok, false);
  assert.equal(adjudicatePaging({ limit: 1.5 }).ok, false);
  assert.equal(adjudicatePaging({ limit: 10 ** 9 }).ok, false);
  assert.equal(adjudicatePaging({ limit: 10, offset: -3 }).ok, false);
  const plan = atomicWritePlan({ target: '/data/settings.json' });
  assert.ok(plan.tmp.endsWith('.tmp') && plan.rename === '/data/settings.json');
  assert.deepEqual(cleanupPlan({ destDir: '/data/partial.bin', failed: true }), { remove: '/data/partial.bin', reason: 'ZIP_FAILED' });
});
