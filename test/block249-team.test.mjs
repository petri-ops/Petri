import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-q4a-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
process.env.PETRI_DB_PATH = path.join(tempDir, 'q4a.db');

const require = createRequire(import.meta.url);
// conversations.js 在 require 时打开共享 db（`projects` 等基础表必须已在）——
// 先按真实迁移建库，再由各模块打开同一文件。
{
  const Database = require('better-sqlite3');
  const bootDb = new Database(process.env.PETRI_DB_PATH);
  const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();
}

const jsonSchema = require('../core/petri-server/helpers/json-schema-subset');
const toolFilter = require('../core/petri-server/helpers/tool-filter');
const agentPause = require('../core/petri-server/helpers/agent-pause');
const agentJournal = require('../core/petri-server/helpers/agent-journal');
const agentTeam = require('../core/petri-server/helpers/agent-team');
const conversations = require('../core/petri-server/helpers/conversations');
const store = require('../core/petri-server/agent-task-store');

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ---------- schema 子集 ----------
test('schema 子集：形状闸只收白名单关键字；值校验覆盖 required/type/enum/items/额外字段', () => {
  assert.deepEqual(jsonSchema.isSupportedSchema({ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }), []);
  assert.ok(jsonSchema.isSupportedSchema({ $ref: '#/x' }).length > 0, '$ref 必须被拒绝');
  assert.ok(jsonSchema.isSupportedSchema({ type: 'object', properties: { a: { oneOf: [] } } }).length > 0, 'oneOf 必须被拒绝');

  const schema = {
    type: 'object',
    required: ['answer', 'tags'],
    additionalProperties: false,
    properties: {
      answer: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    },
  };
  assert.deepEqual(jsonSchema.validateSubset({ answer: 2, tags: ['a'] }, schema), []);
  const errors = jsonSchema.validateSubset({ answer: 0, tags: ['c'], extra: 1 }, schema);
  assert.ok(errors.some((row) => row.includes('minimum') || row.includes('小于')));
  assert.ok(errors.some((row) => row.includes('枚举')));
  assert.ok(errors.some((row) => row.includes('额外字段')));
  assert.ok(jsonSchema.validateSubset({ tags: [] }, schema).some((row) => row.includes('缺少必填')));

  assert.equal(jsonSchema.parseJsonFromText('```json\n{"a":1}\n```').value.a, 1);
  assert.equal(jsonSchema.parseJsonFromText('not json').ok, false);
});

// ---------- 工具过滤 ----------
test('工具过滤：allow 取交集、deny 优先、无 policy 零变化、未知名出诊断', () => {
  const defs = [
    { type: 'function', function: { name: 'workspace_read' } },
    { type: 'function', function: { name: 'workspace_write' } },
    { type: 'function', function: { name: 'spawn_agent' } },
  ];
  assert.equal(toolFilter.filterToolDefs(defs, null).length, 3);
  assert.deepEqual(toolFilter.filterToolDefs(defs, { allow: ['workspace_read', 'spawn_agent'] }).map((d) => d.function.name), ['workspace_read', 'spawn_agent']);
  assert.deepEqual(toolFilter.filterToolDefs(defs, { deny: ['spawn_agent'] }).map((d) => d.function.name), ['workspace_read', 'workspace_write']);
  assert.deepEqual(toolFilter.filterToolDefs(defs, { allow: ['spawn_agent'], deny: ['spawn_agent'] }), [], 'deny 优先');
  const diagnostics = toolFilter.policyDiagnostics({ allow: ['nope'], deny: ['spawn_agent'] }, defs.map((d) => d.function.name));
  assert.deepEqual(diagnostics, [{ code: 'unknown_allow_tool', tool: 'nope' }]);
});

// ---------- 暂停 ----------
test('暂停登记：等待可被恢复唤醒；取消优先返回', async () => {
  agentPause.__resetForTests();
  agentPause.requestPause('task_p1');
  assert.equal(agentPause.isPaused('task_p1'), true);
  const started = Date.now();
  const waiting = agentPause.waitWhilePaused('task_p1', () => false, { pollMs: 20 });
  setTimeout(() => agentPause.resumeTask('task_p1'), 60);
  await waiting;
  assert.ok(Date.now() - started >= 40);

  agentPause.requestPause('task_p2');
  const t0 = Date.now();
  await agentPause.waitWhilePaused('task_p2', () => true, { pollMs: 20 });
  assert.ok(Date.now() - t0 < 500, '取消优先应立即返回');
  agentPause.__resetForTests();
});

