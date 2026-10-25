// BLOCK-256 Q7 — 目标状态机/预算 + 定时任务 runner + 三工具注册契约。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b256-'));
const dbPath = path.join(tempRoot, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });

const { runMigrations } = require('../src/migration-runner');
await runMigrations(dbPath, path.join(REPO_ROOT, 'src', 'migrations'));

const dbMod = require('../core/petri-server/db');
const sqlite = dbMod.getDatabase();
// 让真实模块建全量 schema（不要手工建精简表：conversations.js / ai-usage.js 会补列）
require('../core/petri-server/helpers/conversations');
require('../core/petri-server/helpers/ai-usage');
const store = require('../core/petri-server/helpers/automation-store');
const runner = require('../core/petri-server/helpers/automation-runner');

function pastIso(minutes = 5) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
function makeDue(scheduleId) {
  sqlite.prepare('UPDATE agent_schedules SET next_run_at=? WHERE id=?').run(pastIso(), scheduleId);
}
function ensureConversation(id, projectId, goalId = null) {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR REPLACE INTO copilot_conversations
    (id,user_id,title,status,last_page,project_id,message_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 'local-user', `test-${id}`, 'active', null, projectId, 0, now, now);
  if (goalId) sqlite.prepare('UPDATE copilot_conversations SET goal_id=? WHERE id=?').run(goalId, id);
}
function insertUsage(conversationId, promptTokens, completionTokens) {
  sqlite.prepare('INSERT INTO ai_usage (conversation_id,prompt_tokens,completion_tokens,ts,kind) VALUES (?,?,?,?,?)')
    .run(conversationId, promptTokens, completionTokens, new Date().toISOString(), 'chat');
}

test.after(() => {
  try { sqlite.close(); } catch { /* ignore */ }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows handle delay */ }
});

test('goal 状态机：创建/暂停/恢复/完成/重开，非法迁移拒绝', () => {
  const created = store.createGoal({ projectId: 'proj_1', conversationId: 'conv_1', title: '完成 Q7' });
  assert.equal(created.ok, true);
  assert.equal(created.goal.status, 'active');
  const id = created.goal.id;

  const paused = store.updateGoal({ id, status: 'paused' });
  assert.equal(paused.ok, true);
  assert.equal(paused.goal.status, 'paused');
  const invalid = store.updateGoal({ id, status: 'blocked' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'invalid_transition');

  assert.equal(store.updateGoal({ id, status: 'active' }).goal.status, 'active');
  const completed = store.updateGoal({ id, status: 'completed' });
  assert.equal(completed.ok, true);
  assert.ok(completed.goal.completed_at);
  assert.equal(store.updateGoal({ id, status: 'active' }).goal.status, 'active');
});

test('goal 用量/预算：真实 ai_usage 投影，80% usageLimited、100% budgetLimited', () => {
  const created = store.createGoal({ projectId: 'proj_1', conversationId: 'conv_goal_usage', title: '预算目标', budgetTokens: 100 });
  ensureConversation('conv_goal_usage', 'proj_1', created.goal.id);
  insertUsage('conv_goal_usage', 60, 30);
  const withUsage = store.getGoal({ id: created.goal.id }).goal;
  assert.equal(withUsage.usageTokens, 90);
  assert.equal(withUsage.usageLimited, true);
  assert.equal(withUsage.budgetLimited, false);

  insertUsage('conv_goal_usage', 5, 5);
  const over = store.getGoal({ id: created.goal.id }).goal;
  assert.equal(over.usageTokens, 100);
  assert.equal(over.budgetLimited, true);
  assert.equal(over.remainingTokens, 0);
});

test('schedule 校验/到期/提醒/运行历史', async () => {
  const bad = store.createSchedule({ projectId: 'proj_1', title: 'bad', prompt: '', kind: 'task', intervalMinutes: 1 });
  assert.equal(bad.ok, false);
  const schedule = store.createSchedule({ projectId: 'proj_1', title: '每日汇总', prompt: '汇总今天的质控结果', intervalMinutes: 1 });
  assert.equal(schedule.ok, true);
  makeDue(schedule.schedule.id);
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/api/ai/conversations')) return { ok: true, json: async () => ({ conversation: { id: 'conv_run_1' } }) };
    return { ok: true, json: async () => ({ taskId: 'task_run_1' }) };
  };
  const report = await runner.runDueSchedulesOnce({ fetchImpl: fakeFetch, baseUrl: 'http://127.0.0.1:3001' });
  assert.equal(report.executed.length, 1);
  assert.equal(report.executed[0].status, 'running');
  assert.equal(report.executed[0].taskId, 'task_run_1');
  assert.ok(calls.some((call) => String(call.url).includes('/api/ai/agent')));
  const runs = store.listRunsForSchedule(schedule.schedule.id);
  assert.equal(runs[0].status, 'running');
  assert.equal(runs[0].task_id, 'task_run_1');

  const reminder = store.createSchedule({ projectId: 'proj_1', title: '提醒', kind: 'reminder', reminderText: '喝口水', intervalMinutes: 1 });
  makeDue(reminder.schedule.id);
  const reminderReport = await runner.runDueSchedulesOnce({ fetchImpl: fakeFetch, baseUrl: 'http://127.0.0.1:3001' });
  assert.ok(reminderReport.executed.some((row) => row.status === 'reminder'));
  const reminders = store.listReminders({ projectId: 'proj_1', unacknowledged: true });
  assert.ok(reminders.some((row) => row.message === '喝口水'));
});

