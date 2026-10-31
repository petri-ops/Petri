import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OcctKernel } from 'occt-wasm';

const require = createRequire(import.meta.url);
const cad = require('../core/petri-server/helpers/cad-exchange.js');
const assets = require('../core/petri-server/helpers/model3d-assets.js');
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'model3d');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cad-exchange-'));
}

async function sampleStepAndStl() {
  const kernel = await OcctKernel.init();
  try {
    const box = kernel.makeBox(10, 20, 30);
    return {
      step: kernel.exportStep(box, { schema: 'AP214' }),
      stl: Buffer.from(kernel.exportStl(box, 0.1, false)),
    };
  } finally {
    kernel[Symbol.dispose]();
  }
}

test('BLOCK-322 P4-04 CAD 内核探针 — occt-wasm 就绪，IGES 导入可用、导出如实不支持', async () => {
  const result = await cad.probeCadExchange();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.kernel, 'occt-wasm');
  assert.match(result.version, /^5\./);
  assert.equal(result.formats.stepImport, true);
  assert.equal(result.formats.stepExport, true);
  assert.equal(result.formats.igesImport, true);
  assert.equal(result.formats.igesExport, false);
  assert.equal(result.formats.drawingSvg, true);
});

test('BLOCK-322 P4-04 STEP 导入 — XCAF 转 GLB，保留标签摘要', async () => {
  const { step } = await sampleStepAndStl();
  const result = await cad.stepToGlb({ bytes: Buffer.from(step) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.glb.subarray(0, 4).toString('ascii'), 'glTF');
  assert.ok(result.glb.length > 1000);
  assert.equal(result.summary.kernel, 'occt-wasm');
  assert.ok(result.summary.labelCount >= 1);
});

test('BLOCK-322 P4-04 STEP 导出 — Blender STL 经 OCCT 固化为 faceted STEP', async () => {
  const { stl } = await sampleStepAndStl();
  const result = await cad.stlToStep({ bytes: stl });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.step, /^ISO-10303-21;/);
  assert.match(result.step, /MANIFOLD_SOLID_BREP/);
  assert.equal(result.summary.solid, true);
  assert.equal(result.summary.faceted, true);
  assert.ok(Math.abs(result.summary.volumeMm3 - 6000) < 0.5);
  assert.deepEqual(result.summary.bbox, { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 20, zmax: 30 });
  assert.equal(cad.stepToSvg ? (await cad.stepToSvg({ bytes: Buffer.from(result.step) })).ok : false, true);
});

test('BLOCK-322 P4-04 IGES 导入 — 网格转 STL，HLR 多视图 SVG 可生成', async () => {
  const fixture = fs.readFileSync(path.join(FIXTURE_DIR, 'iges-cube-10mm.igs'));
  const result = await cad.igesToStl({ bytes: fixture });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.stl.length > 80);
  assert.equal(result.summary.kernel, 'occt-import-js');
  assert.equal(result.summary.meshCount, 1);
  assert.equal(result.summary.triangleCount, 12);
  assert.deepEqual(result.summary.bbox, { xmin: -5, ymin: 0, zmin: -5, xmax: 5, ymax: 10, zmax: 5 });
  const svg = await cad.stlToSvg({ bytes: result.stl, summary: result.summary });
  assert.equal(svg.ok, true, JSON.stringify(svg));
  assert.match(svg.svg, /<svg/);
  assert.ok(svg.svg.length > 1000);
});

test('BLOCK-322 P4-04 资产入链 — STEP/IGES 转换出派生 GLB/STL 并记录 source sha', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  const { step } = await sampleStepAndStl();
  fs.writeFileSync(path.join(root, 'model3d', 'part.step'), Buffer.from(step));
  const stepResult = await assets.importCadAsset({
    workspaceRoot: root,
    sourcePath: 'model3d/part.step',
    name: 'imported-part',
  });
  assert.equal(stepResult.ok, true, JSON.stringify(stepResult));
  assert.equal(stepResult.cad.sourceFormat, 'step');
  assert.equal(stepResult.cad.derivedFormat, 'glb');
  assert.equal(stepResult.asset.path, `model3d/assets/${stepResult.asset.sha256}.glb`);
  assert.equal(stepResult.node.type, 'mesh-reference');
  assert.equal(stepResult.provenance.sourcePath, 'model3d/part.step');
  assert.equal(stepResult.provenance.sourceFormat, 'step');
  assert.equal(stepResult.provenance.sourceSha256, stepResult.cad.sourceSha256);
  assert.equal(fs.readFileSync(path.join(root, stepResult.asset.path)).subarray(0, 4).toString('ascii'), 'glTF');

  fs.copyFileSync(path.join(FIXTURE_DIR, 'iges-cube-10mm.igs'), path.join(root, 'model3d', 'legacy.igs'));
  const igesResult = await assets.importCadAsset({
    workspaceRoot: root,
    sourcePath: 'model3d/legacy.igs',
    name: 'legacy-part',
  });
  assert.equal(igesResult.ok, true, JSON.stringify(igesResult));
  assert.equal(igesResult.cad.sourceFormat, 'iges');
  assert.equal(igesResult.cad.derivedFormat, 'stl');
  assert.equal(igesResult.asset.path, `model3d/assets/${igesResult.asset.sha256}.stl`);
  assert.equal(igesResult.provenance.sourcePath, 'model3d/legacy.igs');
  assert.equal(igesResult.provenance.sourceFormat, 'iges');
  assert.equal(fs.readFileSync(path.join(root, igesResult.asset.path)).subarray(0, 5).toString('ascii'), 'BLOCK');
  assert.equal(assets.listAssets({ workspaceRoot: root }).total, 2);
});

test('BLOCK-322 P4-04 失败面 — 非法格式/缺失/空源 fail-closed', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'model3d', 'part.txt'), 'x');
  assert.equal((await assets.importCadAsset({ workspaceRoot: root, sourcePath: 'model3d/part.txt' })).error, 'cad_format_unsupported');
  assert.equal((await assets.importCadAsset({ workspaceRoot: root, sourcePath: 'model3d/none.step' })).error, 'cad_source_not_found');
  assert.equal((await cad.stepToGlb({ bytes: Buffer.alloc(0) })).error, 'cad_source_empty');
  assert.equal((await cad.igesToStl({ bytes: Buffer.alloc(0) })).error, 'cad_source_empty');
});
