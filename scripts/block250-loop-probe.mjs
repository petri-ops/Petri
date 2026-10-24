#!/usr/bin/env node
/**
 * BLOCK-250（UI-FIX）— ProjectWorkspace 重渲染环定位探针。
 *
 * 做法：隔离栈（后端 :3001 + Vite :3000 + Electron 9223，**离屏**）→ 在页面里包装
 * console.error，捕获「Maximum update depth exceeded」发生时的 **JS 调用栈**（Vite dev
 * 保留源码行）→ 导航到 /project/:id → 读回栈并打印。诊断用，不改产品代码。
 *
 * 前置：端口 3000/3001/9223 空闲。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;

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
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

async function main() {
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用（本探针不杀未知进程）`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b250-probe-'));
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

  const collected = [];
  const beaconServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/loop') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 200_000) req.destroy(); });
      req.on('end', () => { try { collected.push(JSON.parse(body)); } catch { collected.push({ raw: body.slice(0, 500) }); } res.writeHead(204).end(); });
      return;
    }
    res.writeHead(204).end();
  });
  await new Promise((resolve) => beaconServer.listen(39058, '127.0.0.1', resolve));

  let backend = null;
  let vite = null;
  let electron = null;
  let client = null;
  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok ? true : null;
    }, { timeoutMs: 30_000, label: 'backend' });
    const rest = async (method, endpoint, body) => {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${endpoint}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const project = await rest('POST', '/data/projects', { name: 'B250 环探针项目' });
    const projectId = project.data?.project?.id;
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    const workspace = detail.data?.project?.workspace_path;
    if (workspace) {
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, 'README.md'), '# probe\n', 'utf8');
    }
    // 会话（工作区挂载后会自动选中最近会话）
    const conv = await rest('POST', '/ai/conversations', { title: 'B250 环探针会话', projectId });
    const conversationId = conv.data?.conversation?.id || null;
    // 合成 done job（让结果面有数据）
    if (workspace) {
      const db = new Database(dbPath);
      try {
        db.prepare('INSERT OR REPLACE INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, completed_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run('tj_b250', 'local', 'scanpy_recipe', '{}', 'done', Date.now(), 'B250 合成结果', Date.now(), projectId);
      } catch { /* 表形状差异不阻塞 */ }
      db.close();
    }

    vite = spawn(process.execPath, [path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(VITE_PORT), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${VITE_PORT}/`, { signal: AbortSignal.timeout(2000) });
      return res.ok ? true : null;
    }, { timeoutMs: 60_000, label: 'vite' });

    const electronEnv = {
      ...process.env, PETRI_TEST_INSTANCE: '1', PETRI_ELECTRON_USER_DATA_DIR: userDataDir,
      PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electron = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), '.', '--dev', `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    client = await lib.connectTestTarget({ timeoutMs: 90_000 });
    console.log('cdp connected');
    // 包装 console.error，记录 loop 警告的 JS 栈；用 addScriptToEvaluateOnNewDocument
    // 保证整页导航（location.href 会重建 JS 上下文）后探针仍在。
    const probeSource = `(function(){
      window.__loopProbe = [];
      var orig = console.error;
      console.error = function(){
        try {
          var first = arguments && arguments[0] ? String(arguments[0]) : '';
          if (first.indexOf('Maximum update depth') >= 0) {
            var item = { at: Date.now(), stack: (new Error()).stack };
            window.__loopProbe.push(item);
            if (window.__loopProbe.length <= 8 && navigator.sendBeacon) {
              try { navigator.sendBeacon('http://127.0.0.1:39058/loop', JSON.stringify(item)); } catch (e) {}
            }
          }
        } catch (e) {}
        return orig.apply(console, arguments);
      };
    })();`;
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource }).catch(() => null);
    await client.send('Page.enable').catch(() => null);
    console.log('probe injected for next documents');
    await lib.evalJs(client, `location.href = ${JSON.stringify(`http://localhost:${VITE_PORT}/project/${projectId}`)}; 'ok'`, 20_000).catch(() => null);
    console.log('navigated');
    await sleep(12_000);
    console.log('beacon collected:', collected.length);
    for (const item of collected.slice(0, 3)) console.log('--- STACK ---\n' + String(item.stack || JSON.stringify(item)));
    const probe = await lib.evalJs(client, `JSON.stringify({ count: (window.__loopProbe||[]).length, samples: (window.__loopProbe||[]).slice(0,3) })`, 30_000).catch((e) => `probe_error:${e.message}`);
    console.log(`projectId=${projectId} conversationId=${conversationId}`);
    console.log(String(probe).slice(0, 8000));
    // 响应性判据：同一渲染器连续 3 次 CDP 求值 <1s（修复前每次都撞 30s 超时）。
    const evals = [];
    for (let i = 0; i < 3; i += 1) {
      const started = Date.now();
      const value = await lib.evalJs(client, `JSON.stringify({ ready: document.readyState, at: Date.now() })`, 10_000)
        .catch((e) => `eval_error:${e.message}`);
      evals.push({ ms: Date.now() - started, value: String(value).slice(0, 120) });
    }
    console.log('probe evals:', JSON.stringify(evals));
  } finally {
    try { client && client.close(); } catch {}
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { beaconServer.close(); } catch {}
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
