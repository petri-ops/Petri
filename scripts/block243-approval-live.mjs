#!/usr/bin/env node
'use strict';

/**
 * BLOCK-243 — Q1 审批契约 v2 + MCP trust 实机腿（隔离后端 + mock provider）。
 *
 * 链路：真实 stdio MCP 夹具（many_destructive，destructiveHint）→ trust=ask deny
 * （approval 信封含变体/解释/参数预览/requestId）→ 非法编辑参数 400 → 合法编辑
 * 参数批准（scope=once）→ 模型重试原调用 → 拦截器按「原始指纹→生效参数」替换执行
 * → permission.resolved 审计（原始/生效哈希与脱敏输入）+ guard-events 可查。
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
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-243');
const MCP_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-many-tools-server.cjs');
const TOOL_NAME = 'mcp_many_many_destructive';
const ORIGINAL_ARGS = { target: 'db' };
const EDITED_ARGS = { target: 'archive' };
const AUTH = { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' };

const checks = [];
let allPass = true;
function record(name, pass, detail = '') {
  const ok = Boolean(pass);
  if (!ok) allPass = false;
  checks.push({ name, pass: ok, detail: String(detail).slice(0, 600) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
}

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
const FINAL_TEXT = '审批链路收口：编辑后的参数已按批准执行。';
let providerCalls = 0;
let releaseRetry = null;
const retryGate = new Promise((resolve) => { releaseRetry = resolve; });
const mockRequests = [];

function emitToolCall(res, id, args) {
  res.write(`data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id,
          type: 'function',
          function: { name: TOOL_NAME, arguments: JSON.stringify(args) },
        }],
      },
    }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
}

function startMockServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const lastUser = [...(parsed.messages || [])].reverse().find((m) => m && m.role === 'user');
        mockRequests.push({ n: providerCalls, lastUser: String((lastUser && lastUser.content) || '').slice(0, 60) });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

        if (providerCalls === 2) {
          // 模拟「任务停在等用户」：审批到达前不返回模型重试（30s 兜底防挂死）。
          await Promise.race([
            retryGate,
            new Promise((resolve) => setTimeout(resolve, 30_000)),
          ]);
        }
        if (providerCalls === 1 || providerCalls === 2) {
          // req2 故意用**原始参数**重试：审批替换必须把它换成生效参数。
          emitToolCall(res, `call_b243_${providerCalls}`, ORIGINAL_ARGS);
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

// ---------- SSE collector（信封帧归一，同 block180） ----------
async function collectTaskEvents(apiBase, taskId, timeoutMs = 60_000) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}/api/ai/agent/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: AUTH.Authorization },
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') { done = true; continue; }
          try {
            const parsed = JSON.parse(payload);
            const event = parsed && parsed.eventType && parsed.payload
              ? { ...parsed.payload, _seq: parsed.seq, _eventType: parsed.eventType }
              : parsed;
            events.push(event);
          } catch { /* partial frame */ }
        }
      }
    }
  } catch (error) {
    if (!(error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    try { controller.abort(); } catch { /* closed */ }
  }
  return events;
}

function isTrustDeny(event) {
  const approval = event && event.toolResult && event.toolResult.approval;
  return Boolean(approval && approval.guardKey === 'mcp:many' && approval.requestId);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b243-live-'));
  const mockPort = await freePort();
  const backendPort = await freePort();
  let backend = null;
  let mockServer = null;

  fs.writeFileSync(path.join(tmpDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'block243-mock',
    chat_model_presets: [{
      id: 'block243-mock',
      label: 'B243 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      contextWindow: 24000,
    }],
  }, null, 2));

  mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));

  const bootDb = new Database(path.join(tmpDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();

  backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: {
      ...process.env,
      PETRI_DB_PATH: path.join(tmpDir, 'petri.db'),
      PETRI_LOCAL_DATA_DIR: tmpDir,
      R_SERVER_PORT: String(backendPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('Error')) console.log('  [backend]', text.slice(0, 200));
  });
  backend.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
  });

  const API = `http://127.0.0.1:${backendPort}`;
  let stackUp = false;
  for (let i = 0; i < 40 && !stackUp; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) });
      stackUp = response.ok;
    } catch { /* not yet */ }
  }
  record('E1_isolated_backend', stackUp, `隔离后端 :${backendPort}`);

  if (stackUp) {
    const api = async (method, endpoint, body) => {
      const response = await fetch(API + endpoint, {
        method,
        headers: AUTH,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json().catch(() => null) };
    };

    // MCP 夹具接入（真实 stdio）
    await api('DELETE', '/api/mcp/servers/many');
    const created = await api('POST', '/api/mcp/servers', {
      id: 'many',
      command: process.execPath,
      args: [MCP_FIXTURE],
      autoConnect: false,
    });
    const connected = await api('POST', '/api/mcp/servers/many/connect');
    record('E2_mcp_connected', created.status === 200 && connected.status === 200 && connected.json?.toolCount === 6,
      JSON.stringify(connected.json || {}).slice(0, 240));

    const project = await api('POST', '/api/data/projects', { name: 'BLOCK-243 审批探针项目' });
    const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;
    const conversation = projectId
      ? await api('POST', '/api/ai/conversations', { title: 'BLOCK-243 审批链路', project_id: projectId })
      : null;
    const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;
    record('E3_project_conversation', Boolean(projectId && conversationId), `projectId=${projectId}`);

    const start = await api('POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'block243-mock',
      messages: [{ role: 'user', content: '对归档库执行破坏性操作，目标是 db' }],
      context: { accessMode: 'full', projectId },
    });
    const taskId = start.json?.taskId || null;
    record('E4_task_started', Boolean(taskId), `taskId=${taskId}`);

    if (taskId) {
      let denyEvent = null;
      let events = [];
      for (let i = 0; i < 40 && !denyEvent; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        events = await collectTaskEvents(API, taskId, 8000).catch(() => []);
        denyEvent = events.find(isTrustDeny) || null;
      }
      const approval = denyEvent && denyEvent.toolResult ? denyEvent.toolResult.approval : null;
      record('A1_trust_deny_envelope', Boolean(approval),
        approval ? JSON.stringify(approval).slice(0, 320) : 'trust deny 信封缺席');
      record('A2_approval_explanation', Boolean(approval
        && approval.guardKey === 'mcp:many'
        && approval.dimension === 'mcp-trust'
        && approval.approvalVariant === 'info'
        && /destructive/i.test(String(approval.explanation || ''))
        && String(approval.argsPreview || '').includes('"db"')
        && approval.inputEditable === true),
      approval ? `variant=${approval.approvalVariant} args=${approval.argsPreview}` : '无');
      record('A3_pending_count_duplicate', Boolean(approval
        && approval.pendingRequestCount === 1
        && approval.duplicatePending === false),
      approval ? `pending=${approval.pendingRequestCount} duplicate=${approval.duplicatePending}` : '无');

      const requestId = approval && approval.requestId;
      // 非法编辑：schema 不通过 → 400，请求保持 pending
      const invalid = requestId
        ? await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, {
          requestId,
          guardKey: 'mcp:many',
          decision: 'approve',
          scope: 'once',
          updatedInput: { target: 42 },
        })
        : { status: 0, json: null };
      record('B1_updated_input_revalidation', invalid.status === 400 && invalid.json?.error === 'updated_input_invalid',
        `status=${invalid.status} error=${invalid.json?.error} details=${JSON.stringify(invalid.json?.details || []).slice(0, 160)}`);

      let ack = { status: 0, json: null };
      if (requestId) {
        ack = await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, {
          requestId,
          guardKey: 'mcp:many',
          decision: 'approve',
          scope: 'once',
          updatedInput: EDITED_ARGS,
          reason: 'BLOCK-243 live：改为归档目标',
        });
        releaseRetry();
      }
      record('B2_approve_with_edit', ack.status === 200 && ack.json?.ok === true
        && ack.json?.scope === 'once' && ack.json?.updatedInput === true,
      `status=${ack.status} resp=${JSON.stringify(ack.json || {}).slice(0, 240)}`);

      const eventsAll = await collectTaskEvents(API, taskId);
      const toolResults = eventsAll.filter((event) => event.event === 'tool_result' && event.name === TOOL_NAME);
      const executed = toolResults.find((event) => {
        const data = event.toolResult && event.toolResult.data;
        return data && data.ok === true && data.appliedInputOverride;
      });
      const executedData = executed ? executed.toolResult.data : null;
      record('C1_override_executed', Boolean(executedData
        && String(executedData.text || '').includes('"target":"archive"')
        && !String(executedData.text || '').includes('"target":"db"')),
      executedData ? String(executedData.text || '').slice(0, 240) : '替换执行结果缺席');
      record('C2_override_audit_meta', Boolean(executedData
        && executedData.appliedInputOverride
        && executedData.appliedInputOverride.requestId === requestId
        && executedData.appliedInputOverride.originalFingerprint
        && executedData.appliedInputOverride.effectiveFingerprint
        && executedData.appliedInputOverride.originalFingerprint !== executedData.appliedInputOverride.effectiveFingerprint),
      JSON.stringify(executedData && executedData.appliedInputOverride || {}).slice(0, 320));
      record('C3_task_completed', eventsAll.some((event) => event.event === 'done'), '任务正常收口');

      // 审计：guard-events 端点（UI 可查）
      const guardEvents = await api('GET', '/api/ai/agent/guard-events?limit=20');
      const resolved = (guardEvents.json?.events || []).find((event) => event.requestId === requestId);
      record('D1_permission_resolved_endpoint', Boolean(resolved
        && resolved.eventType === 'permission.resolved'
        && resolved.decision === 'approve'
        && resolved.scope === 'once'
        && resolved.updatedInput === true
        && resolved.mcpServerId === 'many'
        && typeof resolved.durationMs === 'number'),
      JSON.stringify(resolved || null).slice(0, 360));

      // 审计：task_events 原始载荷（原始/生效哈希与脱敏输入）
      const db = new Database(path.join(tmpDir, 'petri.db'), { readonly: true });
      let payload = null;
      try {
        const row = db.prepare(
          "SELECT payload FROM task_events WHERE task_id = ? AND event_type = 'permission.resolved' ORDER BY seq DESC LIMIT 1"
        ).get(taskId);
        payload = row ? JSON.parse(row.payload) : null;
      } finally {
        db.close();
      }
      record('D2_permission_resolved_payload', Boolean(payload
        && payload.updatedInput === true
        && payload.scope === 'once'
        && payload.originalInputHash
        && payload.effectiveInputHash
        && payload.originalInputHash !== payload.effectiveInputHash
        && String(payload.originalInput || '').includes('"db"')
        && String(payload.effectiveInput || '').includes('"archive"')
        && payload.durationMs >= 0),
      JSON.stringify(payload || null).slice(0, 520));

      // 收尾清理
      await api('POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/cancel`).catch(() => {});
    }
  }

  try { backend.kill('SIGTERM'); } catch { /* ignore */ }
  await new Promise((resolve) => setTimeout(resolve, 800));
  try { backend.kill('SIGKILL'); } catch { /* ignore */ }
  try { mockServer.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }

  const report = {
    name: 'block243-approval-contract-live',
    startedAt,
    finishedAt: new Date().toISOString(),
    providerCalls,
    mockRequests,
    assertions: checks,
    allPass,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block243-live.json'), JSON.stringify(report, null, 2));
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} ${checks.filter((c) => c.pass).length}/${checks.length}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'block243-live.json'), JSON.stringify({
    name: 'block243-approval-contract-live',
    assertions: checks,
    allPass: false,
    error: error && error.stack ? error.stack : String(error),
  }, null, 2));
  process.exitCode = 1;
});
