#!/usr/bin/env node
/**
 * BLOCK-246 — Q2 余项实机腿（速记板 / 消息动作 / @ 新源）（隔离栈 + mock provider，零真实 key）。
 *
 * 与 BLOCK-244 同姿势（:3001 后端 + :3000 Vite + :9223 Electron 测试实例 + 临时数据根），
 * 差异在断言面：本包要证的是「引用真的上行了」而不是「卡片画出来了」——
 *   ① mock provider 收到的请求体里含 `【引用…】` 引用块（反证：UI 有 chip 但没上行会红）；
 *   ② 同样加三条后移除一条重发，请求体里的引用块**变少**；
 *   ③ 超过逐源/分组上限时提示可见（C16：静默截断改可见）。
 *
 * 结果产物腿用**合成夹具**（隔离库里插一条 status='done' 的 tool_jobs）：
 * 真跑一条工具链会引入生信依赖与分钟级耗时，与本包结构面无关；报告里如实标注 synthetic。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着就 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-554/（亮/暗截图 + 断言 JSON）+ 同份复制到 acceptance/block-246/。
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
const MOCK_PORT = Number(process.env.UI557_MOCK_PORT || 39054);
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui557-web-access-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-557');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-247');
const SYNTHETIC_JOB_ID = 'tj_ui554_synthetic';

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

/** 杀整棵进程树：先试 Windows taskkill（POSIX 上必然抛），失败再走 POSIX signal。
 *  写成"试错式"而不是平台分支——平台判据收敛在 src/platform-compat.js，
 *  门禁 `platform-branch-freeze` 不允许新脚本再散落平台分支（连注释里的字面量也算）。 */
function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  } catch { /* 非 Windows / 已退出 */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

// ---------- mock OpenAI SSE provider（只回文本；请求体全量留档） ----------
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

/** 等流程侧打开授权（写 marker 文件）——让"关闭态被拒"与"开启后成功"落在同一轮里，
 *  避免第二轮发送撞上 ProjectWorkspace 既存重渲染环（AUDIT-LOG 已登记的抖动）。 */
async function waitForEnableMarker() {
  const marker = process.env.PETRI_B247_ENABLE_MARKER;
  if (!marker) return false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if (fs.existsSync(marker)) return true; } catch { /* ignore */ }
    await sleep(200);
  }
  return false;
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
    if (req.method === 'GET' && url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ calls: providerCalls, requests: mockRequests, scriptCursor }));
      return;
    }
    // 假 SearXNG：只回 JSON 结果（真实实例需 settings.yml 开 json 输出）
    if (req.method === 'GET' && url.pathname === '/search') {
      const query = url.searchParams.get('q') || '';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        query,
        results: [
          { title: '格物桌面版说明', url: 'https://wiki.example.org/petri', content: '格物是本地优先的 AI 陪伴学习平台。', engine: 'mock' },
          { title: '上下文装配笔记', url: 'https://notes.example.net/context', content: '单一 ComposerContextItem 通道。', engine: 'mock' },
        ],
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
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
        // 状态机（不按队列位置）：**只有本轮用户正文命中标记**才发工具调用，
        // 已经带 tool 结果的请求 → 回文本收尾；标题/记忆等旁路请求不碰工具。
        const userText = lastUserText(messages);
        // 本轮已回灌的工具结果条数 = 回合进度（0=还没调过工具，1=调过一次…）
        const toolCount = messages.filter((m) => m && m.role === 'tool').length;
        const isChatTurn = /联网检索|抓取/.test(String(userText || ''));
        let next = { type: 'text', text: '已按授权面完成联网动作（来源与拒绝原因见活动行）。' };
        if (isChatTurn) {
          if (toolCount === 0) {
            // 第 0 次：关闭态探针（应被拒：web_access_disabled）
            next = { type: 'tool', name: 'web_search', args: { query: String(userText || '').slice(0, 60) } };
          } else if (toolCount === 1) {
            // 第 1 次：**等授权面被打开**（流程侧写 marker）再发第二次检索
            await waitForEnableMarker();
            next = { type: 'tool', name: 'web_search', args: { query: '格物 联网检索（授权后）' } };
          } else if (toolCount === 2) {
            // 第 2 次：抓取云元数据地址（应被 SSRF 策略拒绝）
            next = { type: 'tool', name: 'web_fetch', args: { url: 'http://169.254.169.254/latest/meta-data/' } };
          }
        }
        scriptCursor += 1;
        if (next.type === 'tool') {
          // 逐 delta 分片发（整块发会在某些渲染路径丢字）
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: `call_b247_${providerCalls}`,
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
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'UI-557 工作区说明\n', 'utf8');
  for (let i = 0; i < 10; i += 1) {
    fs.writeFileSync(path.join(workspace, `f${i}.txt`), `file ${i}\n`, 'utf8');
  }
  // C16 文件夹整体引用的实机夹具：一个带子文件的目录
  fs.mkdirSync(path.join(workspace, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'analysis', 'qc.py'), 'import scanpy as sc\n', 'utf8');
  fs.writeFileSync(path.join(workspace, 'analysis', 'norm.py'), 'sc.pp.normalize_total(adata)\n', 'utf8');
}

