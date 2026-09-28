#!/usr/bin/env node
'use strict';

/**
 * BLOCK-126 实机验收 — 感知实时性（终态失效事件 + 运行期日志 live 尾部）。
 *
 * 前置：dev 栈在跑（biof3-server 含 BLOCK-126 代码）。
 * 断言：
 *   A1 复跑一个真实 deseq2 job，终态时 SSE /api/events 收到
 *      { type:'invalidate', domain:'jobs', payload.toolJobId=<新 job>, state=<终态> }；
 *   A2 事件到达时刻与 DB completedAt 的偏移为秒级（记录量值）；
 *   A3 运行窗口内 /api/tools/log/:id 至少一次返回 source='live' 且 log 非空；
 *   A4 终态后日志端点走 run.log 文件链（source='run.log'）。
 * 结果落 acceptance/block-126/perception-live.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BLOCK126_BASE_URL || 'http://127.0.0.1:3001';
const TEMPLATE_JOB = process.env.BLOCK126_TEMPLATE_JOB || 'tj_muhpp7bn_olnq';
const OUT_DIR = path.join(ROOT, 'acceptance', 'block-126');

async function getJson(route, timeoutMs = 15_000) {
  const res = await fetch(BASE + route, { signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} -> ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function main() {
  const checks = [];
  const record = (id, pass, detail) => {
    checks.push({ id, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 220)}`);
  };

  // 0) 模板 job 参数（复用最近一次真实成功 deseq2 的输入）
  const template = await getJson(`/api/tools/status/${TEMPLATE_JOB}`);
  const { toolId, params } = template;
  if (!toolId || !params || !params.counts) throw new Error('template job unusable');
  // 模板项目可能已被并行会话清场——不可用时自建验收项目（bulk），跑完删。
  let projectId = template.projectId;
  let createdProjectId = null;
  try {
    await getJson(`/api/data/projects/${encodeURIComponent(projectId)}`);
  } catch {
    const created = await fetch(BASE + '/api/data/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `block126-perception-verify-${Date.now().toString(36)}`, modality: 'bulk' }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json());
    if (!created.project || !created.project.id) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 200)}`);
    createdProjectId = created.project.id;
    projectId = createdProjectId;
  }
  console.log(`template job ${TEMPLATE_JOB} tool=${toolId} project=${projectId}${createdProjectId ? ' (created)' : ''}`);

  // 1) SSE 订阅（先连后触发，防错过事件）
  const events = [];
  const controller = new AbortController();
  const sseStartedAt = Date.now();
  const sse = await fetch(BASE + '/api/events', { signal: controller.signal });
  if (!sse.ok || !(sse.headers.get('content-type') || '').includes('event-stream')) {
    throw new Error(`SSE handshake failed: ${sse.status}`);
  }
  record('sse_connected', true, { status: sse.status, contentType: sse.headers.get('content-type') });
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            events.push({ receivedAt: Date.now(), payload: JSON.parse(dataLine.slice(6)) });
          } catch { /* 忽略非 JSON 帧 */ }
        }
      }
    } catch { /* 断流由超时兜底 */ }
  })();

  // 2) 触发真实 job
  const submit = await fetch(BASE + '/api/tools/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 模板项目可能已被并行会话清场（DB 行删除、文件保留）——无 projectId 时
    // 执行链落全局 tool-jobs 目录（routes/tools.js 既定语义），输入用绝对路径。
    body: JSON.stringify({ toolId, ...(projectId && process.env.BLOCK126_NO_PROJECT !== '1' ? { projectId } : {}), params }),
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.json());
  if (!submit.ok || !submit.jobId) throw new Error(`submit failed: ${JSON.stringify(submit).slice(0, 300)}`);
  const jobId = submit.jobId;
  const submittedAt = Date.now();
  console.log(`submitted ${jobId}`);

  // 3) 运行窗口内轮询日志端点，抓 live 尾部
  const logSamples = [];
  let liveSeen = null;
  let terminal = null;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const status = await getJson(`/api/tools/status/${jobId}`).catch(() => null);
    if (status && ['completed', 'failed', 'cancelled'].includes(status.status)) {
      terminal = status;
      break;
    }
    const log = await getJson(`/api/tools/log/${jobId}`).catch(() => null);
    if (log && log.source === 'live' && log.log) {
      liveSeen = {
        at: Date.now(),
        logPreview: String(log.log).slice(0, 160),
        note: log.note || '',
        truncated: !!log.truncated,
      };
    }
    if (log) logSamples.push({ t: Date.now() - submittedAt, source: log.source, bytes: (log.log || '').length });
    await new Promise((r) => { setTimeout(r, 700); });
  }
  await new Promise((r) => { setTimeout(r, 1200); }); // 给 SSE 帧一点到达余量
  controller.abort();
  await Promise.race([pump, new Promise((r) => { setTimeout(r, 2000); })]);

  if (!terminal) throw new Error('job did not reach terminal state in time');
  const completedAt = terminal.completedAt || null;

  // A3：运行中 live 日志
  record('live_log_during_run', !!liveSeen, liveSeen || { logSamplesSeen: logSamples.length });

  // A1/A2：SSE 终态失效事件
  const jobEvents = events.filter((e) => e.payload && e.payload.type === 'invalidate'
    && e.payload.domain === 'jobs' && e.payload.toolJobId === jobId);
  const terminalEvent = jobEvents.find((e) => ['completed', 'failed', 'cancelled'].includes(e.payload.state)) || null;
  record('sse_terminal_invalidation', !!terminalEvent, terminalEvent
    ? { state: terminalEvent.payload.state, allJobEvents: jobEvents.map((e) => e.payload.state) }
    : { totalEvents: events.length, domains: [...new Set(events.map((e) => e.payload.domain))] });
  const latencyMs = terminalEvent && completedAt ? terminalEvent.receivedAt - completedAt : null;
  record('terminal_event_latency_seconds', latencyMs !== null ? Math.abs(latencyMs) <= 10_000 : false, { latencyMs, completedAt });

  // A4：终态后日志走 run.log 文件链
  const finalLog = await getJson(`/api/tools/log/${jobId}`).catch(() => null);
  record('final_log_from_runlog', !!finalLog && finalLog.source === 'run.log' && (finalLog.log || '').includes('=== STDOUT ==='),
    finalLog ? { source: finalLog.source, bytes: (finalLog.log || '').length } : null);

  const allPass = checks.every((c) => c.pass);
  const report = {
    suite: 'block126-perception-live',
    baseUrl: BASE,
    jobId,
    templateJob: TEMPLATE_JOB,
    toolId,
    terminalStatus: terminal.status,
    sseConnectedAfterMs: null,
    runDurationMs: completedAt ? completedAt - submittedAt : null,
    checks,
    allPass,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'perception-live.json'), JSON.stringify(report, null, 2));
  console.log(`\nblock126-perception-live: ${allPass ? 'allPass' : 'HAS FAILURES'} (${checks.filter((c) => c.pass).length}/${checks.length})`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
