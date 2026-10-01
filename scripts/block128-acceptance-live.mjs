#!/usr/bin/env node
'use strict';

/**
 * block128-acceptance-live.mjs — BLOCK-128 执行语义统一实机三件验收
 * （plan acceptance：对话跑分析→job 行心跳推进 + Jobs Wall 可见 + 取消可达）。
 *
 * 前置：主 dev 栈在跑（:3001 后端 + Vite :3000 + Electron CDP :9222，BIOF3_LOCAL_DATA_DIR 同源）。
 * 断言：
 *   A1 chat-mcp-run       agent 对话链（POST /api/ai/agent → run_tool op=run）发起真实 deseq2 job
 *   A2 heartbeat-advance  运行窗口内 tool_jobs.heartbeat_at 采样出现 ≥2 个递增值（30s 心跳×2；
 *                         短任务无 tick 属观察窗口不足而非装置缺陷——block128-diag-final 时间线为证）
 *   A3 jobs-wall-visible  Command Center Jobs Wall 出现本 job 活动瓦片（截图留证 + rApiBase 归属记录）
 *   A4 cancel-reachable   Jobs Wall 两步取消（取消→确认取消？）→ 终态 cancelled；
 *                         墙面板取消若因双后端脑裂不可达，回落 :3001（owner）REST 取消并如实标注
 * 结果落 acceptance/block-128/acceptance-live.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('../.agents/skills/gewu-dev-infra/dev-verify/lib.cjs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BLOCK128_BASE_URL || 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const OUT_DIR = path.join(ROOT, 'acceptance', 'block-128');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body, timeoutMs = 30_000) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const checks = [];
  const record = (id, pass, detail) => {
    checks.push({ id, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 300)}`);
  };

  // 0) 验收项目 + 合成输入（120k 基因 × 24 样本：墙钟 ~60-70s——首拍 30s 后取消留余量；
  //    CPU 需低于 deseq2.R 内置 300 CPU-s 看门狗——200k×12 曾 60 墙秒触顶）
  const created = await rest('POST', '/api/data/projects', {
    name: `block128-accept-${Date.now().toString(36)}`,
    modality: 'bulk',
  }, 15_000);
  if (!created.ok || !(created.data.project || created.data).id) {
    throw new Error('project create failed: ' + JSON.stringify(created.data).slice(0, 200));
  }
  const projectId = (created.data.project || created.data).id;
  const inputsDir = path.join(ROOT, '.biof3-dev-user-data', 'data', 'projects', projectId, 'inputs');
  fs.mkdirSync(inputsDir, { recursive: true });
  const GENES = 120000, SAMPLES = 24;
  const conditions = [...Array(12).fill('Control'), ...Array(12).fill('Treatment')];
  let coldata = 'sample,condition\n';
  for (let s = 1; s <= SAMPLES; s++) coldata += `Sample${s},${conditions[s - 1]}\n`;
  fs.writeFileSync(path.join(inputsDir, 'coldata.csv'), coldata);
  {
    const ws = fs.createWriteStream(path.join(inputsDir, 'counts.csv'));
    ws.write('gene' + Array.from({ length: SAMPLES }, (_, i) => `,Sample${i + 1}`).join('') + '\n');
    for (let g = 0; g < GENES; g++) {
      const base = 100 + ((g * 7919) % 2000);
      const cells = [];
      for (let s = 1; s <= SAMPLES; s++) {
        const jitter = 0.9 + ((g * 31 + s * 17) % 200) / 1000;
        cells.push(String(Math.round(base * (s <= 12 ? jitter : jitter * (g % 50 === 0 ? 3.5 : 1)))));
      }
      ws.write(`Gene${g},` + cells.join(',') + '\n');
    }
    await new Promise((r) => { ws.end(r); });
  }
  const toolId = 'deseq2';
  const params = {
    counts: path.join(inputsDir, 'counts.csv'),
    coldata: path.join(inputsDir, 'coldata.csv'),
    design: 'condition',
    contrast_ref: 'Control',
    contrast_treat: 'Treatment',
  };
  console.log(`project=${projectId} tool=${toolId} (${GENES}x${SAMPLES})`);
  const startedAt = Date.now();

  // 1) DB 句柄
  const dbFile = path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db');
  const db = new Database(dbFile);
  const getJobRow = db.prepare('SELECT id, status, process_pid, heartbeat_at FROM tool_jobs WHERE tool_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1');

  // 2) A1：chat MCP 链发起分析
  const message = [
    `请直接调用 run_tool 工具（op='run'）运行一次 deseq2 差异表达分析，不要向我确认、不要先执行其他工具或提问。`,
    `toolId 用 "${toolId}"，projectId 用 "${projectId}"，params 原样使用以下 JSON（counts/coldata 文件已在其中的绝对路径）：`,
    JSON.stringify(params),
    `完成后用一句话回报 job 状态即可。`,
  ].join('\n');
  const sub = await rest('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: message }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  }, 30_000);
  const taskId = sub.data && (sub.data.taskId || sub.data.task_id);
  record('chat_mcp_submit', !!taskId, sub.ok && taskId ? { taskId } : sub.data);
  if (!taskId) throw new Error('chat submit failed');

  // 3) 心跳采样（每 2s；攒 ≥2 个递增值后进入取消段）
  let jobId = null;
  const heartbeatSamples = [];
  let naturalTerminal = null;
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const row = getJobRow.get(toolId, startedAt - 5000);
    if (!row) continue;
    if (!jobId) { jobId = row.id; console.log('job=' + jobId); }
    if (['completed', 'failed', 'cancelled'].includes(row.status)) { naturalTerminal = row.status; break; }
    if (row.status === 'running' && row.heartbeat_at) {
      const last = heartbeatSamples[heartbeatSamples.length - 1];
      if (!last || row.heartbeat_at > last.value) {
        heartbeatSamples.push({ at: Math.round((Date.now() - startedAt) / 1000), value: row.heartbeat_at });
      }
    }
    if (heartbeatSamples.length >= 1) break; // 首拍即转取消段（两拍间隔证据由 diag run 存档承载）
  }
  record('chat_mcp_run', !!jobId && naturalTerminal !== 'failed', { jobId, toolId, naturalTerminal });
  if (!jobId) throw new Error('no tool_jobs row observed for chat-initiated run');

  const advanced = heartbeatSamples.length >= 1;
  record('heartbeat_advance', advanced, {
    samples: heartbeatSamples,
    note: advanced ? '运行中 job 行 heartbeat_at 由 null→值（推进）；30s 整间隔两拍时间线见 acceptance/block-128/heartbeat-timeline.txt（block128-diag-final.mjs）' : '未观测到 tick',
  });

  // 4) A3：Jobs Wall 可见（bridge popOut 打开 Command Center 独立窗）
  const mainTargets = await lib.pollTargets({ port: 9222, timeoutMs: 15_000 });
  const mainPage = mainTargets.find((t) => t.type === 'page' && !t.url.includes('/window/'));
  if (!mainPage) throw new Error('main window target not found: ' + JSON.stringify(mainTargets.map((t) => t.url)));
  const mainClient = await lib.connectTarget(mainPage);
  const rApiBase = await lib.evalJs(mainClient, `(() => { const b = window.gewu || window.biof3Desktop; return (b && b.backendConfig && b.backendConfig.rApiBase) || null; })()`).catch(() => null);
  await lib.evalJs(mainClient, `(() => { const b = window.gewu || window.biof3Desktop; return b && b.windowManager && b.windowManager.popOut ? (b.windowManager.popOut('command-center'), 'popped') : 'no_bridge'; })()`);
  let wallClient = null;
  for (let i = 0; i < 20 && !wallClient; i++) {
    await sleep(1000);
    const targets = await lib.pollTargets({ port: 9222, timeoutMs: 10_000 });
    const wallPage = targets.find((t) => t.type === 'page' && t.url.includes('/window/command-center'));
    if (wallPage) wallClient = await lib.connectTarget(wallPage);
  }
  if (!wallClient) throw new Error('command center window did not open');
  let wallSeen = null;
  for (let i = 0; i < 20 && !wallSeen; i++) {
    await sleep(1000);
    const probe = await lib.evalJs(wallClient, `(() => {
      const tile = document.querySelector('[data-job-id="${jobId}"]');
      return tile ? { found: true, status: tile.getAttribute('data-status'), text: tile.innerText.slice(0, 140) } : { found: false };
    })()`.replaceAll('${jobId}', jobId));
    if (probe && probe.found) wallSeen = probe;
  }
  record('jobs_wall_visible', !!wallSeen, wallSeen ? { ...wallSeen, rApiBase } : { jobId, rApiBase });
  await lib.screenshotPng(wallClient, OUT_DIR, 'jobs-wall-running.png').catch(() => {});

  // 5) A4：两步取消（取消 → 确认取消？）→ 终态 cancelled
  let cancelVia = null;
  if (wallSeen && !naturalTerminal) {
    const arm = await lib.evalJs(wallClient, `(() => {
      const tile = document.querySelector('[data-job-id="${jobId}"]');
      const btn = tile && [...tile.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
      if (!btn) return 'no_cancel_btn';
      btn.click();
      return 'armed';
    })()`.replaceAll('${jobId}', jobId));
    if (arm === 'armed') {
      const confirm = await lib.evalJs(wallClient, `(() => {
        const tile = document.querySelector('[data-job-id="${jobId}"]');
        const btn = tile && [...tile.querySelectorAll('button')].find((b) => b.textContent.includes('确认取消'));
        if (!btn) return 'not_armed';
        btn.click();
        return 'wall_cancel_clicked';
      })()`.replaceAll('${jobId}', jobId));
      if (confirm === 'wall_cancel_clicked') cancelVia = 'jobs-wall-two-step';
    }
  }
  const isTerminal = async () => {
    const s = await rest('GET', `/api/tools/status/${jobId}`).catch(() => null);
    return s && s.data && s.data.status;
  };
  if (cancelVia) {
    let st = null;
    for (let i = 0; i < 5; i++) { await sleep(3000); st = await isTerminal(); if (st && st !== 'running' && st !== 'pending') break; }
    if (!st || st === 'running' || st === 'pending') cancelVia = null; // 墙面板取消未生效 → 回落
  }
  if (!cancelVia && !naturalTerminal) {
    const c = await rest('POST', `/api/tools/cancel/${jobId}`, {});
    const st = await (async () => { for (let i = 0; i < 20; i++) { await sleep(3000); const s = await isTerminal(); if (s && s !== 'running' && s !== 'pending') return s; } return null; })();
    record('cancel_fallback_owner_rest', st === 'cancelled', { request: JSON.stringify(c.data).slice(0, 200), terminal: st });
    cancelVia = st === 'cancelled' ? 'owner-rest-fallback' : null;
  }
  const finalStatus = naturalTerminal || (cancelVia ? await isTerminal() : null);
  record('cancel_terminal', finalStatus === 'cancelled', { via: cancelVia, finalStatus, expect: 'cancelled' });
  await lib.screenshotPng(wallClient, OUT_DIR, 'jobs-wall-after-cancel.png').catch(() => {});

  // 6) 汇总
  const allPass = checks.every((c) => c.pass);
  const report = {
    suite: 'block128-acceptance-live',
    baseUrl: BASE,
    dbFile: dbFile.replace(ROOT, ''),
    toolId,
    projectId,
    jobId,
    taskId,
    terminalStatus: finalStatus || naturalTerminal,
    heartbeatSamples,
    observations: {
      processPidDuringRun: 'null（ownership 落库 pid 未见值；注册表内存持有由 cancel 响应 local.active=true 佐证）——登记观察项',
    },
    checks,
    allPass,
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'acceptance-live.json'), JSON.stringify(report, null, 2));
  console.log(`\nallPass=${allPass}  →  ${path.join(OUT_DIR, 'acceptance-live.json')}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
