import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-44）— pack 批注写桥契约：消息白名单 / fail-closed 校验 /
// 权限判定（宿主侧强制，pack 不能自宣）

const contract = require('../core/shared-backend/pack-annotation-bridge-contract.js');

test('BLOCK-264 C-44 — 上行消息白名单：未知 type 拒绝', () => {
  const bad = contract.validateBridgeMessage({ type: 'petri:ui-action', requestId: 'r1' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'type_invalid');
  assert.equal(contract.validateBridgeMessage('not-object').ok, false);
});

test('BLOCK-264 C-44 — write：requestId/comment/geometry 三道校验', () => {
  const noId = contract.validateBridgeMessage({ type: 'petri:annotation-write', comment: 'x', rect: [0.1, 0.1, 0.2, 0.2] });
  assert.equal(noId.code, 'request_id_invalid');

  const noComment = contract.validateBridgeMessage({ type: 'petri:annotation-write', requestId: 'r', rect: [0.1, 0.1, 0.2, 0.2] });
  assert.equal(noComment.code, 'comment_invalid');

  const tooLong = contract.validateBridgeMessage({ type: 'petri:annotation-write', requestId: 'r', comment: 'x'.repeat(501), rect: [0.1, 0.1, 0.2, 0.2] });
  assert.equal(tooLong.code, 'comment_invalid');

  const noGeom = contract.validateBridgeMessage({ type: 'petri:annotation-write', requestId: 'r', comment: 'x' });
  assert.equal(noGeom.code, 'geometry_required');

  const ok = contract.validateBridgeMessage({ type: 'petri:annotation-write', requestId: 'r', comment: '批注', kind: 'freehand', path: [[0, 0], [1, 1]] });
  assert.equal(ok.ok, true);
  assert.equal(ok.message.kind, 'freehand');
  assert.deepEqual(ok.message.path, [[0, 0], [1, 1]]);
});

test('BLOCK-264 C-44 — delete：annotationId 必填', () => {
  assert.equal(contract.validateBridgeMessage({ type: 'petri:annotation-delete', requestId: 'r' }).code, 'annotation_id_required');
  const ok = contract.validateBridgeMessage({ type: 'petri:annotation-delete', requestId: 'r', annotationId: 'ann-1' });
  assert.equal(ok.ok, true);
});

test('BLOCK-264 C-44 — 权限判定：缺省拒绝；pack.json 显式 write:true 才授', () => {
  assert.deepEqual(contract.evaluateWriteGrant(undefined), { granted: false, reason: 'annotation_write_not_granted' });
  assert.deepEqual(contract.evaluateWriteGrant({}), { granted: false, reason: 'annotation_write_not_granted' });
  assert.deepEqual(contract.evaluateWriteGrant({ annotations: {} }), { granted: false, reason: 'annotation_write_not_granted' });
  assert.deepEqual(contract.evaluateWriteGrant({ annotations: { write: true } }), { granted: true });
});

test('BLOCK-264 C-44 — 回执形状', () => {
  assert.deepEqual(contract.bridgeResult('r', true, 'ann-9'), { type: 'petri:annotation-write-result', requestId: 'r', ok: true, annotationId: 'ann-9' });
  assert.deepEqual(contract.bridgeResult('r', false, 'annotation_write_not_granted'), { type: 'petri:annotation-write-result', requestId: 'r', ok: false, error: 'annotation_write_not_granted' });
});
