#!/usr/bin/env node
/**
 * BLOCK-248 — Q3 执行轨迹实机腿（隔离栈 + mock provider，零真实 key）。
 *
 * 与 BLOCK-247 同姿势（:3001 后端 + :3000 Vite + :9223 Electron 测试实例 + 临时数据根），
 * 差异在断言面：一条**真实失败**的工具链 → 执行轨迹 → 错误筛选 → 定位失败 → 模型 I/O 互链 → 证据面聚合。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着就 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-558/（亮/暗截图 + 断言 JSON）+ 同份复制到 acceptance/block-248/。
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
const MOCK_PORT = Number(process.env.UI558_MOCK_PORT || 39055);
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui558-trace-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-558');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-248');

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

/** 杀整棵进程树：先试 Windows taskkill（POSIX 上必然抛），失败再走 POSIX signal。 */
function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  } catch { /* 非 Windows / 已退出 */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

// ---------- mock OpenAI SSE provider ----------
let providerCalls = 0;
const mockRequests = [];
let scriptCursor = 0;

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = [...list].reverse().find((m) => m && m.role === 'user');
  const content = last ? last.content : '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => String(part?.text || '')).join(' ');
  return String(content || '');
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
    if (req.method === 'GET' && url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ calls: providerCalls, requests: mockRequests, scriptCursor }));
      return;
    }
    if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
        mockRequests.push({
          n: providerCalls,
          userText: typeof lastUser?.content === 'string' ? lastUser.content : '',
          toolMessages: messages.filter((m) => m && m.role === 'tool').length,
        });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

        const userText = lastUserText(messages);
        const toolCount = messages.filter((m) => m && m.role === 'tool').length;
        const isChatTurn = /轨迹/.test(String(userText || ''));
        let next = { type: 'text', text: '已尝试读取缺失文件，失败原因与事件顺序见执行轨迹。' };
        if (isChatTurn && toolCount === 0) {
          // 真实失败：读一个不存在的文件 → handler ENOENT → tool_result status=error
          next = { type: 'tool', name: 'workspace_read', args: { path: 'missing-trace-file.txt' } };
        }
        scriptCursor += 1;

        if (next.type === 'tool') {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: `call_b248_${providerCalls}`,
                  type: 'function',
                  function: { name: next.name, arguments: JSON.stringify(next.args) },
                }],
              },
            }],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        } else {
          for (const piece of [next.text.slice(0, 8), next.text.slice(8)]) {
            if (!piece) continue;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        }
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

function seedWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'BLOCK-248 工作区说明\n', 'utf8');
  for (let i = 0; i < 5; i += 1) {
    fs.writeFileSync(path.join(workspace, `f${i}.txt`), `file ${i}\n`, 'utf8');
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  if (await portOpen(MOCK_PORT)) throw new Error(`mock 端口 :${MOCK_PORT} 已被占用`);

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui558-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui558-mock',
    chat_model_presets: [{
      id: 'ui558-mock',
      label: 'UI-558 Mock',
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

    const project = await rest('POST', '/data/projects', { name: 'UI-558 轨迹探针项目' });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    seedWorkspace(workspace);

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
    assert('E2_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B248_PROJECT_ID = String(projectId);
    process.env.PETRI_B248_PROJECT_NAME = 'UI-558 轨迹探针项目';
    process.env.PETRI_B248_WORKSPACE = workspace;
    process.env.PETRI_B248_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    process.env.PETRI_B248_DARK = process.env.UI558_DARK === '1' ? '1' : '0';
    await flow.run({ assert });
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E3_mock_provider_used', Boolean(stats && stats.calls >= 2), JSON.stringify(stats && stats.calls));
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
    try {
      const from = path.join(tempRoot, 'electron.log');
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(EVIDENCE_UI, 'electron.log'));
    } catch { /* 诊断文件缺失不影响断言 */ }
    try { mockServer.close(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'ui558-trace-live',
      darkMode: process.env.UI558_DARK === '1',
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui558-trace-live-dark.json' : 'ui558-trace-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    for (const name of fs.readdirSync(EVIDENCE_UI)) {
      if (!name.endsWith('.png')) continue;
      fs.copyFileSync(path.join(EVIDENCE_UI, name), path.join(EVIDENCE_BLOCK, name));
    }
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
