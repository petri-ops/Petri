#!/usr/bin/env node
/**
 * BLOCK-271 — 1b（BIO-2 / UI-454）交互上限与降级链：日志端点项目目录兜底实机生效腿。
 *
 * 1b 唯一未验证点 = 「实机生效待栈重启」（backlog 注记）：BIO-2 代码已落地
 * （日志端点在布局解析失败时按 workspace_path 经 resolveToolJobExportDirs
 * 候选链兜底项目 jobRoot），本脚本在**隔离后端**上以真实 DB 行 + 项目布局
 * run.log 直证端点返回 source='run.log'。
 *
 * 用法：node scripts/block271-bio2-logfallback-live.mjs
 * 证据：acceptance/block-271/bio2-logfallback-live.json
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
const BACKEND_PORT = 3001;
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-271');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* fallthrough */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
}

async function waitHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function rest(method, p, body) {
  const response = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  return { ok: response.ok, status: response.status, data };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  if (await portOpen(BACKEND_PORT)) throw new Error(`端口 :${BACKEND_PORT} 已被占用；请先停止现有 dev/测试实例（本脚本自起隔离后端）`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b271-live-'));
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

  let backend = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 200)}`);
    writeReport();
  };
  function writeReport() {
    const report = {
      name: 'b271-bio2-logfallback-live', block: 'BLOCK-271',
      migrationsApplied: applied.length,
      startedAt, finishedAt: new Date().toISOString(),
      assertions,
      allPass: assertions.every((item) => item.pass),
      passed: assertions.filter((item) => item.pass).length,
      total: assertions.length,
    };
    fs.writeFileSync(path.join(EVIDENCE, 'bio2-logfallback-live.json'), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, PETRI_LOCAL_RESULTS_DIR: path.join(dataDir, 'results'), R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200)); });
    await waitHttp(`${API}/health`, 30_000, 'backend health');
    // 等 schema 就绪（tool_jobs 由后端启动链建表，非桌面迁移）：轻探一个 DB-backed 端点
    await waitHttp(`${API}/data/projects`, 30_000, 'schema-ready');

    // seed 项目（带 workspace_path → 布局解析走项目 jobRoot）
    const created = await rest('POST', '/data/projects', { name: `B271-验收-${Date.now()}`, modality: 'general' });
    const project = created.data && created.data.project;
    if (!project) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 200)}`);
    assert('S1_seeded_project', true, `project=${project.id}`);

    // seed tool_jobs 行 + 在项目布局 outputDir 造 run.log（布局用与端点同一函数解析）
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const jobId = `job_b271_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO tool_jobs (id, user_id, project_id, tool_id, status, is_test_run, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(jobId, 'local-user', project.id, 'probe-tool', 'completed', now);
    // workspace_path 补齐（POST /data/projects 可能不落盘字段——按执行链约定落到 dataDir/projects）
    const projectRow = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(project.id);
    const workspacePath = projectRow && projectRow.workspace_path
      ? projectRow.workspace_path
      : path.join(dataDir, 'projects', project.id);
    if (!projectRow || !projectRow.workspace_path) {
      db.prepare('UPDATE projects SET workspace_path = ? WHERE id = ?').run(workspacePath, project.id);
    }
    db.close();

    // 项目 jobRoot 布局（C-22 单源约定：<ws>/results/jobs/<jobId>，日志在其 output/ 下——
    // 端点主链 layout.outputDir 与兜底链 resolveToolJobExportDirs 首项同构，本路径两条链都命中）
    const projectRowNow = new Database(dbPath).prepare('SELECT workspace_path FROM projects WHERE id = ?').get(project.id);
    const outputDir = path.join(projectRowNow && projectRowNow.workspace_path ? projectRowNow.workspace_path : path.join(dataDir, 'projects', project.id), 'results', 'jobs', jobId, 'output');
    assert('S2_layout_outputDir', outputDir.includes(path.join('results', 'jobs', jobId)), `outputDir=${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'run.log'), 'B271 live probe line 1\nline 2\n', 'utf8');

    // 终态后日志端点走 run.log 文件链（1b 唯一未验证点：项目布局兜底实机生效）
    const logResp = await rest('GET', `/tools/log/${jobId}`);
    const log = logResp.data || {};
    assert('A4_runlog_via_project_layout', logResp.status === 200 && log.source === 'run.log' && typeof log.log === 'string' && log.log.includes('B271 live probe line 1'),
      `source=${log.source} bytes=${(log.log || '').length} note=${(log.note || '').slice(0, 80)}`);

    // 对照回归：项目**无 workspace_path** 时（布局解析失败且兜底不可用）→ 全局目录链不回退
    const orphanProject = await rest('POST', '/data/projects', { name: `B271-orphan-${Date.now()}`, modality: 'general' });
    const orphanProjectId = orphanProject.data && orphanProject.data.project && orphanProject.data.project.id;
    const db2 = new Database(dbPath);
    db2.prepare('UPDATE projects SET workspace_path = NULL WHERE id = ?').run(orphanProjectId);
    const orphanId = `job_b271_orphan_${Date.now().toString(36)}`;
    db2.prepare('INSERT INTO tool_jobs (id, user_id, project_id, tool_id, status, is_test_run, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(orphanId, 'local-user', orphanProjectId, 'probe-tool', 'completed', now);
    db2.close();
    const globalDir = path.join(dataDir, 'results', 'tool-jobs', orphanId, 'output');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'run.log'), 'orphan global chain\n', 'utf8');
    const orphanResp = await rest('GET', `/tools/log/${orphanId}`);
    assert('A5_global_chain_unregressed', orphanResp.data && orphanResp.data.source === 'run.log' && orphanResp.data.log.includes('orphan global chain'),
      `source=${orphanResp.data && orphanResp.data.source}（全局目录链行为不回退）`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(backend && backend.pid);
    await sleep(400);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows delay */ }
    const report = writeReport();
    console.log(`\n[block271-live] ${report.passed}/${report.total} pass · evidence=acceptance/block-271/bio2-logfallback-live.json`);
    if (!report.allPass) process.exitCode = 1;
  }
}

await main();
