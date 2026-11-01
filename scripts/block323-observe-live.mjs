/**
 * scripts/block323-observe-live.mjs — BLOCK-323 放权坡道实机探针（隔离后端，同 block180/243 姿势）。
 *
 * 形态：隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录+独立端口，用户空间零残留）
 * + mock OpenAI SSE provider 走真实 agent 全链。observe 规则预先写进隔离 agent-rules.json。
 *
 * A[观察档]：mock 注入 workspace_exec「npm --version」（observe 规则 command-token npm 命中）
 *   → 不拦截真实执行 → GET /api/ai/policy-observations 出 rule-observe 行（hits≥1、样本含 npm）。
 * B[复盘升级]：经真实 REST PUT 把规则 observe→allow → policy-change 留痕行在场；
 *   重跑同命令 → 自动执行 + rule-auto-allow 审计行 + task_event permission.auto_allowed。
 * C[安全地板]：再加 vssadmin allow 规则 → 破坏命令仍被动态防护拦（deny 信封携 requestId），
 *   且无 rule-auto-allow 行——「人推车」红线：allow 档不豁免系统级安全网。
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
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-323');
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

// ---------- mock OpenAI SSE provider ----------
// 调用脚本（按 provider 调用序）：1/2=任务1（npm 观察档）、3/4=任务2（npm 放行档）、
// 5/6=任务3（vssadmin allow 撞动态防护，deny 后模型收口）。
let providerCalls = 0;
const NPM_COMMAND = 'npm --version';
const VSS_COMMAND = 'vssadmin list shadows';
const FINAL_TEXT = 'BLOCK-323 探针收口：本次命令已按放权坡道语义处理完毕。';
const mockLog = [];
function startMockServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      req.on('data', () => {});
      req.on('end', () => {
        providerCalls += 1;
        mockLog.push({ n: providerCalls });
        console.log(`  [mock] req#${providerCalls}`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const command = providerCalls === 5 ? VSS_COMMAND : NPM_COMMAND;
        if (providerCalls % 2 === 1) {
          const args = JSON.stringify({ command });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_b323_${providerCalls}`, type: 'function', function: { name: 'workspace_exec', arguments: args } }] } }] })}\n\n`);
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

// ---------- SSE collector（同 block180 信封帧归一） ----------
async function collectTaskEvents(apiBase, taskId, timeoutMs = 60_000) {
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
            const ev = parsed && parsed.eventType && parsed.payload
              ? { ...parsed.payload, _seq: parsed.seq, _eventType: parsed.eventType }
              : parsed;
            events.push(ev);
            if (ev && ['done', 'error', 'agent_cancelled', 'fatal_agent_error'].includes(ev.event)) done = true;
          } catch { /* 心跳注释行等 */ }
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

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block323-live-'));
  const mockPort = await freePort();
  const backendPort = await freePort();

  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'block323-mock',
    chat_model_presets: [{
      id: 'block323-mock',
      label: 'B323 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      contextWindow: 24000,
    }],
  }, null, 2));

  // 观察规则预先落盘（隔离数据根）：npm → observe
  fs.writeFileSync(path.join(tmpDir, 'agent-rules.json'), JSON.stringify({
    version: 1,
    rules: [{ id: 'r-npm', matcher: { type: 'command-token', pattern: 'npm' }, action: 'observe', scope: 'global' }],
  }, null, 2));

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  const Database = require('better-sqlite3');
  const bootDb = new Database(path.join(tmpDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  bootDb.close();

  const backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: {
      ...process.env,
      PETRI_DB_PATH: path.join(tmpDir, 'petri.db'),
      PETRI_LOCAL_DATA_DIR: tmpDir,
      R_SERVER_PORT: String(backendPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.on('data', (d) => { const t = d.toString(); if (t.includes('Error')) console.log('  [backend:ERR]', t.slice(0, 160)); });

  const API = `http://127.0.0.1:${backendPort}`;
  let stackUp = false;
  for (let i = 0; i < 40 && !stackUp; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) });
      stackUp = r.ok;
    } catch { /* not yet */ }
  }
  record('env.isolated-backend', stackUp, `隔离后端 :${backendPort} 健康`);

  if (stackUp) {
    const api = async (method, url, body) => {
      const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const project = await api('POST', '/api/data/projects', { name: 'BLOCK-323 探针项目' });
    const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;

    async function runTask(label, userText) {
      const conversation = projectId ? await api('POST', '/api/ai/conversations', { title: `BLOCK-323 ${label}`, project_id: projectId }) : null;
      const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;
      const start = await api('POST', '/api/ai/agent', {
        conversationId,
        modelPresetId: 'block323-mock',
        messages: [{ role: 'user', content: userText }],
        // 路由不从 conversationId 派生 projectId：工具工作区解析要求显式传入（否则 project_required）
        context: { accessMode: 'full', projectId },
      });
      const taskId = start.json?.taskId || null;
      if (!taskId) return { taskId: null, events: [] };
      const events = await collectTaskEvents(API, taskId, 90_000).catch(() => []);
      return { taskId, events };
    }

    // ---------- A[观察档] ----------
    const a = await runTask('观察档', '查一下 npm 版本');
    record('A.task-started', Boolean(a.taskId), `taskId=${a.taskId}`);
    const aDenied = a.events.some((e) => e.toolResult && e.toolResult.data && String(e.toolResult.data.error || '').includes('require_ack'));
    record('A.observe-not-intercepted', Boolean(a.taskId) && !aDenied, 'observe 命中未拦截（无 require_ack 信封）');
    const aDone = a.events.some((e) => e.event === 'done');
    record('A.task-completed', aDone, '任务正常收口');
    const obsA = await api('GET', '/api/ai/policy-observations');
    const aRow = (obsA.json?.unreviewed || []).find((row) => row.kind === 'rule-observe' && row.ruleId === 'r-npm');
    record('A.observation-recorded', Boolean(aRow) && aRow.hits >= 1 && String(aRow.samplePreview || '').includes('npm'),
      aRow ? `hits=${aRow.hits} sample=${String(aRow.samplePreview).slice(0, 60)}` : 'rule-observe 行缺席');

    // ---------- B[复盘升级：真实 REST PUT] ----------
    const rulesNow = await api('GET', '/api/ai/agent-rules');
    const rules = (rulesNow.json?.rules || []).map((r) => (r.id === 'r-npm' ? { ...r, action: 'allow' } : r));
    const put = await api('PUT', '/api/ai/agent-rules', { rules });
    record('B.rule-upgraded', put.status === 200 && put.json?.status === 'ok', `PUT /api/ai/agent-rules → ${put.status}`);
    await new Promise((r) => setTimeout(r, 400));
    const obsB1 = await api('GET', '/api/ai/policy-observations');
    const changeRow = (obsB1.json?.policyChanges || []).find((row) => String(row.samplePreview || '').includes('r-npm'));
    record('B.policy-change-recorded', Boolean(changeRow), changeRow ? `摘要=${String(changeRow.samplePreview).slice(0, 80)}` : 'policy-change 行缺席');

    const b = await runTask('放行档', '再查一次 npm 版本');
    const bDenied = b.events.some((e) => e.toolResult && e.toolResult.data && String(e.toolResult.data.error || '').includes('require_ack'));
    record('B.auto-allowed-executes', Boolean(b.taskId) && !bDenied && b.events.some((e) => e.event === 'done'), 'allow 档自动执行不询问');
    const autoEvent = b.events.find((e) => (e.event === 'permission.auto_allowed' || e._eventType === 'permission.auto_allowed'));
    record('B.task-event-auto-allowed', Boolean(autoEvent) && autoEvent.ruleId === 'r-npm',
      autoEvent ? `ruleId=${autoEvent.ruleId}` : 'permission.auto_allowed 事件缺席');
    const obsB2 = await api('GET', '/api/ai/policy-observations');
    const autoRow = (obsB2.json?.autoAllow || []).find((row) => row.ruleId === 'r-npm');
    record('B.auto-allow-audit-row', Boolean(autoRow) && autoRow.hits >= 1, autoRow ? `hits=${autoRow.hits}` : 'rule-auto-allow 行缺席');

    // ---------- C[安全地板] ----------
    const rules2 = [...rules, { id: 'r-vss', matcher: { type: 'command-token', pattern: 'vssadmin' }, action: 'allow', scope: 'global' }];
    await api('PUT', '/api/ai/agent-rules', { rules: rules2 });
    await new Promise((r) => setTimeout(r, 400));
    const c = await runTask('安全地板', '列出卷影副本');
    const denyEvent = c.events.find((e) => e.toolResult && e.toolResult.data && e.toolResult.data.error === 'dynamic_guard_triggered' && e.toolResult.data.requestId);
    record('C.dynamic-guard-still-denies', Boolean(denyEvent),
      denyEvent ? `requestId=${denyEvent.toolResult.data.requestId}` : '动态防护未拦（红线破）');
    const obsC = await api('GET', '/api/ai/policy-observations');
    const vssAuto = (obsC.json?.autoAllow || []).find((row) => row.ruleId === 'r-vss');
    record('C.no-auto-allow-for-dangerous', !vssAuto, '破坏命令无自动放行审计行（地板未被穿透）');

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block323-live-events.json'),
      JSON.stringify({
        mockCalls: providerCalls,
        taskA: a.events.map((e) => `${e.event || e._eventType || '?'}`).slice(0, 40),
        taskB: b.events.map((e) => `${e.event || e._eventType || '?'}`).slice(0, 40),
        taskC: c.events.map((e) => `${e.event || e._eventType || '?'}`).slice(0, 40),
        observationA: aRow || null,
        autoAllowRow: autoRow || null,
        policyChange: changeRow || null,
      }, null, 2));
  }

  try { backend.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  try { backend.kill('SIGKILL'); } catch {}
  mockServer.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  record('cleanup', true, '隔离后端+mock+临时目录已清场');

  const pass = results.filter((r) => r.ok).length;
  const summary = { probe: 'block323-observe-live', at: new Date().toISOString(), platform: `${os.platform()}-${os.arch()}`, pass, total: results.length, results };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block323-observe-live.json'), JSON.stringify(summary, null, 2));
  console.log(`\n=== block323-observe-live: ${pass}/${results.length} PASS（证据 acceptance/block-323/block323-observe-live.json）===`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exitCode = 1;
});