test('goal 预算受限/非 active 时定时提交前跳过', async () => {
  const goal = store.createGoal({ projectId: 'proj_2', conversationId: 'conv_goal_2', title: '受限目标', budgetTokens: 1 });
  ensureConversation('conv_goal_2', 'proj_2', goal.goal.id);
  insertUsage('conv_goal_2', 10, 10);
  const schedule = store.createSchedule({ projectId: 'proj_2', title: '预算任务', prompt: 'run', intervalMinutes: 1, goalId: goal.goal.id });
  makeDue(schedule.schedule.id);
  const report = await runner.runDueSchedulesOnce({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    baseUrl: 'http://127.0.0.1:3001',
  });
  assert.equal(report.executed[0].status, 'skipped_budget');

  store.updateGoal({ id: goal.goal.id, budgetTokens: 999999 });
  store.updateGoal({ id: goal.goal.id, status: 'paused' });
  makeDue(schedule.schedule.id);
  const pausedReport = await runner.runDueSchedulesOnce({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    baseUrl: 'http://127.0.0.1:3001',
  });
  assert.equal(pausedReport.executed[0].status, 'skipped_goal');
});

test('三工具注册：create_goal/get_goal/update_goal 定义/契约/元数据齐备', async () => {
  try {
    const registry = require('../core/petri-server/agent-tools/registry');
    for (const name of ['create_goal', 'get_goal', 'update_goal']) {
      assert.ok(registry.getToolEntry(name), `${name} missing`);
      assert.ok(registry.getToolContract(name), `${name} contract missing`);
    }
    const created = await registry.getToolHandler('create_goal')({ title: '工具目标', budgetTokens: 10 }, { projectId: 'proj_3', userId: 'local-user' });
    assert.equal(created.ok, true);
    const got = await registry.getToolHandler('get_goal')({ projectId: 'proj_3' }, { userId: 'local-user' });
    assert.equal(got.ok, true);
    assert.ok(got.goals.some((goal) => goal.title === '工具目标'));
    const updated = await registry.getToolHandler('update_goal')({ goalId: created.goal.id, status: 'paused' }, { userId: 'local-user' });
    assert.equal(updated.ok, true);
    assert.equal(updated.goal.status, 'paused');
  } catch (error) {
    console.error('[b256-tool-test]', error && error.stack ? error.stack : error);
    throw error;
  }
});
