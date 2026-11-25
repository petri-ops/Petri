/**
 * BLOCK-520 P2 — HK-01 红绿先行契约
 * OB-008 goal-verifier 接线进主循环终止判定（decisionVerifier 默认 null 不变）/
 * OB-009 ready 显式事件替 isReady 轮询（轮询 fallback 向后兼容）。零新依赖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ---- OB-008 goal-verifier 接线 ------------------------------------------

test('OB-008 goal-verifier 纯函数契约（no-tool 产物证据判定）', () => {
  const { verifyGoalCompletion } = require(path.join(ROOT, 'core/petri-server/agent-tools/goal-verifier.js'));
  const good = verifyGoalCompletion({
    goal: { status: 'active' },
    artifacts: [{ path: '/tmp/report.html', bytes: 120 }],
    todos: [{ status: 'done' }],
    backgroundTasks: [{ settled: true }],
  });
  assert.equal(good.ok, true);
  assert.equal(good.verdict, 'verified');
  const bad = verifyGoalCompletion({
    goal: { status: 'blocked' },
    artifacts: [],
    todos: [{ status: 'open' }],
    backgroundTasks: [{ settled: false }],
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.reasons.map((r) => r.code).sort(),
    ['ARTIFACTS_ABSENT', 'BACKGROUND_TASKS_UNSETTLED', 'GOAL_BLOCKED', 'TODO_NOT_TERMINAL']);
});

test('OB-008 接线：loop 终止判定调用 goalVerifier，默认未传零行为变化，decisionVerifier null 不变', () => {
  const loop = fs.readFileSync(path.join(ROOT, 'core/petri-server/loop-orchestrator.js'), 'utf-8');
  assert.match(loop, /goalVerifier/, 'loop 终止判定须识别可选 goalVerifier 注入');
  // 默认未传时不得改变判定：注入点为可选 fn（typeof check）
  assert.match(loop, /typeof goalVerifier === 'function'/);
  // decisionVerifier 默认值仍在 agent-runner 为 null（裁决2：不变）
  const runner = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-runner.js'), 'utf-8');
  assert.match(runner, /decisionVerifier = null/);
});

// ---- OB-009 ready 显式事件 ----------------------------------------------

test('OB-009 ready 显式事件模块：广播/等待，轮询 fallback 保留', () => {
  const READY = path.join(ROOT, 'core/shared-backend/ready-signal.js');
  assert.ok(fs.existsSync(READY), 'core/shared-backend/ready-signal.js 必须新建');
  const r = require(READY);
  r.resetReadySignals();
  const key = 'test-instance-1';
  let fired = 0;
  const off = r.onReady(key, () => { fired += 1; });
  r.signalReady(key, { pid: 123 });
  assert.equal(fired, 1);
  assert.equal(r.isReady(key), true);
  assert.equal(r.getReadyInfo(key).pid, 123);
  off();
  r.signalReady(key, { pid: 456 });
  assert.equal(fired, 1, 'off 后不得再收到事件');
  r.resetReadySignals();
  assert.equal(r.isReady(key), false);
});

test('OB-009 main.js waitForBackendHealthy 接 ready 事件快路径（轮询保留）', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf-8');
  assert.match(main, /ready-signal|signalReady|onReady/);
  // 轮询 fallback 必须保留（setTimeout 仍在）
  assert.match(main, /setTimeout\(resolve, 1000\)/);
});
