#!/usr/bin/env node
/**
 * NEXT-06 黄金路径 + 可复现/指标基线：
 * box-enclosure 120mm → 修订恢复点 → 130mm → 渲染 → GLB/STL/OBJ → manifest；
 * 同 SceneSpec/同 provider 重跑比较规范几何报告与 manifest；记录真实耗时。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-06-convergence');
const WORKSPACE = path.join(EVIDENCE_DIR, 'golden-workspace');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'next06-data-'));
process.env.PETRI_LOCAL_DATA_DIR = DATA_DIR;
process.env.PETRI_DB_PATH = path.join(DATA_DIR, 'petri.db');

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 700) });
  if (pass) console.log(`PASS ${id}`);
  else console.error(`FAIL ${id}: ${detail}`);
}

function migrate() {
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const db = new Database(process.env.PETRI_DB_PATH);
  const dir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  db.close();
}

async function main() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  migrate();
  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const { runModel3DRecipe } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-recipe-runner.js'));
  const sceneStore = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-scene-store.js'));
  const scene3d = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'scene3d.js'));
  const blender = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'blender-provider.js'));

  const project = db.createProject({ name: `NEXT-06-${Date.now()}`, workspacePath: path.join(WORKSPACE, 'project') });
  const root = project.workspace_path;
  const rel = 'model3d/enclosure.scene3d.json';

  const t0 = Date.now();
  const dry = await runModel3DRecipe({ recipeId: 'box-enclosure', params: { width: 120 }, dryRun: true });
  const dryMs = Date.now() - t0;
  assert('G1_dryRun_ok', dry.ok === true && dry.dryRun === true, JSON.stringify(dry).slice(0, 300));
  assert('G2_dryRun_no_write', fs.existsSync(path.join(root, rel)) === false, rel);

  const t1 = Date.now();
  const built = await runModel3DRecipe({
    recipeId: 'box-enclosure',
    params: { width: 120 },
    workspaceRoot: root,
    relativePath: rel,
    dryRun: false,
    render: true,
    formats: ['glb', 'stl', 'obj'],
  });
  const buildMs = Date.now() - t1;
  assert('G3_build_ok', built.ok === true && built.render?.report?.ok === true, JSON.stringify(built).slice(0, 400));
  assert('G4_manifest', fs.existsSync(path.join(root, built.render.manifest)), built.render.manifest);

  const beforeScene = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  const edit = await sceneStore.applyOperations({
    workspaceRoot: root,
    relativePath: rel,
    scene: beforeScene,
    operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
    reason: 'golden_path_120_to_130',
  });
  assert('G5_edit_130', edit.ok === true && edit.diff.parameters[0].after === 130, JSON.stringify(edit.diff).slice(0, 400));
  assert('G6_revision_recorded', Boolean(edit.revision?.revisionId), JSON.stringify(edit.revision));
  const afterScene = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  assert('G7_scene_persisted_130', afterScene.parameters.width === 130, JSON.stringify(afterScene.parameters));

  const resolved130 = scene3d.resolveSceneSpec(afterScene);
  assert('G7b_resolve_130', resolved130.ok === true, JSON.stringify(resolved130.errors || []));
  const t2 = Date.now();
  const render130 = await blender.runBlenderScene({
    scene: resolved130.scene,
    workspaceRoot: root,
    views: ['front', 'top', 'side', 'iso'],
    formats: ['glb', 'stl', 'obj'],
  });
  const renderMs = Date.now() - t2;
  assert('G8_render_130', render130.ok === true && Object.keys(render130.report.renders || {}).length === 4, JSON.stringify(render130.report?.renders || {}));
  const manifest130 = scene3d.buildExportManifest({
    sceneHash: scene3d.hashSceneSpec(afterScene),
    recipeId: 'box-enclosure',
    recipeVersion: 1,
    provider: 'blender',
    providerVersion: (await blender.probeBlender()).version,
    validation: {
      ok: render130.report?.ok === true,
      watertight: render130.report?.mesh?.watertight === true,
      nonManifoldEdges: render130.report?.mesh?.nonManifoldEdges,
    },
    outputs: render130.outputs,
  });
  const manifestPath = path.join(root, render130.outDir, 'manifest-golden.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest130, null, 2));
  assert('G9_manifest_130', fs.existsSync(manifestPath), path.relative(root, manifestPath));

  const rerun = await blender.runBlenderScene({
    scene: resolved130.scene,
    workspaceRoot: root,
    views: ['front', 'top', 'side', 'iso'],
    formats: ['glb', 'stl', 'obj'],
  });
  const canonical = (report) => JSON.stringify({ mesh: report?.mesh, boundsMm: report?.boundsMm, renderEngine: report?.renderEngine });
  assert('G10_reproducible_geometry', rerun.ok === true && canonical(render130.report) === canonical(rerun.report), 'mesh/bounds/renderEngine');
  const hashes = (result) => Object.fromEntries((result.outputs || []).map((item) => [path.basename(item.path), item.sha256]));
  const firstHashes = hashes(render130);
  const secondHashes = hashes(rerun);
  const binarySame = Object.keys(firstHashes).filter((key) => firstHashes[key] && secondHashes[key])
    .every((key) => firstHashes[key] === secondHashes[key]);
  assert('G11_manifest_scene_hash', manifest130.sceneHash === scene3d.hashSceneSpec(afterScene), manifest130.sceneHash);

  const revisions = await sceneStore.listRevisionsForProject({ workspaceRoot: root, relativePath: rel });
  const evidence = {
    schema: 'next06-golden-path/v1',
    generatedAt: new Date().toISOString(),
    project: root,
    scenePath: rel,
    sceneHash120: scene3d.hashSceneSpec(beforeScene),
    sceneHash130: scene3d.hashSceneSpec(afterScene),
    revision: edit.revision,
    revisions,
    outputs120: built.render.outputs,
    outputs130: render130.outputs,
    manifest130: path.relative(root, manifestPath),
    manifest: manifest130,
    metrics: {
      dryRunMs: dryMs,
      buildRenderExportMs: buildMs,
      rerenderMs: renderMs,
      firstPreviewAvailable: Object.keys(render130.report?.renders || {}).length > 0,
    },
    reproducibility: {
      geometrySame: canonical(render130.report) === canonical(rerun.report),
      binaryHashesSame: binarySame,
      firstHashes,
      secondHashes,
    },
    assertions,
    passed: assertions.every((entry) => entry.pass),
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'golden-path.json'), JSON.stringify(evidence, null, 2));
  console.log('\nNEXT-06 golden path: acceptance/next-06-convergence/golden-path.json');
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  if (!evidence.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
