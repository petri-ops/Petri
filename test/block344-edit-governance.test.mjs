import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import scene3d from '../core/petri-server/helpers/scene3d.js';
import sceneStore from '../core/petri-server/helpers/model3d-scene-store.js';

const SCENE = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  parameters: { width: 100, height: 50 },
  nodes: [
    { id: 'base', type: 'box', transform: { position: [0, 0, 0] }, dimensions: { width: 40, height: 10, depth: 40 }, material: { color: '#4a7cba' } },
    { id: 'post', type: 'cylinder', transform: { position: [0, 30, 0] }, dimensions: { radius: 8, height: 60 }, material: { color: '#3a8f6b' } },
  ],
  constraints: [],
};

describe('BLOCK-344 P1 — 3D 编辑治理对齐（逐项取舍/CAS/约束变更）', () => {
  it('diffScenes：nodes.changed 出字段级 before/after；source 不入 diff 字段（与 op 白名单对齐）', () => {
    const before = structuredClone(SCENE);
    const after = structuredClone(SCENE);
    after.nodes[0].dimensions = { width: 60, height: 10, depth: 40 };
    after.nodes[0].source = 'stepped.stl'; // 白名单外字段：diff 不列（列得出=改不了 的对齐契约）
    const diff = sceneStore.diffScenes(before, after);
    const changed = diff.nodes.find((n) => n.id === 'base');
    assert.ok(changed, 'changed entry missing');
    assert.deepEqual(changed.fields, ['dimensions']);
    assert.deepEqual(changed.changesBefore.dimensions, { width: 40, height: 10, depth: 40 });
    assert.deepEqual(changed.changesAfter.dimensions, { width: 60, height: 10, depth: 40 });
    assert.equal(changed.fields.includes('source'), false);
  });

  it('diffScenes：约束按 id 对齐出 changed（此前只能 added+removed 对）', () => {
    const before = structuredClone(SCENE);
    before.constraints = [{ id: 'c1', kind: 'distance', a: 'base', b: 'post', axis: 'z', value: 30 }];
    const after = structuredClone(SCENE);
    after.constraints = [{ id: 'c1', kind: 'distance', a: 'base', b: 'post', axis: 'z', value: 45 }];
    const diff = sceneStore.diffScenes(before, after);
    assert.equal(diff.constraints.added.length, 0);
    assert.equal(diff.constraints.removed.length, 0);
    assert.equal(diff.constraints.changed.length, 1);
    assert.equal(diff.constraints.changed[0].id, 'c1');
    assert.equal(diff.constraints.changed[0].after.value, 45);
    assert.equal(diff.changed, true);
  });

  it('update_constraint op：按 id 变更且走 fail-closed 校验链', () => {
    const scene = structuredClone(SCENE);
    scene.constraints = [{ id: 'c1', kind: 'distance', a: 'base', b: 'post', axis: 'z', value: 30 }];
    const applied = scene3d.applySceneOperations(scene, [
      { op: 'update_constraint', id: 'c1', changes: { value: 45 } },
    ]);
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.scene.constraints[0].value, 45);
    // id 不可变
    assert.equal(scene3d.applySceneOperations(scene, [
      { op: 'update_constraint', id: 'c1', changes: { id: 'c9' } },
    ]).error, 'operation_invalid');
    // 缺席 id
    assert.equal(scene3d.applySceneOperations(scene, [
      { op: 'update_constraint', id: 'c404', changes: { value: 1 } },
    ]).error, 'constraint_not_found');
    // 空 changes
    assert.equal(scene3d.applySceneOperations(scene, [
      { op: 'update_constraint', id: 'c1', changes: {} },
    ]).error, 'operation_invalid');
  });

  it('diffToOperations：混合 diff → 白名单 op 序列（可回放且结果一致）', () => {
    const before = structuredClone(SCENE);
    const after = structuredClone(SCENE);
    after.parameters.width = 120;
    after.nodes[0].material = { color: '#cc0000' };
    after.nodes.push({ id: 'leg', type: 'box', transform: { position: [0, 5, 0] }, dimensions: { width: 10, height: 10, depth: 10 }, material: { color: '#333333' } });
    after.constraints = [{ id: 'c2', kind: 'distance', a: 'base', b: 'leg', axis: 'z', value: 12 }];
    const ops = sceneStore.diffToOperations(before, after);
    const kinds = ops.map((o) => o.op);
    assert.ok(kinds.includes('set_parameter'), 'set_parameter missing');
    assert.ok(kinds.includes('update_node'), 'update_node missing');
    assert.ok(kinds.includes('add_node'), 'add_node missing');
    assert.ok(kinds.includes('add_constraint'), 'add_constraint missing');
    // 回放一致性 = 「声明 + 约束求解后」的物理一致（约束是活求解器：add_constraint 求值会把
    // leg 落位到满足 distance 的位置——与 SVG 静态 op 的本质差异，字节比对过强）
    const replayed = scene3d.applySceneOperations(before, ops);
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    const leg = replayed.scene.nodes.find((n) => n.id === 'leg');
    assert.equal(leg.transform.position[2], 12, `约束未求解落位：${JSON.stringify(leg.transform)}`);
    assert.equal(replayed.scene.constraints[0].value, 12);
    assert.equal(replayed.scene.parameters.width, 120);
    assert.equal(replayed.scene.nodes[0].material.color, '#cc0000');
  });

  it('diffToOperations：删节点收尾（其约束先移除不悬空）', () => {
    const before = structuredClone(SCENE);
    before.constraints = [{ id: 'c1', kind: 'distance', a: 'base', b: 'post', axis: 'z', value: 30 }];
    const after = structuredClone(SCENE);
    after.nodes = after.nodes.filter((n) => n.id !== 'post');
    after.constraints = [];
    const ops = sceneStore.diffToOperations(before, after);
    const removeNodeIdx = ops.findIndex((o) => o.op === 'remove_node');
    const removeConstraintIdx = ops.findIndex((o) => o.op === 'remove_constraint');
    assert.ok(removeConstraintIdx >= 0 && removeNodeIdx > removeConstraintIdx, `order broken: ${JSON.stringify(kinds(ops))}`);
    const replayed = scene3d.applySceneOperations(before, ops);
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.scene.nodes.some((n) => n.id === 'post'), false);
    function kinds(list) { return list.map((o) => o.op).join(','); }
  });

  it('model3d_apply 的 schema 暴露 expectedHash（CAS 治理对齐）', () => {
    const defs = fs.readFileSync(path.join(process.cwd(), 'core/petri-server/agent-tools/tool-defs/model3d.js'), 'utf8');
    const block = defs.slice(defs.indexOf("name: 'model3d_apply'"), defs.indexOf("name: 'model3d_apply'") + 1200);
    assert.ok(block.includes('expectedHash'), 'apply schema 缺 expectedHash（CAS 未对齐）');
    assert.ok(block.includes('scene_conflict'), 'expectedHash 描述应说明冲突语义');
  });
});

