/**
 * L5 utility-process host 决策层 HK-01（2026-11-23，用户裁决放行运行态）。
 *
 * 安全边界：默认不装载；仅已安装且启用的包 + 白名单入口可 fork；不传 MessagePort；
 * 不碰现有 pack iframe sandbox/CSP；fork 参数固定（禁 shell/远程 URL）；启动/退出全程审计。
 * 决策层是纯函数，IPC 装配层（channels/preload/main）随后接线。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'utility-host-decision.js');
const load = () => require(MODULE);

test('L5 决策模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 utility-host-decision.js');
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /require\(['"](?!\.\.?\/|node:)/);
});

test('默认不装载：无显式声明/未启用包/未知入口一律拒绝', () => {
  const { evaluateForkAdmission } = load();
  assert.equal(evaluateForkAdmission({}).allowed, false, '空请求=默认不装载');
  const disabled = evaluateForkAdmission({ pack: { enabled: false, packRoot: '/p' }, manifest: { host: { type: 'utility-process', entry: 'w.js' } } });
  assert.equal(disabled.allowed, false, '禁用包不得 fork');
  const badEntry = evaluateForkAdmission({ pack: { enabled: true, packRoot: '/p' }, manifest: { host: { type: 'utility-process', entry: '../../evil.js' } } });
  assert.equal(badEntry.allowed, false, '路径穿越不得 fork');
});

test('合法声明：固定 argv、不传 MessagePort、远程 URL 拒绝', () => {
  const { evaluateForkAdmission } = load();
  const ok = evaluateForkAdmission({
    pack: { enabled: true, packRoot: '/p' },
    manifest: { id: 'pk', host: { type: 'utility-process', entry: 'host/worker.js', permissions: ['workspace.read'], messages: { inbound: ['ping'] } } },
  });
  assert.equal(ok.allowed, true);
  assert.deepEqual(ok.argv, ['host/worker.js'], 'argv 须固定为白名单入口，无 shell');
  assert.equal(ok.messagePort, false, '不传 MessagePort');
  const remote = evaluateForkAdmission({ pack: { enabled: true, packRoot: '/p' }, manifest: { host: { type: 'utility-process', entry: 'https://evil/x.js' } } });
  assert.equal(remote.allowed, false, '远程 URL 入口拒绝');
});

test('生命周期状态机：start→running→exit/stop，非法跃迁拒绝', () => {
  const { reduceHostState } = load();
  assert.equal(reduceHostState({ status: 'stopped' }, 'start').status, 'starting');
  assert.equal(reduceHostState({ status: 'starting' }, 'spawned').status, 'running');
  assert.equal(reduceHostState({ status: 'running' }, 'exit').status, 'stopped');
  assert.equal(reduceHostState({ status: 'stopped' }, 'exit').error, 'invalid_transition');
});

test('审计事件：只记状态/入口/包 id，不记路径真值/凭据', () => {
  const { auditHostEvent } = load();
  const line = auditHostEvent({ at: '2026-11-23T00:00:00Z', packId: 'pk', action: 'start', entry: 'host/worker.js', packRoot: '/secret/root', token: 'x' });
  assert.ok(line.includes('pk') && line.includes('start'));
  assert.ok(!line.includes('/secret/root') && !line.includes('token'), 'packRoot 真值/凭据不进审计');
});

test('红线：现有 pack sandbox/CSP handler 未改', () => {
  const scheme = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/scheme.js'), 'utf8');
  const csp = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/csp.js'), 'utf8');
  assert.match(scheme, /protocol\.handle\(SCHEME/);
  assert.match(csp, /default-src/);
});
