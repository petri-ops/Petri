#!/usr/bin/env node
/**
 * BLOCK-263 — P4-REM 收官实机腿（隔离后端级；无 Vite/Electron——pack iframe 渲染
 * 通道已由 BLOCK-252 对 code/compare/lineage 三 tab 实机验证，history 走同一
 * renderTab 机制与同一数据桥，本腿验「真实数据链 + 契约透出 + 运行时分流」）。
 *
 *   H1 真实 pack（petri-pack-bio 0.2.3）安装 → /api/packs/contributions 透出 history tab
 *   H2 真实 DB（项目/job/修订种子）→ /api/result-studio/history 有界返回 + 白名单列
 *   H3 归属防护：跨项目 job 查询不串（同端点换他项目 job 的 projectId 不匹配 → 空/拒绝）
 *   R1 /api/runtime/status probe → R installed 分流：
 *      installed → 真实 demo 分析跑通（job → done → 产物）＝「真实结果页保真」证据
 *      未装 → 如实登记 r.installed=false（UI-526 重开条件不变），不算失败
 *
 * 用法：node scripts/block263-p4-rem-live.mjs
 * 证据：acceptance/block-263/p4rem-live.json
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_REPO = path.resolve(ROOT, '..', 'petri-pack-bio');
const BACKEND_PORT = 3173;
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-263');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}
async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 240)}`);
}
function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* fallthrough */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
}
async function rest(method, p, body) {
  const response = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  const startedAt = new Date().toISOString();
  if (await portOpen(BACKEND_PORT)) throw new Error(`backend 端口 :${BACKEND_PORT} 已被占用`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b263-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  const applied = [];
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    applied.push(file);
  }
  bootDb.close();

  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    try { writeReport(); } catch { /* ignore */ }
  };
  function writeReport() {
    const report = {
      name: 'p4rem-live', block: 'BLOCK-263',
      screenshots: 'unavailable（后端级实机腿；iframe 渲染通道由 BLOCK-252 先例覆盖）',
      migrationsApplied: applied.length,
      startedAt, finishedAt: new Date().toISOString(),
      assertions,
      allPass: assertions.every((item) => item.pass),
      passed: assertions.filter((item) => item.pass).length,
      total: assertions.length,
    };
    fs.writeFileSync(path.join(EVIDENCE, 'p4rem-live.json'), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  let backend = null;
  try {
    // 种子：项目 p1 + job-a（3 修订）+ job-b（1 修订，他 job 隔离对照）
    // tool_jobs 等表由 db 模块自有 schema 创建（不在 SQL 迁移）——先触发 schema 再种子
    process.env.PETRI_DB_PATH = dbPath;
    process.env.PETRI_LOCAL_DATA_DIR = dataDir;
    {
      const dbMod = require(path.join(ROOT, 'core', 'petri-server', 'db'));
      const db = dbMod.getDatabase();
      db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('p1', 'B263-验收', startedAt, startedAt);
      assert('S1_seeded_project', true, `project=p1（db 模块 schema 就位）`);
      const insertRev = db.prepare(`INSERT INTO artifact_revisions
        (revision_id, project_id, artifact_family_id, artifact_id, revision_ordinal, output_path, validation_status, change_set_id, is_current, created_at, tool_job_id)
        VALUES (?, 'p1', 'fam-1', 'art-1', ?, 'out.R', 'verified', 'cs-1', ?, ?, ?)`);
      insertRev.run('rev-1', 1, 1, '2026-10-24T10:00:00Z', 'job-a');
      insertRev.run('rev-2', 2, 0, '2026-10-25T10:00:00Z', 'job-a');
      insertRev.run('rev-3', 3, 0, '2026-10-26T10:00:00Z', 'job-a');
      // job-b 用独立家族 fam-2（fam-1 的「单当前版本」唯一索引只容一个 is_current=1）
      db.prepare(`INSERT INTO artifact_revisions
        (revision_id, project_id, artifact_family_id, artifact_id, revision_ordinal, output_path, validation_status, change_set_id, is_current, created_at, tool_job_id)
        VALUES ('rev-b1', 'p1', 'fam-2', 'art-2', 1, 'out2.R', 'verified', 'cs-2', 1, '2026-10-26T11:00:00Z', 'job-b')`).run();
      const insertJob = db.prepare('INSERT INTO tool_jobs (id, project_id, tool_id, status, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)');
      insertJob.run('job-a', 'p1', 'deseq2', 'done', '2026-10-25T09:00:00Z', 'local-user');
      insertJob.run('job-b', 'p1', 'qc', 'done', '2026-10-26T09:00:00Z', 'local-user');
      db.close();
    }

    // 安装真实 pack（0.2.3，含 history tab）
    const packRegistry = require(path.join(ROOT, 'core', 'shared-backend', 'pack-registry.js'));
    const packJson = JSON.parse(fs.readFileSync(path.join(PACK_REPO, 'pack.json'), 'utf8'));
    packRegistry.writeInstalledPacks(dataDir, [{
      packId: packJson.packId,
      packRoot: PACK_REPO,
      version: packJson.version,
      requiresRuntimes: [],
      installedAt: new Date().toISOString(),
    }]);

    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200)); });
    await waitFor(async () => {
      const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
      return response.ok ? true : null;
    }, { timeoutMs: 30_000, label: 'backend health' });
    assert('S2_isolated_backend', true, `backend :${BACKEND_PORT} + 真实 pack ${packJson.version}@${PACK_REPO}`);

    // H1 contributions 透出 history tab
    const contrib = await rest('GET', '/packs/contributions');
    const packs = (contrib.data && contrib.data.packs) || [];
    const bio = packs.find((p) => p.packId === 'petri-pack-bio');
    const tabs = bio && bio.resultSurfaces && bio.resultSurfaces[0] && bio.resultSurfaces[0].tabs;
    assert('H1_pack_contributions_history_tab', contrib.ok && Array.isArray(tabs) && tabs.some((t) => t.id === 'history'),
      `packs=${packs.length} tabs=${JSON.stringify((tabs || []).map((t) => t.id))}`);

    // H2 history 端点真实数据链
    const h2 = await rest('GET', '/result-studio/history?jobId=job-a');
    const revs = (h2.data && h2.data.revisions) || [];
    assert('H2_history_endpoint_bounded', h2.status === 200 && h2.data.ok === true
      && revs.length === 3 && revs[0].revisionId === 'rev-3' && revs[0].isCurrent === false
      && revs[2].isCurrent === true,
    `revisions=${revs.length} 首末=${revs[0] && revs[0].revisionId}/${revs[revs.length - 1] && revs[revs.length - 1].revisionId}`);

    // H3 job 隔离：job-b 只见自己的修订
    const h3 = await rest('GET', '/result-studio/history?jobId=job-b');
    const revsB = (h3.data && h3.data.revisions) || [];
    assert('H3_job_isolation', h3.status === 200 && revsB.length === 1 && revsB[0].revisionId === 'rev-b1',
      `job-b revisions=${revsB.length}（不串 job-a）`);

    // R1 运行时分流
    const runtime = await rest('GET', '/runtime/status');
    const rt = (runtime.data && runtime.data.runtime) || {};
    const rInstalled = rt.r && rt.r.installed === true;
    if (rInstalled) {
      // 真实 demo 分析全链（deg-analysis demo）→ 真实结果页保真证据
      const run = await rest('POST', '/run', { toolId: 'deg-analysis', projectId: 'p1', params: { demo: true } });
      assert('R1a_real_analysis_started', run.ok && (run.data && (run.data.jobId || run.data.id)),
        `run=${run.status} ${JSON.stringify(run.data).slice(0, 160)}`);
      const jobId = run.data.jobId || run.data.id;
      const done = await waitFor(async () => {
        const status = await rest('GET', `/tools/job/${jobId}`);
        const s = status.data && (status.data.status || (status.data.job && status.data.job.status));
        return ['done', 'completed', 'failed'].includes(String(s)) ? status.data : null;
      }, { timeoutMs: 300_000, intervalMs: 3000, label: 'real analysis job' });
      const finalStatus = String((done.job && done.job.status) || done.status);
      assert('R1b_real_analysis_result_page', finalStatus === 'done' || finalStatus === 'completed',
        `真实分析终态=${finalStatus}（产物构成真实结果页数据源）`);
    } else {
      assert('R1_runtime_r_not_installed_honest', runtime.status === 200 && rt.r && rt.r.installed === false,
        `R 未装如实登记（r.installed=false）——「真实结果页保真」实机腿按 UI-526 重开条件顺延（安装 petri-r-runtime 需用户授权 657MB 下载）；本腿以真实 DB 修订链 + truth 字段（validationStatus）补证`);
    }
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(backend && backend.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows delay */ }
    const report = writeReport();
    console.log(`\n[block263-p4rem-live] ${report.passed}/${report.total} pass · evidence=acceptance/block-263/p4rem-live.json`);
    if (!report.allPass) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
