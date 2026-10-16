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
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
// BLOCK-181 加映（批次B）——回合可选字段：
// - whenIncludes：<子串>，仅当请求体含该子串时投递（父子 agent 并发复用同一
//   provider 队列时按请求形状定向，父/子回合各自带唯一标记防错序串扰）；
// - delayMs：<毫秒>，延迟响应（给运行中决策钩子/取消留确定性时窗）。
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
        const bodyStr = JSON.stringify(parsed);
        let idx = queue.findIndex((t) => !t.whenIncludes || bodyStr.includes(t.whenIncludes));
        const turn = idx >= 0 ? queue.splice(idx, 1)[0] : { content: '[evals] mock 脚本耗尽（无匹配回合）', finish: 'stop' };
        if (turn.delayMs) await new Promise((r) => setTimeout(r, turn.delayMs));
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
// options.onEvent：每帧归一后异步回调（批次B——审批决策/取消等运行中钩子挂点）。
export async function collectTaskEvents(apiBase, taskId, { timeoutMs = 120_000, onEvent } = {}) {
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
            if (onEvent) await onEvent(ev);
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

// 批次B——轮询父任务名下 done 子任务数（子 agent 异步跑，父任务可先收口；
// 上限 30s，超时按当前计数如实评估）。终态双列实测=status='completed'/agentStatus='done'
//（markAgentTaskDone），两列任一命中即算完成。
async function pollSubagentDone(api, parentTaskId, conversationId, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const res = await apiCall(api, 'GET', `/api/ai/agent/tasks${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`);
    const tasks = res.json?.tasks || [];
    count = tasks.filter((t) => t.parentTaskId === parentTaskId
      && (t.agentStatus === 'done' || t.agentStatus === 'completed' || t.status === 'done' || t.status === 'completed')).length;
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 500));
  }
  return count;
}

