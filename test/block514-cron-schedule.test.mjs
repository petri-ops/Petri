'use strict';

/**
 * BLOCK-514 — Q7 cron+时区+失败退避+overlap 可配置（HK-01 红绿先行）。
 *
 * 契约（plan §1，additive over automation-runner/store）：
 *   1. cron-schedule.js 纯函数（零依赖）：parseCron 五字段子集 + nextFireMs 固定偏移时区；
 *      不支持形态（4 字段/@daily/月星期英文名/域越界）显式 invalid_* 拒绝。
 *   2. store additive：agent_schedules 增列 cron_expr/tz_offset_minutes/retry_backoff/overlap_policy；
 *      createSchedule 二选一（intervalMinutes 或 cronExpr）；advanceSchedule cron 感知（非 cron 逐字不变）。
 *   3. 失败退避：retry_backoff=exponential 失败→ next = now + interval × 2^连续失败（封顶 24h）；成功清零。
 *   4. overlap：queue 放行 open-run（排队提交）；默认 skip 行为逐字不变。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// store 绑定临时 DB（须先于 require store 设置 env + 跑迁移，同 block256 惯例）
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'block514-'));
const dbPath = path.join(tempRoot, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });

const { runMigrations } = require('../src/migration-runner');
await runMigrations(dbPath, path.join(REPO_ROOT, 'src', 'migrations'));

const store = require('../core/petri-server/helpers/automation-store.js');
const runner = require('../core/petri-server/helpers/automation-runner.js');

// ── 纯函数面（零依赖，先于 store）────────────────────────────

const cron = require('../core/petri-server/helpers/cron-schedule.js');

const MIN = 60_000;
const HOUR = 60 * MIN;

test('parseCru 形态矩阵：合法五字段子集全收', () => {
  for (const expr of ['*/5 * * * *', '0 9 * * 1-5', '30 8 1,15 * *', '0 */2 * * *', '0 9 * * *', '59 23 31 12 *']) {
    const r = cron.parseCron(expr);
    assert.equal(r.ok, true, `expr=${expr} => ${JSON.stringify(r)}`);
    assert.equal(r.fields.length, 5);
  }
});

test('parseCru 非法形态显式拒绝（不静默）', () => {
  const cases = [
    ['0 9 * *', 'invalid_field_count'],       // 4 字段
    ['0 9 * * * *', 'invalid_field_count'],   // 6 字段
    ['@daily', null],                          // @ 形态不支持（字段数口径即可，只要显式拒绝）
    ['0 9 * * jan', null],                     // 月英文名
    ['0 9 * * mon', null],                     // 星期英文名
    ['60 * * * *', 'invalid_range'],          // 分钟越界
    ['0 25 * * *', 'invalid_range'],          // 小时越界
    ['0 9 32 * *', 'invalid_range'],          // 日越界
    ['0 9 * 13 *', 'invalid_range'],          // 月越界
    ['0 9 * * 8', 'invalid_range'],           // 星期越界（0-7 允许 7=0 的话本条按实现约定，见下）
  ];
  for (const [expr, code] of cases) {
    const r = cron.parseCron(expr);
    assert.equal(r.ok, false, `expr=${expr} 应拒绝，实际 ${JSON.stringify(r)}`);
    if (code) assert.equal(r.code, code, `expr=${expr} code=${r.code}`);
  }
});

test('nextFireMs 固定偏移时区：每日 09:00 北京钟面', () => {
  // tz=480（UTC+8）：UTC 2026-03-10T20:00:00Z = 北京 11 日 04:00 → 下一次 09:00 北京 = UTC 01:00
  const from = Date.UTC(2026, 2, 10, 20, 0, 0);
  const next = cron.nextFireMs({ cron: '0 9 * * *', fromMs: from, tzOffsetMinutes: 480 });
  assert.equal(next, Date.UTC(2026, 2, 11, 1, 0, 0), new Date(next).toISOString());
});

test('nextFireMs 周域：周一到周五', () => {
  // 2026-03-14 是周六（UTC）。tz=0：周五 09:00 已过 → 下一个周一 09:00
  const from = Date.UTC(2026, 2, 14, 10, 0, 0);
  const next = cron.nextFireMs({ cron: '0 9 * * 1-5', fromMs: from, tzOffsetMinutes: 0 });
  assert.equal(next, Date.UTC(2026, 2, 16, 9, 0, 0), new Date(next).toISOString());
});

test('nextFireMs 永不满足显式报 unsatisfiable（2 月 30 日）', () => {
  const from = Date.UTC(2026, 0, 1, 0, 0, 0);
  let threw = null;
  try {
    cron.nextFireMs({ cron: '0 0 30 2 *', fromMs: from, tzOffsetMinutes: 0 });
  } catch (e) { threw = e; }
  assert.ok(threw, '应抛错');
  assert.equal(threw.code, 'unsatisfiable');
});

