import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const express = require('express');

// workflows root 走 dataPaths → 用隔离数据目录（调用时读 env 的路由不受影响；
// dataPaths 在 require 时解析目录，先设 env 再 require）
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-routes-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;

const workflowRoute = require('../core/petri-server/routes/ai-agent/workflow.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// 注入式 deps：记录 spawn；wait 挂起直到 finish；取消即 resolve cancelled
function makeFakeDeps() {
  const spawned = [];
  const waiting = new Map();
  return {
    spawned,
    deps: {
      launchSubAgent: ({ userContent }) => {
        const agentId = `fa-${spawned.length + 1}`;
        spawned.push({ agentId, userContent });
        return { ok: true, agentId, status: 'running' };
      },
      waitAgentTerminal: (agentId) => new Promise((resolve) => waiting.set(agentId, resolve)),
      requestCancellation: (agentId) => {
        const resolve = waiting.get(agentId);
        if (resolve) { resolve({ status: 'cancelled', summary: '' }); waiting.delete(agentId); }
        return true;
      },
    },
    finish(agentId, result = { status: 'completed', summary: 'ok' }) {
      const resolve = waiting.get(agentId);
      if (resolve) { resolve(result); waiting.delete(agentId); }
    },
  };
}

async function makeServer({ deps } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // 会话鉴权桩：req.user 由路由自行读
  app.use((req, _res, next) => { req.user = { id: 'u-test' }; next(); });
  workflowRoute.register(app, deps ? { deps } : {});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, body) =>
    fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
  return { server, call };
}

const GOOD_SCRIPT = `export const meta = { name: 'review', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run(ctx) {
  await agent({ prompt: 'review ' + ctx.file });
  return { done: true };
}`;

test('BLOCK-262 routes — opt-in 默认关：全部端点 503 workflow_disabled', async () => {
  delete process.env.PETRI_WORKFLOW_ENABLED;
  const { server, call } = await makeServer();
  try {
    const run = await call('POST', '/api/ai/agent/workflow/run', { script: GOOD_SCRIPT });
    assert.equal(run.status, 503);
    assert.equal(run.body.error, 'workflow_disabled');
    const list = await call('GET', '/api/ai/agent/workflow/runs');
    assert.equal(list.status, 503);
    const one = await call('GET', '/api/ai/agent/workflow/runs/any');
    assert.equal(one.status, 503);
    const cancel = await call('POST', '/api/ai/agent/workflow/runs/any/cancel');
    assert.equal(cancel.status, 503);
    assert.equal(cancel.body.error, 'workflow_disabled');
  } finally {
    server.close();
  }
});

test('BLOCK-262 routes — env 调用时读：同进程开闸后放行（不固化模块常量）', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const fake = makeFakeDeps();
  const { server, call } = await makeServer({ deps: fake.deps });
  try {
    const dry = await call('POST', '/api/ai/agent/workflow/run', { script: GOOD_SCRIPT, dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.estimate.agentCallsInSource, 1);
    assert.equal(fake.spawned.length, 0, 'dryRun 零执行');
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});

test('BLOCK-262 routes — 缺 script / 脚本非法 400 带诊断', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const { server, call } = await makeServer({ deps: makeFakeDeps().deps });
  try {
    const missing = await call('POST', '/api/ai/agent/workflow/run', {});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'script_required');

    const forbidden = await call('POST', '/api/ai/agent/workflow/run', {
      script: 'export const meta = { name: "w", version: 1 };\nexport default async function run() { const t = Date.now(); }',
    });
    assert.equal(forbidden.status, 400);
    assert.equal(forbidden.body.error, 'script_forbidden_syntax');

    const badMeta = await call('POST', '/api/ai/agent/workflow/run', {
      script: 'export const meta = { name: "w", version: 1, budget: { maxAgents: 99 } };\nexport default async function run() {}',
      dryRun: true,
    });
    assert.equal(badMeta.status, 400);
    assert.equal(badMeta.body.error, 'meta_invalid');
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});

test('BLOCK-262 routes — 真跑返回 202 runId；runs/:id 可读；cancel 后终态 cancelled', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const fake = makeFakeDeps();
  const { server, call } = await makeServer({ deps: fake.deps });
  try {
    const start = await call('POST', '/api/ai/agent/workflow/run', { script: GOOD_SCRIPT, args: { file: 'a.ts' } });
    assert.equal(start.status, 202);
    assert.equal(start.body.ok, true);
    assert.match(start.body.runId, /^wf-/);
    const runId = start.body.runId;

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fake.spawned.length, 1);

    const cancelRes = await call('POST', `/api/ai/agent/workflow/runs/${runId}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.cancelled, true);
    assert.equal(cancelRes.body.mode, 'in_process');

    await new Promise((r) => setTimeout(r, 30));
    const detail = await call('GET', `/api/ai/agent/workflow/runs/${runId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.run.status, 'cancelled');
    assert.ok(Array.isArray(detail.body.journalTail) && detail.body.journalTail.length >= 1);

    const list = await call('GET', '/api/ai/agent/workflow/runs');
    assert.equal(list.status, 200);
    assert.ok(list.body.runs.some((r) => r.runId === runId));
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});

test('BLOCK-262 routes — 正常完成链路：finish 后 run.json=completed', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const fake = makeFakeDeps();
  const { server, call } = await makeServer({ deps: fake.deps });
  try {
    const start = await call('POST', '/api/ai/agent/workflow/run', { script: GOOD_SCRIPT, args: { file: 'b.ts' } });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 30));
    fake.finish('fa-1');
    await new Promise((r) => setTimeout(r, 50));
    const detail = await call('GET', `/api/ai/agent/workflow/runs/${runId}`);
    assert.equal(detail.body.run.status, 'completed');
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});

test('BLOCK-262 routes — 已结束 run 再 cancel → 409 run_not_active', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const fake = makeFakeDeps();
  const { server, call } = await makeServer({ deps: fake.deps });
  try {
    const start = await call('POST', '/api/ai/agent/workflow/run', { script: GOOD_SCRIPT, args: { file: 'c.ts' } });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 30));
    fake.finish('fa-1');
    await new Promise((r) => setTimeout(r, 50));
    const cancelRes = await call('POST', `/api/ai/agent/workflow/runs/${runId}/cancel`);
    assert.equal(cancelRes.status, 409);
    assert.equal(cancelRes.body.error, 'run_not_active');
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});

test('BLOCK-262 routes — 未知 run → 404', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const { server, call } = await makeServer({ deps: makeFakeDeps().deps });
  try {
    const detail = await call('GET', '/api/ai/agent/workflow/runs/wf-nonexistent');
    assert.equal(detail.status, 404);
    assert.equal(detail.body.error, 'run_not_found');
  } finally {
    delete process.env.PETRI_WORKFLOW_ENABLED;
    server.close();
  }
});
