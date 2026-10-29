import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'next04a-db-'));
process.env.PETRI_DB_PATH = path.join(temp, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(temp, 'data');
fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });

const { runMigrations } = require(path.join(ROOT, 'src', 'migration-runner.js'));
await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
const tools = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'model3d-tools.js'));
const scene3d = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'scene3d.js'));

const acceptanceDir = path.join(ROOT, 'acceptance', 'next-04a-3d-foundation');
fs.mkdirSync(acceptanceDir, { recursive: true });
const workspace = path.join(acceptanceDir, 'blender-live');
const project = db.createProject({ name: 'NEXT-04A Blender Live', workspacePath: workspace });
const scene = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  parameters: { width: 120, height: 40, depth: 80, wall: 2, portRadius: 6, portLength: 8 },
  nodes: [
    {
      id: 'enclosure',
      type: 'box',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      dimensions: { width: 'width', height: 'height', depth: 'depth' },
      material: { color: '#4c78a8', roughness: 0.65 },
    },
    {
      id: 'port',
      type: 'cylinder',
      transform: { position: [60, 0, 0], rotation: [0, 90, 0] },
      dimensions: { radius: 'portRadius', height: 'portLength' },
      material: { color: '#d29b42', roughness: 0.5 },
    },
  ],
  constraints: [],
  metadata: { title: 'NEXT-04A live enclosure' },
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });
};
const ctx = { projectId: project.id, userId: 'local-user' };

try {
  const validated = scene3d.validateSceneSpec(scene);
  check('scene_valid', validated.ok, JSON.stringify(validated).slice(0, 400));

  const applied = await tools.tool_model3d_apply({
    scene,
    path: 'model3d/live.scene3d.json',
    operations: [{ op: 'set_parameter', name: 'width', value: 130 }],
  }, ctx);
  check('apply_writes_scene', applied.ok === true && applied.afterHash !== applied.beforeHash, JSON.stringify(applied));
  const onDisk = JSON.parse(fs.readFileSync(path.join(workspace, 'model3d', 'live.scene3d.json'), 'utf8'));
  check('apply_parameter_persisted', onDisk.parameters.width === 130, onDisk.parameters.width);

  const inspected = await tools.tool_model3d_inspect({ scene: onDisk }, ctx);
  check('inspect_summary', inspected.ok === true && inspected.stats.nodes === 2, JSON.stringify(inspected).slice(0, 400));

  const rendered = await tools.tool_model3d_render({ scene: onDisk }, ctx);
  check('blender_render_ready', rendered.ok === true, JSON.stringify(rendered).slice(0, 700));
  check('four_views', rendered.ok === true && Object.keys(rendered.report?.renders || {}).length === 4,
    JSON.stringify(rendered.report?.renders || {}));
  check('mesh_report', rendered.report?.mesh?.objects === 2 && rendered.report?.mesh?.watertight === true,
    JSON.stringify(rendered.report?.mesh || {}));

  const exported = await tools.tool_model3d_export({
    scene: onDisk,
    formats: ['glb', 'stl', 'obj'],
    taskSpecId: 'next04a-live-task',
    workflowRunId: 'next04a-live-workflow',
    recipeId: 'modeling/box-enclosure',
    recipeVersion: 1,
  }, ctx);
  check('blender_export_ok', exported.ok === true, JSON.stringify(exported).slice(0, 700));
  const byExt = (ext) => (exported.outputs || []).find((entry) => entry.path.toLowerCase().endsWith(`.${ext}`));
  check('glb_exported', Boolean(byExt('glb')) && byExt('glb').bytes > 100, JSON.stringify(byExt('glb')));
  check('stl_exported', Boolean(byExt('stl')) && byExt('stl').bytes > 100, JSON.stringify(byExt('stl')));
  check('obj_exported', Boolean(byExt('obj')) && byExt('obj').bytes > 100, JSON.stringify(byExt('obj')));
  const manifestPath = path.join(workspace, exported.manifest || '');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  check('manifest_written', Boolean(manifest) && manifest.schema === 'model3d-manifest/v1', exported.manifest);
  check('manifest_scene_hash', manifest?.sceneHash === scene3d.hashSceneSpec(onDisk), manifest?.sceneHash);
  check('manifest_provider_version', String(manifest?.providerVersion || '').includes('4.5'), manifest?.providerVersion);
  check('manifest_output_hashes', (manifest?.outputs || []).length >= 3 && (manifest.outputs || []).every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
    JSON.stringify(manifest?.outputs || []).slice(0, 500));
} catch (error) {
  check('unexpected_exception', false, error && error.stack ? error.stack : String(error));
} finally {
  const payload = {
    name: 'next04a-blender-live',
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    workspace: path.relative(ROOT, workspace).replace(/\\/g, '/'),
    checks,
    allPass: checks.length > 0 && checks.every((entry) => entry.pass),
  };
  fs.writeFileSync(path.join(acceptanceDir, 'blender-live.json'), JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify(payload, null, 2));
  try { db.getDatabase().close(); } catch { /* ignore */ }
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* Windows handle delay */ }
  process.exit(payload.allPass ? 0 : 1);
}
