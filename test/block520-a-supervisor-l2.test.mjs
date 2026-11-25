/**
 * BLOCK-520 A-会话级外部监督器直达 L2 — HK-01 红绿先行（口令 msg_7cf0a3957a41）。
 * 唯一硬门槛=§2 身份+豁免+fail-safe：owner dev / 9223 / test-user-data / 身份不明一律豁免；
 * prod_user 才进动作候选；重启风暴熔断；resume 失败回落 recovery_required（可逆）。
 * 注入 deps 可控时钟，不碰 owner 实例；L3 进程级 kill/restart 永久挂账不在本包。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('A-L2 HK-01：豁免清单四短路——owner dev / 9223 / test-user-data / 身份不明零误杀', () => {
  const f = path.join(ROOT, 'core/petri-server/helpers/external-supervisor-controller.js');
  assert.ok(fs.existsSync(f), 'external-supervisor-controller.js 必须新建');
  const { classifyInstance } = require(f);
  const cases = [
    { name: 'owner dev 角色', input: { instanceRole: 'dev_owner', dataDir: '/Users/x/.petri-user-data', port: 3001 }, reason: 'role_not_prod_user' },
    { name: '9223 调试实例', input: { instanceRole: 'prod_user', dataDir: '/repo/.petri-user-data', port: 9223 }, reason: 'reserved_port' },
    { name: 'CDP 9222', input: { instanceRole: 'prod_user', dataDir: '/repo/.petri-user-data', port: 9222 }, reason: 'reserved_port' },
    { name: 'test user data', input: { instanceRole: 'prod_user', dataDir: '/repo/.petri-test-user-data', port: 3101 }, reason: 'test_data_dir' },
    { name: 'dev user data', input: { instanceRole: 'prod_user', dataDir: '/repo/.petri-dev-user-data', port: 3101 }, reason: 'dev_data_dir' },
    { name: '身份不明（无 prod_user 标签）', input: { dataDir: '/repo/.petri-user-data', port: 4101 }, reason: 'identity_unknown' },
  ];
  for (const c of cases) {
    const verdict = classifyInstance(c.input);
    assert.equal(verdict.exempt, true, `${c.name} 必须豁免`);
    assert.equal(verdict.reason, c.reason, `${c.name} 理由`);
  }
});

test('A-L2 HK-01：显式 prod_user 且四项全过才进候选', () => {
  const { classifyInstance } = require(path.join(ROOT, 'core/petri-server/helpers/external-supervisor-controller.js'));
  const v = classifyInstance({ instanceRole: 'prod_user', dataDir: '/srv/petri/.petri-user-data', port: 4101, parentChainVerified: true });
  assert.equal(v.exempt, false);
  assert.equal(v.eligible, true);
  assert.equal(v.role, 'prod_user');
});

test('A-L2 HK-01：单次超时→L2 调 resume；重启风暴→熔断转 L3 人工', async () => {
  const { decideAction, classifyInstance } = require(path.join(ROOT, 'core/petri-server/helpers/external-supervisor-controller.js'));
  const eligible = classifyInstance({ instanceRole: 'prod_user', dataDir: '/srv/petri/.petri-user-data', port: 4101, parentChainVerified: true });
  let resumed = 0;
  const deps = { resume: async () => { resumed += 1; return { ok: true }; }, now: () => 1000 };
  const normal = await decideAction({ instance: eligible, restartsInWindow: 1, threshold: 5, taskId: 't1' }, deps);
  assert.equal(normal.level, 'L2');
  assert.equal(resumed, 1);
  const storm = await decideAction({ instance: eligible, restartsInWindow: 9, threshold: 5, taskId: 't2' }, deps);
  assert.equal(storm.level, 'L3');
  assert.match(storm.reason, /restart_storm|风暴/);
  assert.equal(resumed, 1, '风暴不得再调 resume');
});

test('A-L2 HK-01：resume 失败必回落 recovery_required（可逆，不自造状态）', async () => {
  const { decideAction, classifyInstance } = require(path.join(ROOT, 'core/petri-server/helpers/external-supervisor-controller.js'));
  const eligible = classifyInstance({ instanceRole: 'prod_user', dataDir: '/srv/petri/.petri-user-data', port: 4101, parentChainVerified: true });
  const deps = { resume: async () => ({ ok: false, error: 'already_current' }), now: () => 1000 };
  const r = await decideAction({ instance: eligible, restartsInWindow: 1, threshold: 5, taskId: 't3' }, deps);
  assert.equal(r.level, 'L2');
  assert.equal(r.outcome, 'recovery_required');
  assert.equal(r.reason, 'resume_failed');
});

test('A-L2 HK-01：L3 进程级 kill/restart 零代码（永久挂账）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/external-supervisor-controller.js'), 'utf-8');
  assert.doesNotMatch(src, /\bkill\s*\(|process\.kill|SIGKILL|SIGTERM|\.restart\s*\(/i);
  const note = fs.readFileSync(path.join(ROOT, 'acceptance/harness-observability/A-EXTERNAL-SUPERVISOR-BOUNDARY.md'), 'utf-8');
  assert.match(note, /L3.*挂账|进程级.*挂账/);
});
