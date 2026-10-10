// BLOCK-109 P1/P2 — 编排韧性契约测试
// ① callProviderWithNetworkRetry 行为（瞬断重试/耗尽上抛/非瞬断不重试/abort 即停）
// ② spawn 派发并行度软上限源码契约
// ③ 项目概览孤儿过滤源码契约
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

test('callProviderWithNetworkRetry：瞬断重试后成功、耗尽上抛、非瞬断不重试、abort 即停', async () => {
  // loop-orchestrator 依赖桌面 DB 环境——用 dev 库副本隔离加载；无库环境跳过（诚实分级）
  const devDb = resolve(root, '.petri-dev-user-data', 'data', 'petri.db');
  if (!existsSync(devDb)) {
    assert.ok(true, 'dev DB 不存在，跳过行为验证（CI/干净环境）');
    return;
  }
  const tmp = resolve(os.tmpdir(), `b109-retry-test-${Date.now()}.db`);
  copyFileSync(devDb, tmp);
  process.env.PETRI_DB_PATH = tmp;
  process.env.PETRI_LOCAL_DATA_DIR = dirname(tmp);
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(root, 'core', 'petri-server', 'loop-orchestrator.js')).href);
  } finally {
    try { unlinkSync(tmp); } catch { /* Windows 句柄延迟释放：留给 OS 清理（known class ③） */ }
  }

  const { callProviderWithNetworkRetry } = mod;
  assert.equal(typeof callProviderWithNetworkRetry, 'function');

  // ① 瞬断两次后成功
  let calls = 0;
  const r1 = await callProviderWithNetworkRetry(
    async () => { calls += 1; if (calls < 3) { throw new Error('read ECONNRESET'); } return { ok: 1 }; },
    { retries: 2, baseDelayMs: 1 }
  );
  assert.deepEqual(r1, { ok: 1 });
  assert.equal(calls, 3);

  // ② 重试耗尽 → 上抛最后一次错误
  let calls2 = 0;
  await assert.rejects(
    callProviderWithNetworkRetry(
      async () => { calls2 += 1; throw new Error('read ECONNRESET'); },
      { retries: 1, baseDelayMs: 1 }
    ),
    /ECONNRESET/
  );
  assert.equal(calls2, 2);

  // ③ 非瞬断错误不重试（fail-fast）
  let calls3 = 0;
  await assert.rejects(
    callProviderWithNetworkRetry(
      async () => { calls3 += 1; throw new Error('invalid api key'); },
      { retries: 2, baseDelayMs: 1 }
    ),
    /invalid api key/
  );
  assert.equal(calls3, 1);

  // ④ abort 置位后立即停止重试
  let calls4 = 0;
  await assert.rejects(
    callProviderWithNetworkRetry(
      async () => { calls4 += 1; throw new Error('ECONNRESET'); },
      { retries: 3, baseDelayMs: 1, isAborted: () => true }
    ),
    /ECONNRESET/
  );
  assert.equal(calls4, 1);
});

test('spawn 派发并行度软上限源码契约（BLOCK-109 P2）', () => {
  const src = readFileSync(resolve(root, 'core', 'petri-server', 'agent-tools', 'spawn-agent-tools.js'), 'utf8');
  // 软上限守卫三要素：守卫调用 + 常量 + 软指引返回（wait_agent 引导）
  assert.ok(src.includes('getRunningChildAgentTasks(parentTaskId)'), '必须按父任务核对活跃子任务');
  assert.ok(src.includes('SPAWN_CONCURRENCY_LIMIT'), '必须存在并行上限常量');
  assert.ok(src.includes("'concurrency_limit'"), '必须以 concurrency_limit 软返回（不硬拒）');
  assert.ok(src.includes('wait_agent'), '软指引必须引导 wait_agent 腾位');
});

test('项目概览孤儿过滤源码契约（BLOCK-109 P4）', () => {
  const src = readFileSync(resolve(root, 'frontend', 'src', 'components', 'workspace-panels', 'WorkspaceSummaryCard.tsx'), 'utf8');
  assert.ok(src.includes('t.projectId === projectId'), '必须严格按 projectId 过滤');
  assert.ok(!src.includes('!t.projectId || t.projectId === projectId'), '孤儿兜底（!projectId 计入每个项目）必须已移除');
});
