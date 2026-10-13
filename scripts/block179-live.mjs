/**
 * scripts/block179-live.mjs — BLOCK-179 正文工具块修复提升实机探针。
 *
 * 形态：隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录 + 独立端口，零触碰
 * 用户真实数据）+ mock OpenAI SSE provider（openai-compatible preset 指向本机
 * mock，脚本化注入正文退化场景，走真实 agent 循环/SSE/task_events 全链）。
 *
 * 断言：
 *   A[repair]：第 1 轮正文=围栏 JSON 工具调用（无原生 tool_calls）→
 *     tool_call_repair 透明事件在场 + system_info 真实执行（tool_call/tool_result）
 *     + 第 2 轮正常收口 + 第 2 轮请求含「原文保留+修复后 tool_calls」assistant 历史。
 *   B[keep]：正文=未知工具名演示形态 → 零修复零执行，按最终回答收口（存量行为）。
 *
 * 清场：杀隔离后端 + 关 mock + 删临时目录（隔离面即清场面，用户空间零残留）。
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
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-179');
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 200)}`);
};

// ---------- free port ----------
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
// 内容寻址：按「最后一条用户消息」选择回合脚本，任务间顺序零耦合。
//  - 检查系统信息 且历史无修复后 tool_calls → 注入正文退化（围栏 JSON，无原生调用）
//  - 检查系统信息 且历史含 assistant tool_calls（=修复已发生）→ 正常收口答复
//  - 调用示例 → 注入未知名演示正文（keep 保护场景）
const DEGRADED_TEXT = [
  '我来查一下系统信息。',
  '',
  '```json',
  '{"name": "system_info", "arguments": {}}',
  '```',
].join('\n');
const FINAL_A = '修复链路收口：系统检查完成，修复调用已真实执行，一切正常。';
const DEMO_TEXT = '调用示例：{"name": "totally_fake_tool", "arguments": {}}（这是给用户看的文档示例）。';

const mockRequests = [];
function pickTurn(messages) {
  const lastUser = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
  const text = String((lastUser && lastUser.content) || '');
  const hasRepairedCall = (messages || []).some(
    (m) => m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
  );
  if (text.includes('检查系统信息')) {
    return hasRepairedCall ? { content: FINAL_A, finish: 'stop' } : { content: DEGRADED_TEXT, finish: 'stop' };
  }
  if (text.includes('调用示例')) return { content: DEMO_TEXT, finish: 'stop' };
  return { content: '[mock] 未识别的请求编排', finish: 'stop' };
}
function startMockServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}
        const messages = parsed.messages || [];
        mockRequests.push({ url: req.url, messages });
        const dbgLastUser = [...messages].reverse().find((m) => m && m.role === 'user');
        console.log(`  [mock] req#${mockRequests.length} msgs=${messages.length} roles=${messages.map((m) => m.role).join(',').slice(0, 120)} lastUser=${String((dbgLastUser && dbgLastUser.content) || '').slice(0, 40).replace(/\n/g, ' ')}`);
        const turn = pickTurn(messages);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        // 拆成两个 delta 块模拟真实流式
        const mid = Math.max(1, Math.floor(turn.content.length / 2));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: turn.content.slice(0, mid) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: turn.content.slice(mid) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: turn.finish || 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return server;
}

// ---------- SSE collector ----------
// SSE 帧形态（routes/ai-agent/events.js）：存量/增量帧=信封 {seq, eventType, payload}；
// 终态帧=裸 {event:'done'|'error'|'agent_cancelled', ...}。统一归一为「裸事件 + _seq」。
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
            const phase = ev && ev.event === 'agent_status' ? `:${ev.phase}` : '';
            const terminal = ev && ['done', 'error', 'agent_cancelled', 'fatal_agent_error'].includes(ev.event);
            console.log(`  [evt] ${ev.event || '(no-event)'}${phase}${terminal ? ' (terminal)' : ''}`);
            if (terminal) done = true;
          } catch { /* 非 JSON 帧（心跳注释行等） */ }
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