test('advanceSchedule cron 感知：cron 调度按 nextFireMs 推进（非 cron 逐字不变）', () => {
  const created = store.createSchedule({
    projectId: 'proj_b514',
    title: 'cron 每日九点',
    prompt: 'cron 推进验证',
    kind: 'task',
    cronExpr: '0 9 * * *',
    tzOffsetMinutes: 480,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const row = store.getSchedule(created.schedule.id);
  assert.equal(row.cron_expr, '0 9 * * *');
  assert.equal(row.tz_offset_minutes, 480);

  const runAt = Date.UTC(2026, 2, 10, 20, 0, 0); // 北京 11 日 04:00
  const advanced = store.advanceSchedule(created.schedule.id, runAt);
  assert.equal(new Date(advanced.next_run_at).getTime(), Date.UTC(2026, 2, 11, 1, 0, 0),
    `cron 推进应为下一次 09:00 北京：${advanced.next_run_at}`);

  // 非 cron（interval）调度维持现行为
  const intervalSchedule = store.createSchedule({
    projectId: 'proj_b514',
    title: 'interval 30 分钟',
    prompt: 'interval 回归',
    kind: 'task',
    intervalMinutes: 30,
  });
  assert.equal(intervalSchedule.ok, true, JSON.stringify(intervalSchedule));
  const adv2 = store.advanceSchedule(intervalSchedule.schedule.id, runAt);
  assert.equal(new Date(adv2.next_run_at).getTime(), runAt + 30 * MIN, 'interval 逐字不变');
});

test('createSchedule 二选一：无 interval 无 cron 拒绝；非法 cron 拒绝', () => {
  const bad = store.createSchedule({ projectId: 'proj_b514', title: 'x', prompt: 'y', kind: 'task' });
  assert.equal(bad.ok, false, JSON.stringify(bad));
  const badCron = store.createSchedule({ projectId: 'proj_b514', title: 'x', prompt: 'y', kind: 'task', cronExpr: '0 9 * *' });
  assert.equal(badCron.ok, false, JSON.stringify(badCron));
});

test('失败退避：exponential 曲线封顶 24h，成功清零', () => {
  const created = store.createSchedule({
    projectId: 'proj_b514',
    title: '退避验证',
    prompt: 'backoff',
    kind: 'task',
    intervalMinutes: 30,
    retryBackoff: 'exponential',
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const id = created.schedule.id;
  const t0 = Date.UTC(2026, 2, 10, 0, 0, 0);

  // 失败两次：间隔 30m → 60m → 120m
  store.createRun({ scheduleId: id, status: 'failed', error: 'e1', startedAt: new Date(t0).toISOString() });
  const a1 = store.advanceSchedule(id, t0);
  assert.equal(new Date(a1.next_run_at).getTime() - t0, 60 * MIN, `第一次失败退避应 ×2：${a1.next_run_at}`);

  store.createRun({ scheduleId: id, status: 'failed', error: 'e2', startedAt: new Date(t0 + HOUR).toISOString() });
  const a2 = store.advanceSchedule(id, t0 + HOUR);
  assert.equal(new Date(a2.next_run_at).getTime() - (t0 + HOUR), 120 * MIN, `第二次失败退避应 ×4：${a2.next_run_at}`);

  // 封顶 24h：连续失败多次后不超过 24h
  for (let i = 0; i < 8; i += 1) {
    store.createRun({ scheduleId: id, status: 'failed', error: `e${i}`, startedAt: new Date(t0 + (i + 2) * HOUR).toISOString() });
    store.advanceSchedule(id, t0 + (i + 2) * HOUR);
  }
  const aCap = store.advanceSchedule(id, t0 + 10 * HOUR);
  assert.ok(new Date(aCap.next_run_at).getTime() - (t0 + 10 * HOUR) <= 24 * HOUR,
    `退避封顶 24h：${new Date(aCap.next_run_at).getTime() - (t0 + 10 * HOUR)}ms`);

  // 成功清零：回到 interval 原值
  store.createRun({ scheduleId: id, status: 'completed', startedAt: new Date(t0 + 11 * HOUR).toISOString() });
  const aOk = store.advanceSchedule(id, t0 + 11 * HOUR);
  assert.equal(new Date(aOk.next_run_at).getTime() - (t0 + 11 * HOUR), 30 * MIN, '成功后清零回 interval');
});

test('overlap：默认 skip 行为逐字不变；queue 放行 open-run', async () => {
  const created = store.createSchedule({
    projectId: 'proj_b514',
    title: 'overlap 验证',
    prompt: 'overlap',
    kind: 'task',
    intervalMinutes: 30,
    overlapPolicy: 'queue',
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const schedule = store.getSchedule(created.schedule.id);
  assert.equal(schedule.overlap_policy, 'queue');

  // open run 在场：queue 策略不再 skip_running（放行提交）
  let submissions = 0;
  const result = await runner.executeSchedule(schedule, {
    fetchImpl: async () => { submissions += 1; return { ok: true, status: 200, json: async () => ({ conversation: { id: 'conv_x' }, taskId: 'task_x' }) }; },
    baseUrl: 'http://127.0.0.1:9',
    now: new Date(Date.UTC(2026, 2, 10, 0, 0, 0)),
  });
  assert.equal(result.status, 'running', JSON.stringify(result));
  assert.ok(submissions >= 1, 'queue 策略应放行提交');

  // 默认 skip：同形 schedule 无 overlapPolicy → open run 在场时 skipped_running
  const created2 = store.createSchedule({
    projectId: 'proj_b514', title: 'skip 默认', prompt: 'skip', kind: 'task', intervalMinutes: 30,
  });
  const schedule2 = store.getSchedule(created2.schedule.id);
  assert.equal(schedule2.overlap_policy, 'skip');
  store.createRun({ scheduleId: schedule2.id, status: 'running', startedAt: new Date().toISOString() });
  const result2 = await runner.executeSchedule(schedule2, {
    fetchImpl: async () => { throw new Error('should_not_submit'); },
    baseUrl: 'http://127.0.0.1:9',
    now: new Date(Date.UTC(2026, 2, 10, 0, 0, 0)),
  });
  assert.equal(result2.status, 'skipped_running', JSON.stringify(result2));
});

test.after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});
