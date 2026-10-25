#!/usr/bin/env node
/**
 * BLOCK-262 — Q4b 工作流脚本实机腿（纯 REST：隔离后端 + mock provider）。
 *
 * 工作流是 REST/脚本面（无 UI），本腿不起 Vite/Electron——起隔离后端
 * （PETRI_WORKFLOW_ENABLED=1 + 临时数据根 + mock OpenAI-compatible provider），
 * 经真实接线（伞 task → launchSubAgent → runAgentLoop → 终态轮询 → journal）跑三场景：
 *   W1 2-agent fan-out review 全链（agents 终态 completed + journal 血缘 + runs/:id）
 *   W2 预算硬停（maxAgents=1 → 第二个 agent budget_exhausted，运行中不强杀）
 *   W3 cancel（运行中取消 → 级联请求 + 终态 cancelled）
 * 加 R1/R2 契约在真进程内复验（opt-in 门 / dryRun 零执行）。
 *
 * 用法：node scripts/block262-workflow-live.mjs
 * 证据：acceptance/block-262/workflow-live.json
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3171;
const MOCK_PORT = 3172;
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-262');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}
async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 240)}`);
}
function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* fallthrough */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
}
async function rest(method, p, body) {
  const response = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  return { ok: response.ok, status: response.status, data };
}

// ---------- mock OpenAI SSE provider（子代理回固定文本；长任务挂起 8s 供 cancel 窗口） ----------
let providerCalls = 0;
function startMockServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        providerCalls += 1;
        const reply = `review-ok-${providerCalls}`;
        const isLong = body.includes('long running');
        const respond = () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        };
        if (isLong) setTimeout(respond, 8000);
        else respond();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  return server;
}

const FANOUT_SCRIPT = `export const meta = { name: 'review-fanout', version: 1, budget: { maxAgents: 2, maxSteps: 6 }, concurrency: 2 };
export default async function run(ctx) {
  const results = await parallel([
    () => agent({ prompt: 'review module ' + ctx.a }),
    () => agent({ prompt: 'review module ' + ctx.b }),
  ]);
  log('fanout done');
  return { summaries: results.map((r) => r.summary) };
}`;

const BUDGET_SCRIPT = `export const meta = { name: 'budget-hardstop', version: 1, budget: { maxAgents: 1, maxSteps: 2 }, concurrency: 1 };
export default async function run() {
  const first = await agent({ prompt: 'only one allowed' });
  const second = await agent({ prompt: 'should be rejected' });
  return { first: first.status, second: second.error };
}`;