/** 合成 done 产物（不是产品能力声明：结果源端点的可引用性验证夹具）。 */
function seedSyntheticJob(dbPath, projectId) {
  const db = new Database(dbPath);
  db.prepare(
    'INSERT OR REPLACE INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, completed_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(SYNTHETIC_JOB_ID, 'local', 'scanpy_recipe', '{}', 'done', Date.now(), 'UI-554 合成结果', Date.now(), projectId);
  db.close();
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  if (await portOpen(MOCK_PORT)) throw new Error(`mock 端口 :${MOCK_PORT} 已被占用`);

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui557-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  // 联网授权：**默认关**（enabled 不写 = false）。实机腿再经真实 API 打开。
  fs.writeFileSync(path.join(dataDir, 'web-search.json'), JSON.stringify({
    enabled: false,
    provider: 'none',
    searxngBaseUrl: '',
    maxResults: 5,
    timeoutMs: 10000,
    fetchMaxBytes: 1048576,
    allowedHosts: '',
    blockedHosts: '',
  }, null, 2));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui557-mock',
    chat_model_presets: [{
      id: 'ui557-mock',
      label: 'UI-557 Mock',
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

    const project = await rest('POST', '/data/projects', { name: 'UI-557 联网探针项目' });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    seedWorkspace(workspace);
    // 结果源要有一条已完成的 job；合成夹具（见文件头说明）。
    seedSyntheticJob(dbPath, projectId);
    const jobs = await rest('GET', `/data/projects/${projectId}/jobs`);
    const jobRows = Array.isArray(jobs.data?.jobs) ? jobs.data.jobs : [];
    assert('E2_synthetic_done_job', jobRows.some((row) => row.id === SYNTHETIC_JOB_ID && row.status === 'done'),
      `jobs=${jobRows.length} status=${jobs.status}`);

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
    assert('E3_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B247_PROJECT_ID = String(projectId);
    process.env.PETRI_B247_PROJECT_NAME = 'UI-557 联网探针项目';
    process.env.PETRI_B247_WORKSPACE = workspace;
    process.env.PETRI_B247_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    process.env.PETRI_B247_SEARXNG_URL = `http://127.0.0.1:${MOCK_PORT}`;
    process.env.PETRI_B247_AUDIT_FILE = path.join(dataDir, 'web-access-audit.jsonl');
    process.env.PETRI_B247_ENABLE_MARKER = path.join(tempRoot, 'web-access-enabled.marker');
    process.env.PETRI_B247_DARK = process.env.UI557_DARK === '1' ? '1' : '0';
    process.env.PETRI_B247_DB_PATH = dbPath;
    process.env.PETRI_B247_SYNTHETIC_JOB_ID = SYNTHETIC_JOB_ID;
    await flow.run({ assert });
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E4_mock_provider_used', Boolean(stats && stats.calls >= 2), JSON.stringify(stats && stats.calls));
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
    // 诊断留档：Electron/后端日志在 tempRoot 被删前先拷进证据目录（实机抓真要看它）
    try {
      for (const name of ['electron.log']) {
        const from = path.join(tempRoot, name);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(EVIDENCE_UI, name));
      }
    } catch { /* 诊断文件缺失不影响断言 */ }
    try { mockServer.close(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'ui557-web-access-live',
      darkMode: process.env.PETRI_B247_DARK === '1',
      syntheticArtifactJob: SYNTHETIC_JOB_ID,
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui557-web-access-live-dark.json' : 'ui557-web-access-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    // 截图同份落 block-246（证据目录双挂，不复制断言文件之外的东西）
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
