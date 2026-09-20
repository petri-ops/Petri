#!/usr/bin/env node
'use strict';

/**
 * BLOCK-85 双真机验收 P2（Runbook §2）：Windows 提交真实分析作业 → fed 转发 → Mac 执行。
 *
 * 链路：POST /api/tools/run（params.executionTargetId=fed:<peerId>，tools-executor.js fed 分支）
 * → 对端以其本地身份跑 deseq2（demo 数据）→ Windows 侧镜像 job 投影。
 * 断言：
 *   A1 提交响应 federated:true + 对端 job 投影（peerName=MacBook-Pro.local）
 *   A2 镜像 job 到终态 completed（轮询 /api/tools/status）
 *   A3 result 语义含对端指纹（executor/outputPath 等，如实记录）
 *   A4 Artifact Truth 在执行端：Windows 本地 staging 无产物拉回
 * 证据：acceptance/block-85/dual-p2-job.json（Runbook 指定路径）
 * 前置：dev 栈 :3001 在跑；peer probe 绿灯；Mac 有 Rscript + DESeq2 库（缺则 failed+run.log 明示，如实登记）。
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-85');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const PEER_ID = process.env.B85_LOCAL ? null : (process.env.B85_PEER_ID || 'gpeer_1b29dffe41f7d531');
const MODE = PEER_ID ? 'fed' : 'local'; // B85_LOCAL=1 → 本地同链验证（job-provenance 收尾修复回归）
const MARKER = 'B85P2-' + Date.now();

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.slice(0, 200), status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}


// demo 输入从 demo-data 端点取（与 UI 同链），不做本地路径依赖
function fetchB64(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => res.statusCode === 200
        ? resolve(Buffer.concat(chunks).toString('base64'))
        : reject(new Error(`HTTP ${res.statusCode} for ${url}`)));
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), marker: MARKER, peerId: PEER_ID, assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
    try { fs.writeSync(1, '[' + new Date().toISOString().slice(11, 19) + '] ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 180) : '') + String.fromCharCode(10)); } catch {}
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // 0) 预检：fed 模式要求 peer 在册
  if (PEER_ID) {
    const peers = await fetchJson(`${API}/federation/peers`, { headers: AUTH });
    const peer = (peers.peers || []).find((p) => p.peerId === PEER_ID);
    assert('P2-0 peer registered', !!peer, JSON.stringify(peers).slice(0, 200));
    if (!peer) throw new Error('peer not registered');
  } else {
    assert('P2-0 local mode (fed dispatch skipped)', true, 'B85_LOCAL=1');
  }

  // 1) 提交作业（fed → Mac 执行；local → 本机同链回归）
  const params = MODE === 'fed'
    ? { design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO', executionTargetId: `fed:${PEER_ID}` }
    : { design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO' };
  const run = await fetchJson(`${API}/tools/run`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      toolId: 'deseq2',
      params,
      files: {
        'counts.csv': await fetchB64(`${API.replace(/\/api$/, '')}/api/tools/demo-data/deseq2/demo-counts.csv`),
        'coldata.csv': await fetchB64(`${API.replace(/\/api$/, '')}/api/tools/demo-data/deseq2/demo-coldata.csv`),
      },
    }),
  });
  results.submitResponse = run;
  const fedOk = MODE === 'local'
    ? run.ok === true && !!run.jobId
    : run.ok === true && run.federated === true && run.peerId === PEER_ID;
  const jobId = run.jobId || (run.job && run.job.jobId);
  assert('P2-1 submit accepted', fedOk && !!jobId, JSON.stringify(run).slice(0, 300));
  if (!jobId) throw new Error('job submit failed: ' + JSON.stringify(run).slice(0, 200));

  // 2) 轮询到终态（R 冷启动 + DESeq2 加载 +〔fed〕跨网段，给 6 分钟预算）
  const statusUrl = MODE === 'fed'
    ? `${API}/federation/peers/${PEER_ID}/jobs/${jobId}`
    : `${API}/tools/status/${jobId}`;
  let status = null;
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await delay(5000);
    status = await fetchJson(statusUrl, { headers: AUTH });
    const st = status.status || (status.job && status.job.status);
    if (st === 'completed' || st === 'failed' || st === 'cancelled') break;
  }
  const finalStatus = status && (status.status || (status.job && status.job.status));
  results.finalStatus = status;
  assert('P2-2 mirror job reaches completed', finalStatus === 'completed', `status=${finalStatus} detail=${JSON.stringify(status).slice(0, 300)}`);

  // 3) result 语义（对端指纹如实记录：workspaceKind/executor/outputPath 形状以对端产出为准）
  const rj = status && (status.result || status.result_json || (status.job && (status.job.result || status.job.result_json)));
  let parsed = rj;
  if (typeof rj === 'string') { try { parsed = JSON.parse(rj); } catch {} }
  results.resultJson = parsed;
  assert('P2-3 result present (peer truth)', !!parsed, JSON.stringify(parsed || {}).slice(0, 300));

  // 4) Artifact Truth 在执行端：fed 模式断言 Windows staging 无拉回（local 模式产物本就在本地，跳过）
  if (MODE === 'fed') {
    const candidates = [
      path.join(REPO, '.biof3-dev-user-data', 'data', 'results', 'jobs', jobId),
      path.join(REPO, '.biof3-dev-user-data', 'data', 'tools-results', jobId),
    ];
    let pulled = [];
    for (const dir of candidates) {
      try { pulled = pulled.concat(fs.readdirSync(dir)); } catch { /* 目录不存在 = 更干净 */ }
    }
    assert('P2-4 no artifact pull-back to Windows staging', pulled.length === 0,
      `local dirs checked: [${candidates.join(', ')}] found: [${pulled.join(', ').slice(0, 120) || 'none'}]`);
  }

  const allPass = results.assertions.length > 0 && results.assertions.every((a) => a.pass);
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  const evidenceName = MODE === 'fed' ? 'dual-p2-job.json' : 'local-p2-regression.json';
  fs.writeFileSync(path.join(EVIDENCE, evidenceName), JSON.stringify(results, null, 2) + '\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
