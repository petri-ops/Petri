#!/usr/bin/env node
/**
 * BLOCK-323 / UI-655 — 放权坡道复盘区实机腿一键封装（隔离栈 + mock provider，零真实 key）。
 *
 * 同 block244-approval-tail-live 姿势：完全隔离的 :3001 后端 + :3000 Vite + :9223 Electron
 * （PETRI_TEST_INSTANCE 离屏实例），不触碰用户 dev 栈/数据。
 *
 * 分工：后端链（observe 命中→落账）由封装脚本经 REST 预置（M4 直连腿已证真实执行链）；
 * 本腿 UI 责任=设置面复盘区（/settings?section=decisions 深链→AgentRulesPanel 点按流：
 * 待复盘行→升级放行→标复盘→自动放行审计/变更留痕区）。
 *
 * 前置：端口 3000/3001/9223 空闲（占用即 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-655/ + acceptance/block-323/（亮/暗截图 + 断言 JSON）。
 * 暗色轮：PETRI_B323_DARK=1（证据文件名 -dark 后缀）。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 端口解析：首选默认值，被占用（如用户 dev 栈在跑）则自动换空闲端口——绝不杀未知进程
async function resolvePort(preferred, name) {
  if (!(await portOpen(preferred))) return preferred;
  const free = await freePort();
  console.log(`  [port] ${name} :${preferred} 被占用，改用空闲端口 :${free}`);
  return free;
}
let BACKEND_PORT = 0;
let VITE_PORT = 0;
let CDP_PORT = 0;
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'block323-observe-ui-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-655');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-323');
const DARK = process.env.PETRI_B323_DARK === '1';
const FINAL_TEXT = 'BLOCK-323 UI 腿收口：命令已按放权坡道语义处理。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
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
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { /* already gone */ }
}

// ---------- mock OpenAI SSE provider（奇数序=workspace_exec npm，偶数序=收口文本） ----------
let providerCalls = 0;
function startMockServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      req.on('data', () => {});
      req.on('end', () => {
        providerCalls += 1;
        console.log(`  [mock] req#${providerCalls}`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (providerCalls % 2 === 1) {
          const args = JSON.stringify({ command: 'npm --version' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_b323ui_${providerCalls}`, type: 'function', function: { name: 'workspace_exec', arguments: args } }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: FINAL_TEXT } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
}

async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
}

// ---------- SSE collector（同 block180 信封帧归一） ----------
async function collectTaskEvents(apiBase, taskId, timeoutMs = 90_000) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase}/api/ai/agent/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: 'Bearer desktop-local' },
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') { done = true; continue; }
          try {
            const parsed = JSON.parse(payload);
            const ev = parsed && parsed.eventType && parsed.payload ? { ...parsed.payload, _eventType: parsed.eventType } : parsed;
            events.push(ev);
            if (ev && ['done', 'error', 'agent_cancelled', 'fatal_agent_error'].includes(ev.event)) done = true;
          } catch { /* 心跳注释行等 */ }
        }
      }
    }
  } catch { /* 超时即返回已收帧 */ } finally {
    clearTimeout(timer);
    try { controller.abort(); } catch {}
  }
  return events;
}

async function main() {
  const startedAt = new Date().toISOString();
  BACKEND_PORT = await resolvePort(3001, 'backend');
  VITE_PORT = await resolvePort(3000, 'vite');
  CDP_PORT = await resolvePort(9223, 'cdp');

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b323ui-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockPort = await freePort();
  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'b323ui-mock',
    chat_model_presets: [{
      id: 'b323ui-mock', label: 'B323 UI Mock', provider: 'openai-compatible', model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`, contextWindow: 24000,
    }],
  }, null, 2));
  // 观察规则预先落盘（隔离数据根）：npm → observe
  fs.writeFileSync(path.join(dataDir, 'agent-rules.json'), JSON.stringify({
    version: 1,
    rules: [{ id: 'r-npm', matcher: { type: 'command-token', pattern: 'npm' }, action: 'observe', scope: 'global' }],
  }, null, 2));

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
  };

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 30_000, 'backend health');

    const rest = async (method, endpoint, body) => {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${endpoint}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };

    // 预置腿 S1：项目 + 会话 + 任务1（observe 档真实执行）→ 观察行落账
    const project = await rest('POST', '/data/projects', { name: 'BLOCK-323 UI 腿探针项目' });
    const projectId = project.data?.project?.id;
    assert('S1_project_created', Boolean(projectId), `projectId=${projectId}`);
    if (!projectId) throw new Error('project_create_failed');
    const conversation = await rest('POST', '/ai/conversations', { title: 'B323 UI 腿任务1（观察档）', project_id: projectId });
    const conversationId = conversation.data?.conversation?.id || conversation.data?.data?.conversation?.id || conversation.data?.data?.id;
    assert('S1b_conversation_created', Boolean(conversationId), `conversationId=${conversationId}`);
    const start = await rest('POST', '/ai/agent', {
      conversationId,
      modelPresetId: 'b323ui-mock',
      messages: [{ role: 'user', content: '查一下 npm 版本' }],
      context: { accessMode: 'full', projectId },
    });
    const taskId = start.data?.taskId || null;
    assert('S1c_task_started', Boolean(taskId), `taskId=${taskId}`);
    if (!taskId) throw new Error('task_start_failed');
    const events = await collectTaskEvents(`http://127.0.0.1:${BACKEND_PORT}`, taskId, 90_000);
    assert('S1d_observe_task_completed', events.some((e) => e.event === 'done'), `事件=${events.map((e) => e.event || e._eventType || '?').slice(0, 12).join(',')}`);
    const obs = await rest('GET', '/ai/policy-observations');
    const row = (obs.data?.unreviewed || []).find((item) => item.kind === 'rule-observe' && item.ruleId === 'r-npm');
    assert('S1e_observation_seeded', Boolean(row) && row.hits >= 1, row ? `id=${row.id} hits=${row.hits}` : '观察行缺席');
    if (!row) throw new Error('observation_seed_failed');

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');

    const electronEnv = {
      ...process.env,
      PETRI_TEST_INSTANCE: '1',
      PETRI_ELECTRON_USER_DATA_DIR: userDataDir,
      PETRI_DB_PATH: dbPath,
      PETRI_LOCAL_DATA_DIR: dataDir,
      R_SERVER_PORT: String(BACKEND_PORT),
      PETRI_ELECTRON_LOG_PATH: path.join(tempRoot, 'electron.log'),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electron = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
      '.', '--dev', `--remote-debugging-port=${CDP_PORT}`,
    ], { cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    assert('S2_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B323_API = `http://127.0.0.1:${BACKEND_PORT}/api`;
    process.env.PETRI_B323_PROJECT_ID = String(projectId);
    process.env.PETRI_B323_MODEL_PRESET = 'b323ui-mock';
    process.env.PETRI_B323_CDP = String(CDP_PORT);
    await flow.run({ assert });
    console.log(`  [keep] tempRoot=${tempRoot}（PETRI_B323_KEEP=1 保留，可复核 agent-rules.json / electron.log）`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    try { mockServer.close(); } catch {}
    await sleep(600);
    if (process.env.PETRI_B323_KEEP === '1') {
      console.log(`  [keep] 临时目录保留：${tempRoot}`);
    } else {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    }
    const report = {
      name: 'block323-observe-ui-live',
      darkMode: DARK,
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: assertions.every((item) => item.pass),
    };
    const jsonName = DARK ? 'block323-observe-ui-live-dark.json' : 'block323-observe-ui-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}（${jsonName}）`);
    if (!report.allPass) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