// ---------- journal ----------
test('journal：一行一成员落盘；有界读取；坏行计数不静默', () => {
  const leader = 'task_leader_j1';
  assert.equal(agentJournal.hasJournal(leader), false);
  for (let i = 0; i < 3; i += 1) {
    const result = agentJournal.appendJournalEntry({
      at: '2026-10-24T00:00:00.000Z', leaderTaskId: leader, agentId: `task_child_${i}`,
      parentTaskId: leader, role: 'read', status: 'completed', resultHead: `结果 ${i}`,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const read = agentJournal.readJournal(leader, { limit: 2 });
  assert.equal(read.exists, true);
  assert.equal(read.entries.length, 2);
  assert.equal(read.entries[1].agentId, 'task_child_2');
  assert.equal(read.truncated, true);

  fs.appendFileSync(agentJournal.journalPath(leader), 'not-json\n', 'utf8');
  const withCorrupt = agentJournal.readJournal(leader, { limit: 10 });
  assert.equal(withCorrupt.corrupt, 1);
});

// ---------- 团队投影/停止 ----------
function member(id, status, extra = {}) {
  return {
    taskId: id,
    status,
    agentStatus: status === 'running' ? 'running' : 'completed',
    createdAt: '2026-10-24T00:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-10-24T00:00:10.000Z',
    error: null,
    params: { kind: 'subagent', parentTaskId: 'leader_1', role: extra.role || 'read', conversationId: 'conv_1' },
  };
}

function fakeStore(initialMembers) {
  const rows = new Map(initialMembers.map((row) => [row.taskId, { ...row }]));
  const leader = {
    taskId: 'leader_1', status: 'running', agentStatus: 'running',
    userId: 'user_1', createdAt: '2026-10-24T00:00:00.000Z', finishedAt: null, error: null,
    params: { conversationId: 'conv_1', messages: [{ role: 'user', content: '派三个子代理' }] },
  };
  return {
    rows,
    getAgentTask: (id) => (id === 'leader_1' ? { ...leader } : (rows.has(id) ? { ...rows.get(id) } : null)),
    listChildAgentTasks: () => Array.from(rows.values()).map((row) => ({ ...row })),
    getAgentTaskLastEventAt: (id) => (id === 'leader_1' ? '2026-10-24T00:00:05.000Z' : null),
    cancelAgentTaskCascade: (_id) => {
      const cancelled = [];
      for (const row of rows.values()) {
        if (row.status === 'running') {
          row.status = 'cancel_requested';
          row.agentStatus = 'cancel_requested';
          cancelled.push(row.taskId);
        }
      }
      if (cancelled.length) cancelled.push('leader_1');
      return { cancelledTaskIds: cancelled };
    },
  };
}

test('团队投影：leader+members 计数；跨用户 403；停止回执区分请求/已结束/未取消', () => {
  const fake = fakeStore([
    member('task_m1', 'running'),
    member('task_m2', 'completed', { role: 'analysis' }),
    member('task_m3', 'running'),
  ]);
  const view = agentTeam.buildTeamView({ store: fake, leaderTaskId: 'leader_1', userId: 'user_1' });
  assert.equal(view.ok, true);
  assert.equal(view.leader.agentId, 'leader_1');
  assert.equal(view.members.length, 3);
  assert.deepEqual(view.counts, { total: 3, running: 2, finished: 1, structuredInvalid: 0 });
  assert.equal(view.members[1].role, 'analysis');

  const denied = agentTeam.buildTeamView({ store: fake, leaderTaskId: 'leader_1', userId: 'user_2' });
  assert.equal(denied.status, 403);

  const receipt = agentTeam.stopTeam({ store: fake, dbMod: {}, leaderTaskId: 'leader_1', userId: 'user_1' });
  assert.equal(receipt.ok, true);
  const byId = new Map(receipt.members.map((row) => [row.agentId, row.outcome]));
  assert.equal(byId.get('task_m1'), 'cancel_requested');
  assert.equal(byId.get('task_m2'), 'already_finished');
  assert.equal(byId.get('task_m3'), 'cancel_requested');
  assert.deepEqual(receipt.summary, { requested: 2, alreadyFinished: 1, notCancelled: 0 });
});

// ---------- 存储层暂停/合成事件 ----------
test('存储层：暂停翻转 agent_status；合成事件进 task_events', () => {
  store.insertAgentTask({ taskId: 'task_pause_store', userId: 'user_1', params: { conversationId: 'conv_1', kind: 'subagent' } });
  assert.equal(store.setAgentTaskPaused('task_pause_store', true).agentStatus, 'paused');
  assert.equal(store.getAgentTask('task_pause_store').agentStatus, 'paused');
  assert.equal(store.setAgentTaskPaused('task_pause_store', false).agentStatus, 'running');
  assert.equal(store.getAgentTask('task_pause_store').agentStatus, 'running');
  const appended = store.appendSyntheticAgentEvent('task_pause_store', 'agent_paused', { effective: 'iteration_boundary' });
  assert.equal(appended.ok, true);
  const events = store.getAgentTaskEventsSince('task_pause_store', 0, 10);
  assert.equal(events[events.length - 1].eventType, 'agent_paused');
  assert.equal(events[events.length - 1].payload.effective, 'iteration_boundary');
});

// ---------- 结构化输出评估 ----------
test('结构化输出：终态 JSON 校验（有效/无效/无 schema）', () => {
  const schema = { type: 'object', required: ['answer'], properties: { answer: { type: 'integer' } } };
  const task = { taskId: 'task_struct_1', params: { structuredSchema: schema } };
  assert.equal(agentTeam.evaluateStructured({ taskId: 'task_struct_none', params: {} }), null);

  conversations.appendMessageToConversation('conv_struct', 'assistant', '{"answer":42}', null, 'task_struct_1');
  const valid = agentTeam.evaluateStructured(task);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value, { answer: 42 });

  conversations.appendMessageToConversation('conv_struct', 'assistant', '不是 JSON', null, 'task_struct_2');
  const invalid = agentTeam.evaluateStructured({ taskId: 'task_struct_2', params: { structuredSchema: schema, structuredAttempts: 1 } });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length > 0);
  assert.equal(invalid.attempts, 1);
});
