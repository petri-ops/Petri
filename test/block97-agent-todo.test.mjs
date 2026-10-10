'use strict';

/**
 * BLOCK-97 P1 — 任务清单（todo_write）契约测试
 *
 * 覆盖：registry 注册与契约元数据（fail-closed 校验随模块加载生效）、
 * handler 整单幂等归一化与逐项拒绝、task_todo 专用事件发射判定
 * （agent-runner emitToolResult 包裹点 / chat.js legacy 路径共用）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'petri-server');
const require = createRequire(import.meta.url);

// 自举临时 DB（src/migrations 全量）——registry 链路 require query-tools →
// db.js 在 default petri.db 缺最新 schema 时抛 no such table；PETRI_DB_PATH
// 隔离须在 require db.js 前生效（BLOCK-52 收口修法，同 agent-tool-registry.test.mjs）。
{
  const fs = require('fs');
  const os = require('os');
  const dbPath = require('path');
  const Database = require(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(dbPath.join(os.tmpdir(), 'petri-block97-todo-db-'));
  const boot = new Database(dbPath.join(tempDbDir, 'petri.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(dbPath.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = dbPath.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const {
  tool_todo_write,
  maybeEmitTaskTodo,
  TODO_STATUSES,
  MAX_ITEMS,
} = require('../core/petri-server/agent-tools/todo-tools');
const { getToolEntry, getProviderToolDefs } = require('../core/petri-server/agent-tools/registry');

function validItems() {
  return [
    { content: '重建索引', status: 'completed' },
    { content: '  跑通冒烟测试  ', status: 'in_progress' },
    { content: '写收口报告', status: 'pending' },
  ];
}

test('todo_write registered with planning/state-write/R1 contract', () => {
  const entry = getToolEntry('todo_write');
  assert.ok(entry, 'todo_write must be registered');
  assert.equal(entry.contract.category, 'planning');
  assert.equal(entry.contract.sideEffect, 'state-write');
  assert.equal(entry.contract.riskTier, 'R1');
  assert.deepEqual(entry.contract.resources, ['ui.session']);
  assert.equal(entry.contract.cancellable, false);
  assert.equal(typeof entry.handler, 'function');
});

test('provider projection exposes todo_write without internal contract keys', () => {
  const defs = getProviderToolDefs();
  const def = defs.find((d) => d.function.name === 'todo_write');
  assert.ok(def, 'todo_write must be projected to providers');
  assert.equal(def.type, 'function');
  assert.ok(def.function.parameters.properties.items, 'items schema must survive projection');
  assert.equal(def.function.parameters.required[0], 'items');
  // 内部契约元数据不得泄漏进 provider 可见 schema
  const serialized = JSON.stringify(def);
  for (const key of ['contractVersion', 'riskTier', 'sideEffect', 'estimatedDurationMs']) {
    assert.equal(serialized.includes(key), false, `${key} leaked`);
  }
});

test('todo_write normalizes full-list replacement and reports counts', async () => {
  const result = await tool_todo_write({ items: validItems() });
  assert.equal(result.ok, true);
  assert.equal(result.total, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.inProgress, 1);
  assert.deepEqual(
    result.items,
    [
      { id: '1', content: '重建索引', status: 'completed' },
      { id: '2', content: '跑通冒烟测试', status: 'in_progress' },
      { id: '3', content: '写收口报告', status: 'pending' },
    ],
    'content trimmed + order-based ids auto-assigned'
  );

  // 整单幂等：同输入两次调用输出逐字节一致
  const again = await tool_todo_write({ items: validItems() });
  assert.deepEqual(again.items, result.items);
});

test('todo_write keeps explicit ids and accepts every status', async () => {
  const items = TODO_STATUSES.map((status, i) => ({ id: `custom-${i}`, content: `条目 ${i}`, status }));
  const result = await tool_todo_write({ items });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map((item) => item.id), ['custom-0', 'custom-1', 'custom-2']);
});

test('todo_write rejects invalid input fail-closed', async () => {
  const cases = [
    [{}, 'missing_args'],
    [{ items: [] }, 'missing_args'],
    [{ items: Array.from({ length: MAX_ITEMS + 1 }, () => ({ content: 'x', status: 'pending' })) }, 'too_many_items'],
    [{ items: ['not-an-object'] }, 'invalid_item'],
    [{ items: [{ content: '', status: 'pending' }] }, 'invalid_item'],
    [{ items: [{ content: '   ', status: 'pending' }] }, 'invalid_item'],
    [{ items: [{ content: 'x'.repeat(301), status: 'pending' }] }, 'invalid_item'],
    [{ items: [{ content: 'x', status: 'doing' }] }, 'invalid_status'],
  ];
  for (const [args, expectedError] of cases) {
    const result = await tool_todo_write(args);
    assert.equal(result.ok, false, JSON.stringify(args).slice(0, 80));
    assert.equal(result.error, expectedError, JSON.stringify(args).slice(0, 80));
    assert.ok(result.message, 'rejection must carry a message for the model');
  }
});

test('maybeEmitTaskTodo broadcasts snapshot only on successful todo_write results', () => {
  const items = [{ id: '1', content: 'a', status: 'pending' }];
  const okEvt = {
    event: 'tool_result',
    name: 'todo_write',
    toolResult: { status: 'success', data: { ok: true, items } },
  };

  let emitted = null;
  assert.equal(maybeEmitTaskTodo(okEvt, (evt) => { emitted = evt; }), true);
  assert.deepEqual(emitted, { event: 'task_todo', items });

  // 失败/拒绝回执不广播
  assert.equal(
    maybeEmitTaskTodo({ ...okEvt, toolResult: { status: 'error', data: { ok: false } } }, () => {
      throw new Error('must not emit');
    }),
    false
  );
  assert.equal(
    maybeEmitTaskTodo({ ...okEvt, toolResult: { status: 'denied', data: { ok: false } } }, () => {
      throw new Error('must not emit');
    }),
    false
  );

  // 其他工具 / 其他事件 / 缺 emit / data 无 items 均静默跳过
  assert.equal(maybeEmitTaskTodo({ ...okEvt, name: 'plan' }, () => { throw new Error('must not emit'); }), false);
  assert.equal(maybeEmitTaskTodo({ event: 'tool_call', name: 'todo_write' }, () => { throw new Error('must not emit'); }), false);
  assert.equal(maybeEmitTaskTodo(okEvt, null), false);
  assert.equal(
    maybeEmitTaskTodo({ ...okEvt, toolResult: { status: 'success', data: { preview: '…' } } }, () => { throw new Error('must not emit'); }),
    false
  );
});