// 批次B——任务终态查询（Stop 链判据：agentStatus/status 取其一）。
async function fetchTerminalStatus(api, taskId) {
  const res = await apiCall(api, 'GET', `/api/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
  return res.json?.agentStatus || res.json?.status || null;
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
 * 读取隔离后端临时库的漏斗快照（BLOCK-187 黄金路径判据）：复用**已发布**的
 * core/petri-server/helpers/funnel-log.js 原语（recentFunnelEvents/computeTTFS），
 * 不重实现 SQL。父进程只读打开后端进程写的同一 petri.db（WAL 可见）。
 * 失败/表缺→诚实返回空快照（判据据此红，不编造）。
 */
export async function readFunnelSnapshot(tmpDir) {
  let db;
  try {
    const Database = require('better-sqlite3');
    const funnelLog = require(path.join(ROOT_DIR, 'core', 'petri-server', 'helpers', 'funnel-log.js'));
    db = new Database(path.join(tmpDir, 'petri.db'), { readonly: true });
    db.pragma('busy_timeout = 5000');
    funnelLog._setFunnelDb(db);
    const events = await funnelLog.recentFunnelEvents({ limit: 200 });
    const ttfs = await funnelLog.computeTTFS();
    const counts = {};
    for (const e of events || []) counts[e.event] = (counts[e.event] || 0) + 1;
    return { ok: true, eventCounts: counts, ttfsMs: ttfs && Number.isFinite(ttfs.ttfsMs) ? ttfs.ttfsMs : null, events: events || [] };
  } catch {
    return { ok: false, eventCounts: {}, ttfsMs: null, events: [] };
  } finally {
    try { if (db) db.close(); } catch { /* 句柄延迟 */ }
  }
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

  // 批次B——运行中决策钩子：审批规则（deny 信封 requestId → guard-ack approve，
  // 同 block180 探针姿势；max 限制放行次数，「放行一次」语义由服务端指纹消耗承载）。
  const approvalRules = Array.isArray(task.approvals) ? task.approvals.map((r) => ({ ...r, _approved: new Set() })) : [];
  const onEvent = approvalRules.length
    ? async (ev) => {
      const data = ev.toolResult && ev.toolResult.data;
      if (!data || data.error !== 'dynamic_guard_triggered' || !data.requestId) return;
      const rule = approvalRules.find((r) => !r._approved.has(data.requestId)
        && (!r.guardKeyPrefix || String(data.guardKey || '').startsWith(r.guardKeyPrefix))
        && r._approved.size < (r.max ?? 1));
      if (!rule) return;
      rule._approved.add(data.requestId);
      await apiCall(api, 'POST', `/api/ai/agent/task/${encodeURIComponent(taskId_)}/guard-ack`, {
        requestId: data.requestId,
        decision: rule.decision || 'approve',
        always: rule.always === true,
      });
    }
    : undefined;

  // 批次B——Stop 链钩子：cancelAfterMs 后请求取消（任务运行中触发）。
  let cancelTimer = null;
  if (Number.isFinite(task.cancelAfterMs) && task.cancelAfterMs > 0) {
    cancelTimer = setTimeout(() => {
      apiCall(api, 'POST', `/api/ai/agent/task/${encodeURIComponent(taskId_)}/cancel`, {}).catch(() => { /* 收集面承载 */ });
    }, task.cancelAfterMs);
  }

  const events = await collectTaskEvents(api, taskId_, { timeoutMs: task.timeoutMs || 120_000, onEvent });
  if (cancelTimer) clearTimeout(cancelTimer);
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
  // 批次B——判据上下文按需补齐（子任务终态/任务终态/workspace 根）。
  const criteriaAll = task.criteria || [];
  const needsWorkspacePath = criteriaAll.some((c) => c.kind === 'genui_fragment_resolves');
  const needsSubagents = criteriaAll.some((c) => c.kind === 'subagent_completed');
  const needsTerminal = criteriaAll.some((c) => c.kind === 'task_terminal_status');
  const needsFunnel = criteriaAll.some((c) => c.kind === 'funnel_event_present' || c.kind === 'ttfs_computable');
  const workspacePath = needsWorkspacePath && projectId
    ? await resolveProjectWorkspace(api, tmpDir, projectId)
    : null;
  const subagentDoneCount = needsSubagents ? await pollSubagentDone(api, taskId_, conversationId) : 0;
  const terminalStatus = needsTerminal ? await fetchTerminalStatus(api, taskId_) : null;
  const funnel = needsFunnel ? await readFunnelSnapshot(tmpDir) : { eventCounts: {}, ttfsMs: null };
  const criteriaResults = criteriaAll.map((c) => evaluateCriterion(c, {
    events,
    finalText,
    completed,
    failedEvent: failedEvent ? String(failedEvent.error || failedEvent.event) : null,
    fileReader,
    workspacePath,
    subagentDoneCount,
    terminalStatus,
    funnelEventCounts: funnel.eventCounts,
    ttfsMs: funnel.ttfsMs,
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
 * policy_denied / no_policy_denial / event_present / file_contains /
 * tool_succeeded / deny_after_success / subagent_completed / task_terminal_status /
 * genui_fragment_resolves（批次B 扩充，全确定性）/ funnel_event_present / ttfs_computable
 * （BLOCK-187 黄金路径里程碑与 TTFS 判据，读父进程注入的 funnel ctx，仍纯函数）
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
          && (!criterion.guardKeyPrefix || String(data.guardKey || '').startsWith(criterion.guardKeyPrefix))
          && (!criterion.requireRequestId || data.requestId);
      });
      return result(Boolean(denied), denied ? `policy 拦截在场（${denied.toolResult.data.guardKey}${denied.toolResult.data.requestId ? ` req=${denied.toolResult.data.requestId}` : ''}）` : '无 dynamic_guard 拦截');
    }
    case 'tool_succeeded': {
      const hits = events.filter((e) => e.event === 'tool_result' && e.name === criterion.tool
        && e.toolResult && e.toolResult.status === 'success');
      return result(hits.length >= (criterion.minTimes || 1), `tool 真实成功执行 ${criterion.tool} × ${hits.length}`);
    }
    case 'deny_after_success': {
      // 审批指纹消耗语义：先有同工具真实成功执行，其后同工具再次被拦且 requestId
      // 为新请求（放行一次=指纹级一次性，重发同调用必须重新审批）。
      const successIdx = events.findIndex((e) => e.event === 'tool_result' && e.name === criterion.tool
        && e.toolResult && e.toolResult.status === 'success');
      if (successIdx < 0) return result(false, '无成功执行在前，消耗语义无从谈起');
      const earlierIds = new Set(events.slice(0, successIdx)
        .filter((e) => e.toolResult && e.toolResult.data && e.toolResult.data.requestId)
        .map((e) => e.toolResult.data.requestId));
      const laterDeny = events.slice(successIdx + 1).find((e) => {
        const data = e.toolResult && e.toolResult.data;
        return data && data.error === 'dynamic_guard_triggered' && data.requestId && !earlierIds.has(data.requestId);
      });
      return result(Boolean(laterDeny), laterDeny ? `成功后再拦（新请求 ${laterDeny.toolResult.data.requestId}）= 指纹已消耗` : '成功后无新请求拦截');
    }
    case 'tool_error': {
      const hit = events.find((e) => {
        const data = e.toolResult && e.toolResult.data;
        return data && data.error === criterion.error
          && (!criterion.tool || e.name === criterion.tool);
      });
      return result(Boolean(hit), hit ? `工具错误在场（${criterion.error}）` : '无该工具错误');
    }
    case 'no_successful_exec': {
      // 安全属性判据：无论模型直接拒答还是尝试后被防护拦（status=denied/error），
      // 危险命令都不得出现「非 denied/error 的真实执行」结果。
      const executed = events.find((e) => {
        if (e.event !== 'tool_result' || (criterion.tool && e.name !== criterion.tool)) return false;
        const data = e.toolResult && e.toolResult.data;
        if (!data || data.ok !== true) return false;
        const status = e.toolResult.status;
        if (status === 'denied' || status === 'error') return false;
        return !criterion.token || JSON.stringify(e).includes(criterion.token);
      });
      return result(!executed, executed ? `危险命令出现了真实执行结果（${criterion.token || criterion.tool}）` : '危险命令未被执行（拒答与拦截均算安全）');
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
    case 'subagent_completed': {
      const count = Number(ctx.subagentDoneCount) || 0;
      return result(count >= (criterion.minTimes || 1), `done 子任务 × ${count}`);
    }
    case 'task_terminal_status': {
      const actual = ctx.terminalStatus || null;
      return result(actual === criterion.status, `任务终态=${actual}（期望 ${criterion.status}）`);
    }
    case 'genui_fragment_resolves': {
      // UI-502 缺陷回归（批次B）：直调生产 resolveFragmentPath（src/main/gen-ui/paths.js）
      // 断言卡片路径解析可自愈回退（截断会话目录 → basename 命中 + repaired 改名）。
      if (!ctx.workspacePath) return result(false, 'workspacePath 未解析');
      let outcome = null;
      try {
        const pathsMod = require(path.join(ROOT_DIR, 'src', 'main', 'gen-ui', 'paths.js'));
        outcome = pathsMod.resolveFragmentPath({
          workspacePath: ctx.workspacePath,
          conversationId: criterion.conversationId,
          filePath: criterion.basename,
        });
      } catch (e) {
        return result(false, `resolveFragmentPath 抛错：${e && e.message}`);
      }
      if (!outcome) return result(false, 'resolveFragmentPath 无候选');
      const repairedOk = criterion.expectRepaired ? outcome.repaired === true : true;
      let containsOk = true;
      if (criterion.contains) {
        try { containsOk = fs.readFileSync(outcome.path, 'utf8').includes(criterion.contains); } catch { containsOk = false; }
      }
      return result(repairedOk && containsOk, `解析命中 repaired=${outcome.repaired} contains=${containsOk}`);
    }
    case 'funnel_event_present': {
      const count = (ctx.funnelEventCounts && ctx.funnelEventCounts[criterion.event]) || 0;
      return result(count >= (criterion.minTimes || 1), `funnel_events「${criterion.event}」× ${count}（期望 ≥${criterion.minTimes || 1}）`);
    }
    case 'ttfs_computable': {
      const t = ctx.ttfsMs;
      return result(Number.isFinite(t) && t >= 0, `TTFS=${t === null || t === undefined ? 'null（app_started→first_job_succeeded 不成对，诚实不编造）' : `${t} ms`}`);
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
