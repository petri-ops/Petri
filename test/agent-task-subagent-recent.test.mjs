// UI-405 实机抓真清偿 —— listRecentSubAgentTasks LIMIT 先于 subagent 过滤。
//
// 原实现：SELECT ... WHERE user_id = ? ORDER BY created_at DESC LIMIT ? 取整表
// 最近 N 行（主任务+子任务混排），再在 JS 侧过滤 kind === 'subagent'——主任务
// 占满最近窗口时，子 agent 任务被挤出俯瞰面板（/api/ai/agent/tasks）。
// 修正后：kind 过滤下推 SQL（json_valid + json_extract），LIMIT 只作用于
// subagent 子集；畸形 params 行 json_valid 防御不抛错。
//
// 运行：node --test test/agent-task-subagent-recent.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-agent-subagent-recent-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'agent-tasks.db');

const require = createRequire(import.meta.url);
const store = require('../core/petri-server/agent-task-store');

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});

test('LIMIT 窗口内主任务占满时，subagent 任务仍全部可见（过滤下推 SQL）', () => {
  const userId = 'user-ui405';
  // 先插 60 条主任务（> 默认 limit 50）压满最近窗口
  for (let i = 0; i < 60; i++) {
    store.insertAgentTask({
      taskId: `primary-${i}`,
      userId,
      params: { kind: 'primary', conversationId: 'conv-ui405' },
    });
  }
  // 再插 3 条子任务（created_at 更新，天然排在最近窗口头部）
  for (let i = 0; i < 3; i++) {
    store.insertAgentTask({
      taskId: `subagent-${i}`,
      userId,
      params: { kind: 'subagent', parentTaskId: 'primary-0', conversationId: 'conv-ui405' },
    });
  }

  const recent = store.listRecentSubAgentTasks(userId, 50);
  const ids = recent.map((t) => t.taskId);
  assert.equal(recent.length, 3, `subagent 全数可见（不被主任务挤出），got ${recent.length}`);
  for (let i = 0; i < 3; i++) assert.ok(ids.includes(`subagent-${i}`), `subagent-${i} missing`);
  assert.ok(ids.every((id) => id.startsWith('subagent-')), '窗口内只有 subagent');
});

test('畸形 params 行不抛错且不污染结果（json_valid 防御）', () => {
  const userId = 'user-ui405-bad';
  store.insertAgentTask({ taskId: 'sub-ok', userId, params: { kind: 'subagent' } });
  // 直写一条非法 JSON params（模拟历史脏数据）
  const Database = require(path.join(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const raw = new Database(process.env.PETRI_DB_PATH);
  raw.prepare("INSERT INTO tasks (id, type, user_id, params, status, agent_status, created_at) VALUES ('bad-row', 'agent', ?, '{not-json', 'failed', 'failed', datetime('now'))").run(userId);
  raw.close();

  const recent = store.listRecentSubAgentTasks(userId, 50);
  assert.deepEqual(recent.map((t) => t.taskId), ['sub-ok'], '畸形行被 json_valid 排除且不抛错');
});
