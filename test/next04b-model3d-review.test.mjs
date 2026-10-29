import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

// model3d-review → vision-image-io → db 在模块加载期 prepare 语句，需先自举临时库。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b-next04b-'));
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

const { parseVisionReport, runModel3DReview } = require('../core/petri-server/helpers/model3d-review.js');
const { validateSketchImage, buildSketchPrompt, sketchToTaskSpec } = require('../core/petri-server/helpers/model3d-sketch.js');
const registerModel3DRoutes = require('../core/petri-server/routes/model3d.js');
const db = require('../core/petri-server/db.js');

function captureRoutes() {
  const routes = new Map();
  registerModel3DRoutes({
    get: (routePath, handler) => routes.set(routePath, handler),
    post: (routePath, handler) => routes.set(routePath, handler),
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

test('NEXT-04B vision report — 结构化 JSON（含围栏）按视图归一', () => {
  const raw = [
    '```json',
    JSON.stringify({
      views: [
        { view: 'iso', observations: ['外壳完整'], suspectedIssues: ['端口边缘偏薄'], uncertain: [] },
        { view: 'front', observations: ['正面开孔可见'], suspectedIssues: [], uncertain: ['无法确认倒角'] },
        { view: 'unexpected', observations: ['忽略我'] },
      ],
    }),
    '```',
  ].join('\n');
  const parsed = parseVisionReport(raw, ['front', 'top', 'side', 'iso']);
  assert.equal(parsed.parseStatus, 'structured');
  assert.deepEqual(parsed.views.map((row) => row.view), ['front', 'top', 'side', 'iso']);
  assert.deepEqual(parsed.views[0].observations, ['正面开孔可见']);
  assert.deepEqual(parsed.views[1].observations, []);
  assert.deepEqual(parsed.views[3].suspectedIssues, ['端口边缘偏薄']);
});

test('NEXT-04B vision report — 非结构化文本如实降级，不伪造视图结论', () => {
  const parsed = parseVisionReport('看起来是一个带端口的盒子，但无法确认尺寸。', ['front', 'iso']);
  assert.equal(parsed.parseStatus, 'unstructured');
  assert.equal(parsed.views[0].observations[0], '看起来是一个带端口的盒子，但无法确认尺寸。');
  assert.deepEqual(parsed.views[1].observations, []);
  assert.match(parsed.views[1].uncertain[0], /未返回结构化 JSON/);
  assert.equal(parsed.rawText.length > 0, true);
});

test('NEXT-04B vision report — 数组长度裁剪到 12 条', () => {
  const many = Array.from({ length: 20 }, (_value, index) => `观察 ${index}`);
  const parsed = parseVisionReport(JSON.stringify({ views: [{ view: 'front', observations: many }] }), ['front']);
  assert.equal(parsed.views[0].observations.length, 12);
});

test('NEXT-04B review — 无工作区/非法 SceneSpec fail-closed，不触碰 Blender', async () => {
  const missingWorkspace = await runModel3DReview({ scene: { version: 'scene3d/v1' } });
  assert.deepEqual(missingWorkspace, { ok: false, error: 'project_required' });
  const invalidScene = await runModel3DReview({ scene: { version: 'scene3d/v1' }, workspaceRoot: process.cwd() });
  assert.equal(invalidScene.ok, false);
  assert.equal(Array.isArray(invalidScene.errors), true);
});

test('NEXT-04B REST — 未认证/缺项目/非法视图 fail-closed', async () => {
  const handler = captureRoutes().get('/api/model3d/review');
  assert.equal(typeof handler, 'function');

  const anonymous = mockResponse();
  await handler({ body: { projectId: 'p_any' } }, anonymous);
  assert.equal(anonymous.statusCode, 401);

  const missingProject = mockResponse();
  await handler({ user: { id: 'u_1', role: 'admin' }, body: {} }, missingProject);
  assert.equal(missingProject.statusCode, 400);
  assert.equal(missingProject.body.error, 'project_required');

  const project = db.createProject({
    name: 'next04b-review-route',
    workspacePath: path.join(tmpDir, 'workspace'),
  });
  const badViews = mockResponse();
  await handler({
    user: { id: 'u_1', role: 'admin' },
    body: { projectId: project.id, scene: { version: 'scene3d/v1' }, views: ['bogus'] },
  }, badViews);
  assert.equal(badViews.statusCode, 400);
  assert.equal(badViews.body.error, 'invalid_views');
});

test('NEXT-04B 草图 — 图片格式/体积 fail-closed，prompt 强制缺失信息', () => {
  assert.equal(validateSketchImage('').error, 'image_required');
  assert.equal(validateSketchImage('data:image/svg+xml;base64,AAAA').error, 'image_invalid');
  assert.equal(validateSketchImage(`data:image/png;base64,${'A'.repeat(13 * 1024 * 1024)}`).error, 'image_too_large');
  const tiny = validateSketchImage('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(tiny.ok, true);
  const prompt = buildSketchPrompt('120 × 80 × 40 mm', 'ABS 外壳');
  expectPromptHasMissingInfoRule(prompt);
  assert.equal(prompt.includes('120 × 80 × 40 mm'), true);
  assert.equal(buildSketchPrompt('', '').includes('用户未提供任何尺寸'), true);
});

function expectPromptHasMissingInfoRule(prompt) {
  assert.equal(prompt.includes('missingInfo'), true);
  assert.equal(prompt.includes('禁止补造精确数值'), true);
  assert.equal(prompt.includes('taskType 必须是 "modeling"'), true);
}

test('NEXT-04B 草图 — 无图片不调用模型，直接 fail-closed', async () => {
  const result = await sketchToTaskSpec({ imageDataUrl: '', dimensions: '', notes: '', userId: 'u_1' });
  assert.deepEqual(result, { ok: false, error: 'image_required' });
});