// ---------- main ----------
async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block179-live-'));
  const mockPort = await freePort();
  const backendPort = await freePort();

  // 种隔离 ai-settings：openai-compatible preset 指向本机 mock（requiresApiKey=false）
  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'block179-mock',
    chat_model_presets: [{
      id: 'block179-mock',
      label: 'B179 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      contextWindow: 24000,
    }],
  }, null, 2));

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  // 隔离 DB 自举（同 loop 测试模式：fresh 文件先套 src/migrations，server 不自迁移）
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
  const backendLog = [];
  backend.stdout.on('data', (d) => backendLog.push(d.toString()));
  backend.stderr.on('data', (d) => backendLog.push(d.toString()));

  const API = `http://127.0.0.1:${backendPort}`;
  let stackUp = false;
  for (let i = 0; i < 40 && !stackUp; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) });
      stackUp = r.ok;
    } catch { /* not yet */ }
  }
  record('env.isolated-backend', stackUp, `隔离后端 :${backendPort} 健康（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR=${tmpDir}）`);

  if (stackUp) {
    const api = async (method, url, body) => {
      const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
      return r.json().catch(() => null);
    };

    // 项目+会话（隔离 DB，探针项目不留痕）
    const project = await api('POST', '/api/data/projects', { name: 'BLOCK-179 探针项目' });
    const projectId = project?.project?.id || project?.data?.id || project?.data?.project?.id;
    const conversation = projectId ? await api('POST', '/api/ai/conversations', { title: 'BLOCK-179 repair 链', project_id: projectId }) : null;
    const conversationId = conversation?.conversation?.id || conversation?.data?.conversation?.id || conversation?.data?.id;
    record('env.project-conversation', Boolean(projectId && conversationId),
      `projectId=${projectId} conversationId=${conversationId}`);

    // A[repair]：正文退化 → 修复事件 + 真实执行 + 收口
    const startA = await api('POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'block179-mock',
      messages: [{ role: 'user', content: '检查系统信息' }],
      context: { accessMode: 'read' },
    });
    const taskIdA = startA?.taskId || null;
    record('A.task-started', Boolean(taskIdA), `taskId=${taskIdA}`);
    if (taskIdA) {
      const eventsA = await collectTaskEvents(API, taskIdA);
      const inventory = eventsA.map((e) => `${e.event || e._eventType || '?'}${e.phase ? `:${e.phase}` : ''}`);
      const repair = eventsA.find((e) => e.event === 'agent_status' && e.phase === 'tool_call_repair');
      record('A.repair-event', Boolean(repair),
        repair ? `phase=tool_call_repair repaired=${repair.repaired} tools=${JSON.stringify(repair.tools)} msg=${repair.message}` : `修复事件缺席（事件清单：${inventory.join(',').slice(0, 200)}）`);
      record('A.tool-executed',
        eventsA.some((e) => e.event === 'tool_call' && e.name === 'system_info')
        && eventsA.some((e) => e.event === 'tool_result'),
        'tool_call(system_info)+tool_result 在场（提升后真实执行）');
      const terminalOk = eventsA.some((e) => e.event === 'done');
      record('A.task-completed', terminalOk, '任务正常收口（done 在场）');
      // 第 2 轮请求的 assistant 历史：原文保留 + 修复后 tool_calls
      const finalReq = mockRequests[mockRequests.length - 1];
      const repairedMsg = finalReq && finalReq.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
      );
      record('A.history-preserves-raw-text',
        Boolean(repairedMsg && typeof repairedMsg.content === 'string' && repairedMsg.content.includes('system_info')),
        '第 2 轮请求 assistant 历史=退化原文保留+修复后 tool_calls（可审计）');
      // 最终答复：SSE 事件流的 delta 帧聚合含第 2 轮收口文本
      const deltaText = eventsA
        .filter((e) => e.choices && e.choices[0] && e.choices[0].delta && typeof e.choices[0].delta.content === 'string')
        .map((e) => e.choices[0].delta.content)
        .join('');
      record('A.final-answer', deltaText.includes('修复链路收口'),
        `第 2 轮收口文本经 SSE 下发（delta 聚合 ${deltaText.length} 字符）`);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'block179-live-events-A.json'),
        JSON.stringify({ taskId: taskIdA, inventory, eventsCount: eventsA.length }, null, 2));
    }

    // B[keep]：未知名演示正文 → 零修复按最终回答收口
    const requestsBeforeB = mockRequests.length;
    const startB = await api('POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'block179-mock',
      messages: [{ role: 'user', content: '给我看一个调用示例' }],
      context: { accessMode: 'read' },
    });
    const taskIdB = startB?.taskId || null;
    if (taskIdB) {
      const eventsB = await collectTaskEvents(API, taskIdB);
      record('B.no-repair', !eventsB.some((e) => e.event === 'agent_status' && e.phase === 'tool_call_repair')
        && !eventsB.some((e) => e.event === 'tool_call'),
        '未知名正文零修复零执行（fail-closed 保护）');
      record('B.kept-as-answer', eventsB.some((e) => e.event === 'done'),
        '演示正文按最终回答收口（存量行为不变）');
      const bRequests = mockRequests.slice(requestsBeforeB).filter((r) => {
        const lastUser = [...(r.messages || [])].reverse().find((m) => m && m.role === 'user');
        // 精确匹配任务请求的末条用户消息（后台档案提取等异步调用的 prompt 只嵌会话文本，不会精确相等）
        return String((lastUser && lastUser.content) || '') === '给我看一个调用示例';
      }).length;
      record('B.single-round', bRequests === 1, `B 阶段任务请求数=${bRequests}（1 轮即收口；末条用户消息精确匹配，排除后台档案提取异步调用）`);
      await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskIdB)}/cancel`).catch(() => {});
    } else {
      record('B.no-repair', false, `task 未启动：${JSON.stringify(startB).slice(0, 120)}`);
    }
    if (taskIdA) await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskIdA)}/cancel`).catch(() => {});
  }

  // ---------- 清场 ----------
  try { backend.kill('SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  try { backend.kill('SIGKILL'); } catch {}
  mockServer.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  record('cleanup', true, '隔离后端+mock+临时目录已清场（用户空间零残留）');

  const pass = results.filter((r) => r.ok).length;
  const summary = {
    probe: 'block179-live',
    at: new Date().toISOString(),
    platform: `${os.platform()}-${os.arch()}`,
    pass,
    total: results.length,
    results,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block179-live.json'), JSON.stringify(summary, null, 2));
  console.log(`\n=== block179-live: ${pass}/${results.length} PASS（证据 acceptance/block-179/block179-live.json）===`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exitCode = 1;
});
