import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../core/petri-server/helpers/model3d-scene-store.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function scene(overrides = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 40, depth: 80 },
    nodes: [{
      id: 'enclosure',
      type: 'box',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      dimensions: { width: 'width', height: 'height', depth: 'depth' },
      material: { color: '#4c78a8', roughness: 0.65 },
    }],
    constraints: [],
    metadata: { title: 'NEXT-05 test' },
    ...overrides,
  };
}

test('NEXT-05 编辑 — 首次写入 + 参数 diff，无历史时 revision 为 null', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n05-store-'));
  const result = await store.applyOperations({
    workspaceRoot: root,
    relativePath: 'model3d/main.scene3d.json',
    scene: scene(),
    operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
    reason: 'first_write',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.beforeHash, scene3d.hashSceneSpec(scene()));
  assert.equal(result.afterHash, scene3d.hashSceneSpec({ ...scene(), parameters: { ...scene().parameters, width: 130 } }));
  assert.equal(result.revision, null);
  assert.deepEqual(result.diff.parameters, [{ name: 'width', before: 120, after: 130, status: 'changed' }]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'model3d', 'main.scene3d.json'), 'utf8'));
  assert.equal(onDisk.parameters.width, 130);
});

test('NEXT-05 修订 — 第二次写入产生快照，恢复会生成新修订且可回退', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n05-rev-'));
  const rel = 'model3d/main.scene3d.json';
  await store.applyOperations({ workspaceRoot: root, relativePath: rel, scene: scene(), operations: [{ op: 'set_parameter', name: 'width', value: 130 }] });
  const second = await store.applyOperations({
    workspaceRoot: root,
    relativePath: rel,
    scene: { ...scene(), parameters: { ...scene().parameters, width: 130 } },
    operations: [{ op: 'set_parameter', name: 'height', value: 50 }],
    reason: 'second',
  });
  assert.equal(second.ok, true);
  assert.match(second.revision.revisionId, /^rev-\d{6}$/);
  const revisions = await store.listRevisionsForProject({ workspaceRoot: root, relativePath: rel });
  assert.equal(revisions.length, 1);

  const restored = await store.restoreRevision({ workspaceRoot: root, relativePath: rel, revisionId: 'rev-000001' });
  assert.equal(restored.ok, true);
  assert.equal(restored.afterHash, scene3d.hashSceneSpec({ ...scene(), parameters: { ...scene().parameters, width: 130 } }));
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'model3d', 'main.scene3d.json'), 'utf8'));
  assert.equal(onDisk.parameters.width, 130);
  assert.equal(onDisk.parameters.height, 40);
  assert.equal((await store.listRevisionsForProject({ workspaceRoot: root, relativePath: rel })).length, 2);
});

test('NEXT-05 冲突与非法路径 fail-closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n05-conflict-'));
  const rel = 'model3d/main.scene3d.json';
  await store.applyOperations({ workspaceRoot: root, relativePath: rel, scene: scene(), operations: [{ op: 'set_parameter', name: 'width', value: 130 }] });
  const conflict = await store.applyOperations({
    workspaceRoot: root,
    relativePath: rel,
    scene: scene(),
    operations: [{ op: 'set_parameter', name: 'width', value: 140 }],
    expectedHash: 'f'.repeat(64),
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'scene_conflict');
  assert.equal((await store.applyOperations({ workspaceRoot: root, relativePath: 'model3d/nope.json', scene: scene(), operations: [{ op: 'set_parameter', name: 'width', value: 1 }] })).error, 'scene_path_required');
  assert.equal((await store.applyOperations({ workspaceRoot: root, relativePath: rel, scene: scene(), operations: [{ op: 'remove_node', id: 'enclosure' }] })).ok, false);
});

// UI-653 — 聊天产物卡「在 3D 工作台打开」读导出 run 的 scene.json 快照：
// 读面放行，写面仍只认 .scene3d.json（不把编辑历史写进作业目录）。
test('UI-653 导出 run 快照只读可读，写面仍拒绝', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui653-snapshot-'));
  const rel = 'model3d/runs/m3d_run_1/scene.json';
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), JSON.stringify(scene()));
  const read = await store.readSceneInput({ workspaceRoot: root, relativePath: rel });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.hash, scene3d.hashSceneSpec(scene()));
  assert.equal(store.normalizeSnapshotPath(rel), rel);
  assert.equal(store.normalizeSnapshotPath('model3d/runs/m3d_run_1/scene.scene3d.json'), null);
  const apply = await store.applyOperations({
    workspaceRoot: root,
    relativePath: rel,
    scene: scene(),
    operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
  });
  assert.equal(apply.error, 'scene_path_required');
});

test('NEXT-05 diff — 节点增删/字段变化与约束变化可核对', () => {
  const before = scene();
  const after = scene({
    parameters: { width: 130, height: 40, depth: 80 },
    nodes: [
      { ...before.nodes[0], dimensions: { width: 'width', height: 'height', depth: 'depth' }, material: { color: '#ff0000' } },
      { id: 'port', type: 'cylinder', dimensions: { radius: 6, height: 8 } },
    ],
    constraints: [{ kind: 'align', a: 'enclosure', b: 'port', axis: 'x' }],
  });
  const diff = store.diffScenes(before, after);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.parameters, [{ name: 'width', before: 120, after: 130, status: 'changed' }]);
  assert.deepEqual(diff.nodes.find((node) => node.id === 'port'), { id: 'port', status: 'added', fields: [] });
  assert.deepEqual(diff.nodes.find((node) => node.id === 'enclosure').fields, ['material']);
  assert.equal(diff.constraints.added.length, 1);
  assert.equal(store.diffScenes(before, scene()).changed, false);
});
