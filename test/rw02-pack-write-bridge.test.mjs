/**
 * RW-02 B 线（C-44）— pack 写桥四类写操作契约（红绿先行）。
 *
 * 覆盖 docs/rw-02-ui-evidence-pack-write-bridge-plan.md §5 G3：
 * 1. validatePackWriteMessage：kind 词汇 + 各 kind 载荷要求 + requestId 界 + fail-closed
 * 2. evaluateWriteGrant：未声明即拒绝（每种 kind）；声明即授予；v1 annotations={write:true} 兼容
 * 3. createWriteRequestDedupe：TTL 内去重、TTL 后重放拒绝、新 requestId 放行
 * 4. validateSurfaceWritesDecl：bridgeVersion 门 + 未知键拒绝
 * 5. v1 契约不回归：petri:annotation-write/delete 词汇与校验行为不变
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  WRITE_KINDS,
  BRIDGE_VERSION,
  validatePackWriteMessage,
  evaluateWriteGrant,
  createWriteRequestDedupe,
  validateSurfaceWritesDecl,
  packWriteResult,
} = require('../core/shared-backend/pack-write-bridge-contract');

test('RW02 write-bridge：kind 词汇与载荷校验（fail-closed）', () => {
  assert.deepEqual([...WRITE_KINDS].sort(), ['annotation-delete', 'annotation-write', 'export-run', 'revision-replay', 'revision-restore', 'selection-save']);
  assert.equal(BRIDGE_VERSION, 1);

  // 通用形状
  assert.equal(validatePackWriteMessage(null).ok, false);
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r1', kind: 'unknown-kind', payload: {} }).ok, false);
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: '', kind: 'selection-save', payload: {} }).ok, false);
  assert.equal(validatePackWriteMessage({ type: 'petri:annotation-write', requestId: 'r1', kind: 'selection-save', payload: {} }).ok, false, 'v1 专用消息不得冒充通用写');

  // selection-save：必须带 selection 上下文（核心 validateSelectionContext 形状的桥层子集）
  const selection = validatePackWriteMessage({
    type: 'petri:pack-write', requestId: 'r2', kind: 'selection-save',
    payload: { selection: { contractVersion: 1, entityType: 'gene', entityIds: ['TP53'], entityIdCount: 1 } },
  });
  assert.equal(selection.ok, true, JSON.stringify(selection));
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r3', kind: 'selection-save', payload: {} }).ok, false);

  // revision-restore / revision-replay：必须带 revisionId（replay 带 phase）
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r4', kind: 'revision-restore', payload: { revisionId: 'rev_1' } }).ok, true);
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r5', kind: 'revision-restore', payload: {} }).ok, false);
  const replay = validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r6', kind: 'revision-replay', payload: { revisionId: 'rev_1', phase: 'preflight' } });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r7', kind: 'revision-replay', payload: { revisionId: 'rev_1', phase: 'hacker' } }).ok, false);

  // export-run：必须带 format ∈ 词表
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r8', kind: 'export-run', payload: { format: 'method' } }).ok, true);
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'r9', kind: 'export-run', payload: { format: 'virus' } }).ok, false);

  // annotation kinds 兼容别名：v1 专用消息原样可用
  assert.equal(validatePackWriteMessage({ type: 'petri:annotation-write', requestId: 'ra', comment: 'x', rect: {} }).ok, true);
  assert.equal(validatePackWriteMessage({ type: 'petri:pack-write', requestId: 'rb', kind: 'annotation-write', payload: { comment: 'x', rect: {} } }).ok, true);
});

test('RW02 write-bridge：权限判定——未声明即拒绝，声明即授予，v1 兼容，宿主声明不可被消息伪造', () => {
  const kinds = ['annotation-write', 'annotation-delete', 'selection-save', 'revision-restore', 'revision-replay', 'export-run'];
  // 全未声明：全部拒绝
  for (const kind of kinds) {
    assert.equal(evaluateWriteGrant({}, kind).granted, false, `${kind} 未声明必须拒绝`);
  }
  // 逐类显式声明
  const decl = {
    bridgeVersion: 1,
    annotations: { write: true },
    selection: { write: true },
    revisions: { restore: true, replay: true },
    export: { run: true },
  };
  for (const kind of kinds) {
    assert.equal(evaluateWriteGrant(decl, kind).granted, true, `${kind} 声明后必须授予`);
  }
  // v1 兼容：annotations={write:true} 仍授予 annotation-write/delete
  assert.equal(evaluateWriteGrant({ annotations: { write: true } }, 'annotation-write').granted, true);
  // 粒度：只声明 selection 不授予 revisions
  assert.equal(evaluateWriteGrant({ bridgeVersion: 1, selection: { write: true } }, 'revision-restore').granted, false);
});

test('RW02 write-bridge：requestId TTL 去重（防重放）', () => {
  const dedupe = createWriteRequestDedupe({ ttlMs: 50 });
  assert.equal(dedupe.claim('req-a', Date.now()).ok, true);
  assert.equal(dedupe.claim('req-a', Date.now() + 10).ok, false, 'TTL 内重复 = 重放拒绝');
  assert.equal(dedupe.claim('req-a', Date.now() + 10).reason, 'replay_duplicate');
  assert.equal(dedupe.claim('req-a', Date.now() + 80).ok, false, 'TTL 后复用同 requestId = 过期拒绝');
  assert.equal(dedupe.claim('req-a', Date.now() + 80).reason, 'replay_expired');
  assert.equal(dedupe.claim('req-b', Date.now()).ok, true, '新 requestId 放行');
  assert.equal(dedupe.claim('', Date.now()).ok, false);
});

test('RW02 write-bridge：surface writes 声明校验（bridgeVersion 门 + 未知键拒绝）', () => {
  assert.equal(validateSurfaceWritesDecl({ bridgeVersion: 1, selection: { write: true } }).ok, true);
  assert.equal(validateSurfaceWritesDecl({ bridgeVersion: 99 }).ok, false, '版本超前=拒绝');
  assert.equal(validateSurfaceWritesDecl({ annotations: { write: true } }).ok, false, '缺 bridgeVersion=拒绝（走 v1 兼容路径）');
  assert.equal(validateSurfaceWritesDecl({ bridgeVersion: 1, hacking: { write: true } }).ok, false, '未知写类=拒绝');
  assert.equal(validateSurfaceWritesDecl({ bridgeVersion: 1 }).ok, false, '零声明=拒绝');
});

test('RW02 write-bridge：v1 契约零回归（批注词汇与校验不变）', () => {
  const v1 = require('../core/shared-backend/pack-annotation-bridge-contract');
  assert.deepEqual([...v1.BRIDGE_MESSAGE_TYPES].sort(), ['petri:annotation-delete', 'petri:annotation-write']);
  assert.equal(v1.validateBridgeMessage({ type: 'petri:annotation-delete', requestId: 'x', annotationId: 'a1' }).ok, true);
  assert.equal(v1.validateBridgeMessage({ type: 'petri:annotation-write', requestId: 'x' }).ok, false);
  const grant = v1.evaluateWriteGrant({ annotations: { write: true } });
  assert.equal(grant.granted, true);
  const result = v1.bridgeResult('r1', true, 'ann_1');
  assert.equal(result.type, 'petri:annotation-write-result');
  // 通用回执形状
  const generic = packWriteResult('r2', 'selection-save', true, { selectionId: 'sel_1' });
  assert.equal(generic.type, 'petri:pack-write-result');
  assert.equal(generic.kind, 'selection-save');
});
