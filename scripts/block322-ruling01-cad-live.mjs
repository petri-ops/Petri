#!/usr/bin/env node
/**
 * BLOCK-322 RULING-01 直连实机证据：真实 Blender 构建 STL → OCCT faceted STEP；
 * STEP/IGES 导入 → 派生 GLB/STL 资产；STEP HLR 多视图 SVG。真实 Blender 4.5.10 LTS。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-322-ruling01');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'b322-cad-'));
process.env.PETRI_LOCAL_DATA_DIR = DATA;
process.env.PETRI_DB_PATH = path.join(DATA, 'petri.db');

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 900) });
  if (pass) console.log(`PASS ${id}`);
  else console.error(`FAIL ${id}: ${detail}`);
}
function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function migrate() {
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const db = new Database(process.env.PETRI_DB_PATH);
  const dir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  db.close();
}

function scene() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 80, depth: 40 },
    nodes: [
      { id: 'base', type: 'box', dimensions: { width: 'width', height: 'depth', depth: 'height' }, material: { color: '#4c78a8' }, label: '底座' },
      { id: 'block', type: 'box', transform: { position: [0, 0, 40] }, dimensions: { width: 20, height: 20, depth: 20 }, material: { color: '#d29b42' }, label: '凸台' },
    ],
    constraints: [],
    metadata: { title: 'BLOCK-322 RULING-01 CAD live' },
  };
}

async function main() {
  fs.rmSync(EVIDENCE, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  migrate();
  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const sceneStore = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-scene-store.js'));
  const blender = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'blender-provider.js'));
  const cad = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'cad-exchange.js'));
  const tools = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'model3d-tools.js'));
  const project = db.createProject({ name: `B322-CAD-${Date.now()}`, workspacePath: path.join(EVIDENCE, 'live-workspace') });
  const ctx = { projectId: project.id, userId: 'local-user' };
  const root = project.workspace_path;
  const scenePath = 'model3d/live.scene3d.json';
  const base = scene();
  const written = await sceneStore.writeScene({ workspaceRoot: root, relativePath: scenePath, scene: base, reason: 'cad_live' });
  assert('S0_scene_written', written.ok === true, JSON.stringify(written).slice(0, 300));

  const probe = await cad.probeCadExchange();
  assert('S1_kernel_probe', probe.status === 'ready' && probe.formats.stepImport && probe.formats.stepExport && probe.formats.igesImport && probe.formats.igesExport === false, JSON.stringify(probe));

  const exported = await tools.tool_model3d_export({ scene: base, scenePath, formats: ['glb', 'step'] }, ctx);
  assert('S2_export_ok', exported.ok === true, JSON.stringify(exported).slice(0, 700));
  const byExt = Object.fromEntries((exported.outputs || []).map((item) => [path.extname(item.path).slice(1), item]));
  assert('S2_step_output', Boolean(byExt.step), JSON.stringify(Object.keys(byExt)));
  const stepAbs = path.join(root, byExt.step.path);
  const stepText = fs.readFileSync(stepAbs, 'utf8');
  assert('S2_step_header', stepText.startsWith('ISO-10303-21;'), stepText.slice(0, 40));
  assert('S2_step_sha', shaFile(stepAbs) === byExt.step.sha256 && fs.statSync(stepAbs).size === byExt.step.bytes, JSON.stringify(byExt.step));
  assert('S2_step_manifold', (stepText.match(/MANIFOLD_SOLID_BREP/g) || []).length === 2, `solids=${(stepText.match(/MANIFOLD_SOLID_BREP/g) || []).length}`);
  assert('S2_step_volume', Math.abs(exported.cad.volumeMm3 - 392000) < 1, JSON.stringify(exported.cad));
  assert('S2_step_faceted', exported.cad.faceted === true && exported.cad.solidCount === 2, JSON.stringify(exported.cad));

  const stepImport = await tools.tool_model3d_asset({
    action: 'import',
    sourcePath: byExt.step.path,
    name: 'blender-export-step',
  }, ctx);
  assert('S3_step_asset_import', stepImport.ok === true && stepImport.cad?.sourceFormat === 'step' && stepImport.cad?.derivedFormat === 'glb', JSON.stringify(stepImport).slice(0, 800));
  assert('S3_step_asset_node', stepImport.node?.type === 'mesh-reference' && stepImport.asset?.path.endsWith('.glb'), JSON.stringify(stepImport.node));
  assert('S3_step_asset_glb', fs.readFileSync(path.join(root, stepImport.asset.path)).subarray(0, 4).toString('ascii') === 'glTF', stepImport.asset.path);
  assert('S3_step_provenance', stepImport.provenance?.sourceFormat === 'step' && stepImport.provenance?.sourceSha256 === byExt.step.sha256, JSON.stringify(stepImport.provenance));

  const incoming = path.join(root, 'model3d', 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'model3d', 'iges-cube-10mm.igs'), path.join(incoming, 'legacy.igs'));
  const igesImport = await tools.tool_model3d_asset({
    action: 'import',
    sourcePath: 'model3d/incoming/legacy.igs',
    name: 'legacy-iges',
  }, ctx);
  assert('S4_iges_asset_import', igesImport.ok === true && igesImport.cad?.sourceFormat === 'iges' && igesImport.cad?.derivedFormat === 'stl', JSON.stringify(igesImport).slice(0, 800));
  assert('S4_iges_triangles', igesImport.cad?.triangleCount === 12, JSON.stringify(igesImport.cad));
  assert('S4_iges_asset_stl', fs.readFileSync(path.join(root, igesImport.asset.path)).subarray(0, 5).toString('ascii') === 'BLOCK', igesImport.asset.path);

  const stepSvg = await cad.stepToSvg({ bytes: fs.readFileSync(stepAbs) });
  assert('S5_step_svg', stepSvg.ok === true && stepSvg.svg.includes('<svg') && stepSvg.svg.length > 1000, JSON.stringify(stepSvg).slice(0, 500));
  const igesSvg = await cad.igesToSvg({ bytes: fs.readFileSync(path.join(root, 'model3d/incoming/legacy.igs')) });
  assert('S5_iges_svg', igesSvg.ok === true && igesSvg.svg.includes('<svg') && igesSvg.summary.solidCount === 1, JSON.stringify(igesSvg).slice(0, 500));

  const evidence = {
    schema: 'block322-ruling01-cad-live/v1',
    generatedAt: new Date().toISOString(),
    provider: (await blender.probeBlender()).version,
    assertions,
    passed: assertions.every((entry) => entry.pass),
    kernel: probe,
    export: {
      outDir: exported.outDir,
      outputs: exported.outputs,
      cad: exported.cad,
      manifest: exported.manifest,
      resultStudio: exported.resultStudio || null,
    },
    stepAsset: { asset: stepImport.asset, node: stepImport.node, provenance: stepImport.provenance, cad: stepImport.cad },
    igesAsset: { asset: igesImport.asset, node: igesImport.node, provenance: igesImport.provenance, cad: igesImport.cad },
    drawings: { step: stepSvg.summary, iges: igesSvg.summary },
  };
  fs.writeFileSync(path.join(EVIDENCE, 'block322-ruling01-cad-live.json'), JSON.stringify(evidence, null, 2));
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  console.log(`evidence: ${path.relative(ROOT, path.join(EVIDENCE, 'block322-ruling01-cad-live.json'))}`);
  if (!evidence.passed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
