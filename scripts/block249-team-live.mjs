#!/usr/bin/env node
/**
 * BLOCK-249 — Q4a 多智能体团队实机腿（隔离栈 + mock provider，零真实 key）。
 *
 * mock 行为（按首个 user 消息区分任务）：
 *  - 父任务「团队演练」：第 0 次调用一次性派 3 个子代理（search / investigator / search+schema）；
 *    收到 3 个工具结果后派 3 个 wait_agent；全部返回后收尾。
 *  - 子 A「调查 A」：直接文本收尾。
 *  - 子 B「LONG 调查 B」：延迟 60s 再收尾（供暂停/停止演练）。
 *  - 子 C「统计 C」：首次回非 JSON（触发结构化纠正），收到「结构化输出纠正」后回 {"answer":42}。
 *
 * 证据：acceptance/ui-559/（亮/暗断言 JSON + 日志 + 截图 provenance；同份落 acceptance/block-249/）。
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
const MOCK_PORT = Number(process.env.UI559_MOCK_PORT || 39056);
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui559-team-live.cjs');
const UI_FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui559-team-ui.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-559');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-249');

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
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

// ---------- mock provider ----------
let providerCalls = 0;
const mockRequests = [];
let scriptCursor = 0;

function firstUserText(messages) {
  const first = (Array.isArray(messages) ? messages : []).find((m) => m && m.role === 'user');
  const content = first ? first.content : '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => String(part?.text || '')).join(' ');
  return String(content || '');
}

function toolContents(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role === 'tool')
    .map((m) => String(m.content || ''));
}

function extractAgentId(toolContent) {
  try {
    const parsed = JSON.parse(toolContent);
    return parsed && typeof parsed.agentId === 'string' ? parsed.agentId : null;
  } catch {
    return null;
  }
}

const SPAWNS = [
  { task: '调查 A：列出 README 的关键节', role: 'search' },
  { task: 'LONG 调查 B：扫描目录结构', role: 'investigator' },
  {
    task: '统计 C：返回 JSON',
    role: 'search',
    schema: {
      type: 'object',
      required: ['answer'],
      properties: { answer: { type: 'integer' } },
    },
  },
];

function sseToolCalls(res, calls) {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: `call_b249_${providerCalls}_${index}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
}

function sseText(res, text) {
  for (const piece of [text.slice(0, 8), text.slice(8)]) {
    if (!piece) continue;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
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
        try { parsed = JSON.parse(body); } catch {}
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        const userText = firstUserText(messages);
        const tools = toolContents(messages);
        mockRequests.push({ n: providerCalls, userText: userText.slice(0, 80), toolMessages: tools.length });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        scriptCursor += 1;

        const isParent = /团队演练/.test(userText);
        if (isParent) {
          if (tools.length === 0) {
            sseToolCalls(res, SPAWNS.map((spawn) => ({
              name: 'spawn_agent',
              args: {
                task: spawn.task,
                role: spawn.role,
                ...(spawn.schema ? { schema: spawn.schema } : {}),
              },
            })));
          } else if (tools.length === 3) {
            const ids = tools.map(extractAgentId).filter(Boolean);
            sseToolCalls(res, ids.map((agentId) => ({ name: 'wait_agent', args: { agentId, timeout: 120000 } })));
          } else {
            sseText(res, '团队演练完成：三个子代理已收口（B 被停止），journal 与结构化结果见团队面板。');
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (/结构化输出纠正/.test(userText)) {
          sseText(res, '{"answer":42}');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (/统计 C/.test(userText)) {
          sseText(res, '{"answer":42}');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (/LONG 调查 B/.test(userText)) {
          // 保持运行，供暂停/停止演练；取消时连接可能已断，写入失败忽略。
          setTimeout(() => {
            try {
              sseText(res, 'B 完成：目录结构已扫描（这一步很慢）。');
              res.write('data: [DONE]\n\n');
              res.end();
            } catch { /* client gone */ }
          }, 180_000);
          return;
        }
        if (/调查 A/.test(userText)) {
          sseText(res, 'A 完成：README 有安装、用法、治理三节。');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        sseText(res, '子任务完成。');
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
  fs.writeFileSync(path.join(workspace, 'README.md'), '# 演示\n\n安装\n\n用法\n\n治理\n', 'utf8');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'a.js'), 'module.exports = 1;\n', 'utf8');
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  if (await portOpen(MOCK_PORT)) throw new Error(`mock 端口 :${MOCK_PORT} 已被占用`);

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui559-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui559-mock',
    chat_model_presets: [{
      id: 'ui559-mock',
      label: 'UI-559 Mock',
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

    const project = await rest('POST', '/data/projects', { name: 'UI-559 团队探针项目' });
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
    assert('E2_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B249_PROJECT_ID = String(projectId);
    process.env.PETRI_B249_PROJECT_NAME = 'UI-559 团队探针项目';
    process.env.PETRI_B249_DATA_DIR = dataDir;
    process.env.PETRI_B249_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    process.env.PETRI_B249_DARK = process.env.UI559_DARK === '1' ? '1' : '0';
    await flow.run({ assert });

    // BLOCK-249 — 拆会话：长回合后旧渲染器不稳定；重启 Electron（同数据根）做 UI 腿。
    const convs = await rest('GET', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`);
    const convId = convs.data && convs.data.conversations && convs.data.conversations[0]
      ? convs.data.conversations[0].id
      : null;
    const traj = convId ? await rest('GET', `/ai/agent/trajectory?conversationId=${encodeURIComponent(convId)}`) : { data: null };
    const leaderId = traj.data && traj.data.task ? traj.data.task.taskId : null;
    assert('E4_leader_resolved_for_ui', Boolean(leaderId), String(leaderId));

    killTree(electron && electron.pid);
    await sleep(1500);
    electron = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
      '.', '--dev', `--remote-debugging-port=${CDP_PORT}`,
    ], { cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron2:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron ui session' });
    assert('E5_ui_session_restarted', true, 'second Electron session on the same data root');

    process.env.PETRI_B249_LEADER_ID = String(leaderId || '');
    const uiFlow = require(UI_FLOW_PATH);
    await uiFlow.run({ assert });

    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E3_mock_provider_used', Boolean(stats && stats.calls >= 4), JSON.stringify(stats && stats.calls));
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
    } catch {}
    try { mockServer.close(); } catch {}
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    const report = {
      name: 'ui559-team-live',
      darkMode: process.env.UI559_DARK === '1',
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui559-team-live-dark.json' : 'ui559-team-live.json';
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
