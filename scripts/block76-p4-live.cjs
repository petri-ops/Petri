#!/usr/bin/env node
'use strict';

/**
 * BLOCK-76 P4 实机全链验收（plan §6 P4 出口）。
 * 真实节点（dell）全链：SSH 项目跑插件 → 产物落服务器 → 三读面 Gateway 读出
 * → provenance 环境清单正确 → 本地零拉回。
 * 前置：dev 栈在跑（后端已加载 P3 代码）；ssh dell 可达（Rscript + DESeq2）。
 * 证据：acceptance/block-76/p4-live.json
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
  try { return { status: r.status, json: JSON.parse(r.body.toString('utf8')) }; } catch { return { status: r.status, json: null }; }
}

function sshDell(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
    try { fs.writeSync(1, "[" + new Date().toISOString().slice(11, 19) + "] " + (pass ? "PASS" : "FAIL") + " " + name + (detail ? " :: " + String(detail).slice(0, 150) : "") + String.fromCharCode(10)); } catch {}
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  let projectId = null;

  try {
    sshDell(`mkdir -p ${REMOTE_ROOT}`);
    const created = await fetchJson(`${API}/data/projects`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ name: `P4全链-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: REMOTE_ROOT }),
    });
    projectId = created.json && created.json.project && created.json.project.id;
    assert('P4-1 ssh project created (dell)', !!projectId, JSON.stringify(created.json || created).slice(0, 120));
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
    assert('P4-2 job submitted', !!jobId, JSON.stringify(run.json || run).slice(0, 120));
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
    assert('P4-3 deseq2 completed on dell', finalStatus === 'completed', `status=${finalStatus}`);

    // result_json 全语义：ssh 形态 + provenance 环境清单（P3 provenance 平移核对）
    const result = status.json && (status.json.result || (() => { try { return JSON.parse(status.json.result_json); } catch { return null; } })());
    assert('P4-4 result_json ssh semantics', !!result && result.workspaceKind === 'ssh'
      && result.outputPath === `results/jobs/${jobId}/output` && result.transport === 'gateway-ssh-direct',
    JSON.stringify({ ws: result && result.workspaceKind, op: result && result.outputPath }).slice(0, 200));

    // provenance 环境清单（D4：服务器 R 包名册 + sha256）
    const env = result && result.environment;
    assert('P4-5 provenance R env manifest (server truth)', !!env && env.packagesCount > 0
      && /^[0-9a-f]{64}$/.test(env.packagesSha256 || '') && typeof env.packagesText === 'string' && env.packagesText.includes('\n'),
    JSON.stringify({ packagesCount: env && env.packagesCount, sha256: env && env.packagesSha256 }).slice(0, 160));

    // 服务器真值核对（ssh 直查，不经本地读面）
    const remoteFiles = sshDell(`ls -1 ${REMOTE_ROOT}/results/jobs/${jobId}/output/ 2>/dev/null`).split('\n').map((s) => s.trim()).filter(Boolean);
    assert('P4-6 server output truth (artifacts + manifest + run.log)',
      remoteFiles.includes('deg_table.csv') && remoteFiles.includes('manifest.json') && remoteFiles.includes('run.log') && remoteFiles.includes('report.html'),
    `(${remoteFiles.length} files)`);

    // 读面三件套（Gateway）
    const art = await fetchRaw(`${API}/tools/file/${jobId}/deg_table.csv`, { headers: AUTH });
    assert('P4-7 read face: artifact via gateway', art.status === 200 && art.body.length > 500, `status=${art.status} bytes=${art.body.length}`);
    const log = await fetchJson(`${API}/tools/log/${jobId}`, { headers: AUTH });
    assert('P4-8 read face: server run.log', log.status === 200 && log.json && log.json.source === 'run.log' && String(log.json.log || '').length > 0,
    JSON.stringify({ source: log.json && log.json.source }).slice(0, 100));
    const rep = await fetchJson(`${API}/tools/report/${jobId}`, { method: 'POST', headers: AUTH, body: JSON.stringify({}) });
    assert('P4-9 read face: report compose (remote)', rep.status === 200 && rep.json && rep.json.ok === true && rep.json.url,
    JSON.stringify(rep.json || rep).slice(0, 140));

    // 本地零拉回
    const localOut = path.join(REPO, '.petri-dev-user-data', 'data', 'remote-projects', projectId, 'results', 'jobs', jobId, 'output');
    let localFiles = [];
    try { localFiles = fs.readdirSync(localOut); } catch {}
    assert('P4-10 no artifact pull-back (server-only truth)',
      localFiles.filter((f) => f !== 'remote-runner.log').length === 0,
    `local output: [${localFiles.join(', ').slice(0, 120) || 'dir absent'}]`);
  } finally {
    if (projectId) await fetchJson(`${API}/data/projects/${projectId}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    try { sshDell(`rm -rf ${REMOTE_ROOT}`); } catch {}
  }

  const allPass = results.assertions.length > 0 && results.assertions.every((a) => a.pass);
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'p4-live.json'), JSON.stringify(results, null, 2) + '\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
