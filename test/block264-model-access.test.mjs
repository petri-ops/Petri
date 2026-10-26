import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-264（C-37）— 模型选择器权限来源 + 定价缓存：
//   model-access 族（allowedModels 白名单/reasonNotes 账本）判定纯函数 + GET/PUT 路由；
//   pricing 端点进程内缓存（cached:true 标记；表为静态常量无失效源）。

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b264-modelaccess-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
process.env.PETRI_DB_PATH = path.join(tempDir, 'x.db');
// pricing 端点经 ai-usage 触发 db 建表——先按真实迁移建库
{
  const Database = require('better-sqlite3');
  const boot = new Database(process.env.PETRI_DB_PATH);
  for (const file of fs.readdirSync('src/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join('src/migrations', file), 'utf8'));
  }
  boot.close();
}

const express = require('express');
const modelAccess = require('../core/petri-server/helpers/model-access.js');
const { registerAiSettingsRoutes } = require('../core/petri-server/routes/ai-settings-api.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

async function makeServer() {
  const app = express();
  registerAiSettingsRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body) =>
    fetch(base + p, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
  return { server, call };
}

// ---------- 判定纯函数 ----------

test('BLOCK-264 modelAccessFor — 默认全放行（open，零行为变化）', () => {
  const r = modelAccess.modelAccessFor({ model: 'anything' }, { allowedModels: [], reasonNotes: {} });
  assert.deepEqual(r, { allowed: true, reason: null, source: 'open' });
});

test('BLOCK-264 modelAccessFor — 白名单模式：列入=允许（带账本注记）；未列入=拒绝带理由', () => {
  const store = { allowedModels: ['deepseek-chat'], reasonNotes: { 'deepseek-chat': '团队批准 2026-10' } };
  assert.deepEqual(
    modelAccess.modelAccessFor({ model: 'deepseek-chat' }, store),
    { allowed: true, reason: '团队批准 2026-10', source: 'allowlist' }
  );
  const denied = modelAccess.modelAccessFor({ model: 'gpt-x' }, store);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, '未列入本机允许清单');
  const deniedNote = modelAccess.modelAccessFor({ model: 'gpt-y' }, { allowedModels: ['deepseek-chat'], reasonNotes: { 'gpt-y': '审批未过' } });
  assert.equal(deniedNote.reason, '未列入本机允许清单（审批未过）');
});

test('BLOCK-264 saveModelAccess — schema 校验 + 持久化往返；非法值整批拒绝', () => {
  const ok = modelAccess.saveModelAccess({ allowedModels: ['a-model', 'b-model'], reasonNotes: { 'a-model': 'x' } });
  assert.equal(ok.ok, true);
  const store = modelAccess.readStore();
  assert.deepEqual(store.allowedModels, ['a-model', 'b-model']);
  assert.equal(store.reasonNotes['a-model'], 'x');

  const bad = modelAccess.saveModelAccess({ allowedModels: [42, 'ok-model'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'value_invalid');
  // 拒绝后盘上仍是上次成功值
  assert.deepEqual(modelAccess.readStore().allowedModels, ['a-model', 'b-model']);
});

// ---------- REST ----------

test('BLOCK-264 GET/PUT /api/ai/model-access — 读投影与校验写', async () => {
  modelAccess.writeStore({ allowedModels: [], reasonNotes: {} }); // 隔离：清上一测试的盘面
  const { server, call } = await makeServer();
  try {
    const initial = await call('GET', '/api/ai/model-access');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.mode, 'open');

    const put = await call('PUT', '/api/ai/model-access', { allowedModels: ['m-1'], reasonNotes: { 'm-1': '批准' } });
    assert.equal(put.status, 200);
    assert.equal(put.body.mode, 'allowlist');
    assert.deepEqual(put.body.allowedModels, ['m-1']);

    const bad = await call('PUT', '/api/ai/model-access', { allowedModels: [42, 'mixed'] });
    assert.equal(bad.status, 400);
    // PUT 非数组（'not-array'）按「未传该键」处理=清空回 open，这是合法语义不是 400
    const cleared = await call('PUT', '/api/ai/model-access', { allowedModels: 'not-array' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.mode, 'open');
  } finally { server.close(); }
});

test('BLOCK-264 /api/ai/pricing — 缓存标记（cached:true）且形状不变', async () => {
  // pricing 端点依赖 ai_usage 建表（getDatabase 触发 db 模块 schema）——先触发
  const { server, call } = await makeServer();
  try {
    const first = await call('GET', '/api/ai/pricing');
    assert.equal(first.status, 200);
    assert.equal(first.body.cached, true);
    assert.ok(first.body.pricing && typeof first.body.pricing === 'object');
    assert.ok(first.body.pricing['deepseek-chat']);
    const second = await call('GET', '/api/ai/pricing');
    assert.equal(second.body.cached, true);
    assert.deepEqual(Object.keys(second.body.pricing), Object.keys(first.body.pricing));
  } finally { server.close(); }
});
