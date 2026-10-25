#!/usr/bin/env node
/**
 * BLOCK-255 — Q2-REM 实机腿：逐消息统计面板 + 会话拖入 composer。
 *
 * 隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏 + 临时数据根），
 * 种子两条会话：当前会话含「带 usage / 无 usage」两条助手消息，目标会话用于拖入。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 用法：
 *   node scripts/block255-q2-rem-live.mjs                 # 亮色轮
 *   PETRI_B255_DARK=1 node scripts/block255-q2-rem-live.mjs  # 暗色轮
 * 证据：acceptance/block-255/q2rem-live{,-dark}.json
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
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'q2rem-stats-drag-live.cjs');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-255');
const DARK = process.env.PETRI_B255_DARK === '1';
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
    signal: AbortSignal.timeout(8000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  return { ok: response.ok, status: response.status, data };
}

function seedMessages(dbPath, currentConversationId, targetConversationId) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const now = Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
  const insert = db.prepare(
    'INSERT INTO copilot_messages (id, conversation_id, role, content, meta_json, task_id, ts) VALUES (?,?,?,?,?,?,?)',
  );
  const usageMeta = {
    processingDurationMs: 2450,
    progressUpdates: [
      { iteration: 1, content: '先读取工作区文件' },
      { iteration: 2, content: '再核对结果' },
    ],
    toolActivities: [
      { key: 'b255-t1', name: 'workspace_read', status: 'success', actionLabel: '读取', iteration: 1 },
      { key: 'b255-t2', name: 'workspace_write', status: 'success', actionLabel: '写入', iteration: 2 },
    ],
    usage: {
      calls: 2,
      unmeasuredCalls: 1,
      promptTokens: 1200,
      completionTokens: 80,
      cacheReadTokens: 600,
      cacheCreationTokens: 0,
      durationMs: 1800,
      models: ['deepseek-chat'],
    },
  };
  const noUsageMeta = {
    processingDurationMs: 900,
    progressUpdates: [{ iteration: 1, content: '查询历史' }],
    toolActivities: [
      { key: 'b255-t3', name: 'workspace_read', status: 'success', actionLabel: '读取', iteration: 1 },
    ],
  };
  const tx = db.transaction(() => {
    insert.run('msg_b255_cur_1', currentConversationId, 'user', '请解释这轮分析的结论', '{}', null, iso(5000));
    insert.run('msg_b255_cur_2', currentConversationId, 'assistant', '这是带 usage 的回复统计样例。', JSON.stringify(usageMeta), null, iso(4000));
    insert.run('msg_b255_cur_3', currentConversationId, 'user', '再补充一句', '{}', null, iso(3000));
    insert.run('msg_b255_cur_4', currentConversationId, 'assistant', '这是没有 usage 的历史回复。', JSON.stringify(noUsageMeta), null, iso(2000));
    insert.run('msg_b255_tgt_1', targetConversationId, 'user', '上一个会话的问题', '{}', null, iso(15000));
    insert.run('msg_b255_tgt_2', targetConversationId, 'assistant', '上一个会话的结论', '{}', null, iso(14000));
    insert.run('msg_b255_tgt_3', targetConversationId, 'user', '继续追问', '{}', null, iso(13000));
    db.prepare('UPDATE copilot_conversations SET message_count=?, updated_at=? WHERE id=?')
      .run(4, iso(2000), currentConversationId);
    db.prepare('UPDATE copilot_conversations SET message_count=?, updated_at=? WHERE id=?')
      .run(3, iso(13000), targetConversationId);
  });
  tx();
  db.close();
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) {
      throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
    }
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const jsonName = DARK ? 'q2rem-live-dark.json' : 'q2rem-live.json';

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b255-live-'));
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
  let currentConversationId = null;
  let targetConversationId = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    try { writeReport(); } catch { /* 证据写入失败不阻断断言 */ }
  };

  function writeReport() {
    const report = {
      name: 'q2rem-stats-drag-live',
      block: 'BLOCK-255',
      darkMode: DARK,
      mode: DARK ? '--force-dark-mode' : 'system-default',
      migrationsApplied: applied.length,
      screenshots: 'unavailable',
      seeded: {
        projectId,
        projectName,
        currentConversationId,
        targetConversationId,
        currentMessages: 4,
        targetMessages: 3,
        usageSource: 'persisted copilot_messages.meta_json.usage（BLOCK-255 C4 落库形状）',
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
    console.log('[block255-live] backend ready');

    const created = await rest('POST', '/data/projects', {
      name: `BLOCK255-验收-${Date.now()}`,
      modality: 'general',
    });
    projectId = created.data && created.data.project && created.data.project.id;
    projectName = created.data && created.data.project && created.data.project.name;
    if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 300)}`);

    const currentConv = await rest('POST', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`, {
      title: '当前会话（统计）',
      project_id: projectId,
    });
    const targetConv = await rest('POST', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`, {
      title: '待拖入会话',
      project_id: projectId,
    });
    currentConversationId = currentConv.data && currentConv.data.conversation && currentConv.data.conversation.id;
    targetConversationId = targetConv.data && targetConv.data.conversation && targetConv.data.conversation.id;
    if (!currentConversationId || !targetConversationId) {
      throw new Error(`conversation create failed: ${JSON.stringify({ currentConv, targetConv }).slice(0, 400)}`);
    }
    seedMessages(dbPath, currentConversationId, targetConversationId);
    console.log('[block255-live] seeded project/conversations/messages');

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');
    console.log('[block255-live] vite ready');

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
    console.log('[block255-live] electron test target ready; running flow');
    assert('E3_isolated_stack', true,
      `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot} / dark=${DARK}`);

    const flow = require(FLOW_PATH);
    await flow.run({
      assert,
      projectId,
      projectName,
      currentConversationId,
      targetConversationId,
    });
    const early = writeReport();
    console.log(`\n[block255-live] early ${early.passed}/${early.total} pass · dark=${DARK}`);
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
    console.log(`\n[block255-live] ${report.passed}/${report.total} pass · dark=${DARK} · evidence=acceptance/block-255/${jsonName}`);
    if (!report.allPass) process.exitCode = 1;
  }
}

await main();
