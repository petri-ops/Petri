/**
 * BLOCK-457 P1 — supervisor noRetryExitCodes 契约（HK-01 红绿先行）。
 *
 * 缺陷史：绑定类永久失败（exit 77）曾按普通意外退出处理——30s 固定重试无限循环
 * （2026-11-17 实机 749 次 boot / 6 小时噪音）。契约：标记为不可重试的退出码
 * 不再排程重启，且日志单行诚实说明原因。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { createOwnedBackendSupervisor } from '../src/owned-backend-supervisor.js';

/** 鸭子类型 child：supervisor 只用 once/killed/pid/kill。 */
function fakeChild(pid) {
  const listeners = {};
  return {
    pid,
    killed: false,
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    once(event, fn) { (listeners[event] ||= []).push(fn); },
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    emit(event, ...args) { (listeners[event] || []).forEach((fn) => fn(...args)); },
    kill() { this.killed = true; },
  };
}

/** 恒不触发的假 timer 工厂：schedule 只登记不执行（restartScheduled 可断言、无真实重试）。 */
const fakeSchedule = () => 42424;
const fakeCancel = () => {};

function makeSupervisor(noRetryExitCodes) {
  const spawned = [];
  const warns = [];
  const supervisor = createOwnedBackendSupervisor({
    name: 'test-backend',
    spawnProcess: () => {
      const child = fakeChild(1000 + spawned.length);
      spawned.push(child);
      return child;
    },
    log: () => {},
    warn: (m) => warns.push(m),
    schedule: fakeSchedule,
    cancel: fakeCancel,
    noRetryExitCodes,
  });
  return { supervisor, spawned, warns };
}

test('exit 77（noRetryExitCodes 命中）→ 不排程重启、spawn 只发生一次', () => {
  const { supervisor, spawned, warns } = makeSupervisor([77]);
  supervisor.start('boot');
  assert.equal(spawned.length, 1);
  spawned[0].emit('exit', 77, null);
  const state = supervisor.getState();
  assert.equal(state.restartScheduled, false, 'exit 77 不得排程重启');
  assert.equal(spawned.length, 1, '不得再次 spawn');
  assert.ok(
    warns.some((w) => w.includes('77') && w.toLowerCase().includes('no-retry')),
    `应有单行 no-retry 诚实日志（实测 warns=${JSON.stringify(warns)}）`,
  );
});

test('exit 1（普通意外退出）→ 照旧排程重启（回归保护）', () => {
  const { supervisor, spawned } = makeSupervisor([77]);
  supervisor.start('boot');
  spawned[0].emit('exit', 1, null);
  assert.equal(supervisor.getState().restartScheduled, true, '普通退出码仍走重启链');
});

test('默认构造（未传 noRetryExitCodes）行为不变：77 也照旧重启（旧调用方零行为漂移）', () => {
  const { supervisor, spawned } = makeSupervisor(undefined);
  supervisor.start('boot');
  spawned[0].emit('exit', 77, null);
  assert.equal(supervisor.getState().restartScheduled, true, '默认无 noRetry 名单时 77 照旧重启');
});

test('已 shutdown 时 77 不触发任何动作', () => {
  const { supervisor, spawned } = makeSupervisor([77]);
  supervisor.start('boot');
  supervisor.shutdown('test');
  const before = spawned.length;
  spawned[0].emit('exit', 77, null);
  assert.equal(spawned.length, before, 'shuttingDown 状态下不 spawn');
  assert.equal(supervisor.getState().restartScheduled, false);
});
