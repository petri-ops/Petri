#!/usr/bin/env node
/**
 * BLOCK-322 P4-01~P6-04 直连实机证据：BOM/公差、三视图线稿、资产入链/库、
 * FBX/USDZ 导出、几何差值、本地分享包。真实 Blender 4.5.10 LTS。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-322-p4');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'b322-p4-'));
process.env.PETRI_LOCAL_DATA_DIR = DATA;
process.env.PETRI_DB_PATH = path.join(DATA, 'petri.db');

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 800) });
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

function scene(width = 120, height = 80, depth = 40) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width, height, depth },
    nodes: [
      { id: 'base', type: 'box', dimensions: { width: 'width', height: 'depth', depth: 'height' }, material: { color: '#4c78a8', densityKgM3: 1000 }, label: '底座' },
      { id: 'block', type: 'box', transform: { position: [0, 0, 40] }, dimensions: { width: 20, height: 20, depth: 20 }, material: { color: '#d29b42', densityKgM3: 2700 }, label: '凸台' },
    ],
    constraints: [],
    metadata: {
      title: 'BLOCK-322 P4-P6 live',
      defaultDensityKgM3: 1000,
      tolerances: [{ nodeId: 'base', feature: 'width', nominal: 120, lower: -0.2, upper: 0.2, unit: 'mm' }],
    },
  };
}

async function main() {
  fs.rmSync(EVIDENCE, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  migrate();
  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const sceneStore = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-scene-store.js'));
  const { compareGeometryReports } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-geometry-compare.js'));
  const blender = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'blender-provider.js'));
  const tools = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'model3d-tools.js'));
  const project = db.createProject({ name: `B322-P4-${Date.now()}`, workspacePath: path.join(EVIDENCE, 'live-workspace') });
  const ctx = { projectId: project.id, userId: 'local-user' };
  const root = project.workspace_path;
  const scenePath = 'model3d/live.scene3d.json';
  const base = scene();
  const written = await sceneStore.writeScene({ workspaceRoot: root, relativePath: scenePath, scene: base, reason: 'p4_live' });
  assert('S0_scene_written', written.ok === true, JSON.stringify(written).slice(0, 300));

  const bom = await tools.tool_model3d_bom({ scene: base }, ctx);
  assert('P401_bom_ok', bom.ok === true, JSON.stringify(bom).slice(0, 400));
  assert('P401_bom_totals', bom.totals.totalVolumeMm3 === 392000 && bom.totals.totalMassG === 405.6, JSON.stringify(bom.totals));
  assert('P401_bom_tolerance', bom.rows.some((row) => row.id === 'base') && bom.markdown.includes('## 公差声明'), 'tolerance section');
  for (const file of bom.files) assert(`P401_bom_file_${file.name}`, fs.existsSync(path.join(root, file.path)) && shaFile(path.join(root, file.path)) === file.sha256, file.path);

  const lineart = await tools.tool_model3d_render({ scene: base, views: ['front', 'top', 'side'], lineart: true }, ctx);
  assert('P403_lineart_ok', lineart.ok === true && lineart.lineart?.views && Object.keys(lineart.lineart.views).length === 3, JSON.stringify(lineart.lineart || lineart).slice(0, 500));
  const lineHashes = Object.values(lineart.lineart.views).map((relative) => shaFile(path.join(root, relative)));
  assert('P403_lineart_distinct', new Set(lineHashes).size === 3, JSON.stringify(lineHashes));
  assert('P403_lineart_labels', lineart.lineart.labels.front === '前视图' && lineart.lineart.labels.side === '侧视图', JSON.stringify(lineart.lineart.labels));

  const exported = await tools.tool_model3d_export({ scene: base, scenePath, formats: ['glb', 'fbx', 'usdz'] }, ctx);
  assert('P601_export_ok', exported.ok === true, JSON.stringify(exported).slice(0, 500));
  const byExt = Object.fromEntries((exported.outputs || []).map((item) => [path.extname(item.path).slice(1), item]));
  assert('P601_outputs', Boolean(byExt.glb && byExt.fbx && byExt.usdz), JSON.stringify(Object.keys(byExt)));
  assert('P601_fbx_header', fs.readFileSync(path.join(root, byExt.fbx.path)).subarray(0, 18).toString().includes('Kaydara FBX Binary'), 'fbx binary header');
  assert('P601_usdz_zip', fs.readFileSync(path.join(root, byExt.usdz.path)).subarray(0, 2).toString() === 'PK', 'usdz zip header');

  const incomingDir = path.join(root, 'model3d', 'incoming');
  fs.mkdirSync(incomingDir, { recursive: true });
  const incoming = path.join(incomingDir, 'robot.glb');
  fs.writeFileSync(incoming, Buffer.from('glTF-block322-asset'));
  const imported = await tools.tool_model3d_asset({
    action: 'import',
    sourcePath: 'model3d/incoming/robot.glb',
    name: 'robot-arm',
    provenance: { model: 'mock-generator', promptHash: 'a'.repeat(64), parameters: { seed: 322 } },
  }, ctx);
  assert('P501_asset_import', imported.ok === true && imported.node.type === 'mesh-reference', JSON.stringify(imported).slice(0, 500));
  assert('P501_asset_sha_path', imported.asset.path === `model3d/assets/${imported.asset.sha256}.glb`, imported.asset.path);
  const listed = await tools.tool_model3d_asset({ action: 'list', query: 'robot' }, ctx);
  assert('P602_asset_list', listed.ok === true && listed.assets.length === 1, JSON.stringify(listed).slice(0, 300));
  const fetched = await tools.tool_model3d_asset({ action: 'get', assetId: imported.asset.id }, ctx);
  assert('P602_asset_get_same_sha', fetched.ok === true && fetched.asset.sha256 === imported.asset.sha256, JSON.stringify(fetched).slice(0, 300));

  const wide = scene(130);
  const scene3d = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'scene3d.js'));
  const reportA = await blender.runBlenderScene({ scene: scene3d.resolveSceneSpec(base).scene, workspaceRoot: root, views: [], formats: [] });
  const reportB = await blender.runBlenderScene({ scene: scene3d.resolveSceneSpec(wide).scene, workspaceRoot: root, views: [], formats: [] });
  const geometry = compareGeometryReports(reportA.report, reportB.report);
  assert('P603_geometry_compare', geometry.ok === true && geometry.before.totalVolumeMm3 === 392000 && geometry.after.totalVolumeMm3 === 424000, JSON.stringify(geometry).slice(0, 500));
  assert('P603_bounds_delta', geometry.deltas.boundsMm.x === 10, JSON.stringify(geometry.deltas.boundsMm));

  const share = await tools.tool_model3d_share({
    scenePath,
    manifestPath: exported.manifest,
    outputs: exported.outputs,
    name: 'block322-p4-live',
  }, ctx);
  assert('P604_share_ok', share.ok === true, JSON.stringify(share).slice(0, 500));
  assert('P604_share_zip', share.zip && fs.readFileSync(path.join(root, share.zip.path)).subarray(0, 2).toString() === 'PK', JSON.stringify(share.zip));
  assert('P604_share_checksums', share.bundle?.files?.length >= 3 && share.bundle.files.some((file) => file.path.endsWith('.glb')) && share.bundle.files.some((file) => file.path.endsWith('.usdz')) && share.bundleSha256.length === 64, JSON.stringify(share.bundle?.files || []));

  const evidence = {
    schema: 'block322-p4-p6-live/v1',
    generatedAt: new Date().toISOString(),
    provider: (await blender.probeBlender()).version,
    assertions,
    passed: assertions.every((entry) => entry.pass),
    bom: { totals: bom.totals, files: bom.files, toleranceSection: bom.markdown.includes('## 公差声明') },
    lineart: lineart.lineart,
    export: { outputs: exported.outputs, manifest: exported.manifest, resultStudio: exported.resultStudio || null },
    asset: { asset: imported.asset, provenance: imported.provenance, listed: listed.assets.length },
    geometry,
    share,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'block322-p4-p6-live.json'), JSON.stringify(evidence, null, 2));
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  console.log(`evidence: ${path.relative(ROOT, path.join(EVIDENCE, 'block322-p4-p6-live.json'))}`);
  if (!evidence.passed) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
