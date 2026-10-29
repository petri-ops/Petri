import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function scene(overrides = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 80, depth: 40, wall: 2 },
    nodes: [
      {
        id: 'enclosure',
        type: 'box',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        dimensions: { width: 'width', height: 'height', depth: 'depth' },
        material: { color: '#4c78a8', roughness: 0.7 },
      },
    ],
    constraints: [],
    metadata: { title: 'test' },
    ...overrides,
  };
}

test('NEXT-04A SceneSpec — 参数引用解析、复杂度与哈希', () => {
  const validated = scene3d.validateSceneSpec(scene());
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  const resolved = scene3d.resolveSceneSpec(scene());
  assert.equal(resolved.scene.nodes[0].dimensions.width, 120);
  assert.equal(resolved.scene.nodes[0].dimensions.height, 80);
  assert.match(scene3d.hashSceneSpec(scene()), /^[a-f0-9]{64}$/);
  assert.equal(scene3d.hashSceneSpec(scene()), scene3d.hashSceneSpec(scene({ metadata: { title: 'other' } })), 'metadata 不进几何哈希');
});

test('NEXT-04A SceneSpec — 非法单位/id/引用/nonfinite/hash fail-closed', () => {
  assert.equal(scene3d.validateSceneSpec(scene({ units: 'inch' })).ok, false);
  assert.equal(scene3d.validateSceneSpec(scene({ coordinateSystem: 'y-up' })).ok, false);
  assert.equal(scene3d.validateSceneSpec(scene({ nodes: [{ id: 'x', type: 'box', dimensions: { width: 1, height: 1, depth: 1 } }] })).ok, true);
  assert.equal(scene3d.validateSceneSpec(scene({ nodes: [{ id: 'x', type: 'box', dimensions: { width: 'missing' } }] })).error, 'invalid_reference');
  assert.equal(scene3d.validateSceneSpec(scene({ parameters: { width: Infinity } })).ok, false);
  const missingHash = scene({
    nodes: [{ id: 'mesh', type: 'mesh-reference', source: { path: 'a.glb' } }],
  });
  assert.equal(scene3d.validateSceneSpec(missingHash).error, 'mesh_source_hash_required');
});

test('NEXT-04A SceneSpec — 操作白名单、不可变 apply 与 before/after', () => {
  const source = scene();
  const applied = scene3d.applySceneOperations(source, [
    { op: 'set_parameter', name: 'width', value: 130 },
    { op: 'update_node', id: 'enclosure', changes: { material: { color: '#ff0000', roughness: 0.5 } } },
  ]);
  assert.equal(applied.ok, true, JSON.stringify(applied.errors));
  assert.equal(applied.scene.parameters.width, 130);
  assert.equal(source.parameters.width, 120, '输入不可变');
  assert.notEqual(applied.beforeHash, applied.afterHash);
  assert.equal(scene3d.applySceneOperations(source, [{ op: 'run_js', code: 'x' }]).error, 'operation_not_allowed');
});

test('NEXT-04A SceneSpec — 前端 viewer 契约与后端常量不漂移', () => {
  const source = fs.readFileSync(new URL('../frontend/src/lib/scene3d.ts', import.meta.url), 'utf8');
  assert.match(source, /SCENE3D_VERSION = 'scene3d\/v1'/);
  assert.match(source, /'z-up-right-handed'/);
  assert.match(source, /'box', 'cylinder', 'sphere', 'plane', 'group', 'mesh-reference'/);
  assert.match(source, /units: 'mm'/);
});

test('NEXT-04A SceneSpec — manifest 记录版本/哈希/校验/输出', () => {
  const manifest = scene3d.buildExportManifest({
    sceneHash: 'a'.repeat(64),
    taskSpecId: 'task-1',
    workflowRunId: 'wf-1',
    recipeId: 'modeling/box',
    recipeVersion: 1,
    provider: 'blender',
    providerVersion: '4.5.10',
    inputHashes: { 'source.glb': 'b'.repeat(64) },
    validation: { ok: true, warnings: [] },
    outputs: [{ path: 'model.glb', sha256: 'c'.repeat(64), bytes: 10 }],
  });
  assert.equal(manifest.schema, 'model3d-manifest/v1');
  assert.equal(manifest.taskSpecId, 'task-1');
  assert.equal(manifest.outputs[0].sha256, 'c'.repeat(64));
});
