import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bom = require('../core/petri-server/helpers/model3d-bom.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

function scene(overrides = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 80, depth: 40 },
    nodes: [
      { id: 'base', type: 'box', dimensions: { width: 'width', height: 'depth', depth: 'height' }, material: { color: '#4c78a8', densityKgM3: 1000 } },
      { id: 'block', type: 'box', dimensions: { width: 20, height: 20, depth: 20 }, material: { color: '#d29b42', densityKgM3: 2700 } },
    ],
    constraints: [],
    metadata: { title: 'bom-test', ...overrides },
  };
}
const report = { ok: true, mesh: { objects: 2, vertices: 16, triangles: 12, nonManifoldEdges: 0, watertight: true, volumesMm3: { base: 384000, block: 8000 } } };

test('BLOCK-322 P4-01 BOM — 体积×密度→质量，节点密度优先于缺省', () => {
  const built = bom.buildBom(scene(), report);
  assert.equal(built.ok, true, JSON.stringify(built));
  const base = built.rows.find((row) => row.id === 'base');
  const block = built.rows.find((row) => row.id === 'block');
  assert.equal(base.densitySource, 'node.material');
  assert.equal(base.massG, 384);
  assert.equal(block.massG, 21.6);
  assert.equal(built.totals.totalVolumeMm3, 392000);
  assert.equal(built.totals.totalMassG, 405.6);
  assert.match(bom.toCsv(built), /TOTAL,.*392000.*405\.6/);
  assert.match(bom.toMarkdown(built), /\| \*\*合计\*\*/);
});

test('BLOCK-322 P4-01 BOM — scene.metadata 密度兜底与缺省密度假设', () => {
  const metadataScene = scene({ defaultDensityKgM3: 2000 });
  delete metadataScene.nodes[0].material.densityKgM3;
  const built = bom.buildBom(metadataScene, report);
  assert.equal(built.rows[0].densitySource, 'scene.metadata');
  assert.equal(built.rows[0].massG, 768);
  const noNodeDensity = scene();
  delete noNodeDensity.nodes[0].material.densityKgM3;
  delete noNodeDensity.metadata.defaultDensityKgM3;
  const fallback = bom.buildBom(noNodeDensity, report);
  assert.equal(fallback.rows[0].densitySource, 'default');
  assert.match(fallback.assumptions[0], /1000/);
});

test('BLOCK-322 P4-01 BOM — 非水密网格拒绝；产物文件与 sha/manifest 可复算', () => {
  const bad = { ok: true, mesh: { ...report.mesh, watertight: false, nonManifoldEdges: 2 } };
  assert.equal(bom.buildBom(scene(), bad).error, 'mesh_not_watertight');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-'));
  const built = bom.buildBom(scene(), report);
  const written = bom.writeBomArtifacts({ workspaceRoot: root, bom: built, runId: 'run-1' });
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.files.length, 3);
  for (const file of written.files) {
    assert.ok(fs.existsSync(path.join(root, file.path)), file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, written.manifest.path), 'utf8'));
  assert.equal(manifest.sceneHash, built.sceneHash);
  assert.equal(manifest.files.length, 3);
});

test('BLOCK-322 P4-02 公差 — 结构化 tolerances 通过校验并进入 BOM 报告', () => {
  const input = scene({ tolerances: [{ nodeId: 'base', feature: 'width', nominal: 120, lower: -0.2, upper: 0.2, unit: 'mm' }] });
  const validated = scene3d.validateSceneSpec(input);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  const built = bom.buildBom(input, report);
  assert.equal(built.tolerances.length, 1);
  assert.match(bom.toMarkdown(built), /## 公差声明/);
  assert.match(bom.toMarkdown(built), /base \| width \| 120 \| -0\.2 \| 0\.2 \| mm/);
});

test('BLOCK-322 P4-02 公差 — 未知节点/上下限倒置/非 mm fail-closed', () => {
  const unknown = scene({ tolerances: [{ nodeId: 'nope', feature: 'width', nominal: 1, lower: 0, upper: 1, unit: 'mm' }] });
  assert.equal(scene3d.validateSceneSpec(unknown).ok, false);
  const inverted = scene({ tolerances: [{ nodeId: 'base', feature: 'width', nominal: 1, lower: 2, upper: 1, unit: 'mm' }] });
  assert.equal(scene3d.validateSceneSpec(inverted).ok, false);
  const unit = scene({ tolerances: [{ nodeId: 'base', feature: 'width', nominal: 1, lower: 0, upper: 1, unit: 'cm' }] });
  assert.equal(scene3d.validateSceneSpec(unit).ok, false);
});
