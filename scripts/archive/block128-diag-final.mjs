#!/usr/bin/env node
'use strict';

/**
 * block128-diag-final.mjs — MCP 链长任务终局观测：
 * 每 2s 同时采 ①DB 行（读写连接）②ps 里的 Rscript 真身+父进程 ③两个 node 后端 pid；
 * 观察到 pid/hb 或 Rscript 出现后 20s，REST 取消（:3001 /api/tools/cancel/:id），
 * 记录终态。产出全时间线到 stdout。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body, timeoutMs = 30_000) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json().catch(() => ({}));
}

function psSample() {
  try {
    const out = execSync('ps -axo pid,ppid,command | grep -E "Rscript|petri-server/server.js" | grep -v grep', { encoding: 'utf8' });
    return out.trim().split('\n').map((l) => l.trim().slice(0, 130));
  } catch { return []; }
}

async function main() {
  // 项目 + 200k 正确合成输入（node 单循环，无双逗号）
  const created = await rest('POST', '/api/data/projects', { name: `block128-diag-${Date.now().toString(36)}`, modality: 'bulk' });
  const projectId = (created.project || created).id;
  const inputsDir = path.join(ROOT, '.petri-dev-user-data', 'data', 'projects', projectId, 'inputs');
  fs.mkdirSync(inputsDir, { recursive: true });
  const GENES = 200000, SAMPLES = 12;
  const conditions = [...Array(6).fill('Control'), ...Array(6).fill('Treatment')];
  let coldata = 'sample,condition\n';
  for (let s = 1; s <= SAMPLES; s++) coldata += `Sample${s},${conditions[s - 1]}\n`;
  fs.writeFileSync(path.join(inputsDir, 'coldata.csv'), coldata);
  const ws = fs.createWriteStream(path.join(inputsDir, 'counts.csv'));
  ws.write('gene' + Array.from({ length: SAMPLES }, (_, i) => `,Sample${i + 1}`).join('') + '\n');
  for (let g = 0; g < GENES; g++) {
    const base = 100 + ((g * 7919) % 2000);
    const cells = [];
    for (let s = 1; s <= SAMPLES; s++) {
      const jitter = 0.9 + ((g * 31 + s * 17) % 200) / 1000;
      cells.push(String(Math.round(base * (s <= 6 ? jitter : jitter * (g % 50 === 0 ? 3.5 : 1)))));
    }
    ws.write(`Gene${g},` + cells.join(',') + '\n');
  }
  await new Promise((r) => { ws.end(r); });
  const params = {
    counts: path.join(inputsDir, 'counts.csv'),
    coldata: path.join(inputsDir, 'coldata.csv'),
    design: 'condition', contrast_ref: 'Control', contrast_treat: 'Treatment',
  };
  console.log(`project=${projectId} 200k genes ready`);

  const message = `请直接调用 run_tool 工具（op='run'）运行一次 deseq2 差异表达分析，不要确认不要提问。toolId="deseq2"，projectId="${projectId}"，params=${JSON.stringify(params)}。完成后一句话回报。`;
  const sub = await rest('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: message }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  console.log('taskId=' + (sub.taskId || sub.task_id));
  const startedAt = Date.now();

  const db = new Database(path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db'));
  const getRow = db.prepare("SELECT id, status, process_pid, heartbeat_at FROM tool_jobs WHERE tool_id='deseq2' AND created_at >= ? ORDER BY created_at DESC LIMIT 1");

  const timeline = [];
  let jobId = null, sawProcess = false, cancelSent = false;
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const row = getRow.get(startedAt - 5000);
    if (!row) continue;
    if (!jobId) { jobId = row.id; console.log('job=' + jobId); }
    const procs = psSample();
    const rscript = procs.filter((l) => l.includes('Rscript'));
    if (rscript.length > 0) sawProcess = true;
    timeline.push({ t: Math.round((Date.now() - startedAt) / 1000), status: row.status, pid: row.process_pid, hb: row.heartbeat_at, rscript: rscript.length });
    // 心跳两拍 + 20s 余量后取消
    const hbs = [...new Set(timeline.filter((x) => x.hb).map((x) => x.hb))];
    if (!cancelSent && hbs.length >= 2 && timeline[timeline.length - 1].t - timeline.find((x) => x.hb)?.t > 8) {
      const c = await rest('POST', `/api/tools/cancel/${jobId}`, {});
      console.log('cancel sent →', JSON.stringify(c).slice(0, 120));
      cancelSent = true;
    }
    if (cancelSent && ['completed', 'failed', 'cancelled'].includes(row.status)) break;
    if (!cancelSent && ['completed', 'failed'].includes(row.status)) break; // 自然终态（取消失败也如实停）
  }

  console.log('--- timeline（每 3 条采样 1） ---');
  timeline.filter((_, i) => i % 3 === 0).forEach((x) =>
    console.log(`t=${x.t}s status=${x.status} pid=${x.pid} hb=${x.hb ? new Date(x.hb).toISOString().slice(11, 19) : 'null'} rscript=${x.rscript}`));
  const hbs = [...new Set(timeline.filter((x) => x.hb).map((x) => x.hb))];
  console.log(`\nSUMMARY: jobId=${jobId} heartbeat_distinct=${hbs.length} advancing=${hbs.length >= 2} rscript_seen=${sawProcess} cancelSent=${cancelSent}`);
  if (sawProcess) {
    console.log('--- 最后一次进程采样 ---');
    for (const l of psSample()) console.log('  ' + l);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
