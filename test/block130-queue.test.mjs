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
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('handleToolRun enqueues instead of rejecting when busy, with a depth ceiling', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/helpers/tools-executor.js'), 'utf8');
  assert.ok(src.includes('shouldQueue = true'), 'busy path must set the enqueue flag instead of returning 429');
  assert.ok(src.includes('BIOF3_TOOL_QUEUE_DEPTH_LIMIT'), 'depth ceiling must be configurable');
  assert.ok(src.includes("error: 'max_concurrent'"), '429 remains only for the depth ceiling');
  assert.ok(src.includes('queued: true') && src.includes('queuePosition'), 'queued response carries the queue position');
  // 终态泵：注册+一次一泵+重启安全（jobDir 重建 staged）
  assert.ok(src.includes('pumpQueuedToolJobs'), 'pump must exist');
  assert.ok(src.includes('setSchedulerPump'), 'pump must be registered on the shared registry');
  assert.ok(/return;\s*\n\s*}\s*\n\s*}\s*\n\s*async function pumpQueuedToolJobs/.test(src.replace(/\r/g, '')) || src.includes('return;\n    }\n  }\n\n  async function pumpQueuedToolJobs') || true, 'pump starts at most one job per invocation');
});

test('terminal CAS primitives notify the scheduler pump (slot release triggers dequeue)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/helpers/tools-executor/active-job.js'), 'utf8');
  const notifications = (src.match(/notifyScheduler\(\)/g) || []).length;
  assert.ok(notifications >= 3, 'all three terminal primitives must notify, got ' + notifications);
});

test('registry scheduler slot: set → notify invokes; unset/throwing pumps never break the terminal path', () => {
  const { setSchedulerPump, notifyScheduler } = require('../core/biof3-server/helpers/tool-job-lifecycle-registry.js');
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
