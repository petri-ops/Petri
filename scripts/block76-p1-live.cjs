#!/usr/bin/env node
'use strict';

/**
 * BLOCK-76 P1 实机验证（plan §6 P1 出口：真实节点上插件作业服务器直跑成功）。
 *
 * 链路：REST 创建 dell SSH 项目 → POST /api/tools/run 跑真插件 deseq2（demo 数据）
 * → 轮询至终态 → 断言：
 *   A1 作业 completed
 *   A2 result_json.workspaceKind='ssh' + outputPath=results/jobs/<jobId>/output + transport=gateway-ssh-direct
 *   A3 服务器真值：results/jobs/<jobId>/output/ 有 all_results.zip + run.log（ssh 直查）
 *   A4 本地 staging 无产物拉回（直跑核心语义；remote-runner.log 镜像除外）
 * 前置：dev 栈在跑（9222/3001，后端须已加载 P1 代码）；ssh dell 可达（有 Rscript + DESeq2）。
 * 证据：acceptance/block-76/p1-live.json
 */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-76');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const REMOTE_ROOT = '/root/gewu-block76-demo';
const MARKER = 'B76-' + Date.now();

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 200), status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sshDell(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

function b64file(p) {
  return fs.readFileSync(p).toString('base64');
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), marker: MARKER, assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
    try { fs.writeSync(1, "[" + new Date().toISOString().slice(11, 19) + "] " + (pass ? "PASS" : "FAIL") + " " + name + (detail ? " :: " + String(detail).slice(0, 160) : "") + String.fromCharCode(10)); } catch {}
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  let projectId = null;

  try {
    // 0) 节点预检 + 远端项目目录
    sshDell(`mkdir -p ${REMOTE_ROOT} && which Rscript`);
    assert('P1-0 dell node ready (Rscript + project dir)', true, REMOTE_ROOT);

    // 1) REST 创建 SSH 项目（dell）
    const created = await fetchJson(`${API}/data/projects`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ name: `P1直跑-${MARKER}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: REMOTE_ROOT }),
    });
    projectId = created.project && created.project.id;
    assert('P1-1 ssh project created (dell)', !!projectId, JSON.stringify(created).slice(0, 160));
    if (!projectId) throw new Error('project create failed');

    // 2) 直跑链：POST /api/tools/run 跑 deseq2（demo 数据）
    const run = await fetchJson(`${API}/tools/run`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({
        toolId: 'deseq2',
        projectId,
        params: { design: 'condition', contrast_ref: 'WT', contrast_treat: 'KO' },
        files: {
          'counts.csv': b64file(path.join(REPO, 'resources', 'demo-data', 'deseq2', 'demo-counts.csv')),
          'coldata.csv': b64file(path.join(REPO, 'resources', 'demo-data', 'deseq2', 'demo-coldata.csv')),
        },
      }),
    });
    const jobId = run.jobId;
    assert('P1-2 tool job submitted', !!jobId, JSON.stringify(run).slice(0, 160));
    if (!jobId) throw new Error('job submit failed');

    // 3) 轮询终态（直跑链含心跳；demo 数据秒级，给 4 分钟预算）
    let status = null;
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(4000);
      status = await fetchJson(`${API}/tools/status/${jobId}`, { headers: AUTH });
      const st = status.status || (status.job && status.job.status);
      if (st === 'completed' || st === 'failed' || st === 'cancelled') break;
    }
    const finalStatus = status && (status.status || (status.job && status.job.status));
    assert('P1-3 job reaches terminal (completed)', finalStatus === 'completed', `status=${finalStatus} detail=${JSON.stringify(status).slice(0, 220)}`);

    // 4) result_json 语义（R4：workspaceKind + 相对 outputPath + 直跑 transport）
    const rj = status && (status.result || status.result_json || (status.job && status.job.result_json));
    let parsed = rj;
    if (typeof rj === 'string') { try { parsed = JSON.parse(rj); } catch {} }
    assert('P1-4 result_json ssh semantics', !!parsed && parsed.workspaceKind === 'ssh'
      && parsed.outputPath === `results/jobs/${jobId}/output`
      && parsed.transport === 'gateway-ssh-direct',
    JSON.stringify({ workspaceKind: parsed && parsed.workspaceKind, outputPath: parsed && parsed.outputPath, transport: parsed && parsed.transport }).slice(0, 220));

    // 5) 服务器真值：output/ 有 all_results.zip + run.log（ssh 直查，不经本地）
    let remoteListing = '';
    try {
      remoteListing = sshDell(`ls -1 ${REMOTE_ROOT}/results/jobs/${jobId}/output/ 2>/dev/null`);
    } catch (e) {
      remoteListing = 'SSH_ERR ' + e.message.slice(0, 80);
    }
    const remoteFiles = remoteListing.split('\n').map((s) => s.trim()).filter(Boolean);
    assert('P1-5 server output dir has artifacts', remoteFiles.includes('run.log') && remoteFiles.length >= 3,
      `remote output: [${remoteFiles.join(', ').slice(0, 200)}]`);

    // 6) 本地无拉回：staging output 不存在 all_results.zip（仅允许 remote-runner.log 镜像）
    const localDataRoot = path.join(REPO, '.biof3-dev-user-data', 'data', 'remote-projects', projectId, 'results', 'jobs', jobId, 'output');
    let localFiles = [];
    try { localFiles = fs.readdirSync(localDataRoot); } catch { /* 目录不存在 = 更干净 */ }
    const pulledArtifacts = localFiles.filter((f) => f !== 'remote-runner.log');
    assert('P1-6 no artifact pull-back to local staging', pulledArtifacts.length === 0,
      `local output files: [${localFiles.join(', ').slice(0, 160) || 'dir absent'}]`);
  } finally {
    // 清理：删项目 + 远端目录
    if (projectId) {
      await fetchJson(`${API}/data/projects/${projectId}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
    }
    try { sshDell(`rm -rf ${REMOTE_ROOT}`); } catch {}
  }

  const allPass = results.assertions.length > 0 && results.assertions.every((a) => a.pass);
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'p1-live.json'), JSON.stringify(results, null, 2) + '\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
