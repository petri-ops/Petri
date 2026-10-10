#!/usr/bin/env node
'use strict';

/**
 * BLOCK-76 P2 实机验证（读面全量 Gateway 化的主链断言，plan §6 P2 出口）。
 *   A1 dell SSH 项目 + deseq2 直跑作业 completed（P1 链复用）
 *   A2 /api/tools/file/:jobId/deg_table.csv → 200 且内容为服务器真值（csv 含逗号表头）
 *   A3 /api/tools/log/:id → 服务器 run.log 尾部（含 source=run.log / live 标记）
 *   A4 POST /api/tools/report/:jobId → 报告生成且 report.html 已写回服务器 output/
 * 前置：dev 栈在跑且后端已加载 P2 代码；ssh dell 可达。
 * 证据：acceptance/block-76/p2-live.json
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-76');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const REMOTE_ROOT = '/root/petri-block76-demo';

function fetchRaw(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function fetchJson(url, opts = {}) {
  const r = await fetchRaw(url, opts);
  try { return { status: r.status, json: JSON.parse(r.body.toString('utf8')) }; } catch { return { status: r.status, json: null, raw: r.body.toString('utf8').slice(0, 200) }; }
}

function sshDell(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
    try { fs.writeSync(1, "[" + new Date().toISOString().slice(11, 19) + "] " + (pass ? "PASS" : "FAIL") + " " + name + (detail ? " :: " + String(detail).slice(0, 160) : "") + String.fromCharCode(10)); } catch {}
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  let projectId = null;

  try {
    sshDell(`mkdir -p ${REMOTE_ROOT}`);
    const created = await fetchJson(`${API}/data/projects`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ name: `P2读面-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: REMOTE_ROOT }),
    });
    projectId = created.json && created.json.project && created.json.project.id;
    assert('P2-1 ssh project created', !!projectId, JSON.stringify(created.json || created).slice(0, 140));
    if (!projectId) throw new Error('project create failed');

    const run = await fetchJson(`${API}/tools/run`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({
        toolId: 'deseq2', projectId,
        params: { design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO' },
        files: {
          'counts.csv': fs.readFileSync(path.join(REPO, 'resources', 'demo-data', 'deseq2', 'demo-counts.csv')).toString('base64'),
          'coldata.csv': fs.readFileSync(path.join(REPO, 'resources', 'demo-data', 'deseq2', 'demo-coldata.csv')).toString('base64'),
        },
      }),
    });
    const jobId = run.json && run.json.jobId;
    assert('P2-2 job submitted', !!jobId, JSON.stringify(run.json || run).slice(0, 140));
    if (!jobId) throw new Error('submit failed');

    let status = null;
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(4000);
      status = await fetchJson(`${API}/tools/status/${jobId}`, { headers: AUTH });
      const st = status.json && (status.json.status || (status.json.job && status.json.job.status));
      if (st === 'completed' || st === 'failed' || st === 'cancelled') break;
    }
    const finalStatus = status.json && (status.json.status || (status.json.job && status.json.job.status));
    assert('P2-3 deseq2 completed on dell (direct chain)', finalStatus === 'completed', `status=${finalStatus}`);

    // A2 产物文件读面：deg_table.csv 经 Gateway 从服务器读取
    const art = await fetchRaw(`${API}/tools/file/${jobId}/deg_table.csv`, { headers: AUTH });
    const head = art.body.toString('utf8').slice(0, 120);
    assert('P2-4 tools/file serves server artifact', art.status === 200 && art.body.length > 0 && /,/.test(head),
      `status=${art.status} bytes=${art.body.length} head=${JSON.stringify(head.slice(0, 60))}`);

    // A3 日志读面：服务器 run.log 尾部
    const log = await fetchJson(`${API}/tools/log/${jobId}`, { headers: AUTH });
    assert('P2-5 tools/log serves server run.log', log.status === 200 && log.json && log.json.ok === true
      && log.json.source === 'run.log' && String(log.json.log || '').length > 0,
    JSON.stringify({ source: log.json && log.json.source, len: log.json ? String(log.json.log || '').length : 0 }).slice(0, 160));

    // A4 报告读面：生成 + 写回服务器 + 可经 tools/file 取回
    const report = await fetchJson(`${API}/tools/report/${jobId}`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ theme: null }),
    });
    const reportOk = report.json && report.json.ok === true && report.json.url;
    assert('P2-6 report generated (remote compose)', !!reportOk, JSON.stringify(report.json || report).slice(0, 160));
    let serverHasReport = false;
    try {
      serverHasReport = sshDell(`test -f ${REMOTE_ROOT}/results/jobs/${jobId}/output/report.html && echo yes`).trim() === 'yes';
    } catch { serverHasReport = false; }
    assert('P2-7 report.html written back to server (truth)', serverHasReport);
    if (reportOk) {
      const reportName = String(report.json.url).split('/').pop();
      const rep = await fetchRaw(`${API}/tools/file/${jobId}/${reportName}`, { headers: AUTH });
      assert('P2-8 report served via tools/file (gateway read)', rep.status === 200 && rep.body.length > 1000 && /<html/i.test(rep.body.toString('utf8').slice(0, 400)),
        `status=${rep.status} bytes=${rep.body.length}`);
    }
  } finally {
    if (projectId && !process.env.BLOCK76_KEEP) await fetchJson(`${API}/data/projects/${projectId}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    if (!process.env.BLOCK76_KEEP) { try { sshDell(`rm -rf ${REMOTE_ROOT}`); } catch {} }
  }

  const allPass = results.assertions.length > 0 && results.assertions.every((a) => a.pass);
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'p2-live.json'), JSON.stringify(results, null, 2) + '\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
