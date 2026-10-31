import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function box(id, position, dimensions) {
  return { id, type: 'box', dimensions, transform: { position, rotation: [0, 0, 0] } };
}

function scene(nodes, constraints) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints,
  };
}

const positionOf = (resolved, id) => resolved.scene.nodes.find((node) => node.id === id).transform.position;

test('BLOCK-322 P3-03 mate — 轴对齐平面贴合：法向相接 + 面心对齐 + offset', () => {
  const base = box('base', [10, 20, 0], { width: 120, depth: 80, height: 40 });
  const cap = box('cap', [500, 500, 500], { width: 40, depth: 20, height: 10 });
  const constraint = { kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z', offset: 2 };
  const validated = scene3d.validateSceneSpec(scene([base, cap], [constraint]));
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  const resolved = scene3d.resolveSceneSpec(scene([base, cap], [constraint]));
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  // base 顶面 z=20；cap 半高 5；offset 2 → cap 中心 z=27；x/y 对齐 base 面心 (10,20)。
  assert.deepEqual(positionOf(resolved, 'cap'), [10, 20, 27]);
  assert.equal(resolved.appliedConstraints.length, 3);
  assert.ok(resolved.appliedConstraints.every((row) => row.kind === 'mate' && row.aFace === '+z' && row.bFace === '-z'));
});

test('BLOCK-322 P3-03 mate — 参数尺寸/圆柱端面/链式传递', () => {
  const base = {
    id: 'base', type: 'cylinder',
    dimensions: { radius: 20, height: 'h' },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  };
  const mid = box('mid', [100, 100, 100], { width: 10, depth: 10, height: 10 });
  const top = box('top', [200, 200, 200], { width: 4, depth: 4, height: 5 });
  const s = scene([base, mid, top], [
    { kind: 'mate', a: 'base', b: 'mid', aFace: '+z', bFace: '-z' },
    { kind: 'mate', a: 'mid', b: 'top', aFace: '+z', bFace: '-z' },
  ]);
  s.parameters = { h: 40 };
  const resolved = scene3d.resolveSceneSpec(s);
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  // cylinder 顶 z=20；mid 半高 5 → mid z=25；mid 顶 z=30；top 半高 2.5 → top z=32.5。
  assert.deepEqual(positionOf(resolved, 'mid'), [0, 0, 25]);
  assert.deepEqual(positionOf(resolved, 'top'), [0, 0, 32.5]);
});

test('BLOCK-322 P3-03 mate — 非法面/曲面/旋转/同法向/越界/冲突全部 fail-closed', () => {
  const base = box('base', [0, 0, 0], { width: 20, depth: 20, height: 20 });
  const cap = box('cap', [0, 0, 100], { width: 10, depth: 10, height: 10 });
  const invalid = [
    [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z' }, 'aFace/bFace 只支持'],
    [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '+z' }, '需要法向相反的同轴平面'],
    [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+x', bFace: '-z' }, '需要法向相反的同轴平面'],
    [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z', offset: 'bad' }, 'offset 必须是有限数值'],
  ];
  for (const [constraint, keyword] of invalid) {
    const result = scene3d.validateSceneSpec(scene([base, cap], [constraint]));
    assert.equal(result.ok, false, JSON.stringify(constraint));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
  const cylinder = { id: 'cyl', type: 'cylinder', dimensions: { radius: 5, height: 10 }, transform: { position: [0, 0, 0] } };
  const side = scene3d.validateSceneSpec(scene([cylinder, cap], [{ kind: 'mate', a: 'cyl', b: 'cap', aFace: '+x', bFace: '-z' }]));
  assert.equal(side.ok, false);
  assert.ok(side.errors.some((error) => error.includes('不是 cylinder 的可贴合平面')));
  // P3-03 v2a — 旋转节点 mate 已支持（姿态求解器改写 rotation）；「非 90° 组合不可解」
  // 的 fail-closed 改锁到欧拉枚举失败路径（v2a 契约测在 block322-p3-03-v2a-mate-rotation）。
  const rotated = { ...base, transform: { position: [0, 0, 0], rotation: [0, 0, 30] } };
  const rotatedResult = scene3d.validateSceneSpec(scene([rotated, cap], [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z' }]));
  assert.equal(rotatedResult.ok, true, 'v2a：90° 组合可解的旋转节点 mate 不再被 validate 拒绝');
  const rotated45 = { ...base, transform: { position: [0, 0, 0], rotation: [45, 0, 0] } };  // X 45°：+z 面法向倾斜出轴对齐栅格
  const rotated45Result = scene3d.resolveSceneSpec(scene([rotated45, cap], [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z' }]));
  assert.equal(rotated45Result.ok, false, '45° 面法向非轴对齐 → 求值显式拒绝（v2a 边界）');
  assert.ok(rotated45Result.errors.some((error) => error.includes('mate')), '45° 拒绝走 mate 显式错误');

  const conflict = scene3d.resolveSceneSpec(scene([base, cap], [
    { kind: 'distance', a: 'base', b: 'cap', axis: 'x', value: 99 },
    { kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z' },
  ]));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'constraint_conflict');
  const outOfRange = scene3d.resolveSceneSpec(scene([
    box('base', [0, 0, 999_999], { width: 20, depth: 20, height: 20 }),
    cap,
  ], [{ kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z' }]));
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.error, 'constraint_out_of_range');
});
