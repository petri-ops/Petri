import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const meshAssets = require('../core/petri-server/helpers/mesh-assets.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function tempWorkspace(prefix = 'b322-asset-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAsset(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function scene(nodes) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
  };
}

function meshNode(id, sourcePath, sha = 'a'.repeat(64)) {
  return { id, type: 'mesh-reference', source: { path: sourcePath, sourceSha256: sha } };
}

test('BLOCK-322 P1c — 预检从磁盘真实计算 sha256/字节/格式', async () => {
  const root = tempWorkspace();
  try {
    const content = Buffer.from('glb-fixture-bytes');
    writeAsset(root, 'model3d/assets/enclosure.glb', content);
    const result = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: 'model3d/assets/enclosure.glb' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.format, 'glb');
    assert.equal(result.bytes, content.length);
    assert.equal(result.sourceSha256, crypto.createHash('sha256').update(content).digest('hex'), 'sha256 必须是盘面真实值');
    assert.equal(result.path, 'model3d/assets/enclosure.glb', '回工作区相对路径');
    assert.ok(!String(result.path).startsWith(root), '不得泄漏工作区绝对路径');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-322 P1c — 扩展名白名单在预检层拒绝（不算哈希不读盘）', async () => {
  const root = tempWorkspace();
  try {
    writeAsset(root, 'notes.txt', 'not a mesh');
    const result = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: 'notes.txt' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'mesh_format_unsupported');
    assert.deepEqual(result.extensions, meshAssets.MESH_INPUT_EXTENSIONS);
    assert.equal(meshAssets.meshFormatForPath('MODEL/HEAD.STL'), 'stl', '扩展名大小写不敏感');
    assert.equal(meshAssets.meshFormatForPath('no-extension'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-322 P1c — 缺失/超限/越界路径分别如实拒绝', async () => {
  const root = tempWorkspace();
  try {
    const missing = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: 'model3d/assets/gone.glb' });
    assert.equal(missing.error, 'mesh_not_found');

    writeAsset(root, 'model3d/assets/big.glb', Buffer.alloc(64));
    const oversized = await meshAssets.inspectMeshAsset({
      workspaceRoot: root, relativePath: 'model3d/assets/big.glb', maxBytes: 8,
    });
    assert.equal(oversized.error, 'mesh_too_large');
    assert.equal(oversized.bytes, 64);
    assert.equal(oversized.maxBytes, 8);

    const escaped = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: '../outside.glb' });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.error, 'path_escape', '逃逸出工作区必须拒绝');

    const sensitive = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: '.git/hidden.glb' });
    assert.equal(sensitive.error, 'sensitive_path');

    const noRoot = await meshAssets.inspectMeshAsset({ relativePath: 'model3d/assets/a.glb' });
    assert.equal(noRoot.error, 'project_required');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-322 P1c — 上限常量与 Blender 侧一致（64MB 单一数值）', () => {
  assert.equal(meshAssets.MAX_MESH_BYTES, 64 * 1024 * 1024);
  assert.deepEqual([...meshAssets.MESH_INPUT_FORMATS], ['glb', 'gltf', 'stl', 'obj']);
});

test('BLOCK-322 P1c — SceneSpec 校验层提前拒绝非法格式（不再拖到 Blender 构建才炸）', () => {
  const bad = scene3d.validateSceneSpec(scene([meshNode('m', 'model3d/assets/notes.txt')]));
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'mesh_format_unsupported');

  const good = scene3d.validateSceneSpec(scene([meshNode('m', 'model3d/assets/enclosure.gltf', 'b'.repeat(64))]));
  assert.equal(good.ok, true, JSON.stringify(good.errors));

  const noSha = scene3d.validateSceneSpec(scene([{ id: 'm', type: 'mesh-reference', source: { path: 'a.glb' } }]));
  assert.equal(noSha.error, 'mesh_source_hash_required', '缺 sha 的优先级高于格式判定');
});

test('BLOCK-322 P1c — add_node 白名单可写 mesh-reference，重复 id 拒绝', () => {
  const base = scene([{ id: 'box', type: 'box', dimensions: { width: 10, height: 10, depth: 10 } }]);
  const applied = scene3d.applySceneOperations(base, [{
    op: 'add_node',
    node: meshNode('asset-enclosure', 'model3d/assets/enclosure.glb'),
  }]);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.scene.nodes.length, 2);

  const duplicate = scene3d.applySceneOperations(applied.scene, [{
    op: 'add_node',
    node: meshNode('asset-enclosure', 'model3d/assets/other.glb'),
  }]);
  assert.equal(duplicate.error, 'duplicate_node_id');

  const rejected = scene3d.applySceneOperations(base, [{
    op: 'add_node',
    node: meshNode('asset-bad', 'model3d/assets/notes.txt'),
  }]);
  assert.equal(rejected.error, 'mesh_format_unsupported', '写侧同样提前拒绝');
});

test('BLOCK-322 P1c — 预检结果直接可进 SceneSpec（同一 sha 闭环）', async () => {
  const root = tempWorkspace();
  try {
    const content = Buffer.from('{"asset":"glb"}');
    writeAsset(root, 'model3d/assets/loop.glb', content);
    const inspected = await meshAssets.inspectMeshAsset({ workspaceRoot: root, relativePath: 'model3d/assets/loop.glb' });
    const applied = scene3d.applySceneOperations(scene([
      { id: 'box', type: 'box', dimensions: { width: 10, height: 10, depth: 10 } },
    ]), [{
      op: 'add_node',
      node: { id: 'asset-loop', type: 'mesh-reference', source: { path: inspected.path, sourceSha256: inspected.sourceSha256 } },
    }]);
    assert.equal(applied.ok, true, JSON.stringify(applied));
    const roundtrip = scene3d.resolveSceneSpec(applied.scene);
    assert.equal(roundtrip.ok, true);
    assert.equal(
      roundtrip.scene.nodes.find((node) => node.id === 'asset-loop').source.sourceSha256,
      crypto.createHash('sha256').update(content).digest('hex'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
