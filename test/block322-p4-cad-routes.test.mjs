import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { OcctKernel } from 'occt-wasm';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b322-cad-routes-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');
{
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  boot.close();
}

const registerModel3DRoutes = require('../core/petri-server/routes/model3d.js');
const db = require('../core/petri-server/db.js');

function captureRoutes() {
  const routes = new Map();
  registerModel3DRoutes({
    get: (routePath, handler) => routes.set(`GET ${routePath}`, handler),
    post: (routePath, handler) => routes.set(`POST ${routePath}`, handler),
  });
  return routes;
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function sampleStep() {
  const kernel = await OcctKernel.init();
  try {
    return kernel.exportStep(kernel.makeBox(10, 20, 30));
  } finally {
    kernel[Symbol.dispose]();
  }
}

test('BLOCK-322 P4-04a/P4-05 REST — capability 暴露 CAD 内核，STEP 导入与工程图路由可用', async () => {
  const routes = captureRoutes();
  const capabilityHandler = routes.get('GET /api/model3d/capability');
  assert.equal(typeof capabilityHandler, 'function');
  const capabilityRes = mockResponse();
  await capabilityHandler({}, capabilityRes);
  assert.equal(capabilityRes.statusCode, 200);
  assert.equal(capabilityRes.body.cad.status, 'ready');
  assert.equal(capabilityRes.body.cad.formats.stepImport, true);
  assert.equal(capabilityRes.body.cad.formats.igesExport, false);

  const workspace = path.join(tmpDir, 'workspace');
  fs.mkdirSync(path.join(workspace, 'model3d', 'incoming'), { recursive: true });
  const project = db.createProject({ name: 'cad-routes', workspacePath: workspace });
  const userId = project.owner_id || project.user_id || 'local-user';
  fs.writeFileSync(path.join(workspace, 'model3d', 'incoming', 'part.step'), await sampleStep());

  const importRes = mockResponse();
  await routes.get('POST /api/model3d/asset/import-cad')({
    userId,
    body: { projectId: project.id, path: 'model3d/incoming/part.step', name: 'part.step' },
  }, importRes);
  assert.equal(importRes.statusCode, 200, JSON.stringify(importRes.body));
  assert.equal(importRes.body.ok, true);
  assert.equal(importRes.body.cad.sourceFormat, 'step');
  assert.equal(importRes.body.cad.derivedFormat, 'glb');
  assert.equal(importRes.body.node.type, 'mesh-reference');
  assert.equal(fs.readFileSync(path.join(workspace, importRes.body.asset.path)).subarray(0, 4).toString('ascii'), 'glTF');

  const drawingRes = mockResponse();
  await routes.get('POST /api/model3d/cad/drawing')({
    userId,
    body: { projectId: project.id, path: 'model3d/incoming/part.step', views: ['front', 'top'] },
  }, drawingRes);
  assert.equal(drawingRes.statusCode, 200, JSON.stringify(drawingRes.body));
  assert.equal(drawingRes.body.ok, true);
  assert.match(fs.readFileSync(path.join(workspace, drawingRes.body.svgPath), 'utf8'), /<svg/);
  assert.equal(drawingRes.body.capabilities.hiddenLineRemoval, true);
  assert.equal(drawingRes.body.capabilities.dimensions, false);
  assert.equal(drawingRes.body.capabilities.gdt, false);
  assert.match(drawingRes.body.svgUrl, /^\/api\/workspaces\/.+\/file\?path=/);

  const invalidRes = mockResponse();
  await routes.get('POST /api/model3d/cad/drawing')({
    userId,
    body: { projectId: project.id, path: 'model3d/incoming/none.step' },
  }, invalidRes);
  assert.equal(invalidRes.statusCode, 404);
  assert.equal(invalidRes.body.error, 'cad_source_not_found');
});
