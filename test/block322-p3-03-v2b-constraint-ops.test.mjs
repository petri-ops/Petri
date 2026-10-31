/**
 * BLOCK-322 P3-03 v2b 第二票（后端半）— add_constraint / remove_constraint 操作契约。
 *
 * 红绿先行：约束创建经 scene/apply 白名单操作（此前约束只能手写 JSON 入 spec）。
 * 校验走 validateSceneSpec 同源单源（mate 面白名单/法向相反/旋转 v2a 全复用，不建第二真相）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function baseScene() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'v2b constraint ops',
    parameters: {},
    nodes: [
      { id: 'a', type: 'box', name: 'Base', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: 'b', type: 'box', name: 'Lid', dimensions: { width: 120, depth: 80, height: 10 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } },
    ],
  };
}

test('v2b ①：add_constraint 合法 mate 写入 + 求值链生效（b 位置由约束定）', () => {
  const out = scene3d.applySceneOperations(baseScene(), [
    { op: 'add_constraint', constraint: { kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' } },
  ]);
  assert.equal(out.ok, true, JSON.stringify(out));
  const b = out.scene.nodes.find((n) => n.id === 'b');
  assert.deepEqual(b.transform.position.map((v) => Math.round(v)), [0, 0, 20], 'mate 求值须立即生效');
  assert.equal(out.scene.constraints.length, 1);
});

test('v2b ②：非法约束 fail-closed（校验同源——缺 bFace/法向同向/未知节点）', () => {
  const cases = [
    [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z' }, '面标识非法'],
    [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '+z' }, '法向'],
    [{ kind: 'mate', a: 'a', b: 'ghost', aFace: '+z', bFace: '-z' }, 'ghost'],
  ];
  for (const [constraint, keyword] of cases) {
    const out = scene3d.applySceneOperations(baseScene(), [{ op: 'add_constraint', constraint }]);
    assert.equal(out.ok, false, JSON.stringify(constraint));
    const text = JSON.stringify(out);
    assert.ok(
      text.includes(keyword)
      || (out.error === 'mate_face_incompatible' && keyword === '法向')
      || (out.error === 'constraint_invalid' && keyword === 'ghost'),
      `${keyword} 缺位：${text.slice(0, 200)}`,
    );
  }
});

test('v2b ③：remove_constraint 幂等语义（删存在/删不存在诚实报错）', () => {
  const withConstraint = scene3d.applySceneOperations(baseScene(), [
    { op: 'add_constraint', constraint: { kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' } },
  ]);
  assert.equal(withConstraint.ok, true);
  // applySceneOperations 不带 id 的约束——补 id 后删除
  const sceneWithId = { ...withConstraint.scene, constraints: [{ ...withConstraint.scene.constraints[0], id: 'cs_x1' }] };
  const removed = scene3d.applySceneOperations(sceneWithId, [{ op: 'remove_constraint', id: 'cs_x1' }]);
  assert.equal(removed.ok, true);
  assert.equal(removed.scene.constraints.length, 0);
  const missing = scene3d.applySceneOperations(sceneWithId, [{ op: 'remove_constraint', id: 'cs_ghost' }]);
  assert.equal(missing.ok, false);
  assert.ok(JSON.stringify(missing).includes('constraint_not_found'));
});

test('v2b ④：a 旋转至非轴对齐法向 → add_constraint fail-closed 不落盘', () => {
  const scene = baseScene();
  scene.nodes[0].transform.rotation = [45, 0, 0];  // a 的 +z 面法向倾斜出轴对齐栅格
  const out = scene3d.applySceneOperations(scene, [
    { op: 'add_constraint', constraint: { kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' } },
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'mate_face_incompatible', JSON.stringify(out).slice(0, 200));
});
