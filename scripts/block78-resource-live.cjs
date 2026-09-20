#!/usr/bin/env node
'use strict';

/**
 * BLOCK-78 P2-① 实机验收（远程资源实时快照，plan §5 P2① 出口）。
 *   A1 dell SSH 项目创建
 *   A2 首击 GET resource-snapshot?projectId → source=remote/host=dell
 *      （首击即证 ensureAgent 新哈希重部署 + sys_resource verb 生效）
 *   A3 读数对账：free -b / nproc / df -P 逐项（±2% 容差，meminfo 同源应精确）
 *   A4 TTL 合并：3s 内二次 GET → observedAt 相同（缓存命中，仅一次往返）
 *   A5 TTL 过期：>3s 后 GET → observedAt 更新（新探测）
 *   A6 不可达三态：假别名项目 → 502 remote_resource_unreachable + host 回显
 *   A7 本地不回归：无参 GET → 本机快照（无 source=remote）
 *   A8 路由 sanity：不存在 projectId → 404 project_not_found
 * 前置：dev 栈在跑（后端已载 P2-① 代码）；ssh dell 可达（BatchMode）。
 * 证据：acceptance/block-78/resource-live.json
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EVIDENCE = path.join(REPO, 'acceptance', 'block-78');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const REMOTE_ROOT = '/root/gewu-block78-demo';

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
  try { return { status: r.status, headers: r.headers, json: JSON.parse(r.body.toString('utf8')) }; } catch { return { status: r.status, headers: r.headers, json: null, raw: r.body.toString('utf8').slice(0, 200) }; }
}

function sshDell(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell', cmd], { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= Math.abs(Number(b)) * tol;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
    try { fs.writeSync(1, '[' + new Date().toISOString().slice(11, 19) + '] ' + (pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 160) : '') + '\n'); } catch {}
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    sshDell(`mkdir -p ${REMOTE_ROOT}`);
    const created = await fetchJson(`${API}/data/projects`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ name: `B78资源快照-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: REMOTE_ROOT }),
    });
    projectId = created.json && created.json.project && created.json.project.id;
    assert('A1 dell ssh project created', created.status === 200 && !!projectId, JSON.stringify(created.json).slice(0, 160));

    // A2 首击：ensureAgent（新哈希 → 重部署）+ sys_resource verb 生效
    const first = await fetchJson(`${API}/harness/resource-snapshot?projectId=${encodeURIComponent(projectId)}`, { headers: AUTH });
    const snap = first.json && first.json.snapshot;
    assert('A2 first probe source=remote host=dell', first.status === 200 && snap && snap.source === 'remote' && snap.host === 'dell',
      JSON.stringify(first.json).slice(0, 200));

    // A3 与节点真值逐项对账
    try {
      const free = sshDell('free -b');
      const mt = Number((free.match(/Mem:\s+(\d+)/) || [])[1]);
      const ma = Number((free.match(/Mem:\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/) || [])[1]) || null;
      // free 输出第 6 列即 available（available 列存在时）；直接抓 available 行更稳：
      const maMatch = free.match(/Mem:\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      const memAvailable = maMatch ? Number(maMatch[1]) : ma;
      const cores = Number(sshDell('nproc').trim());
      const df = sshDell(`df -PB1 ${REMOTE_ROOT}`).trim().split('\n').pop().split(/\s+/);
      const diskTotal = Number(df[1]); const diskAvail = Number(df[3]);
      const memOk = near(snap.memory.totalBytes, mt, 0.001) && near(snap.memory.availableBytes, memAvailable, 0.02);
      const coresOk = snap.cpu.logicalCores === cores;
      const diskOk = near(snap.disk.totalBytes, diskTotal, 0.001) && near(snap.disk.availableBytes, diskAvail, 0.02);
      assert('A3a memory matches free -b', memOk, `card=${snap.memory.totalBytes}/${snap.memory.availableBytes} node=${mt}/${memAvailable}`);
      assert('A3b cores matches nproc', coresOk, `card=${snap.cpu.logicalCores} node=${cores}`);
      assert('A3c disk matches df -P', diskOk, `card=${snap.disk.totalBytes}/${snap.disk.availableBytes} node=${diskTotal}/${diskAvail}`);
    } catch (e) {
      assert('A3 reconcile (ssh free/df)', false, e.message);
    }

    // A4 TTL：3s 内二次 GET → observedAt 相同
    const second = await fetchJson(`${API}/harness/resource-snapshot?projectId=${encodeURIComponent(projectId)}`, { headers: AUTH });
    assert('A4 TTL cache hit (same observedAt)', second.json && second.json.snapshot && second.json.snapshot.observedAt === snap.observedAt,
      `${snap.observedAt} vs ${second.json && second.json.snapshot && second.json.snapshot.observedAt}`);

    // A5 TTL 过期：>3.2s → 新观测
    await delay(3300);
    const third = await fetchJson(`${API}/harness/resource-snapshot?projectId=${encodeURIComponent(projectId)}`, { headers: AUTH });
    assert('A5 TTL expiry → fresh probe (new observedAt)', third.json && third.json.snapshot && third.json.snapshot.observedAt !== snap.observedAt,
      `${snap.observedAt} → ${third.json && third.json.snapshot && third.json.snapshot.observedAt}`);

    // A6 不可达三态：假别名 → 502 remote_resource_unreachable
    const bogus = await fetchJson(`${API}/data/projects`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ name: `B78不可达-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'b78-nonexistent-alias', remotePath: '/tmp/b78' }),
    });
    const bogusId = bogus.json && bogus.json.project && bogus.json.project.id;
    const bad = await fetchJson(`${API}/harness/resource-snapshot?projectId=${encodeURIComponent(bogusId)}`, { headers: AUTH });
    assert('A6 unreachable → 502 remote_resource_unreachable',
      bad.status === 502 && bad.json && bad.json.error === 'remote_resource_unreachable' && bad.json.host === 'b78-nonexistent-alias',
      JSON.stringify(bad.json).slice(0, 200));

    // A7 本地不回归：无参 GET → 本机快照（无 source=remote）
    const local = await fetchJson(`${API}/harness/resource-snapshot`, { headers: AUTH });
    assert('A7 no-param local snapshot unchanged', local.status === 200 && local.json && local.json.snapshot && local.json.snapshot.source !== 'remote',
      `platform=${local.json && local.json.snapshot && local.json.snapshot.platform}`);

    // A8 路由 sanity：不存在项目 → 404
    const missing = await fetchJson(`${API}/harness/resource-snapshot?projectId=p_nonexistent`, { headers: AUTH });
    assert('A8 missing project → 404 project_not_found', missing.status === 404 && missing.json && missing.json.error === 'project_not_found',
      JSON.stringify(missing.json).slice(0, 120));
  } catch (e) {
    assert('FATAL', false, e.message);
  }

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'resource-live.json'), JSON.stringify(results, null, 2));
  fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] allPass=${results.allPass}\n`);
}

let projectId = null;
main().catch((e) => { console.error(e); process.exit(1); });
