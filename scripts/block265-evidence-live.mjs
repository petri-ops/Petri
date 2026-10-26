#!/usr/bin/env node
/**
 * BLOCK-265 — 实机验证补腿批：UI-578~582 五条 + PiP 真窗口 + transport 首片登记。
 *
 * 隔离栈（:3001/:3000/:9223 + 临时数据根）；seed 项目+会话。
 *
 * 用法：node scripts/block265-evidence-live.mjs
 *       PETRI_B265_DARK=1 node scripts/block265-evidence-live.mjs
 * 证据：acceptance/block-265/b265-live{,-dark}.json
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
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const CONV_ID = 'conv_b265_live';
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'b264-evidence-live.cjs');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-265');
const DARK = process.env.PETRI_B265_DARK === '1';
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const AUTH = { Authorization: 'Bearer desktop-local' };
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
async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
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

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例`);
  }
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const jsonName = DARK ? 'b265-live-dark.json' : 'b265-live.json';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b265-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  const applied = [];
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    applied.push(file);
  }
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  let projectId = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    try { writeReport(); } catch { /* ignore */ }
  };
  function writeReport() {
    const report = {
      name: 'b265-evidence-live', block: 'BLOCK-265',
      darkMode: DARK,
      migrationsApplied: applied.length,
      screenshots: 'unavailable（离屏测试实例纪律）',
      synthetic: { conversationId: CONV_ID, note: 'seed 项目+会话；只验 UI 动作与链路' },
      startedAt, finishedAt: new Date().toISOString(),
      assertions,
      allPass: assertions.every((item) => item.pass),
      passed: assertions.filter((item) => item.pass).length,
      total: assertions.length,
    };
    fs.writeFileSync(path.join(EVIDENCE, jsonName), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200)); });
    await waitHttp(`${API}/health`, 30_000, 'backend health');

    const created = await rest('POST', '/data/projects', { name: `B265-验收-${Date.now()}`, modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 300)}`);

    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const now = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO copilot_conversations
      (id,user_id,title,status,project_id,message_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(CONV_ID, 'local-user', 'B265 验收会话', 'active', projectId, 2, now, now);
    db.close();
    assert('S1_seeded_project_conversation', true, `project=${projectId} conv=${CONV_ID}`);

    vite = spawn(process.execPath, [path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(VITE_PORT), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200)); });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');

    const electronEnv = {
      ...process.env,
      PETRI_TEST_INSTANCE: '1',
      PETRI_ELECTRON_USER_DATA_DIR: userDataDir,
      PETRI_DB_PATH: dbPath,
      PETRI_LOCAL_DATA_DIR: dataDir,
      R_SERVER_PORT: String(BACKEND_PORT),
      PETRI_ELECTRON_LOG_PATH: path.join(tempRoot, 'electron.log'),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const electronArgs = [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), '.', '--dev', `--remote-debugging-port=${CDP_PORT}`];
    if (DARK) electronArgs.push('--force-dark-mode');
    electron = spawn(process.execPath, electronArgs, { cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    electron.stderr.on('data', (chunk) => { const text = chunk.toString(); if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200)); });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    assert('S2_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / dark=${DARK}`);

    const flow = require(FLOW_PATH);
    await flow.run({ assert, projectId, conversationId: CONV_ID });

    const early = writeReport();
    console.log(`\n[block265-live] early ${early.passed}/${early.total} pass · dark=${DARK}`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows delay */ }
    const report = writeReport();
    console.log(`\n[block265-live] ${report.passed}/${report.total} pass · dark=${DARK} · evidence=acceptance/block-265/${jsonName}`);
    if (!report.allPass) process.exitCode = 1;
  }
}

await main();
