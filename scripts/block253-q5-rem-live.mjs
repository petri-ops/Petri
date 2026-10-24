#!/usr/bin/env node
/**
 * BLOCK-253 — Q5-REM 实机腿：计划修订 tabs / 宿主入口菜单 / 文件管理器定位。
 *
 * 隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏 + 临时数据根）。
 * 夹具：合成 active 计划 + 一条 proposed 修订（直接写隔离库，报告标 synthetic）；
 * 工作区 note.txt 供文件树/文件管理器动作。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-544-547-q5rem/ + 同份 acceptance/block-253/。
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
const planLifecycle = require('../core/petri-server/helpers/plan-lifecycle.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'q5rem-plan-tools-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-544-547-q5rem');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-253');
const PLAN_ID = 'plan_q5rem_live';
const PLAN_TITLE = 'Q5-REM 计划修订样本';

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
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
}

function seedWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'note.txt'), 'Q5-REM 文件管理器定位样本\n', 'utf8');
}

/** 合成计划 + 一条 proposed 修订（夹具；报告标 synthetic）。 */
function seedPlan(dbPath, conversationId) {
  const db = new Database(dbPath);
  try {
    planLifecycle.ensurePlanBaseSchema(db);
    planLifecycle.ensureBlock55PlanSchema(db);
    try { db.exec('ALTER TABLE copilot_plans ADD COLUMN conversation_id TEXT'); } catch { /* exists */ }
    const now = new Date().toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO copilot_plans(id, user_id, title, goal, status, chat_context_excerpt, spec_md, conversation_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      PLAN_ID, 'local-user', PLAN_TITLE, '验证修订版本 tabs 与批准链', 'active', 'Q5-REM 计划修订夹具',
      '# 目标\n用修订版本补一步质控。', conversationId, now, now,
    );
    db.prepare('DELETE FROM copilot_plan_steps WHERE plan_id=?').run(PLAN_ID);
    const stepInsert = db.prepare(
      'INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, ts) VALUES (?,?,?,?,?,?,?)',
    );
    stepInsert.run(PLAN_ID, 1, '读取数据', null, null, 'done', now);
    stepInsert.run(PLAN_ID, 2, '降维与聚类', null, null, 'pending', now);
    db.prepare('DELETE FROM copilot_plan_revisions WHERE plan_id=?').run(PLAN_ID);
    db.prepare(
      'INSERT INTO copilot_plan_revisions(id, plan_id, rev_no, reason, proposed_json, status, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      'prev_q5rem_1', PLAN_ID, 1, '第二步拆成两步：先质控再降维',
      JSON.stringify([
        { n: 1, title: '读取数据', hint: null, assignee: null, status: 'done', result: null },
        { n: 2, title: '先做质控', hint: '修订新增', assignee: null, status: 'pending', result: null },
        { n: 3, title: '降维与聚类', hint: null, assignee: null, status: 'pending', result: null },
      ]),
      'proposed', now,
    );
  } finally {
    db.close();
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  const roundSuffix = process.env.PETRI_B253_DARK === '1' ? 'dark' : 'light';
  for (const dir of [EVIDENCE_UI, EVIDENCE_BLOCK]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(`-${roundSuffix}.png`) || name === `q5rem-screenshots-${roundSuffix}.json`) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-q5rem-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  let workspace = null;
  let flowResult = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
  };

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 30_000, 'backend health');

    const rest = async (method, endpoint, body) => {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${endpoint}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };

    const project = await rest('POST', '/data/projects', { name: 'Q5-REM 长尾探针项目' });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    seedWorkspace(workspace);
    const conversation = await rest('POST', '/ai/conversations', { title: 'Q5-REM 计划会话', projectId });
    const conversationId = conversation.data?.conversation?.id || null;
    assert('E1c_conversation_created', Boolean(conversationId), `conversationId=${conversationId}`);
    seedPlan(dbPath, conversationId);
    const plans = await rest('GET', `/ai/plans?conversationId=${encodeURIComponent(conversationId)}&status=active`);
    const seeded = (plans.data?.plans || []).find((row) => row.id === PLAN_ID);
    const revisions = await rest('GET', `/ai/plans/${PLAN_ID}/revisions`);
    assert('E2_synthetic_plan_revision', Boolean(seeded && (revisions.data?.revisions || []).length === 1),
      `plan=${seeded?.id} pending=${seeded?.pending_revision_no} revisions=${(revisions.data?.revisions || []).length}`);

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
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
    electron = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'), '.', '--dev', `--remote-debugging-port=${CDP_PORT}`,
    ], { cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    assert('E3_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B253_PROJECT_ID = String(projectId);
    process.env.PETRI_B253_WORKSPACE = workspace;
    process.env.PETRI_B253_CONVERSATION_ID = String(conversationId);
    process.env.PETRI_B253_PLAN_ID = PLAN_ID;
    process.env.PETRI_B253_PLAN_TITLE = PLAN_TITLE;
    await flow.run({ assert });
    flowResult = { assertions, allPass: assertions.every((item) => item.pass) };
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    flowResult = { assertions, allPass: false };
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'q5rem-plan-tools-live',
      darkMode: process.env.PETRI_B253_DARK === '1',
      synthetic: { planId: PLAN_ID, revisionNo: 1 },
      startedAt,
      finishedAt: new Date().toISOString(),
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'q5rem-live-dark.json' : 'q5rem-live.json';
    for (const dir of [EVIDENCE_UI, EVIDENCE_BLOCK]) {
      fs.writeFileSync(path.join(dir, jsonName), JSON.stringify(report, null, 2));
    }
    for (const name of fs.readdirSync(EVIDENCE_UI)) {
      if (!name.endsWith('.png')) continue;
      fs.copyFileSync(path.join(EVIDENCE_UI, name), path.join(EVIDENCE_BLOCK, name));
    }
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
