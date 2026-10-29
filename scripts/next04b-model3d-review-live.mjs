#!/usr/bin/env node
/**
 * NEXT-04B 直连实机证据：真实 Blender 四视图渲染 + vision 管线 + 无视觉降级。
 *
 * 视觉用本地 mock OpenAI-compatible 端点验证「渲染→图片编码→网关→结构化解析」链路；
 * mock 标签如实写入证据（visionProvider=mock-openai-compatible），不冒充真实模型质量。
 * 降级场景移除凭据，断言渲染/网格事实仍完整且 vision 明确 unavailable。
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'next-04b-3d-vision-loop');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'next04b-data-'));
const WORKSPACE = path.join(EVIDENCE_DIR, 'live-workspace');
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'next04b-review-live.json');

process.env.PETRI_LOCAL_DATA_DIR = DATA_DIR;
process.env.PETRI_DB_PATH = path.join(DATA_DIR, 'petri.db');

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 600) });
  if (!pass) console.error(`FAIL ${id}: ${detail}`);
  else console.log(`PASS ${id}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function sceneSpec() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 40, depth: 80, wall: 2 },
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
        dimensions: { radius: 6, height: 8 },
        material: { color: '#d29b42', roughness: 0.5 },
      },
    ],
    constraints: [],
    metadata: { title: 'NEXT-04B 视觉回读场景' },
  };
}

function startMockVision() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      if (!req.url.includes('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* keep empty */ }
      const content = parsed && Array.isArray(parsed.messages)
        ? parsed.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        : [];
      const texts = content.filter((part) => part && part.type === 'text').map((part) => String(part.text || '')).join('');
      const isSketch = texts.includes('task-spec/v1');
      requests.push({
        model: parsed.model || null,
        kind: isSketch ? 'sketch' : 'qa',
        imageParts: content.filter((part) => part && part.type === 'image_url').length,
        textChars: texts.length,
      });
      if (isSketch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'mock-sketch-1',
          object: 'chat.completion',
          model: parsed.model || 'mock-vl',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                optimizedPrompt: '设计一个 120×80×40mm 的 ABS 外壳，正面开 USB 口。',
                taskSpec: {
                  version: 'task-spec/v1',
                  taskType: 'modeling',
                  goal: '设计带 USB 口的 ABS 外壳',
                  deliverables: ['scene3d/v1 SceneSpec', 'GLB 导出'],
                  constraints: ['宽度 120mm', '深度 80mm', '高度 40mm'],
                  assumptions: ['材料为 ABS'],
                  acceptance: ['USB 口与外壳相交且可导出'],
                  missingInfo: ['壁厚未给出', 'USB 口精确半径未给出'],
                },
                changeSummary: [],
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 96, completion_tokens: 64, total_tokens: 160 },
        }));
        return;
      }
      const report = {
        views: [
          { view: 'front', observations: ['外壳正面完整，开孔可见'], suspectedIssues: [], uncertain: [] },
          { view: 'top', observations: ['顶部平面无缺口'], suspectedIssues: [], uncertain: [] },
          { view: 'side', observations: ['侧面厚度均匀'], suspectedIssues: [], uncertain: [] },
          { view: 'iso', observations: ['端口与外壳相交'], suspectedIssues: ['端口边缘可能需要倒角'], uncertain: ['无法从渲染确认精确半径'] },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-vision-1',
        object: 'chat.completion',
        model: parsed.model || 'mock-vl',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(report) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 128, completion_tokens: 96, total_tokens: 224 },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

function writeVisionSettings(port) {
  writeJson(path.join(DATA_DIR, 'ai-settings.json'), {
    model_profiles: [
      {
        id: 'mock-vision',
        label: 'Mock Vision',
        provider: 'openai-compatible',
        protocol: 'openai-compatible',
        model: 'mock-vl',
        baseUrl: `http://127.0.0.1:${port}`,
        credentialRef: 'provider:mockvision',
        capabilities: ['vision'],
        roles: ['vision'],
      },
    ],
    model_role_bindings: { vision: 'mock-vision' },
    active_chat_model_id: 'mock-vision',
  });
  writeJson(path.join(DATA_DIR, 'ai-credentials.json'), { mockvision: 'test-key' });
}

function writeDegradedSettings(port) {
  writeJson(path.join(DATA_DIR, 'ai-settings.json'), {
    model_profiles: [
      {
        id: 'chat-only',
        label: 'Chat Only',
        provider: 'openai-compatible',
        protocol: 'openai-compatible',
        model: 'mock-chat',
        baseUrl: `http://127.0.0.1:${port}`,
        credentialRef: 'provider:mockvision',
        capabilities: ['chat', 'streaming', 'tools'],
        roles: ['chat'],
      },
    ],
    model_role_bindings: { chat: 'chat-only' },
    active_chat_model_id: 'chat-only',
  });
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

async function main() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });

  const mock = await startMockVision();
  writeVisionSettings(mock.port);
  migrateDatabase();

  const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const { runModel3DReview } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-review.js'));
  const { sketchToTaskSpec } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'model3d-sketch.js'));
  const blender = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'blender-provider.js'));

  const capability = await blender.probeBlender();
  assert('B0_blender_ready', capability.status === 'ready', `${capability.status} ${capability.version || capability.reason}`);

  const project = db.createProject({
    name: `NEXT-04B-${Date.now()}`,
    workspacePath: path.join(WORKSPACE, 'project'),
  });
  const projectAgain = db.createProject({
    name: `NEXT-04B-DEGRADED-${Date.now()}`,
    workspacePath: path.join(WORKSPACE, 'project-degraded'),
  });

  const scene = sceneSpec();
  const visionRun = await runModel3DReview({
    scene,
    workspaceRoot: projectAgain.workspace_path,
    userId: 'local-user',
    views: ['front', 'top', 'side', 'iso'],
  });
  assert('V1_review_ok', visionRun.ok === true, JSON.stringify(visionRun).slice(0, 400));
  assert('V2_four_renders', visionRun.ok && Object.keys(visionRun.render.report.renders || {}).length === 4,
    JSON.stringify(visionRun.render?.report?.renders || {}));
  assert('V3_mesh_watertight', visionRun.ok && visionRun.render.report.mesh?.watertight === true,
    JSON.stringify(visionRun.render?.report?.mesh || {}).slice(0, 300));
  assert('V4_vision_ready', visionRun.ok && visionRun.vision.status === 'ready', JSON.stringify(visionRun.vision || {}).slice(0, 400));
  assert('V5_vision_structured', visionRun.ok && visionRun.vision.parseStatus === 'structured',
    JSON.stringify(visionRun.vision || {}).slice(0, 400));
  assert('V6_vision_images_sent', mock.requests.length === 1 && mock.requests[0].imageParts === 4,
    JSON.stringify(mock.requests));
  assert('V7_vision_issue_surfaced', visionRun.ok && (visionRun.vision.views || []).some((view) => view.suspectedIssues.length > 0),
    JSON.stringify(visionRun.vision?.views || []).slice(0, 400));
  assert('V8_no_absolute_paths', visionRun.ok && !JSON.stringify(visionRun).includes(projectAgain.workspace_path),
    'review payload must expose only workspace-relative paths');
  const renderFiles = visionRun.ok ? Object.values(visionRun.render.report.renders || {}) : [];
  assert('V9_render_files_exist', renderFiles.every((relative) => fs.existsSync(path.join(projectAgain.workspace_path, relative))),
    JSON.stringify(renderFiles));

  const sketch = await sketchToTaskSpec({
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    dimensions: '120 × 80 × 40 mm',
    notes: 'ABS 外壳，正面开 USB 口',
    userId: 'local-user',
  });
  assert('S1_sketch_task_spec_ok', sketch.ok === true, JSON.stringify(sketch).slice(0, 400));
  assert('S2_sketch_task_type_modeling', sketch.ok && sketch.taskSpec.taskType === 'modeling',
    JSON.stringify(sketch.taskSpec || {}).slice(0, 300));
  assert('S3_sketch_missing_info_honest', sketch.ok && sketch.taskSpec.missingInfo.some((item) => item.includes('壁厚')),
    JSON.stringify(sketch.taskSpec?.missingInfo || []));
  assert('S4_sketch_prompt_forbids_invention', mock.requests.some((request) => request.kind === 'sketch'), JSON.stringify(mock.requests));

  // 降级：移除视觉配置并停掉 mock 端点——渲染/网格事实仍须完整，vision 明确 unavailable。
  await new Promise((resolve) => mock.server.close(resolve));
  writeDegradedSettings(mock.port);
  const degradedRun = await runModel3DReview({
    scene,
    workspaceRoot: project.workspace_path,
    userId: 'local-user',
    views: ['front', 'top', 'side', 'iso'],
  });
  assert('D1_render_still_ok', degradedRun.ok === true, JSON.stringify(degradedRun).slice(0, 400));
  assert('D2_renders_complete', degradedRun.ok && Object.keys(degradedRun.render.report.renders || {}).length === 4,
    JSON.stringify(degradedRun.render?.report?.renders || {}));
  assert('D3_vision_unavailable', degradedRun.ok && degradedRun.vision.status === 'unavailable',
    JSON.stringify(degradedRun.vision || {}).slice(0, 400));
  assert('D4_degrade_reason_honest', degradedRun.ok && Boolean(degradedRun.vision.reason),
    JSON.stringify(degradedRun.vision || {}).slice(0, 400));

  const evidence = {
    schema: 'next04b-evidence/v1',
    generatedAt: new Date().toISOString(),
    worktree: ROOT,
    provider: { name: 'blender', version: capability.version },
    visionProvider: 'mock-openai-compatible',
    mockVisionRequests: mock.requests,
    scenarioVision: visionRun.ok ? {
      ok: true,
      sceneHash: visionRun.sceneHash,
      renderOutDir: visionRun.render.outDir,
      renders: visionRun.render.report.renders,
      mesh: visionRun.render.report.mesh,
      vision: {
        status: visionRun.vision.status,
        parseStatus: visionRun.vision.parseStatus,
        model: visionRun.vision.model,
        views: visionRun.vision.views,
      },
      project: projectAgain.workspace_path,
    } : visionRun,
    scenarioDegraded: degradedRun.ok ? {
      ok: true,
      sceneHash: degradedRun.sceneHash,
      renderOutDir: degradedRun.render.outDir,
      renders: degradedRun.render.report.renders,
      mesh: degradedRun.render.report.mesh,
      vision: degradedRun.vision,
      project: project.workspace_path,
    } : degradedRun,
    scenarioSketch: sketch.ok ? {
      ok: true,
      model: sketch.model,
      optimizedPrompt: sketch.optimizedPrompt,
      taskSpec: sketch.taskSpec,
      changeSummary: sketch.changeSummary,
    } : sketch,
    assertions,
    passed: assertions.every((entry) => entry.pass),
  };
  writeJson(EVIDENCE_FILE, evidence);

  console.log(`\nNEXT-04B evidence: ${path.relative(ROOT, EVIDENCE_FILE)}`);
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  if (!evidence.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
