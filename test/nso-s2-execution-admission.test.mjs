/**
 * nso-s2-execution-admission.test.mjs — BLOCK-377（S2 / G-06）执行准入内核契约。
 *
 * 四类拒绝（蓝图 §8.1）：参数改写 / 过期 / 跨 task 重放 / 旁路调用 + 单次消耗语义。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  issueExecutionToken,
  verifyAndConsumeExecutionToken,
  inspectExecutionToken,
  _resetConsumedNonces,
} = require('../core/shared-backend/execution-admission.js');

test.beforeEach(() => _resetConsumedNonces());

test('S2-G06 正路：签发→校验消耗成功，二次消耗=重放拒绝', () => {
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: { cwd: '/x' } });
  const first = verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: { cwd: '/x' } });
  assert.equal(first.ok, true);
  const second = verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: { cwd: '/x' } });
  assert.deepEqual([second.ok, second.reason], [false, 'execution_token_replayed']);
});

test('S2-G06 拒绝①参数改写：ctxSnapshot 变更即拒', () => {
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: { cwd: '/x', argv: ['a'] } });
  const d = verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: { cwd: '/x', argv: ['a', '--injected'] } });
  assert.deepEqual([d.ok, d.reason], [false, 'execution_token_ctx_rewritten']);
});

test('S2-G06 拒绝②过期', () => {
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {}, ttlMs: 1000 });
  const d = verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {}, now: Date.now() + 2000 });
  assert.deepEqual([d.ok, d.reason], [false, 'execution_token_expired']);
});

test('S2-G06 拒绝③跨 task 重放：taskId 绑定不匹配即拒', () => {
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {} });
  const d = verifyAndConsumeExecutionToken({ token, taskId: 't2-attacker', fingerprint: 'fp-a', ctxSnapshot: {} });
  assert.deepEqual([d.ok, d.reason], [false, 'execution_token_task_mismatch']);
});

test('S2-G06 拒绝④旁路：缺 token / 形状非法 / fingerprint 不匹配', () => {
  assert.deepEqual(
    [verifyAndConsumeExecutionToken({}).ok, verifyAndConsumeExecutionToken({}).reason],
    [false, 'execution_token_invalid'],
  );
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {} });
  const d = verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-other', ctxSnapshot: {} });
  assert.deepEqual([d.ok, d.reason], [false, 'execution_token_fingerprint_mismatch']);
  const forged = { ...token, v: 99 };
  assert.equal(verifyAndConsumeExecutionToken({ token: forged, taskId: 't1' }).ok, false);
});

test('S2-G06 inspect 不消耗（observe 模式同构判定面）', () => {
  const { token } = issueExecutionToken({ taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {} });
  assert.equal(inspectExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {} }).ok, true);
  // inspect 后仍可正式消耗（未留痕）
  assert.equal(verifyAndConsumeExecutionToken({ token, taskId: 't1', fingerprint: 'fp-a', ctxSnapshot: {} }).ok, true);
});
