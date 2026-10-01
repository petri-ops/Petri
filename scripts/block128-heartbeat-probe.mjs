#!/usr/bin/env node
'use strict';

/**
 * block128-heartbeat-probe.mjs — MCP 链长任务心跳原始观测（诊断腿，非收口判据）。
 * 200k 基因 deseq2（预计 1-3 分钟），每 2s 采 (status, process_pid, heartbeat_at) 原始行，
 * 结束后打印全时间线 + 是否观察到心跳推进。另开 HTTP 链对照件（同输入直接 /api/tools/run）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('../.agents/skills/gewu-dev-infra/dev-verify/lib.cjs');
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

async function main() {
  // 项目 + 大输入
  const created = await rest('POST', '/api/data/projects', { name: `block128-hb-${Date.now().toString(36)}`, modality: 'bulk' });
  const projectId = (created.project || created).id;
  const inputsDir = path.join(ROOT, '.biof3-dev-user-data', 'data', 'projects', projectId, 'inputs');
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.copyFileSync('/tmp/big-counts.csv', path.join(inputsDir, 'counts.csv'));
  fs.copyFileSync('/tmp/big-coldata.csv', path.join(inputsDir, 'coldata.csv'));
  const params = {
    counts: path.join(inputsDir, 'counts.csv'),
    coldata: path.join(inputsDir, 'coldata.csv'),
    design: 'condition',
    contrast_ref: 'Control',
    contrast_treat: 'Treatment',
  };

  const { db } = (() => {
    const Database2 = Database;
    return { db: new Database2(path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db'), { readonly: true }) };
  })();

  // chat MCP 链发起
  const message = `请直接调用 run_tool 工具（op='run'）运行一次 deseq2 差异表达分析，不要确认不要提问。toolId="deseq2"，projectId="${projectId}"，params=${JSON.stringify(params)}。完成后一句话回报。`;
  const sub = await rest('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: message }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const taskId = sub.taskId || sub.task_id;
  console.log('taskId=' + taskId);
  const startedAt = Date.now();
  const getRow = db.prepare("SELECT id, status, process_pid, heartbeat_at FROM tool_jobs WHERE tool_id='deseq2' AND created_at >= ? ORDER BY created_at DESC LIMIT 1");

  const timeline = [];
  let jobId = null;
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const row = getRow.get(startedAt - 5000);
    if (!row) continue;
    if (!jobId) { jobId = row.id; console.log('job=' + jobId); }
    timeline.push({ t: Math.round((Date.now() - startedAt) / 1000), status: row.status, pid: row.process_pid, hb: row.heartbeat_at });
    if (['completed', 'failed', 'cancelled'].includes(row.status)) break;
  }
  const hbValues = [...new Set(timeline.filter((x) => x.hb).map((x) => x.hb))];
  console.log('--- timeline ---');
  for (const x of timeline) console.log(`t=${x.t}s status=${x.status} pid=${x.pid} hb=${x.hb ? new Date(x.hb).toISOString().slice(11, 19) : 'null'}`);
  const advancing = hbValues.length >= 2;
  console.log(`\nheartbeat distinct values=${hbValues.length} advancing=${advancing}`);
  const meta = await rest('GET', `/api/ai/agent/task/${taskId}/meta`);
  console.log('agent task terminal=', meta.agentStatus || meta.agent_status || JSON.stringify(meta).slice(0, 120));
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
