#!/usr/bin/env node
/**
 * BLOCK-244 / UI-552 — 审批控制面收尾实机腿一键封装（隔离栈 + mock provider，零真实 key）。
 *
 * 与 UI-551 的差异：同一隔离栈内串起「策略 ask → 批准 → 循环 3 次 → 批准 →
 * 结构化提问 → 回答 → 终态」，并在临时 git 工作区验证 checkpoint 编辑回退。
 * 不触碰用户 dev 栈/数据；起一套完全隔离的 :3001 后端 + :3000 Vite + :9223 Electron。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着就 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-552/（亮/暗截图 + 断言 JSON）+ acceptance/block-244/。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const MOCK_PORT = Number(process.env.UI552_MOCK_PORT || 39052);
const MCP_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-many-tools-server.cjs');
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui552-approval-tail-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-552');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-244');
const FINAL_TEXT = 'Q1-REM 收口：策略、循环与提问均已按批准执行。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
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
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { /* already gone */ }
}

// ---------- mock OpenAI SSE provider（按审批阶段释放） ----------
let providerCalls = 0;
let loopEchoes = 0;
const PROBE_TEXT = 'checkpoint 探针轮：只回一句话。';
const PROBE_REPLY = '探针轮完成。';
const releases = { policy: false, loop: false };
const releaseWaiters = new Map();
const mockRequests = [];

function waitRelease(phase, timeoutMs = 60_000) {
  if (releases[phase]) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    releaseWaiters.set(phase, () => { clearTimeout(timer); resolve(true); });
  });
}

function releasePhase(phase) {
  releases[phase] = true;
  const waiter = releaseWaiters.get(phase);
  if (waiter) { releaseWaiters.delete(phase); waiter(); }
}

function lastToolText(messages) {
  const toolMessages = (Array.isArray(messages) ? messages : []).filter((m) => m && m.role === 'tool');
  const last = toolMessages[toolMessages.length - 1];
  return String((last && last.content) || '');
}

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = [...list].reverse().find((m) => m && m.role === 'user');
  const content = last ? last.content : '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => String(part?.text || '')).join(' ');
  return String(content || '');
}

function classifyRequest(messages) {
  // 探针轮按「最后一句用户消息」判定，而不是按消息形状：编辑回退会截断前端历史，
  // 主链路轮的第一次请求也可能看起来像空历史。
  if (lastUserText(messages).includes(PROBE_TEXT)) return 'probe';
  const text = lastToolText(messages);
  if (text.includes('loop_guard')) return 'after-loop';
  // 策略 ask 尚未撤销（args 含 loop）→ 记为 ask_again，让 flow 的断言抓真而不是静默重试。
  if (text.includes('tool_approval_required') && text.includes('"loop"')) return 'ask_again';
  if (text.includes('tool_approval_required')) return 'after-policy';
  if (text.includes('called:many_echo')) return 'accumulate';
  if (text.includes('"answered"')) return 'after-question';
  return 'initial';
}

function writeSse(res, payloads, finish = 'tool_calls') {
  for (const payload of payloads) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function toolCall(id, name, args) {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
    if (req.method === 'POST' && url.pathname === '/release') {
      const phase = String(url.searchParams.get('phase') || '');
      if (phase === 'policy' || phase === 'loop') releasePhase(phase);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, phase }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ calls: providerCalls, releases, requests: mockRequests }));
      return;
    }
    if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const phase = classifyRequest(parsed.messages);
        mockRequests.push({ n: providerCalls, phase, lastTool: lastToolText(parsed.messages).slice(0, 260) });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (phase === 'probe') {
          writeSse(res, [{ choices: [{ delta: { content: PROBE_REPLY } }] }], 'stop');
          return;
        }
        if (phase === 'initial') {
          // 提问腿放在最前：长链路尾部渲染会卡（ProjectWorkspace 既存重渲染环），
          // 先跑提问可以让卡片渲染与回答回传在页面还干净时被断言。
          writeSse(res, [toolCall('call_ui552_question', 'ask_user_question', {
            question: '选择继续方式',
            options: [
              { id: 'opt-run', label: '继续执行' },
              { id: 'opt-stop', label: '停止' },
            ],
            multiSelect: false,
            allowFreeText: false,
          })]);
          return;
        }
        if (phase === 'after-question') {
          writeSse(res, [toolCall('call_ui552_policy', 'mcp_many_many_echo', { message: 'policy' })]);
          return;
        }
        if (phase === 'after-policy') {
          await waitRelease('policy');
          loopEchoes += 1;
          writeSse(res, [toolCall(`call_ui552_loop_${loopEchoes}`, 'mcp_many_many_echo', { message: 'loop' })]);
          return;
        }
        if (phase === 'accumulate') {
          loopEchoes += 1;
          writeSse(res, [toolCall(`call_ui552_loop_${loopEchoes}`, 'mcp_many_many_echo', { message: 'loop' })]);
          return;
        }
        if (phase === 'ask_again') {
          writeSse(res, [{ choices: [{ delta: { content: 'MOCK_ABORT：工具策略未复位为 allow（loop 参数仍被 ask 拦截）' } }] }], 'stop');
          return;
        }
        if (phase === 'after-loop') {
          await waitRelease('loop');
          writeSse(res, [{ choices: [{ delta: { content: FINAL_TEXT } }] }], 'stop');
          return;
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: FINAL_TEXT } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  return server;
}

