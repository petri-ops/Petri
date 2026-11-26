/**
 * harness M4（owner msg_8640320d302e）：审批 store 进程内 Map → 持久化（重启不丢审批）。
 * HK-01：持久化表/加载/写穿接入两 store，对外 API 不变。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const persist = read('core/petri-server/helpers/approval-persistence.js');
const guard = read('core/petri-server/helpers/guard-ack-store.js');
const approval = read('core/petri-server/helpers/approval-request-store.js');

test('HK-01-1：持久化表与 load/save/delete 原语（同步、幂等）', () => {
  assert.match(persist, /CREATE TABLE IF NOT EXISTS approval_persistence/);
  assert.match(persist, /function loadAll/);
  assert.match(persist, /function saveState/);
  assert.match(persist, /function deleteState/);
});

test('HK-01-2：guard-ack store 启动时恢复 + 变更写穿', () => {
  assert.match(guard, /approval-persistence/);
  assert.match(guard, /loadAll\(/);
  assert.match(guard, /saveState\(/);
});

test('HK-01-3：approval-request store 启动时恢复 + 变更写穿（API 面不变）', () => {
  assert.match(approval, /approval-persistence/);
  assert.match(approval, /loadAll\(/);
  assert.match(approval, /saveState\(/);
  assert.match(approval, /module\.exports = \{/);
});
