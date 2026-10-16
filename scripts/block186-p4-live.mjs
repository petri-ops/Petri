/**
 * scripts/block186-p4-live.mjs — BLOCK-186 本地漏斗台账自动化实机探针（无人眼）。
 *
 * 形态（仿 block180 姿势）：隔离后端（temp PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR + 独立端口，
 * 用户空间零残留）+ mock OpenAI provider（纯文本收口，无工具调用→任务直达 done）。
 * 全程无 Electron、无 CDP、无人眼，纯后端 HTTP + 直读 temp 库断言。
 *
 * 断言链（TTFS 三锚点，全经真实后端进程落账，非注入）：
 *   A app_started        —— 后端 server.listen 钩子旁挂（BLOCK-186 Design Y）。
 *   B project_created    —— POST /api/data/projects 成功处旁挂。
 *   C first_job_succeeded —— mock agent 任务成功终态 markAgentTaskDone 旁挂。
 *   D computeTTFS         —— 注入真实 temp 库句柄，验证**已发布的 computeTTFS**算出非 null
 *                            （跨进程写、父进程读，WAL 可见），并逐条 recentFunnelEvents 回放。
 * 证据落 acceptance/block-186/block186-p4-live.json。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-186');
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 200)}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ---------- mock OpenAI SSE provider：纯文本收口，无工具调用 → agent 循环一次即 done ----------
const FINAL_TEXT = 'BLOCK-186 探针：任务已完成（无工具调用的纯文本收口）。';
let providerCalls = 0;
function startMockServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      req.on('data', () => { /* 排空请求体以触发 end；mock 恒返回固定收口文本，不解析入参 */ });
      req.on('end', () => {
        providerCalls += 1;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: FINAL_TEXT } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
}

async function collectTaskEvents(apiBase, taskId, timeoutMs = 90_000) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase}/api/ai/agent/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: AUTH.Authorization },
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
          } catch { /* 心跳注释行 */ }
        }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') console.log('  [evt] collection timeout');
    else throw e;
  } finally {
    clearTimeout(timer);
    try { controller.abort(); } catch {}
  }
  return events;
}

// 直读 temp 库某事件是否有行（父进程 readonly 连接，WAL 可见后端进程提交）
function countEvent(dbPath, event) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM funnel_events WHERE event = ?').get(event);
    return Number(row?.c || 0);
  } finally {
    db.close();
  }
}

