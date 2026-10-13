/**
 * scripts/lib/evals-harness.mjs — Agent 质量评测基建（BLOCK-181）。
 *
 * block179/180 实机探针姿势的产品化：隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR
 * 临时目录+独立端口+src/migrations 自举）+ 脚本化 mock OpenAI SSE provider +
 * 黄金任务执行器 + 确定性判据评估器 + 基线棘轮对比。
 *
 * 诚实边界（写入报告的 measures 字段）：
 * - provider=mock：测的是 harness 与 loop 机制回归（判据评估/事件面/策略拦截/
 *   正文修复提升），不是模型质量；
 * - provider=real：真实模型质量测量（需凭据；无凭据任务诚实 skip）。
 * 判据 v1 全确定性（事件/文件/答案文本断言，离线可验证）；LLM-as-judge 登记不做。
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

// ---------- 端口 ----------
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ---------- 隔离后端 ----------
function bootstrapDb(root, dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  db.close();
}

export async function spawnIsolatedBackend({ root, tmpDir }) {
  const port = await freePort();
  bootstrapDb(root, path.join(tmpDir, 'petri.db'));
  // provider 种子（credential_updates 文件路径——credential-store 迁移后的正道，
  // 根治 block93 类 env 占位失活债）
  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'evals-provider',
    credential_updates: { 'openai-compatible': process.env.PETRI_EVALS_PROVIDER_KEY || 'evals-mock-key' },
    chat_model_presets: [{
      id: 'evals-provider',
      label: 'Evals Provider',
      provider: 'openai-compatible',
      model: process.env.PETRI_EVALS_MODEL || 'evals-model',
      baseUrl: process.env.PETRI_EVALS_BASE_URL || `http://127.0.0.1:${port}/placeholder`,
      contextWindow: 32000,
    }],
  }, null, 2));
  const backend = spawn(process.execPath, [path.join(root, 'core', 'petri-server', 'server.js')], {
    env: {
      ...process.env,
      PETRI_DB_PATH: path.join(tmpDir, 'petri.db'),
      PETRI_LOCAL_DATA_DIR: tmpDir,
      R_SERVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.on('data', () => { /* 进程级错误由健康检查与任务终态承载 */ });
  const api = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(2000) });
      up = r.ok;
    } catch { /* not yet */ }
  }
  return {
    port,
    api,
    ok: up,
    async cleanup() {
      try { backend.kill('SIGTERM'); } catch { /* already dead */ }
      await new Promise((r) => setTimeout(r, 600));
      try { backend.kill('SIGKILL'); } catch { /* already dead */ }
    },
  };
}

// ---------- 脚本化 mock provider ----------
// 有序回合队列：每个请求 shift 一回合。回合={content,finish} 或 {toolCalls:[{name,arguments}]}。
export function startMockProvider() {
  const queue = [];
  const captured = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* 容忍 */ }
        captured.push({ messages: parsed.messages || [] });
        const turn = queue.shift() || { content: '[evals] mock 脚本耗尽', finish: 'stop' };
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (turn.toolCalls) {
          const toolCalls = turn.toolCalls.map((tc, index) => ({
            index,
            id: `call_evals_${captured.length}_${index}`,
            type: 'function',
            function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}) },
          }));
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        } else {
          const content = String(turn.content || '');
          const mid = Math.max(1, Math.floor(content.length / 2));
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, mid) } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(mid) } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: turn.finish || 'stop' }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const portPromise = freePort();
  const ready = portPromise.then((port) => new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(port));
  }));
  return {
    ready,
    push(...turns) { queue.push(...turns); },
    captured,
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- SSE 收集（信封帧归一，同 block180） ----------
export async function collectTaskEvents(apiBase, taskId, { timeoutMs = 120_000 } = {}) {
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
          const raw = line.slice(6);
          if (raw === '[DONE]') { done = true; continue; }
          try {
            const parsed = JSON.parse(raw);
            const ev = parsed && parsed.eventType && parsed.payload
              ? { ...parsed.payload, _seq: parsed.seq, _eventType: parsed.eventType }
              : parsed;
            events.push(ev);
            if (ev && ['done', 'error', 'agent_cancelled', 'fatal_agent_error'].includes(ev.event)) done = true;
          } catch { /* 心跳注释行 */ }
        }
      }
    }
  } catch (e) {
    if (!(e && e.name === 'AbortError')) throw e;
  } finally {
    clearTimeout(timer);
    try { controller.abort(); } catch { /* already aborted */ }
  }
  return events;
}

