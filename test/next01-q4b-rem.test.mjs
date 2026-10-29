import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-next01-'));
process.env.PETRI_DB_PATH = path.join(tempRoot, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });

const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src', 'migrations'));

const registry = require('../core/petri-server/agent-tools/registry');
const workflowRoute = require('../core/petri-server/routes/ai-agent/workflow');
const store = require('../core/petri-server/helpers/automation-store');
const runner = require('../core/petri-server/helpers/automation-runner');
const sqlite = require('../core/petri-server/db').getDatabase();

const SCRIPT = `export const meta = { name: 'next01-probe', version: 1, budget: { maxAgents: 2, maxSteps: 4 }, concurrency: 1 };
export default async function run() { return { done: true }; }`;

test.after(() => {
  delete process.env.PETRI_WORKFLOW_ENABLED;
  try { sqlite.close(); } catch { /* ignore */ }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows handle delay */ }
});

test('NEXT-01: run_workflow 工具注册 + dryRun 零执行', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  assert.ok(registry.getToolEntry('run_workflow'), 'run_workflow missing');
  assert.equal(registry.getToolContract('run_workflow').riskTier, 'R2');
  const express = require('express');
  const http = require('node:http');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  workflowRoute.register(app, {});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.PETRI_WORKFLOW_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await registry.getToolHandler('run_workflow')({
      script: SCRIPT,
      args: { file: 'demo.ts' },
      dryRun: true,
    }, { userId: 'local-user' });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.estimate.agentCallsInSource, 0);
    assert.equal(workflowRoute._internals.activeRuns.size, 0, 'dryRun 不应产生活跃 run');
  } finally {
    delete process.env.PETRI_WORKFLOW_BASE_URL;
    server.close();
  }
});

test('NEXT-01: run_workflow 默认关时诚实拒绝', async () => {
  delete process.env.PETRI_WORKFLOW_ENABLED;
  const result = await registry.getToolHandler('run_workflow')({ script: SCRIPT, dryRun: true }, { userId: 'local-user' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'workflow_disabled');
});

test('NEXT-01: resume 从持久脚本创建新 run 并保留前缀来源', async () => {
  process.env.PETRI_WORKFLOW_ENABLED = '1';
  const express = require('express');
  const http = require('node:http');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  const spawned = [];
  const waiting = new Map();
  const deps = {
    launchSubAgent: ({ userContent }) => {
      const agentId = `fa-${spawned.length + 1}`;
      spawned.push({ agentId, userContent });
      return { ok: true, agentId, status: 'running' };
    },
    waitAgentTerminal: (agentId) => new Promise((resolve) => waiting.set(agentId, resolve)),
    requestCancellation: () => true,
  };
  workflowRoute.register(app, { deps });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, body) => fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  try {
    const agentScript = `${SCRIPT.replace('return { done: true };', "await agent({ prompt: 'probe' }); return { done: true };")}`;
    const first = await call('POST', '/api/ai/agent/workflow/run', { script: agentScript });
    assert.equal(first.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(typeof waiting.get('fa-1'), 'function', `agent not waiting: ${spawned.length}`);
    waiting.get('fa-1')({ status: 'completed', summary: 'ok' });
    let firstDetail = null;
    let lastDetail = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const detail = await call('GET', `/api/ai/agent/workflow/runs/${first.body.runId}`);
      lastDetail = detail;
      if (detail.body?.run?.status === 'completed') { firstDetail = detail.body; break; }
    }
    assert.equal(firstDetail?.run?.status, 'completed', JSON.stringify(lastDetail));
    const resumed = await call('POST', `/api/ai/agent/workflow/runs/${first.body.runId}/resume`);
    assert.equal(resumed.status, 202);
    assert.notEqual(resumed.body.runId, first.body.runId);
    assert.equal(resumed.body.resumeFromRunId, first.body.runId);
  } finally {
    server.close();
  }
});

test('NEXT-01: schedule kind=workflow 校验、运行关联与终态对账', async () => {
  const invalid = store.createSchedule({ projectId: 'p_next01', title: 'bad', kind: 'workflow', intervalMinutes: 1 });
  assert.equal(invalid.ok, false);
  const created = store.createSchedule({
    projectId: 'p_next01',
    title: 'workflow 定时',
    kind: 'workflow',
    workflowScript: SCRIPT,
    workflowArgs: { run: 1 },
    intervalMinutes: 1,
  });
  assert.equal(created.ok, true);
  assert.equal(created.schedule.kind, 'workflow');
  assert.equal(created.schedule.workflow_script, undefined, 'API view 不回传脚本正文');
  assert.equal(created.schedule.hasWorkflowScript, true);

  sqlite.prepare('UPDATE agent_schedules SET next_run_at=? WHERE id=?')
    .run(new Date(Date.now() - 60_000).toISOString(), created.schedule.id);
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      json: async () => ({ ok: true, runId: 'wf-next01', taskId: 'task-next01', status: 'running' }),
    };
  };
  const first = await runner.runDueSchedulesOnce({ fetchImpl: fakeFetch, baseUrl: 'http://127.0.0.1:3001' });
  assert.ok(first.executed.some((row) => row.status === 'running'));
  assert.ok(calls.some((call) => call.url.includes('/api/ai/agent/workflow/run')));
  const runs = store.listRunsForSchedule(created.schedule.id);
  assert.equal(runs[0].workflow_run_id, 'wf-next01');
  assert.equal(runs[0].task_id, 'task-next01');

  await runner.runDueSchedulesOnce({
    fetchImpl: fakeFetch,
    baseUrl: 'http://127.0.0.1:3001',
    getTask: () => null,
    getWorkflowRun: async (runId) => {
      assert.equal(runId, 'wf-next01');
      return { status: 'completed' };
    },
  });
  assert.equal(store.listRunsForSchedule(created.schedule.id)[0].status, 'completed');
});
