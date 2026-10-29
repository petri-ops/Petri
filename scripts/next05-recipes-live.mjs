#!/usr/bin/env node
/**
 * NEXT-05 直连实机证据：五类 recipe dryRun→execute→render→export→manifest，
 * STL mesh-reference 有界导入（hash 校验/篡改拒绝），以及 recipe-build workflow。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-05-3d-process');
const WORKSPACE = path.join(EVIDENCE_DIR, 'live-workspace');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'next05-data-'));
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'next05-recipes-live.json');
process.env.PETRI_LOCAL_DATA_DIR = DATA_DIR;
process.env.PETRI_DB_PATH = path.join(DATA_DIR, 'petri.db');

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 700) });
  if (pass) console.log(`PASS ${id}`);
  else console.error(`FAIL ${id}: ${detail}`);
}

function migrateDatabase() {
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const db = new Database(process.env.PETRI_DB_PATH);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
}

function cubeStl(size = 10) {
  const v = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const lines = ['solid cube'];
  for (const [a, b, c] of faces) {
    lines.push('facet normal 0 0 0', 'outer loop');
    for (const index of [a, b, c]) lines.push(`vertex ${v[index].join(' ')}`);
    lines.push('endloop', 'endfacet');
  }
  lines.push('endsolid cube');
  return `${lines.join('\n')}\n`;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const RECIPES = [
  ['box-enclosure', { width: 120, height: 40, depth: 80, portRadius: 6, portLength: 8 }],
  ['bracket', { width: 80, depth: 50, thickness: 6, plateHeight: 60, bossRadius: 5 }],
  ['room-layout', { roomWidth: 4000, roomDepth: 3000, wallHeight: 2800, wallThickness: 100 }],
  ['experiment-rig', { platformWidth: 600, platformDepth: 400, platformHeight: 20, containerRadius: 60, containerHeight: 120, sensorCount: 3 }],
  ['from-table', { rows: [
    { width: 40, depth: 30, height: 20, x: 0, y: 0, label: 'sample-a' },
    { width: 40, depth: 30, height: 20, x: 60, y: 0, label: 'sample-b' },
    { width: 40, depth: 30, height: 20, x: 120, y: 0, label: 'sample-c' },
  ] }],
];

async function main() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  migrateDatabase();
  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const { runModel3DRecipe } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-recipe-runner.js'));
  const blender = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'blender-provider.js'));
  const runner = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workflow-runner.js'));
  const project = db.createProject({ name: `NEXT-05-${Date.now()}`, workspacePath: path.join(WORKSPACE, 'project') });
  const root = project.workspace_path;

  assert('B0_blender_ready', (await blender.probeBlender()).status === 'ready', 'Blender probe');

  const recipeResults = [];
  for (const [recipeId, params] of RECIPES) {
    const relativePath = `model3d/recipes/${recipeId}.scene3d.json`;
    const before = fs.existsSync(path.join(root, relativePath));
    const dryRun = await runModel3DRecipe({ recipeId, params, dryRun: true });
    assert(`R_${recipeId}_dryRun_ok`, dryRun.ok === true && dryRun.dryRun === true, JSON.stringify(dryRun).slice(0, 400));
    assert(`R_${recipeId}_dryRun_no_write`, before === false && fs.existsSync(path.join(root, relativePath)) === false, relativePath);
    const executed = await runModel3DRecipe({
      recipeId,
      params,
      workspaceRoot: root,
      relativePath,
      dryRun: false,
      render: true,
      formats: ['glb', 'stl', 'obj'],
    });
    assert(`R_${recipeId}_execute_ok`, executed.ok === true && executed.dryRun === false, JSON.stringify(executed).slice(0, 500));
    const render = executed.render || {};
    assert(`R_${recipeId}_four_views`, render.report && Object.keys(render.report.renders || {}).length === 4,
      JSON.stringify(render.report?.renders || {}));
    assert(`R_${recipeId}_three_exports`, render.report && Object.keys(render.report.exports || {}).length === 3,
      JSON.stringify(render.report?.exports || {}));
    assert(`R_${recipeId}_watertight`, render.report?.mesh?.watertight === true && render.report?.mesh?.nonManifoldEdges === 0,
      JSON.stringify(render.report?.mesh || {}));
    assert(`R_${recipeId}_manifest`, Boolean(render.manifest) && fs.existsSync(path.join(root, render.manifest)), render.manifest);
    recipeResults.push({
      recipeId,
      hash: executed.hash,
      path: executed.written?.path,
      outputs: render.outputs,
      manifest: render.manifest,
      mesh: render.report?.mesh,
      taskSpec: executed.taskSpec,
      missingInfo: executed.missingInfo,
    });
  }

  // mesh-reference 导入：hash 校验通过时可构建/导出；篡改 hash 必须拒绝。
  const meshDir = path.join(root, 'meshes');
  fs.mkdirSync(meshDir, { recursive: true });
  const stlPath = path.join(meshDir, 'cube.stl');
  fs.writeFileSync(stlPath, cubeStl(10));
  const stlHash = sha256File(stlPath);
  const importScene = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [
      { id: 'base', type: 'box', transform: { position: [0, 0, 0] }, dimensions: { width: 10, height: 10, depth: 10 }, material: { color: '#4c78a8' } },
      { id: 'imported', type: 'mesh-reference', transform: { position: [30, 0, 0], rotation: [0, 0, 0] }, source: { path: 'meshes/cube.stl', sourceSha256: stlHash } },
    ],
    constraints: [],
    metadata: { title: 'NEXT-05 mesh import' },
  };
  const imported = await blender.runBlenderScene({ scene: importScene, workspaceRoot: root, views: ['front', 'iso'], formats: ['glb'] });
  assert('M1_mesh_import_ok', imported.ok === true, JSON.stringify(imported).slice(0, 500));
  assert('M2_mesh_objects', imported.report?.mesh?.objects === 2, JSON.stringify(imported.report?.mesh || {}));
  assert('M3_mesh_import_manifest', Object.keys(imported.report?.exports || {}).length === 1, JSON.stringify(imported.report?.exports || {}));
  const tampered = JSON.parse(JSON.stringify(importScene));
  tampered.nodes[1].source.sourceSha256 = '0'.repeat(64);
  const rejected = await blender.runBlenderScene({ scene: tampered, workspaceRoot: root, views: [], formats: [] });
  assert('M4_mesh_hash_mismatch_rejected', rejected.ok === false && JSON.stringify(rejected.report?.unsupported || []).includes('mesh_source_hash_mismatch'),
    JSON.stringify(rejected.report?.unsupported || rejected).slice(0, 500));

  // workflow：recipe-build 经 host.recipe 走同一 runner（dryRun→execute）。
  const source = fs.readFileSync(path.join(ROOT, 'resources', 'model3d', 'workflows', 'recipe-build.js'), 'utf8');
  const calls = [];
  const workflow = runner.startWorkflowRun({
    source,
    args: { projectId: project.id, recipeId: 'bracket', params: RECIPES[1][1], formats: ['glb'] },
    userId: 'local-user',
    deps: {
      recipe: async (payload) => {
        calls.push(payload);
        return runModel3DRecipe({
          recipeId: payload.recipeId,
          params: payload.params,
          workspaceRoot: root,
          relativePath: 'model3d/recipes/workflow-bracket.scene3d.json',
          dryRun: payload.dryRun,
          render: payload.render,
          views: payload.views,
          formats: payload.formats,
          projectId: payload.projectId,
        });
      },
    },
    root: path.join(EVIDENCE_DIR, 'workflow-runs'),
  });
  const wfResult = await workflow.promise;
  assert('W1_workflow_completed', wfResult.status === 'completed', JSON.stringify(wfResult).slice(0, 600));
  assert('W2_workflow_dryRun_then_execute', calls.length === 2 && calls[0].dryRun !== false && calls[1].dryRun === false,
    JSON.stringify(calls.map((call) => ({ dryRun: call.dryRun }))));
  assert('W3_workflow_manifest', Boolean(wfResult.returned?.manifest) && fs.existsSync(path.join(root, wfResult.returned.manifest)),
    JSON.stringify(wfResult.returned || {}).slice(0, 500));

  // 取消/恢复：recipe phase 结果进 resume 前缀（dryRun 复用，execute 重跑）。
  const reserveSource = `
export const meta = { name: 'recipe-resume-live', version: 1, budget: { maxAgents: 1, maxSteps: 6, timeoutMs: 60000 }, concurrency: 1 };
export default async function run(ctx) {
  const dry = await phase('dryRun', async () => recipe(ctx.recipeId, ctx.params, { dryRun: true }));
  const executed = await phase('execute', async () => {
    const outcome = await recipe(ctx.recipeId, ctx.params, { dryRun: false, projectId: ctx.projectId });
    if (budget.cancelled) throw new Error('workflow_cancelled');
    return outcome;
  });
  return { dry: dry && dry.ok, exec: executed && executed.ok };
}
`;
  let executeStarted;
  const started = new Promise((resolve) => { executeStarted = resolve; });
  const wfRoot = path.join(EVIDENCE_DIR, 'workflow-runs');
  const first = runner.startWorkflowRun({
    source: reserveSource,
    args: { projectId: project.id, recipeId: 'box-enclosure' },
    userId: 'local-user',
    root: wfRoot,
    deps: {
      recipe: async (payload) => {
        if (payload.dryRun !== false) return { ok: true, recipe: { id: 'box-enclosure', version: 1 } };
        executeStarted();
        return new Promise((resolve) => {
          payload.signal.addEventListener('abort', () => resolve({ ok: false, error: 'recipe_cancelled' }), { once: true });
        });
      },
    },
  });
  await started;
  await first.cancel();
  const cancelled = await first.promise;
  assert('W4_cancel_status', cancelled.status === 'cancelled', JSON.stringify(cancelled));
  const resumedCalls = [];
  const second = runner.startWorkflowRun({
    source: reserveSource,
    args: { projectId: project.id, recipeId: 'box-enclosure' },
    userId: 'local-user',
    root: wfRoot,
    resumeFromRunId: first.runId,
    deps: {
      recipe: async (payload) => {
        resumedCalls.push(payload.dryRun);
        return { ok: true, recipe: { id: 'box-enclosure', version: 1 } };
      },
    },
  });
  const resumed = await second.promise;
  assert('W5_resume_completed', resumed.status === 'completed', JSON.stringify(resumed));
  assert('W6_resume_prefix_reused', JSON.stringify(resumedCalls) === '[false]', JSON.stringify(resumedCalls));

  const evidence = {
    schema: 'next05-evidence/v1',
    generatedAt: new Date().toISOString(),
    provider: (await blender.probeBlender()).version,
    recipes: recipeResults,
    meshImport: {
      source: 'meshes/cube.stl',
      sourceSha256: stlHash,
      objects: imported.report?.mesh?.objects,
      exports: imported.report?.exports,
      unsupportedRejected: rejected.report?.unsupported || rejected,
    },
    workflow: {
      runId: workflow.runId,
      status: wfResult.status,
      calls: calls.map((call) => ({ dryRun: call.dryRun, recipeId: call.recipeId })),
      returned: wfResult.returned,
    },
    workflowCancelResume: {
      cancelledRunId: first.runId,
      cancelledStatus: cancelled.status,
      resumedRunId: second.runId,
      resumedStatus: resumed.status,
      resumedCalls,
    },
    assertions,
    passed: assertions.every((entry) => entry.pass),
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  console.log(`\nNEXT-05 evidence: ${path.relative(ROOT, EVIDENCE_FILE)}`);
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  if (!evidence.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