// ---------- 黄金任务执行 ----------
async function apiCall(api, method, url, body) {
  const r = await fetch(api + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function findWorkspaceFile(tmpDir, relativePath) {
  const target = relativePath.replaceAll('\\', '/');
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (full.replaceAll('\\', '/').endsWith(`/${target}`)) return full;
    }
  }
  return null;
}

async function resolveProjectWorkspace(api, tmpDir, projectId) {
  const rec = await apiCall(api, 'GET', `/api/data/projects/${encodeURIComponent(projectId)}`);
  const ws = rec.json?.project?.workspace_path || rec.json?.data?.workspace_path || rec.json?.workspace_path;
  if (ws && fs.existsSync(ws)) return ws;
  // 兜底：隔离目录内按项目 id 扫描（workspace 目录名/路径含项目 id）
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    if (path.basename(dir) === projectId || dir.includes(projectId)) {
      let stat;
      try { stat = fs.statSync(dir); } catch { continue; }
      if (stat.isDirectory()) return dir;
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return null;
}

/**
 * 执行一枚黄金任务：fixture 项目/会话播种 → 真实 agent 循环 → 事件收集 → 终态。
 * mockScript 由调用方预先 push 进 mock provider（provider=mock 时）。
 */
export async function runGoldenTask({ api, tmpDir, task }) {
  const startedAt = Date.now();
  const project = await apiCall(api, 'POST', '/api/data/projects', { name: `evals-${task.id}` });
  const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;
  // fixture 播种（任务定义的 fixtureFiles 写入项目 workspace）
  if (projectId && task.fixtureFiles && typeof task.fixtureFiles === 'object') {
    const wsDir = await resolveProjectWorkspace(api, tmpDir, projectId);
    if (wsDir) {
      for (const [rel, content] of Object.entries(task.fixtureFiles)) {
        const abs = path.join(wsDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(content));
      }
    }
  }
  const conversation = projectId
    ? await apiCall(api, 'POST', '/api/ai/conversations', { title: `evals-${task.id}`, project_id: projectId })
    : null;
  const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;

  const start = await apiCall(api, 'POST', '/api/ai/agent', {
    conversationId,
    modelPresetId: 'evals-provider',
    messages: [{ role: 'user', content: task.prompt }],
    // projectId 绑定 workspace 工具的项目上下文（缺失则 workspace_* 一律 project_required）
    context: { accessMode: task.accessMode || 'full', projectId },
  });
  const taskId_ = start.json?.taskId || null;
  if (!taskId_) {
    return { id: task.id, passed: false, status: 'not_started', criteriaResults: [], finalText: '', durationMs: Date.now() - startedAt, error: `task 启动失败：${JSON.stringify(start.json || {}).slice(0, 160)}` };
  }
  const events = await collectTaskEvents(api, taskId_, { timeoutMs: task.timeoutMs || 120_000 });
  const finalText = events
    .filter((e) => e.choices && e.choices[0] && e.choices[0].delta && typeof e.choices[0].delta.content === 'string')
    .map((e) => e.choices[0].delta.content)
    .join('');
  const completed = events.some((e) => e.event === 'done');
  const failedEvent = events.find((e) => e.event === 'error' || e.event === 'fatal_agent_error');

  const fileReader = (relativePath) => {
    const abs = findWorkspaceFile(tmpDir, relativePath);
    return abs ? fs.readFileSync(abs, 'utf8') : null;
  };
  const criteriaResults = (task.criteria || []).map((c) => evaluateCriterion(c, {
    events,
    finalText,
    completed,
    failedEvent: failedEvent ? String(failedEvent.error || failedEvent.event) : null,
    fileReader,
  }));
  return {
    id: task.id,
    passed: criteriaResults.length > 0 && criteriaResults.every((c) => c.passed),
    status: completed ? 'completed' : (failedEvent ? 'failed' : 'timeout'),
    criteriaResults,
    finalText,
    durationMs: Date.now() - startedAt,
  };
}

// ---------- 判据评估器（纯函数，供单测） ----------
function toolCallEvents(events) {
  return events.filter((e) => e.event === 'tool_call');
}

/**
 * 单条判据评估。kind 取值：
 * task_completed / final_answer_contains / tool_used / tool_not_used /
 * policy_denied / no_policy_denial / event_present / file_contains
 */
export function evaluateCriterion(criterion, ctx) {
  const { events, finalText, completed, failedEvent, fileReader } = ctx;
  const result = (passed, detail) => ({ ...criterion, passed, detail: String(detail).slice(0, 240) });
  switch (criterion.kind) {
    case 'task_completed':
      return result(completed === true && !failedEvent, completed ? '任务正常收口' : `未收口（failed=${failedEvent}）`);
    case 'final_answer_contains':
      return result(finalText.includes(criterion.value), `最终答复${finalText.includes(criterion.value) ? '含' : '不含'}「${String(criterion.value).slice(0, 40)}」`);
    case 'tool_used': {
      const hits = toolCallEvents(events).filter((e) => e.name === criterion.name);
      return result(hits.length >= (criterion.minTimes || 1), `tool_call ${criterion.name} × ${hits.length}`);
    }
    case 'tool_not_used':
      return result(!toolCallEvents(events).some((e) => e.name === criterion.name), `tool_call ${criterion.name} 应缺席`);
    case 'policy_denied': {
      const denied = events.find((e) => {
        const data = e.toolResult && e.toolResult.data;
        return data && data.error === 'dynamic_guard_triggered'
          && (!criterion.guardKeyPrefix || String(data.guardKey || '').startsWith(criterion.guardKeyPrefix));
      });
      return result(Boolean(denied), denied ? `policy 拦截在场（${denied.toolResult.data.guardKey}）` : '无 dynamic_guard 拦截');
    }
    case 'tool_error': {
      const hit = events.find((e) => {
        const data = e.toolResult && e.toolResult.data;
        return data && data.error === criterion.error
          && (!criterion.tool || e.name === criterion.tool);
      });
      return result(Boolean(hit), hit ? `工具错误在场（${criterion.error}）` : '无该工具错误');
    }
    case 'no_policy_denial':
      return result(!events.some((e) => e.toolResult && e.toolResult.data && String(e.toolResult.data.error || '').includes('guard')), '无策略拦截');
    case 'event_present': {
      const hit = events.find((e) => (!criterion.event || e.event === criterion.event)
        && (!criterion.phase || e.phase === criterion.phase)
        && (!criterion.requestIdPrefix || String(e.requestId || '').startsWith(criterion.requestIdPrefix)));
      return result(Boolean(hit), hit ? `事件在场（${criterion.event || ''}${criterion.phase ? ':' + criterion.phase : ''}）` : '事件缺席');
    }
    case 'file_contains': {
      const content = fileReader ? fileReader(criterion.path) : null;
      if (content === null) return result(false, `文件不存在：${criterion.path}`);
      return result(content.includes(criterion.value), `文件 ${criterion.path} ${content.includes(criterion.value) ? '含' : '不含'}目标内容`);
    }
    default:
      return result(false, `未知判据 kind：${criterion.kind}`);
  }
}

// ---------- 基线棘轮（纯函数，供单测） ----------
/**
 * 最新 run 对比基线：基线通过、本次失败 = 回归（红）；基线失败、本次通过 = 改善；
 * 本次新任务不判红。返回 { ok, regressions, improvements, newTasks, skipped }。
 */
export function compareRunVsBaseline(run, baseline) {
  const baseTasks = new Map((baseline.tasks || []).map((t) => [t.id, t]));
  const regressions = [];
  const improvements = [];
  const newTasks = [];
  const skipped = [];
  for (const task of run.tasks || []) {
    if (task.skipped) { skipped.push(task.id); continue; }
    const base = baseTasks.get(task.id);
    const failing = (task.criteriaResults || []).filter((c) => !c.passed).map((c) => `${task.id}:${c.kind}`);
    if (!base) { newTasks.push(task.id); continue; }
    const baseFailing = new Set((base.criteriaResults || []).filter((c) => !c.passed).map((c) => `${task.id}:${c.kind}`));
    for (const key of failing) {
      if (!baseFailing.has(key)) regressions.push(key);
    }
    for (const key of baseFailing) {
      if (!failing.includes(key)) improvements.push(key);
    }
  }
  for (const [id] of baseTasks) {
    if (!(run.tasks || []).some((t) => t.id === id)) regressions.push(`${id}:task_missing`);
  }
  return { ok: regressions.length === 0, regressions, improvements, newTasks, skipped };
}

export function defaultTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