async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
}

function initGitWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
  git('init');
  git('config', 'user.email', 'ui552@petri.local');
  git('config', 'user.name', 'UI-552');
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'v1\n', 'utf8');
  git('add', '.');
  git('commit', '-m', 'init');
  // 发送前留下未提交变更 → 快照可捕获；回退应恢复到这个版本。
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'v2\n', 'utf8');
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  if (await portOpen(MOCK_PORT)) throw new Error(`mock 端口 :${MOCK_PORT} 已被占用`);

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui552-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui552-mock',
    chat_model_presets: [{
      id: 'ui552-mock',
      label: 'UI-552 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      contextWindow: 24000,
    }],
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
  let workspace = null;
  let flowResult = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
  };

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: {
        ...process.env,
        PETRI_DB_PATH: dbPath,
        PETRI_LOCAL_DATA_DIR: dataDir,
        R_SERVER_PORT: String(BACKEND_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    backend.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend]', text.slice(0, 200));
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

    // 与 UI-551 同型：项目不带显式 workspacePath，由后端按 LOCAL_DATA_DIR/projects/<slug> 落位；
    // 读回真实路径后再 git 初始化，供 checkpoint 快照/回退使用。
    const project = await rest('POST', '/data/projects', { name: 'UI-552 审批尾项探针项目' });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    initGitWorkspace(workspace);

    const created = await rest('POST', '/mcp/servers', {
      id: 'many',
      transport: 'stdio',
      command: process.execPath,
      args: [MCP_FIXTURE],
      autoConnect: false,
    });
    const connected = await rest('POST', '/mcp/servers/many/connect');
    assert('E2_mcp_connected', created.status === 200 && connected.data?.toolCount === 6,
      JSON.stringify(connected.data || {}).slice(0, 200));
    const policy = await rest('PUT', '/ai/tool-approval-policy', { modes: [{ name: 'mcp_many_many_echo', mode: 'ask' }] });
    assert('E3_policy_ask_written', policy.status === 200, JSON.stringify(policy.data).slice(0, 200));

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], {
      cwd: path.join(ROOT, 'frontend'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');

    const electronEnv = {
      ...process.env,
      PETRI_TEST_INSTANCE: '1',
      PETRI_TEST_ONSCREEN: '1',
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
    ], {
      cwd: ROOT,
      env: electronEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    assert('E4_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B244_PROJECT_ID = String(projectId);
    process.env.PETRI_B244_WORKSPACE = workspace;
    process.env.PETRI_B244_MOCK_RELEASE_URL = `http://127.0.0.1:${MOCK_PORT}/release`;
    process.env.PETRI_B244_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    process.env.PETRI_B244_DB_PATH = dbPath;
    await flow.run({ assert });
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E5_mock_provider_used', Boolean(stats && stats.calls >= 4), JSON.stringify(stats || null).slice(0, 240));
    flowResult = { assertions, allPass: assertions.every((item) => item.pass), stats };
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    flowResult = { assertions, allPass: false };
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    try { mockServer.close(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'ui552-approval-tail-live',
      darkMode: process.env.PETRI_B244_DARK === '1',
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui552-approval-tail-live-dark.json' : 'ui552-approval-tail-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
