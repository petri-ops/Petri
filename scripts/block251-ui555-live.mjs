#!/usr/bin/env node
/**
 * BLOCK-251 — UI-555 实机腿（划词动作 / 图片预览 / 计划反馈）。
 *
 * 姿势与 BLOCK-246/250 相同：隔离后端 :3001 + Vite :3000 + Electron 测试实例 CDP :9223
 * + 临时数据根 + mock OpenAI-compatible provider（请求体全量留档，零真实 key）。
 * 离屏：不设 PETRI_TEST_ONSCREEN，默认 show:false。
 *
 * 三角色面的证据口径：
 *   · 划词动作：真实 DOM Range + mouseup → 动作条 → 引用 chip / 速记 REST / 侧聊 dock / 复制载荷，
 *     发送后请求体里必须出现 `【引用 preview-note.md】` 与原文；
 *   · 图片预览：Canvas 生成两张真 PNG → ClipboardEvent 粘贴 → 1/2 → 2/2 → 200%/50% → 保存锚点；
 *   · 计划反馈：隔离库合成 draft 计划（夹具，报告标注 synthetic）→ 卡片意见 → mock 请求体含意见
 *     与 planId，且 REST 读回计划仍为 draft。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-555/ + 同份 acceptance/block-251/。
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
const planLifecycle = require('../core/petri-server/helpers/plan-lifecycle.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const MOCK_PORT = Number(process.env.UI555_MOCK_PORT || 39055);
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui555-preview-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-555');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-251');
const REPLY_TEXT = 'UI-555 探针：已收到。';
const PLAN_ID = 'plan_ui555_live';
const PLAN_TITLE = 'UI-555 计划反馈样本';
const FEEDBACK = '第二步拆成两步：先做质控，再跑降维';

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
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

// ---------- mock OpenAI SSE provider（只回文本；请求体全量留档） ----------
let providerCalls = 0;
const mockRequests = [];

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
        .end(JSON.stringify({ calls: providerCalls, requests: mockRequests }));
      return;
    }
    if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        mockRequests.push({ n: providerCalls, userText: lastUserText(parsed.messages) });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        for (const piece of [REPLY_TEXT.slice(0, 6), REPLY_TEXT.slice(6)]) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
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

function seedWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'preview-note.md'), [
    '# UI-555 预览样本',
    '',
    '划词动作实机样本第一句。',
    '',
    '第二段用于验证加入速记与侧聊。',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
  ].join('\n'), 'utf8');
}

/** 合成 draft 计划（夹具）：批准卡数据源；报告里标 synthetic，不冒充模型产出。 */
function seedDraftPlan(dbPath, conversationId) {
  const db = new Database(dbPath);
  try {
    planLifecycle.ensurePlanBaseSchema(db);
    planLifecycle.ensureBlock55PlanSchema(db);
    try { db.exec('ALTER TABLE copilot_plans ADD COLUMN conversation_id TEXT'); } catch { /* exists */ }
    const now = new Date().toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO copilot_plans(id, user_id, title, goal, status, chat_context_excerpt, spec_md, conversation_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      PLAN_ID,
      'local-user',
      PLAN_TITLE,
      '验证计划调整意见不会停在输入框',
      'draft',
      'UI-555 计划反馈实机夹具',
      '# 目标\n把计划意见带回模型，而不是只收起卡片。',
      conversationId,
      now,
      now,
    );
    db.prepare('DELETE FROM copilot_plan_steps WHERE plan_id=?').run(PLAN_ID);
    const stepInsert = db.prepare(
      'INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, ts) VALUES (?,?,?,?,?,?,?)',
    );
    stepInsert.run(PLAN_ID, 1, '读取工作区并质控', '先做 QC', 'subagent', 'pending', now);
    stepInsert.run(PLAN_ID, 2, '降维与聚类', null, null, 'pending', now);
  } finally {
    db.close();
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui555-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  // 显式 model_profiles 才保留 capabilities：旧 chat_model_presets 在 normalizeAiSettings
  // 里只留 id/label/provider/model/baseUrl/contextWindow，vision 能力位会被剥掉，
  // 图片前置门（chatVisionCapable）就恒为 false。
  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui555-mock',
    chat_provider: 'openai-compatible',
    chat_model_presets: [{
      id: 'ui555-mock',
      label: 'UI-555 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      contextWindow: 24000,
    }],
    model_profiles: [{
      id: 'ui555-mock',
      label: 'UI-555 Mock',
      provider: 'openai-compatible',
      protocol: 'openai-compatible',
      model: 'mock-1',
      defaultModel: 'mock-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      contextWindow: 24000,
      capabilities: ['chat', 'streaming', 'tools', 'vision'],
      roles: ['chat', 'vision'],
    }],
    model_role_bindings: { chat: 'ui555-mock', vision: 'ui555-mock' },
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
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
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

    const project = await rest('POST', '/data/projects', { name: 'UI-555 三面实机探针项目' });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    seedWorkspace(workspace);

    const conv = await rest('POST', '/ai/conversations', { title: 'UI-555 三面会话', projectId });
    const conversationId = conv.data?.conversation?.id || null;
    assert('E2_conversation_created', Boolean(conversationId), `conversationId=${conversationId} status=${conv.status}`);
    if (!conversationId) throw new Error('conversation_create_failed');

    seedDraftPlan(dbPath, conversationId);
    const draft = await rest('GET', `/ai/plans?conversationId=${encodeURIComponent(conversationId)}&status=draft`);
    const draftPlans = Array.isArray(draft.data?.plans) ? draft.data.plans : [];
    assert('E3_synthetic_draft_plan', draftPlans.some((row) => row.id === PLAN_ID && row.status === 'draft' && (row.steps || []).length === 2),
      `plans=${draftPlans.length} steps=${(draftPlans.find((row) => row.id === PLAN_ID)?.steps || []).length} status=${draft.status}`);

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
    assert('E4_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B251_PROJECT_ID = String(projectId);
    process.env.PETRI_B251_WORKSPACE = workspace;
    process.env.PETRI_B251_CONVERSATION_ID = String(conversationId);
    process.env.PETRI_B251_DB_PATH = dbPath;
    process.env.PETRI_B251_PLAN_ID = PLAN_ID;
    process.env.PETRI_B251_PLAN_TITLE = PLAN_TITLE;
    process.env.PETRI_B251_FEEDBACK = FEEDBACK;
    process.env.PETRI_B251_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    await flow.run({ assert });
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E5_mock_provider_used', Boolean(stats && stats.calls >= 2), JSON.stringify(stats && stats.calls));
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
      name: 'ui555-preview-live',
      darkMode: process.env.PETRI_B251_DARK === '1',
      syntheticDraftPlan: PLAN_ID,
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui555-preview-live-dark.json' : 'ui555-preview-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    for (const name of fs.readdirSync(EVIDENCE_UI)) {
      if (!name.endsWith('.png') && !name.endsWith('-screenshots.json')) continue;
      fs.copyFileSync(path.join(EVIDENCE_UI, name), path.join(EVIDENCE_BLOCK, name));
    }
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
