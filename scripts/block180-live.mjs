/**
 * scripts/block180-live.mjs — BLOCK-180 执行审批一等资源实机探针。
 *
 * 形态：隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录+独立端口，同
 * block179 姿势，用户空间零残留）+ mock OpenAI SSE provider 走真实 agent 全链。
 *
 * A[审批全链]：mock 注入 workspace_exec「vssadmin list shadows」（首 token 命中
 *   动态防护、执行只读无副作用）→ deny 信封携 requestId/spans → 探针以用户身份
 *   POST guard-ack 请求级 approve → 模型重试同调用 → 指纹放行真实执行（第二从
 *   tool_result 非 policy 拒绝）→ 正常收口。
 * B[决策边缘]：未知 requestId 决策→409；存量键级 ack（无 requestId）→ok（向后兼容）。
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
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-180');
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
// 请求计数脚本：req1/req2=同一破坏命令工具调用（deny 后模型重试），req3=收口答复。
const DANGEROUS_COMMAND = 'vssadmin list shadows';
const FINAL_TEXT = '审批链路收口：危险命令已按你的批准真实执行完毕。';
let providerCalls = 0;
let approvalSignalResolve = null; // req2 等待用户决策（探针 POST guard-ack 后放行）
const approvalGate = new Promise((r) => { approvalSignalResolve = r; });
function awaitApproval() { return approvalGate; }
const mockRequests = [];
function startMockServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}
        const lastUser = [...(parsed.messages || [])].reverse().find((m) => m && m.role === 'user');
        mockRequests.push({ n: providerCalls, lastUser: String((lastUser && lastUser.content) || '').slice(0, 40) });
        console.log(`  [mock] req#${providerCalls} lastUser=${mockRequests[mockRequests.length - 1].lastUser}`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (providerCalls === 2) {
          // 等待探针以用户身份完成决策（审批卡语义：任务停在等用户，不抢跑）
          await awaitApproval();
        }
        if (providerCalls <= 2) {
          const args = JSON.stringify({ command: DANGEROUS_COMMAND });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_b180_${providerCalls}`, type: 'function', function: { name: 'workspace_exec', arguments: args } }] } }] })}\n\n`);
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

// ---------- SSE collector（信封帧归一，同 block179） ----------
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block180-live-'));
  const mockPort = await freePort();
  const backendPort = await freePort();

  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'block180-mock',
    chat_model_presets: [{
      id: 'block180-mock',
      label: 'B180 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      contextWindow: 24000,
    }],
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
  backend.stdout.on('data', (d) => { const t = d.toString(); if (t.includes('Error')) console.log('  [backend]', t.slice(0, 160)); });
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
    const project = await api('POST', '/api/data/projects', { name: 'BLOCK-180 探针项目' });
    const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;
    const conversation = projectId ? await api('POST', '/api/ai/conversations', { title: 'BLOCK-180 审批链', project_id: projectId }) : null;
    const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;
    record('env.project-conversation', Boolean(projectId && conversationId), `projectId=${projectId}`);

    const start = await api('POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'block180-mock',
      messages: [{ role: 'user', content: '查一下卷影副本列表' }],
      context: { accessMode: 'full' },
    });
    const taskId = start.json?.taskId || null;
    record('A.task-started', Boolean(taskId), `taskId=${taskId}`);
    if (taskId) {
      // 等 deny 事件在场再决策（模拟用户在审批卡看到拒绝）
      let denyEvent = null;
      let events = [];
      for (let i = 0; i < 40 && !denyEvent; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        events = await collectTaskEvents(API, taskId, 8000).catch(() => []);
        denyEvent = events.find((e) => e.toolResult && e.toolResult.data && e.toolResult.data.error === 'dynamic_guard_triggered' && e.toolResult.data.requestId);
      }
      record('A.deny-envelope', Boolean(denyEvent),
        denyEvent
          ? `requestId=${denyEvent.toolResult.data.requestId} spans=${JSON.stringify(denyEvent.toolResult.data.spans || []).slice(0, 160)}`
          : 'deny 信封缺席（事件见证据 json）');
      record('A.spans-attached', Boolean(denyEvent && Array.isArray(denyEvent.toolResult.data.spans) && denyEvent.toolResult.data.spans.length > 0),
        denyEvent ? `首 span kind=${denyEvent.toolResult.data.spans[0] && denyEvent.toolResult.data.spans[0].kind}` : '无');

      // B[决策边缘·存活期]：未知 requestId 决策→409（任务运行中 store 在册）
      const unknownMidRun = await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, {
        requestId: 'apr_unknown_probe', decision: 'approve',
      });
      record('B.unknown-request-409', unknownMidRun.status === 409 && unknownMidRun.json?.error === 'request_not_found',
        `status=${unknownMidRun.status} error=${unknownMidRun.json?.error}（任务存活期 store 在册）`);

      let ack = { status: 0, json: null };
      if (denyEvent) {
        const dData = denyEvent.toolResult.data;
        ack = await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, {
          requestId: dData.requestId,
          guardKey: dData.guardKey,
          decision: 'approve',
        });
        if (approvalSignalResolve) approvalSignalResolve(); // 放行 mock req2（模型重试）
      }
      record('A.request-decision', ack.status === 200 && ack.json?.ok === true,
        `status=${ack.status} resp=${JSON.stringify(ack.json || {}).slice(0, 120)}`);

      const eventsAll = await collectTaskEvents(API, taskId);
      const guardAckEvent = eventsAll.find((e) => e.event === 'guard_ack' && e.requestId === (denyEvent && denyEvent.toolResult.data.requestId));
      record('A.guard-ack-event', Boolean(guardAckEvent),
        guardAckEvent ? `decision=${guardAckEvent.decision} spans=${Array.isArray(guardAckEvent.spans) ? guardAckEvent.spans.length : 0}` : '决策事件缺席');

      // 第二次 workspace_exec 尝试：第一次 denied、第二次非 policy 拒绝（真实执行——vssadmin 可能 OS 失败，属执行面）
      const execResults = eventsAll.filter((e) => e.event === 'tool_result' && e.name === 'workspace_exec');
      const firstDenied = execResults[0] && execResults[0].toolResult && execResults[0].toolResult.data
        && execResults[0].toolResult.data.error === 'dynamic_guard_triggered';
      const second = execResults[1] && execResults[1].toolResult && execResults[1].toolResult.data;
      const secondBlocked = Boolean(second && second.error === 'dynamic_guard_triggered');
      record('A.retry-executed', Boolean(firstDenied && execResults.length >= 2 && !secondBlocked),
        `workspace_exec tool_result ${execResults.length} 条：首次 denied=${Boolean(firstDenied)}，第二次 policy 重拦=${secondBlocked ? '有' : '无'}（指纹放行生效）`);
      record('A.task-completed', eventsAll.some((e) => e.event === 'done'), '任务正常收口');

      const legacy = await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, {
        guardKey: 'cmd:dd', always: true,
      });
      record('B.legacy-key-ack', legacy.status === 200 && legacy.json?.ok === true, '存量键级 ack 向后兼容');

      fs.writeFileSync(path.join(EVIDENCE_DIR, 'block180-live-events.json'),
        JSON.stringify({
          taskId,
          inventory: eventsAll.map((e) => `${e.event || e._eventType || '?'}`).slice(0, 60),
          denyEvent: denyEvent || null,
          providerCalls,
        }, null, 2));
      await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/cancel`).catch(() => {});
    }
  }

  try { backend.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  try { backend.kill('SIGKILL'); } catch {}
  mockServer.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  record('cleanup', true, '隔离后端+mock+临时目录已清场');

  const pass = results.filter((r) => r.ok).length;
  const summary = { probe: 'block180-live', at: new Date().toISOString(), platform: `${os.platform()}-${os.arch()}`, pass, total: results.length, results };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block180-live.json'), JSON.stringify(summary, null, 2));
  console.log(`\n=== block180-live: ${pass}/${results.length} PASS（证据 acceptance/block-180/block180-live.json）===`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exitCode = 1;
});
