// BLOCK-171 CP-2 — 确认集写侧单测（task 内 Set 语义 + release）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGuardAcks, getGuardAcks, ackGuard, releaseGuardAcks } = require('../core/petri-server/helpers/guard-ack-store.js');

test('ackGuard：task 锚定 Set，ack 后 isGuardAcked 语义（has）成立', () => {
  const set = createGuardAcks('task_g1');
  assert.equal(set.has('cmd:format'), false);
  const result = ackGuard('task_g1', 'cmd:format');
  assert.equal(result.ok, true);
  assert.equal(set.has('cmd:format'), true);
  assert.equal(getGuardAcks('task_g1').has('cmd:format'), true);
});

test('ackGuard：空 guardKey 拒绝；无 task 时惰性建集', () => {
  assert.equal(ackGuard('task_g2', '').ok, false);
  const result = ackGuard('task_g3', 'path:c:/x');
  assert.equal(result.ok, true);
  assert.equal(getGuardAcks('task_g3').has('path:c:/x'), true);
});

test('releaseGuardAcks：收口释放', () => {
  createGuardAcks('task_g4');
  releaseGuardAcks('task_g4');
  assert.equal(getGuardAcks('task_g4'), null);
});
