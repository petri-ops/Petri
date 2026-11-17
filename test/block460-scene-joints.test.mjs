import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

// BLOCK-460 — SceneSpec v1 additive joints[] 契约（HK-01 红绿先行）。
// 值域与语义来自 BLOCK-459 探针实测（acceptance/block-459/PROBE-REPORT.md §2）：
// 导出层 kind 值域 = revolute | prismatic | continuous | floating；
// SceneSpec 角度=度、长度=mm（场景单位制），由归一器从导出层的 rad/m 换算。
// 红线：无 joints 的既有文档行为零变化（additive，沿 constraints/lights 先例）。

function baseScene(joints) {
  const scene = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [
      { id: 'base', type: 'box', transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, dimensions: { width: 100, height: 10, depth: 60 } },
      { id: 'arm', type: 'box', transform: { position: [5, 0, 90], rotation: [0, 0, 0] }, dimensions: { width: 70, height: 8, depth: 14 } },
    ],
  };
  if (joints !== undefined) scene.joints = joints;
  return scene;
}

test('BLOCK-460: validateJoints 导出且 additive——无 joints 的既有文档不受影响', () => {
  assert.equal(typeof scene3d.validateJoints, 'function', 'scene3d.validateJoints 必须导出');
  const result = scene3d.validateSceneSpec(baseScene(undefined));
  assert.equal(result.ok, true, `无 joints 的最小合法场景必须通过: ${JSON.stringify(result.errors || [])}`);
});

test('BLOCK-460: 合法 revolute+prismatic 关节组合通过', () => {
  const result = scene3d.validateSceneSpec(baseScene([
    {
      id: 'hinge_arm', child: 'arm', parent: 'base', kind: 'revolute',
      axis: [0, 0, 1], range: { min: 0, max: 90 }, // 度
    },
    {
      id: 'rail_slider', child: 'arm', parent: 'base', kind: 'prismatic',
      axis: [1, 0, 0], range: { min: 0, max: 40 }, // mm
    },
  ]));
  assert.equal(result.ok, true, `合法关节必须通过: ${JSON.stringify(result.errors || [])}`);
});

test('BLOCK-460: kind 越界拒绝（只收导出层四值）', () => {
  for (const kind of ['free', 'screw', 'fixed', '']) {
    const result = scene3d.validateSceneSpec(baseScene([
      { id: 'j1', child: 'arm', parent: 'base', kind, axis: [0, 0, 1], range: { min: 0, max: 90 } },
    ]));
    assert.equal(result.ok, false, `kind=${JSON.stringify(kind)} 必须拒绝`);
  }
});

test('BLOCK-460: 悬空 child/parent 引用拒绝', () => {
  const missingChild = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'ghost', parent: 'base', kind: 'revolute', axis: [0, 0, 1], range: { min: 0, max: 90 } },
  ]));
  assert.equal(missingChild.ok, false);
  const missingParent = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'ghost', kind: 'revolute', axis: [0, 0, 1], range: { min: 0, max: 90 } },
  ]));
  assert.equal(missingParent.ok, false);
});

test('BLOCK-460: 重复关节 id 拒绝', () => {
  const joint = { id: 'j1', child: 'arm', parent: 'base', kind: 'revolute', axis: [0, 0, 1], range: { min: 0, max: 90 } };
  const result = scene3d.validateSceneSpec(baseScene([joint, { ...joint, child: 'base', parent: 'arm' }]));
  assert.equal(result.ok, false);
});

test('BLOCK-460: revolute/prismatic 必须带 range；range 必须包含 0', () => {
  const noRange = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'revolute', axis: [0, 0, 1] },
  ]));
  assert.equal(noRange.ok, false, 'revolute 缺 range 必须拒绝');
  const notContainingZero = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'revolute', axis: [0, 0, 1], range: { min: 10, max: 90 } },
  ]));
  assert.equal(notContainingZero.ok, false, 'range 不含 0 必须拒绝');
  const inverted = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'prismatic', axis: [1, 0, 0], range: { min: 40, max: 0 } },
  ]));
  assert.equal(inverted.ok, false, 'range min>max 必须拒绝');
});

test('BLOCK-460: continuous/floating 无 range 合法；floating 无 axis 合法', () => {
  const continuous = scene3d.validateSceneSpec(baseScene([
    { id: 'spin', child: 'arm', parent: 'base', kind: 'continuous', axis: [0, 0, 1] },
  ]));
  assert.equal(continuous.ok, true, `continuous 合法: ${JSON.stringify(continuous.errors || [])}`);
  const floating = scene3d.validateSceneSpec(baseScene([
    { id: 'wobble', child: 'arm', parent: 'base', kind: 'floating' },
  ]));
  assert.equal(floating.ok, true, `floating 合法: ${JSON.stringify(floating.errors || [])}`);
});

test('BLOCK-460: follows 指向必须存在且禁止自环', () => {
  const selfLoop = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'prismatic', axis: [1, 0, 0], follows: 'j1', ratio: 0.5 },
  ]));
  assert.equal(selfLoop.ok, false, 'follows 自环必须拒绝');
  const dangling = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'prismatic', axis: [1, 0, 0], follows: 'nope', ratio: 0.5 },
  ]));
  assert.equal(dangling.ok, false, 'follows 悬空必须拒绝');
  const withRatio = scene3d.validateSceneSpec(baseScene([
    { id: 'rail', child: 'arm', parent: 'base', kind: 'prismatic', axis: [1, 0, 0], range: { min: 0, max: 40 } },
    { id: 'cap', child: 'base', parent: 'arm', kind: 'prismatic', axis: [1, 0, 0], follows: 'rail', ratio: 0.5 },
  ]));
  assert.equal(withRatio.ok, true, `合法 mimic 组合必须通过: ${JSON.stringify(withRatio.errors || [])}`);
  const missingRatio = scene3d.validateSceneSpec(baseScene([
    { id: 'cap', child: 'base', parent: 'arm', kind: 'prismatic', axis: [1, 0, 0], follows: 'rail' },
  ]));
  assert.equal(missingRatio.ok, false, 'follows 缺 ratio 必须拒绝');
});

test('BLOCK-460: axis 必须是三维有限向量', () => {
  const bad = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'revolute', axis: [0, 0], range: { min: 0, max: 90 } },
  ]));
  assert.equal(bad.ok, false);
  const nan = scene3d.validateSceneSpec(baseScene([
    { id: 'j1', child: 'arm', parent: 'base', kind: 'revolute', axis: [0, Number.NaN, 1], range: { min: 0, max: 90 } },
  ]));
  assert.equal(nan.ok, false);
});

test('BLOCK-460: joints 非数组拒绝；joints 为空数组合法（additive 语义）', () => {
  const notArray = scene3d.validateSceneSpec({ ...baseScene(undefined), joints: 'nope' });
  assert.equal(notArray.ok, false);
  const empty = scene3d.validateSceneSpec(baseScene([]));
  assert.equal(empty.ok, true);
});
