/**
 * UI-638 加映 — /api/ai/chat 上游无响应兜底（红证据＝实机 150s 挂死，零 token 零报错）。
 *
 * 语义：到点只触发一次 abort + 报错；已结束/非法时长不 arm；clear() 幂等。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armAbortTimeout } from '../core/petri-server/helpers/model-timeout.js';

function harness(timeoutMs) {
  const calls = [];
  let fire = null;
  const guard = armAbortTimeout({
    timeoutMs,
    abort: () => calls.push('abort'),
    onTimeout: () => calls.push('timeout'),
    setTimer: (fn, ms) => { fire = fn; calls.push(`arm:${ms}`); return 42; },
    clearTimer: (id) => calls.push(`clear:${id}`),
  });
  return { calls, guard, fire: () => fire && fire() };
}

describe('armAbortTimeout', () => {
  it('到点只触发一次 abort + 报错（重复触发幂等）', () => {
    const { calls, guard, fire } = harness(120000);
    assert.deepEqual(calls, ['arm:120000']);
    assert.equal(guard.fired(), false);
    fire();
    fire();
    assert.deepEqual(calls, ['arm:120000', 'abort', 'timeout']);
    assert.equal(guard.fired(), true);
  });

  it('clear() 释放定时器并返回 id', () => {
    const { calls, guard } = harness(5000);
    guard.clear();
    assert.deepEqual(calls, ['arm:5000', 'clear:42']);
  });

  it('非法/非正时长不 arm（0、负数、NaN、undefined）', () => {
    for (const ms of [0, -1, Number.NaN, undefined, null]) {
      const { calls, guard } = harness(ms);
      assert.deepEqual(calls, [], `timeoutMs=${String(ms)}`);
      assert.equal(guard.fired(), false);
      guard.clear();
    }
  });

  it('abort 抛错不阻断 onTimeout', () => {
    const calls = [];
    const guard = armAbortTimeout({
      timeoutMs: 10,
      abort: () => { throw new Error('boom'); },
      onTimeout: () => calls.push('timeout'),
      setTimer: (fn) => { fn(); return 1; },
      clearTimer: () => {},
    });
    assert.deepEqual(calls, ['timeout']);
    assert.equal(guard.fired(), true);
  });
});