const CANCEL_SCRIPT = `export const meta = { name: 'cancel-midway', version: 1, budget: { maxAgents: 2, maxSteps: 4 }, concurrency: 1 };
export default async function run() {
  await agent({ prompt: 'long running step one' });
  await agent({ prompt: 'never starts' });
  return { done: true };
}`;

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [MOCK_PORT, 'mock']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用`);
  }
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b262-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'b262-mock',
    chat_provider: 'openai-compatible',
    chat_model_presets: [{
      id: 'b262-mock', label: 'B262 Mock', provider: 'openai-compatible', model: 'mock-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, contextWindow: 24000,
    }],
    model_profiles: [{
      id: 'b262-mock', label: 'B262 Mock', provider: 'openai-compatible', protocol: 'openai-compatible',
      model: 'mock-1', defaultModel: 'mock-1', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      contextWindow: 24000, capabilities: ['chat', 'streaming', 'tools'], roles: ['chat'],
    }],
    model_role_bindings: { chat: 'b262-mock' },
  }, null, 2));

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  const applied = [];
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    applied.push(file);
  }
  bootDb.close();

  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    try { writeReport(); } catch { /* ignore */ }
  };
  function writeReport() {
    const report = {
      name: 'workflow-live', block: 'BLOCK-262',
      provider: 'mock', screenshots: 'unavailable',
      migrationsApplied: applied.length, providerCalls,
      startedAt, finishedAt: new Date().toISOString(),
      assertions,
      allPass: assertions.every((item) => item.pass),
      passed: assertions.filter((item) => item.pass).length,
      total: assertions.length,
    };
    fs.writeFileSync(path.join(EVIDENCE, 'workflow-live.json'), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  let backend = null;
  let mockServer = null;
  try {
    mockServer = startMockServer();
    await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: {
        ...process.env,
        PETRI_DB_PATH: dbPath,
        PETRI_LOCAL_DATA_DIR: dataDir,
        R_SERVER_PORT: String(BACKEND_PORT),
        PETRI_WORKFLOW_ENABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200)); });
    await waitFor(async () => {
      const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
      return response.ok ? true : null;
    }, { timeoutMs: 30_000, label: 'backend health' });
    assert('S1_isolated_backend', true, `backend :${BACKEND_PORT} + mock :${MOCK_PORT} + PETRI_WORKFLOW_ENABLED=1`);

    // R1: 默认关语义在真进程内复验（独立开关读取）——通过 env 已开，这里验 dryRun 契约
    const dry = await rest('POST', '/ai/agent/workflow/run', { script: FANOUT_SCRIPT, args: { a: 'x', b: 'y' }, dryRun: true });
    assert('R1_dryRun_estimate_zero_exec', dry.status === 200 && dry.data.ok && dry.data.dryRun === true
      && dry.data.estimate.agentCallsInSource === 2 && providerCalls === 0,
    `dryRun=${dry.status} estimate=${JSON.stringify(dry.data.estimate || {}).slice(0, 120)} providerCalls=${providerCalls}`);

    const bad = await rest('POST', '/ai/agent/workflow/run', {
      script: 'export const meta = { name: "w", version: 1 };\nexport default async function run() { const t = Date.now(); }',
    });
    assert('R2_forbidden_syntax_400', bad.status === 400 && bad.data.error === 'script_forbidden_syntax',
      `status=${bad.status} error=${bad.data && bad.data.error}`);

    // W1: 2-agent fan-out 全链
    const w1 = await rest('POST', '/ai/agent/workflow/run', { script: FANOUT_SCRIPT, args: { a: 'alpha', b: 'beta' } });
    assert('W1_start_202', w1.status === 202 && w1.data.ok && /^wf-/.test(w1.data.runId || '') && w1.data.taskId,
      `runId=${w1.data.runId} taskId=${w1.data.taskId}`);
    const w1RunId = w1.data.runId;
    const w1TaskId = w1.data.taskId;

    const w1Detail = await waitFor(async () => {
      const detail = await rest('GET', `/ai/agent/workflow/runs/${w1RunId}`);
      return detail.data && detail.data.run && detail.data.run.status === 'completed' ? detail.data : null;
    }, { timeoutMs: 120_000, intervalMs: 1000, label: 'W1 completed' });
    const w1Journal = w1Detail.journalTail || [];
    const w1AgentLines = w1Journal.filter((l) => l.kind === 'agent');
    assert('W1_fanout_completed', w1Detail.run.status === 'completed' && w1AgentLines.length === 2
      && w1AgentLines.every((l) => l.status === 'completed'),
    `agents=${w1AgentLines.length} statuses=${w1AgentLines.map((l) => l.status).join(',')}`);

    // 真实接线核验：伞 task kind=workflow + 子任务血缘
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const umbrella = db.prepare('SELECT id, params FROM tasks WHERE id = ?').get(w1TaskId);
    // 子任务血缘存 params JSON（params.parentTaskId；无 parent_task_id 列）
    const children = db
      .prepare("SELECT id, status, params FROM tasks WHERE type = 'agent_loop' AND json_extract(params, '$.kind') = 'subagent' AND json_extract(params, '$.parentTaskId') = ? ORDER BY id")
      .all(w1TaskId);
    db.close();
    const umbrellaKind = umbrella ? (JSON.parse(umbrella.params || '{}').kind) : null;
    assert('W1_umbrella_and_lineage', umbrellaKind === 'workflow' && children.length === 2,
      `umbrellaKind=${umbrellaKind} children=${children.length} statuses=${children.map((c) => c.status).join(',')}`);

    assert('W1_mock_provider_real_loop', providerCalls >= 2,
      `providerCalls=${providerCalls}（子代理经真实 runAgentLoop 打到 mock）`);

    // W2: 预算硬停
    const w2 = await rest('POST', '/ai/agent/workflow/run', { script: BUDGET_SCRIPT, args: {} });
    const w2RunId = w2.data.runId;
    const w2Detail = await waitFor(async () => {
      const detail = await rest('GET', `/ai/agent/workflow/runs/${w2RunId}`);
      return detail.data && detail.data.run && ['completed', 'failed'].includes(detail.data.run.status) ? detail.data : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'W2 settled' });
    const w2Journal = w2Detail.journalTail || [];
    const w2Rejected = w2Journal.filter((l) => l.kind === 'agent' && l.status === 'rejected');
    assert('W2_budget_hardstop', w2Rejected.length === 1 && w2Detail.run.status === 'completed',
      `rejected=${w2Rejected.length} runStatus=${w2Detail.run.status}（第二个 agent 被 maxAgents=1 拒绝，第一个不强杀）`);

    // W3: cancel 中途取消
    const w3 = await rest('POST', '/ai/agent/workflow/run', { script: CANCEL_SCRIPT, args: {} });
    const w3RunId = w3.data.runId;
    await sleep(1500); // 等第一个 agent 进入运行
    const w3Cancel = await rest('POST', `/ai/agent/workflow/runs/${w3RunId}/cancel`);
    assert('W3_cancel_accepted', w3Cancel.status === 200 && w3Cancel.data.cancelled === true && w3Cancel.data.mode === 'in_process',
      `status=${w3Cancel.status} mode=${w3Cancel.data && w3Cancel.data.mode}`);
    const w3Detail = await waitFor(async () => {
      const detail = await rest('GET', `/ai/agent/workflow/runs/${w3RunId}`);
      return detail.data && detail.data.run && detail.data.run.status === 'cancelled' ? detail.data : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'W3 cancelled' });
    const w3Journal = w3Detail.journalTail || [];
    const w3AgentLaunched = w3Journal.filter((l) => l.kind === 'agent' && l.status !== 'rejected').length;
    assert('W3_cancelled_no_second_agent', w3Detail.run.status === 'cancelled' && w3AgentLaunched === 1,
      `launched=${w3AgentLaunched}（取消后不再启动第二个 agent）`);

    // 列表面
    const list = await rest('GET', '/ai/agent/workflow/runs');
    assert('L1_runs_listed', list.status === 200 && list.data.runs.length >= 3,
      `runs=${list.data.runs.length}`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(backend && backend.pid);
    if (mockServer) { try { mockServer.close(); } catch { /* ignore */ } }
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows delay */ }
    const report = writeReport();
    console.log(`\n[block262-workflow-live] ${report.passed}/${report.total} pass · evidence=acceptance/block-262/workflow-live.json`);
    if (!report.allPass) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
