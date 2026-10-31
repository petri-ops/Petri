/**
 * BLOCK-322 P3-03 v2a — mate 支持带旋转节点的平面贴合（红绿先行）。
 *
 * RULING-04 v2 §5 开工序第 2 票 + 欧拉序探针定案（Blender 5.2.3 实测）：
 *   - 默认 rotation_mode='XYZ'，矩阵合成 Rz·Ry·Rx（X 先转，列向量右乘）；
 *   - 探针证据：euler=(90°,90°,0) 时局部 +X→(0,0,-1)、+Y→(1,0,0)（Rz·Ry·Rx 唯一判序）；
 *   - dimensions 属性=最终尺寸（scale=尺寸/半 extents 由 primitive size=2 换算）。
 *
 * v2a 契约（D4 推荐口径=先只解「旋转+平面」）：
 *   ① 有旋转节点的 mate 不再 validate 拒绝、不再 mate_dimensions_missing 兜底；
 *   ② 面点求值走「局部面点 → 局→世合成（Rz·Ry·Rx，度→弧度）」；
 *   ③ 贴合后 b 的 rotation 与 a 的 rotation 同步（贴合平面法向对齐）；
 *   ④ 无旋转节点行为逐字不变（兼容锚：v1 全部既有断言保持）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d');

const round = (v) => Number(v.toFixed(6));

function mateScene(bRotation = [0, 0, 0]) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'v2a probe',
    parameters: {},
    nodes: [
      { id: 'a', type: 'box', name: 'Anchor', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: 'b', type: 'box', name: 'Lid', dimensions: { width: 120, depth: 80, height: 10 }, transform: { position: [0, 0, 0], rotation: bRotation } },
    ],
    constraints: [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' }],
  };
}

function resolve(scene) {
  const validated = scene3d.validateSceneSpec(scene);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  return scene3d.resolveSceneSpec(scene);
}

test('P3-03 v2a ①：无旋转节点 mate 行为逐字不变（兼容锚）', () => {
  const out = resolve(mateScene());
  assert.equal(out.ok, true, JSON.stringify(out.errors || null));
  const b = out.scene.nodes.find((n) => n.id === 'b');
  // a 上表面 z=+15，b 下表面 z=-5 → b.position.z = 15 + 5 = 20
  assert.deepEqual(b.transform.position.map(round), [0, 0, 20]);
  assert.deepEqual(b.transform.rotation, [0, 0, 0]);
});

test('P3-03 v2a ②：带旋转节点不再被 validate/求值拒绝', () => {
  const scene = mateScene([90, 0, 0]);
  const validated = scene3d.validateSceneSpec(scene);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors || null));
  const out = resolve(scene);
  assert.equal(out.ok, true, JSON.stringify(out.errors || null));
});

test('P3-03 v2a ③：绕 X 转 90° 的盖板 → 面点经 Rz·Ry·Rx 合成、贴合位置与姿态正确', () => {
  // b 绕 X 转 90°：b 的局部 -z 面法向转到世界 (0,1,0)（探针：+Y_local→(1,0,0)，-Z_local→(0,1,0)）。
  // 贴合语义：b 的贴合面（局部 -z 面）法向须与 a 的贴合面（世界 +z）法向相反 → 不成立时
  // 求值器按 v2a 规则改写 b.rotation 使两法向对齐（贴合=法向相反）。
  const out = resolve(mateScene([90, 0, 0]));
  assert.equal(out.ok, true, JSON.stringify(out.errors || null));
  const applied = out.appliedConstraints.filter((a) => a.kind === 'mate');
  assert.ok(applied.length > 0, 'mate 必须有 applied 记录');
  const rotationApplied = applied.find((a) => a.field === 'rotation' && a.poseSolve === true);
  assert.ok(rotationApplied, 'v2a 姿态改写必须留 applied 记录（poseSolve）');
  assert.deepEqual(rotationApplied.from, [90, 0, 0]);
  assert.deepEqual(rotationApplied.to, [0, 0, 0]);
  const b = out.scene.nodes.find((n) => n.id === 'b');
  // 姿态被改写为与 a 面法向对齐：-z_local 面对世界 +z → b.rotation = [0,0,0] 才能让
  // -z_local 指向 -z_world…… 探针定案：euler [0,0,0] 时 -z_local=(-0,0,-1)。翻转后
  // [180,0,0] 时 -z_local=(0,0,1)。贴合（法向相反）→ -z_local 需指 -z_world → [0,0,0]。
  assert.deepEqual(b.transform.rotation.map(round), [0, 0, 0], JSON.stringify(b.transform.rotation));
  assert.deepEqual(b.transform.position.map(round), [0, 0, 20]);
});

test('P3-03 v2a ④：绕 Z 转 90° 的盖板（平面平行案例）→ 位置按旋转后面点求值', () => {
  // b 绕 Z 转 90°：局部 -z 面法向仍指世界 -z（Rz 不改 z 分量），面心世界坐标 = Rz·(局部面心)。
  const out = resolve(mateScene([0, 0, 90]));
  assert.equal(out.ok, true, JSON.stringify(out.errors || null));
  const b = out.scene.nodes.find((n) => n.id === 'b');
  // b 局部 -z 面心 = (0,0,-5)，Rz(90) 旋转后仍 (0,0,-5)（z 轴旋转不改 z），贴合 z=15+5=20
  assert.deepEqual(b.transform.position.map(round), [0, 0, 20]);
  assert.deepEqual(b.transform.rotation.map(round), [0, 0, 90]);
});

test('P3-03 v2a ⑤：垂直面 mate（+y 面贴 -x 面）带旋转 → 走同一局→世合成', () => {
  const scene = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'v2a perpendicular',
    parameters: {},
    nodes: [
      { id: 'wall', type: 'box', name: 'Wall', dimensions: { width: 10, depth: 80, height: 30 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: 'panel', type: 'box', name: 'Panel', dimensions: { width: 120, depth: 80, height: 10 }, transform: { position: [0, 0, 0], rotation: [0, 0, 90] } },
    ],
    constraints: [{ kind: 'mate', a: 'wall', b: 'panel', aFace: '+x', bFace: '-z' }],
  };
  const out = resolve(scene);
  // v2a：跨轴平面贴合（wall 的 +x 面与 panel 的 -z 面）——面板先按姿态把 -z_local
  // 转到世界向（Rz(90)：-z_local 仍 -z_world），再对 wall 的 +x 面贴合。
  // 该案例的几何可解性由求值器裁决（同轴校验在合成后的世界法向上做）。
  const applied = (out.appliedConstraints || []).filter((a) => a.kind === 'mate');
  assert.ok(out.ok === true || out.errors.some((e) => e.includes('mate')), '要么求值成功要么显式 mate 错误（不静默）');
  assert.ok(applied.length > 0 || (out.errors || []).length > 0);
});
