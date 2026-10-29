import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'next03-task-spec-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
const spec = require('../core/petri-server/helpers/task-spec.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows handle delay */ }
});

test('NEXT-03 task-spec — 解析围栏 JSON 并归一 task-spec/v1', () => {
  const parsed = spec.parseTaskSpecResponse(`说明\n\`\`\`json
  {
    "optimizedPrompt": "请生成外壳",
    "taskSpec": {
      "goal": "生成外壳",
      "deliverables": ["SceneSpec", "GLB"],
      "constraints": ["壁厚 2mm"],
      "assumptions": ["比例来自草图"],
      "acceptance": ["尺寸可校验"],
      "missingInfo": ["材料"],
      "taskType": "modeling"
    },
    "changeSummary": ["补充验收"],
    "contextUsed": ["ignored:model-value"]
  }
\`\`\``);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.taskSpec.version, 'task-spec/v1');
  assert.equal(parsed.value.taskSpec.taskType, 'modeling');
  assert.deepEqual(parsed.value.taskSpec.deliverables, ['SceneSpec', 'GLB']);
  assert.deepEqual(parsed.value.contextUsed, [], 'contextUsed 只由服务端事实生成');
});

test('NEXT-03 task-spec — 非法/缺字段 fail-closed，数组有界', () => {
  assert.equal(spec.parseTaskSpecResponse('not json').ok, false);
  assert.equal(spec.parseTaskSpecResponse('{"taskSpec":{}}').error, 'task_spec_invalid');
  const huge = spec.parseRawTaskSpec({
    optimizedPrompt: 'x'.repeat(9000),
    taskSpec: {
      goal: 'g',
      deliverables: Array.from({ length: 30 }, (_, i) => `d${i}`),
      constraints: [],
      assumptions: [],
      acceptance: [],
      missingInfo: [],
      taskType: 'unknown',
    },
    changeSummary: Array.from({ length: 20 }, (_, i) => `c${i}`),
  });
  assert.equal(huge.ok, true);
  assert.ok(huge.value.optimizedPrompt.length <= 6000);
  assert.ok(huge.value.taskSpec.deliverables.length <= 12);
  assert.equal(huge.value.taskSpec.taskType, 'general');
  assert.ok(huge.value.changeSummary.length <= 8);
});

test('NEXT-03 capability snapshot — 只输出有界能力状态，不含凭据', () => {
  const snapshot = spec.buildCapabilitySnapshot({
    workflowEnabled: false,
    visionAvailable: true,
    mcpConnected: 1,
  });
  const workflow = snapshot.find((row) => row.id === 'workflow');
  const vision = snapshot.find((row) => row.id === 'vision');
  const blender = snapshot.find((row) => row.id === 'blender');
  assert.equal(workflow.status, 'disabled');
  assert.equal(vision.status, 'ready');
  assert.equal(blender.status, 'unavailable');
  const serialized = JSON.stringify(snapshot);
  assert.equal(/api[_-]?key|secret|token/i.test(serialized), false);
});

test('NEXT-03 端点 — prompt 必填；无凭据诚实 503，不产生草稿', async () => {
  const express = require('express');
  const http = require('node:http');
  const route = require('../core/petri-server/routes/ai-agent/suggestions.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  route.register(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (body) => fetch(`${base}/api/ai/agent/prompt-enhance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  try {
    const missing = await call({});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'prompt_required');
    const noCredential = await call({ prompt: '做个外壳', context: { surface: 'conversation' } });
    assert.equal(noCredential.status, 503);
    assert.equal(noCredential.body.error, 'no_credential');
    assert.equal(noCredential.body.taskSpec, undefined);
  } finally {
    server.close();
  }
});
