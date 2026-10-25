#!/usr/bin/env node
/**
 * BLOCK-256 — Q7 实机腿：自动化看板 + goal 状态/预算 + 立即运行 + 提醒 + `/schedule`。
 *
 * 隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏 + 临时数据根），
 * seed：项目 + goal（820/1000 tokens）+ schedule（关联 goal）+ completed run + 未确认提醒。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 用法：
 *   node scripts/block256-q7-automation-live.mjs                 # 亮色轮
 *   PETRI_B256_DARK=1 node scripts/block256-q7-automation-live.mjs  # 暗色轮
 * 证据：acceptance/block-256/q7-live{,-dark}.json
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
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'q7-automation-live.cjs');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-256');
const DARK = process.env.PETRI_B256_DARK === '1';
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
    if (await portOpen(port)) {
      throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
    }
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const jsonName = DARK ? 'q7-live-dark.json' : 'q7-live.json';

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b256-live-'));
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
  let projectName = null;
  let goalId = 'goal_bf256_live';
  let scheduleId = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    try { writeReport(); } catch { /* 证据写入失败不阻断断言 */ }
  };

  function writeReport() {
    const report = {
      name: 'q7-automation-live',
      block: 'BLOCK-256',
      darkMode: DARK,
      mode: DARK ? '--force-dark-mode' : 'system-default',
      migrationsApplied: applied.length,
      screenshots: 'unavailable',
      seeded: {
        projectId,
        projectName,
        goalId,
        scheduleId,
        goalUsageTokens: 820,
        goalBudgetTokens: 1000,
        scheduleLinkedToGoal: true,
        completedRun: true,
        unacknowledgedReminder: '记得看质控',
      },
      startedAt,
      finishedAt: new Date().toISOString(),
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
    backend.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
    });
    await waitHttp(`${API}/health`, 30_000, 'backend health');
    console.log('[block256-live] backend ready');

    const created = await rest('POST', '/data/projects', { name: `BLOCK256-验收-${Date.now()}`, modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    projectName = created.data && created.data.project && created.data.project.name;
    if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 300)}`);

    // seed goal + conversation usage + schedule + run + reminder（真实表，直接落库）
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const now = new Date();
    const iso = (deltaMs = 0) => new Date(now.getTime() + deltaMs).toISOString();
    db.prepare(`INSERT INTO agent_goals
      (id,user_id,project_id,conversation_id,title,description,status,budget_tokens,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`)
      .run(goalId, 'local-user', projectId, 'conv_bf256_goal', 'Q7 稳定交付', '实机 seed 目标', 'active', 1000, iso(-3_600_000), iso());
    db.prepare(`INSERT INTO copilot_conversations
      (id,user_id,title,status,last_page,project_id,message_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('conv_bf256_goal', 'local-user', 'Q7 goal conversation', 'active', null, projectId, 0, iso(-3_600_000), iso());
    try { db.prepare('UPDATE copilot_conversations SET goal_id=? WHERE id=?').run(goalId, 'conv_bf256_goal'); } catch { /* column exists */ }
    db.prepare('INSERT INTO ai_usage (conversation_id,prompt_tokens,completion_tokens,ts,kind) VALUES (?,?,?,?,?)')
      .run('conv_bf256_goal', 500, 320, iso(-60_000), 'chat');
    db.close();

    const schedule = await rest('POST', '/schedules', {
      projectId,
      goalId,
      title: 'BLOCK256 实机计划',
      prompt: '汇总今天的质控结果并给出结论',
      kind: 'task',
      intervalMinutes: 60,
    });
    scheduleId = schedule.data && schedule.data.schedule && schedule.data.schedule.id;
    if (!scheduleId) throw new Error(`schedule create failed: ${JSON.stringify(schedule).slice(0, 300)}`);

    const db2 = new Database(dbPath);
    db2.pragma('busy_timeout = 5000');
    db2.prepare(`INSERT INTO agent_schedule_runs
      (id,schedule_id,task_id,conversation_id,status,error,started_at,finished_at)
      VALUES (?,?,?,?,?,NULL,?,?)`)
      .run('run_bf256_live', scheduleId, 'task_bf256_seed', 'conv_bf256_goal', 'completed', iso(-120_000), iso(-60_000));
    db2.prepare(`INSERT INTO agent_schedule_reminders
      (id,schedule_id,project_id,message,due_at,acknowledged_at)
      VALUES (?,?,?,?,?,NULL)`)
      .run('rem_bf256_live', scheduleId, projectId, '记得看质控', iso(-30_000));
    db2.close();
    console.log('[block256-live] seeded goal/schedule/run/reminder');

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');
    console.log('[block256-live] vite ready');

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
    electron = spawn(process.execPath, electronArgs, {
      cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets)
        ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1'))
        : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    console.log('[block256-live] electron test target ready; running flow');
    assert('E3_isolated_stack', true,
      `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot} / dark=${DARK}`);

    const flow = require(FLOW_PATH);
    await flow.run({ assert, projectId, goalId, scheduleId });
    const early = writeReport();
    console.log(`\n[block256-live] early ${early.passed}/${early.total} pass · dark=${DARK}`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }

    const report = writeReport();
    console.log(`\n[block256-live] ${report.passed}/${report.total} pass · dark=${DARK} · evidence=acceptance/block-256/${jsonName}`);
    if (!report.allPass) process.exitCode = 1;
  }
}

await main();