async function waitEvent(dbPath, event, timeoutMs = 15_000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 500); i += 1) {
    try { if (countEvent(dbPath, event) > 0) return true; } catch { /* 表尚未可见/锁 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block186-live-'));
  const dbPath = path.join(tmpDir, 'petri.db');
  const mockPort = await freePort();
  const backendPort = await freePort();

  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'block186-mock',
    chat_model_presets: [{
      id: 'block186-mock',
      label: 'B186 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      contextWindow: 24000,
    }],
  }, null, 2));

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  // 应用全部 src/migrations（含 014_funnel_events），与 block180 同姿势——core db.js 不自跑这些迁移。
  const Database = require('better-sqlite3');
  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  bootDb.close();

  const backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: tmpDir, R_SERVER_PORT: String(backendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (d) => { const t = d.toString(); if (t.includes('Error')) console.log('  [backend]', t.slice(0, 160)); });
  backend.stderr.on('data', (d) => { const t = d.toString(); if (t.includes('Error')) console.log('  [backend:ERR]', t.slice(0, 160)); });

  const API = `http://127.0.0.1:${backendPort}`;
  let stackUp = false;
  for (let i = 0; i < 40 && !stackUp; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try { stackUp = (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* not yet */ }
  }
  record('env.isolated-backend', stackUp, `隔离后端 :${backendPort} 健康 / db=${path.basename(dbPath)}`);

  try {
    if (!stackUp) throw new Error('backend-not-healthy');

    // A：后端 listen 钩子已旁挂 app_started——健康即应落账
    const appStarted = await waitEvent(dbPath, 'app_started', 8000);
    record('A.app_started-logged', appStarted, `funnel_events app_started 行数=${appStarted ? countEvent(dbPath, 'app_started') : 0}`);

    // B：创建项目 → project_created
    const api = async (method, url, body) => {
      const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const project = await api('POST', '/api/data/projects', { name: 'BLOCK-186 漏斗探针项目' });
    const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;
    record('B.project-created-api', Boolean(projectId), `status=${project.status} projectId=${projectId}`);
    const projLogged = await waitEvent(dbPath, 'project_created', 8000);
    record('B.project_created-logged', projLogged, `funnel_events project_created 行数=${projLogged ? countEvent(dbPath, 'project_created') : 0}`);

    // C：跑 mock agent 任务至 done → markAgentTaskDone → first_job_succeeded
    const conversation = projectId ? await api('POST', '/api/ai/conversations', { title: 'BLOCK-186 漏斗链', project_id: projectId }) : null;
    const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;
    const start = conversationId ? await api('POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'block186-mock',
      messages: [{ role: 'user', content: '你好，随便说点什么（探针触发一次成功任务）' }],
      context: { accessMode: 'full' },
    }) : { json: null };
    const taskId = start.json?.taskId || null;
    record('C.task-started', Boolean(taskId), `conversationId=${conversationId} taskId=${taskId}`);

    let jobLogged = false;
    if (taskId) {
      const events = await collectTaskEvents(API, taskId, 90_000);
      const terminal = events.some((e) => e && e.event === 'done');
      record('C.task-reached-done', terminal, `events=${events.length} providerCalls=${providerCalls}`);
      jobLogged = await waitEvent(dbPath, 'first_job_succeeded', 10_000);
      record('C.first_job_succeeded-logged', jobLogged, `funnel_events first_job_succeeded 行数=${jobLogged ? countEvent(dbPath, 'first_job_succeeded') : 0}`);
    } else {
      record('C.task-reached-done', false, 'no taskId');
      record('C.first_job_succeeded-logged', false, 'no task');
    }

    // D：验证**已发布的 computeTTFS** 对真实跨进程数据算出非 null（注入 temp 库句柄，非重实现 SQL）
    const funnelLog = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'funnel-log.js'));
    const readDb = new Database(dbPath, { readonly: true });
    funnelLog._setFunnelDb(readDb);
    const ttfs = await funnelLog.computeTTFS();
    const recent = await funnelLog.recentFunnelEvents({ limit: 50 });
    record('D.computeTTFS-computable', Boolean(ttfs && Number.isFinite(ttfs.ttfsMs) && ttfs.ttfsMs >= 0),
      `ttfsMs=${ttfs?.ttfsMs} appStartedAt=${ttfs?.appStartedAt} firstSuccessAt=${ttfs?.firstSuccessAt}`);
    record('D.recent-events-nonempty', Array.isArray(recent) && recent.length >= 3, `recent=${(recent || []).map((r) => r.event).join(',')}`);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block186-p4-live.json'), JSON.stringify({
      ranAt: new Date().toISOString(),
      allPass: results.every((r) => r.ok),
      ttfsMs: ttfs?.ttfsMs ?? null,
      eventsSeen: (recent || []).map((r) => r.event),
      results,
    }, null, 2));
    try { readDb.close(); } catch { /* injected handle stays open in funnel-log cache */ }
  } catch (e) {
    record('fatal', false, e && (e.stack || e.message));
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block186-p4-live.json'), JSON.stringify({
      ranAt: new Date().toISOString(), allPass: false, error: String(e && (e.message || e)), results,
    }, null, 2));
  } finally {
    try { backend.kill('SIGKILL'); } catch { /* already gone */ }
    try { mockServer.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const allPass = results.every((r) => r.ok);
  console.log(`\n${allPass ? 'ALL PASS' : 'SOME FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) → acceptance/block-186/block186-p4-live.json`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