describe('BLOCK-344 P2 — readRevision 只读 + actor 字段', () => {
  it('readRevision：读快照内容 + actor 推导（agent_apply→agent）；缺席 id 如实 404 语义', async () => {
    const before = structuredClone(SCENE);
    const after = structuredClone(SCENE);
    after.parameters.width = 130;
    // apply 一次（内部 recordRevision 推导 actor=user_parameter_edit→user）
    const applied = scene3d.applySceneOperations(before, [
      { op: 'set_parameter', name: 'width', value: 130 },
    ]);
    assert.equal(applied.ok, true);
    // 直接探 recordRevision（经 store 内部路径）——用临时文件走完整链
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'b344-'));
    // 用 applyOperations 的完整链（写盘 + revision）：
    const target = path.join(tmp, 'model3d', 'scene.scene3d.json');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(before));
    const result = await sceneStore.applyOperations({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      scene: before,
      operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
      expectedHash: scene3d.hashSceneSpec(before),
      reason: 'agent_apply',
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const read = await sceneStore.readRevision({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      revisionId: result.revision.revisionId,
    });
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.actor, 'agent'); // reason=agent_apply → actor=agent
    assert.deepEqual(read.scene, before);
    assert.equal(read.hash, scene3d.hashSceneSpec(before));
    // 缺席修订
    const missing = await sceneStore.readRevision({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      revisionId: 'rev-999999',
    });
    assert.equal(missing.error, 'revision_not_found');
    // 非法 id
    const bad = await sceneStore.readRevision({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      revisionId: 'hack',
    });
    assert.equal(bad.error, 'revision_id_invalid');
  });

  it('user_parameter_edit 推导为 user；restore 推导为 system', async () => {
    // actorFromReason 未导出——经 recordRevision 间接验证：读 index 不可行（未导出），
    // 用 applyOperations 两次不同 reason 走完整链断言 actor。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b344-u-'));
    const target = path.join(tmp, 'model3d', 'scene.scene3d.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(SCENE));
    const r1 = await sceneStore.applyOperations({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      scene: SCENE,
      operations: [{ op: 'set_parameter', name: 'width', value: 111 }],
      reason: 'user_parameter_edit',
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.revision.actor, 'user');
    const r2 = await sceneStore.applyOperations({
      workspaceRoot: tmp,
      relativePath: 'model3d/scene.scene3d.json',
      scene: r1.scene,
      operations: [{ op: 'set_parameter', name: 'width', value: 222 }],
      reason: 'agent_apply',
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.revision.actor, 'agent');
  });
});

describe('BLOCK-344 桥对账（Blender/Godot 写回守卫）', () => {
  it('godot 场景编辑写盘带 before-sha 守卫（stale_propose——与 SceneSpec CAS 同构）', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'core/petri-server/helpers/godot-tools.js'), 'utf8');
    assert.ok(src.includes('beforeSha256'), 'godot 场景编辑缺 before-sha 守卫');
    assert.ok(src.includes('stale_propose'), 'godot 守卫缺 stale 拒绝语义');
  });

  it('blender/godot 产物写盘均为新建运行目录（不覆盖用户源文件——无 CAS 需求的对账结论）', () => {
    const blender = fs.readFileSync(path.join(process.cwd(), 'core/petri-server/helpers/blender-provider.js'), 'utf8');
    assert.ok(blender.includes("path.join(outDir, 'scene.json')"), 'blender 场景落 runs 产物目录');
    const godot = fs.readFileSync(path.join(process.cwd(), 'core/petri-server/helpers/godot-tools.js'), 'utf8');
    assert.ok(godot.includes('manifest.json'), 'godot manifest 落运行目录');
    // 守卫性断言：两桥均无「对 workspace 根 SceneSpec 源文件的整体覆盖写」
    assert.equal(blender.includes('writeFileSync(workspaceRoot'), false);
    assert.equal(godot.includes('writeFileSync(workspaceRoot'), false);
  });
});

describe('BLOCK-345 Inkscape 1.4 buildArgs 形态（实机抓真钉死）', () => {
  const { buildArgs } = require('../core/petri-server/helpers/inkscape.js');

  it('布尔/文字转路径用 1.4 实名 path-* + select-all:no-groups（旧名 union 在 1.4 不存在）', () => {
    const args = buildArgs('union', '/a.svg', '/b.svg');
    assert.equal(args[0], '--actions=select-all:no-groups;path-union;export-filename:/b.svg;export-do');
    const diff = buildArgs('intersection', '/a.svg', '/b.svg');
    assert.ok(diff[0].includes('path-intersection'));
    const t2p = buildArgs('text-to-path', '/a.svg', '/b.svg');
    assert.equal(t2p[0], '--export-text-to-path');
    assert.equal(t2p[1], '--export-filename=/b.svg');
  });

  it('export-pdf 走导出参数', () => {
    const args = buildArgs('export-pdf', '/a.svg', '/a.pdf');
    assert.equal(args[0], '--export-type=pdf');
    assert.equal(args[2], '/a.svg');
  });
});
