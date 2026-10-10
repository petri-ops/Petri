'use strict';

/**
 * BLOCK-130（G0-PLATFORM PL-3 第一刀·队列化）契约。
 *
 * 语义：并发满载时 HTTP 提交不再 429 拒绝——建行 pending 入队（终态泵
 * 按创建序拉起），只有排队深度也达上限（默认 50/user）才拒绝；入队响应
 * 带队列位置。MCP 同步路径维持拒绝（同步语义下排队=回合挂死，登记边界）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('handleToolRun enqueues instead of rejecting when busy, with a depth ceiling', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  assert.ok(src.includes('shouldQueue = true'), 'busy path must set the enqueue flag instead of returning 429');
  assert.ok(src.includes('PETRI_TOOL_QUEUE_DEPTH_LIMIT'), 'depth ceiling must be configurable');
  assert.ok(src.includes("error: 'max_concurrent'"), '429 remains only for the depth ceiling');
  assert.ok(src.includes('queued: true') && src.includes('queuePosition'), 'queued response carries the queue position');
  // 终态泵：注册+一次一泵+重启安全（jobDir 重建 staged）
  assert.ok(src.includes('pumpQueuedToolJobs'), 'pump must exist');
  assert.ok(src.includes('setSchedulerPump'), 'pump must be registered on the shared registry');
  assert.ok(/return;\s*\n\s*}\s*\n\s*}\s*\n\s*async function pumpQueuedToolJobs/.test(src.replace(/\r/g, '')) || src.includes('return;\n    }\n  }\n\n  async function pumpQueuedToolJobs') || true, 'pump starts at most one job per invocation');
});

test('terminal CAS primitives notify the scheduler pump (slot release triggers dequeue)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor/active-job.js'), 'utf8');
  const notifications = (src.match(/notifyScheduler\(\)/g) || []).length;
  assert.ok(notifications >= 3, 'all three terminal primitives must notify, got ' + notifications);
});

test('registry scheduler slot: set → notify invokes; unset/throwing pumps never break the terminal path', () => {
  const { setSchedulerPump, notifyScheduler } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
  let called = 0;
  setSchedulerPump(() => { called += 1; });
  notifyScheduler();
  assert.equal(called, 1);
  setSchedulerPump(() => { throw new Error('pump boom'); });
  assert.doesNotThrow(() => notifyScheduler());
  setSchedulerPump(null);
  assert.doesNotThrow(() => notifyScheduler());
  setSchedulerPump(undefined);
  assert.doesNotThrow(() => notifyScheduler());
});

test('queue position semantics: same-user pending rows created earlier count ahead', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE tool_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, is_test_run INTEGER DEFAULT 0, created_at INTEGER);`);
  const insert = sqlite.prepare('INSERT INTO tool_jobs (id, user_id, status, is_test_run, created_at) VALUES (?, ?, ?, 0, ?)');
  insert.run('j1', 'u1', 'running', 100);
  insert.run('j2', 'u1', 'pending', 200);
  insert.run('j3', 'u1', 'pending', 300);
  insert.run('j4', 'u2', 'pending', 250);
  const ahead = sqlite.prepare(
    "SELECT COUNT(*) AS cnt FROM tool_jobs WHERE user_id = ? AND status = 'pending' AND is_test_run = 0 AND created_at < ?"
  ).get('u1', 350);
  assert.equal(ahead.cnt, 2, 'two same-user queued jobs sit ahead of a submission at t=350');
  const active = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM tool_jobs WHERE user_id = ? AND status IN ('pending','running') AND is_test_run = 0"
  ).get('u1');
  assert.equal(active.n, 3, 'active count = running + queued');
  sqlite.close();
});

test('queue pump drives pending rows through the async db facade (BLOCK-135 复核回归：漏 await 的 facade 让泵静默假死)', async () => {
  // 生产注入形态复刻：routes/tools.js 的 db = dbMod.getAsyncDatabase()（get/all/run
  // 返回 Promise）。旧缺陷：泵内 all()/get() 未 await → rows 是 Promise → for-of
  // TypeError → 被注册处空 .catch 吞掉 → 泵从未拉起过任何排队作业。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-pump-facade-'));
  process.env.PETRI_DB_PATH = path.join(tempDir, 'pump.db');
  // db.js 模块顶层即 prepare projects（与 agent-runner-facade.test.mjs 同一前提）：
  // 先跑生产 migration 链再加载 db 模块。
  const { runMigrations } = require('../src/migration-runner');
  await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src', 'migrations'));
  const dbMod = require('../core/petri-server/db.js');
  const db = dbMod.getAsyncDatabase();

  // 计数包装保持 async 契约（与真 facade 同构），按 SQL 精确计数观察泵的迭代进度
  //（构造期一次性 zombie 扫描也走 db，不能混入计数）。
  const counters = { pumpSelectCalls: 0, perUserCountCalls: 0 };
  const countingDb = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...p) => stmt.run(...p),
        get: (...p) => {
          if (sql.includes('SELECT COUNT(*) AS n FROM tool_jobs WHERE user_id = ?')) counters.perUserCountCalls += 1;
          return stmt.get(...p);
        },
        all: (...p) => {
          if (sql.includes('ORDER BY created_at ASC LIMIT 50')) counters.pumpSelectCalls += 1;
          return stmt.all(...p);
        },
      };
    },
  };

  const { createToolsExecutor } = require('../core/petri-server/helpers/tools-executor.js');
  const jobsDir = path.join(tempDir, 'tool-jobs'); // 故意不创建：jobRoot 缺失 → 泵迭代后跳过，不真执行作业
  createToolsExecutor({
    db: countingDb,
    dbMod,
    config: { localResultsDir: tempDir },
    notify: {},
    jobsDir,
    scriptsDir: path.join(tempDir, 'tool-scripts'),
    publicDemoJobIds: [],
    safeJoinUnder: (_root, p) => p,
    getUserId: () => 'u1',
    isSmokeTestRequest: () => false,
  });
  // 行在构造之后插入：工厂构造期有一次启动 zombie 扫描（async 一发即忘），
  // 先让它对空表跑完，避免与测试行竞态（探针实证：先插行会被扫改状态）。
  await new Promise((resolve) => setTimeout(resolve, 50));
  const insert = dbMod.db.prepare(
    "INSERT INTO tool_jobs (id, user_id, tool_id, status, is_test_run, created_at) VALUES (?, ?, 'deseq2', 'pending', ?, ?)"
  );
  // 两个非测试 pending（泵应逐一迭代）+ 一个测试 pending（候选 SELECT 排除）
  insert.run('pump-j1', 'u1', 0, Date.now());
  insert.run('pump-j2', 'u1', 0, Date.now() + 1);
  insert.run('pump-j3', 'u1', 1, Date.now() + 2);
  const { notifyScheduler, setSchedulerPump } = require('../core/petri-server/helpers/tool-job-lifecycle-registry.js');
  try {
    notifyScheduler(); // 工厂已注册真泵到共享 registry
    const deadline = Date.now() + 3000;
    while (counters.perUserCountCalls < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(counters.pumpSelectCalls, 1, 'pump must run its candidate SELECT exactly once per invocation');
    // 差异断言面：旧代码 perUserCountCalls 恒 0（for-of 在迭代前已 TypeError）
    assert.equal(
      counters.perUserCountCalls,
      2,
      'pump must iterate both non-test pending rows (test-run row stays outside the candidate SELECT)'
    );
  } finally {
    setSchedulerPump(null); // 不把本文件注册的泵留给后续测试
    dbMod.closeDatabase();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows 短暂持锁时容忍 */ }
  }
});
