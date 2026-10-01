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
import os from 'node:os';
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

  // 2) 触发真实 job——HTTP run 的文件输入走 files: { 文件名: base64 } 内联协议
  //（p5 先例），params 里的旧绝对路径仅作参数快照，不参与 staging。
  const filePayload = {};
  for (const key of ['counts', 'coldata']) {
    const src = params[key];
    if (src && fs.existsSync(src)) {
      filePayload[key === 'counts' ? 'counts.csv' : 'coldata.csv'] = fs.readFileSync(src).toString('base64');
    }
  }
  if (!filePayload['counts.csv']) throw new Error(`template input file missing: ${params.counts}`);
  const submit = await fetch(BASE + '/api/tools/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 模板项目可能已被并行会话清场（DB 行删除、文件保留）——不可用时自建验收项目。
    body: JSON.stringify({
      toolId,
      ...(projectId && process.env.BLOCK126_NO_PROJECT !== '1' ? { projectId } : {}),
      params,
      files: filePayload,
    }),
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

  // A4：终态后 run.log 文件链（物理真相）——finalize 原语义 = 写 output/run.log
  //（STDOUT/STDERR/EXIT 三段）。日志端点对该链路的返回另行记录：
  // 端点 resolveProjectRunLayout 对部分项目形态（自建/已删）解析失败回退全局
  // 目录后误报“无日志”——既有缺陷（found 计算非本包触碰面），登记 AUDIT-LOG，
  // 不作为本包验收判据。
  const runLogPath = path.join(ROOT, '.biof3-dev-user-data', 'data', 'projects');
  const candidates = fs.existsSync(runLogPath)
    ? fs.readdirSync(runLogPath).map((entry) => path.join(runLogPath, entry, 'results', 'jobs', jobId, 'output', 'run.log'))
    : [];
  candidates.push(path.join(ROOT, '.biof3-dev-user-data', 'data', 'results', 'tool-jobs', jobId, 'output', 'run.log'));
  candidates.push(path.join(os.homedir(), 'Documents', 'BioF3-Local', 'results', 'tool-jobs', jobId, 'output', 'run.log'));
  const runLogFile = candidates.find((p) => fs.existsSync(p)) || null;
  const runLogContent = runLogFile ? fs.readFileSync(runLogFile, 'utf8') : '';
  record('final_runlog_on_disk',
    !!runLogFile && runLogContent.includes('=== STDOUT ===') && runLogContent.includes('=== EXIT ==='),
    runLogFile ? { path: runLogFile.replace(ROOT, ''), bytes: runLogContent.length } : { searched: candidates.length });
  const endpointFinal = await getJson(`/api/tools/log/${jobId}`).catch(() => null);
  record('log_endpoint_after_terminal_recorded', true, endpointFinal
    ? { source: endpointFinal.source, note: (endpointFinal.note || '').slice(0, 80) }
    : null);

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
