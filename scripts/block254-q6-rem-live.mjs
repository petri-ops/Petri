#!/usr/bin/env node
/**
 * BLOCK-254 — Q6-REM 实机腿：马赛克遮蔽边界 / 撤销 / 文本面批注条 / 速记图片批注 / docx 段落批注。
 *
 * 隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏 + 临时数据根），
 * 全部迁移按序应用到临时库（含 018 anchor_json / 019 entry_id）。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 用法：
 *   node scripts/block254-q6-rem-live.mjs                 # 亮色轮
 *   PETRI_B254_DARK=1 node scripts/block254-q6-rem-live.mjs  # 暗色轮（--force-dark-mode）
 * 证据：acceptance/block-254/q6rem-live{,-dark}.json
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
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'q6rem-annotations-live.cjs');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-254');
const DARK = process.env.PETRI_B254_DARK === '1';
/**
 * 分轮执行（实机抓真 2026-10-24）：一旦本轮保存过批注，再切换文件预览会让离屏窗口的
 * CDP 会话失活（后续 eval 连续超时）。因此按「每轮只保存一次、保存后不再切文件」拆三轮：
 *   image — 图像面：批注条 + 马赛克声明 + 保存 + 撤销
 *   text  — 文本面批注条 + 速记图片大图 + 速记批注保存
 *   office— docx 段落批注按钮 + 段落批注保存（unit=paragraph）
 */
const PHASE = process.env.PETRI_B254_PHASE || 'image';

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

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) {
      throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
    }
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const jsonName = DARK ? `q6rem-${PHASE}-dark.json` : `q6rem-${PHASE}.json`;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b254-live-'));
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
  const columns = bootDb.prepare('PRAGMA table_info(result_annotations)').all().map((row) => row.name);
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  let client = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
    // 断一条落一条：实机在「保存过批注后再切文件」处会卡住收尾，积攒到 finally 才写会丢证据。
    try { writeReport(); } catch { /* 证据写入失败不阻断断言 */ }
  };

  /**
   * 报告落盘（幂等覆盖）。flow 跑完**立刻**写一次，finally 再写一次：
   * 收尾阶段（关 Electron / 删临时根）在 Windows 上偶发挂住，不能让已取得的
   * 断言证据跟着丢——先落盘再清理是这里唯一正确的顺序。
   */
  function writeReport() {
    const report = {
      name: 'q6rem-annotations-live',
      block: 'BLOCK-254',
      phase: PHASE,
      darkMode: DARK,
      mode: DARK ? '--force-dark-mode' : 'system-default',
      migrationsApplied: applied.length,
      resultAnnotationColumns: columns,
      screenshots: 'unavailable',
      synthetic: {
        note: '临时项目 + 合成 SVG/文本/最小 docx；速记图片为 data URL 自造',
        paragraphAnchor: 'docx split into 2 paragraphs; annotation anchors unit=paragraph startLine=2',
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
    console.log('[block254-live] backend ready');

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');
    console.log('[block254-live] vite ready');

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
    console.log('[block254-live] electron test target ready; running flow');
    assert('E3_isolated_stack', true,
      `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot} / dark=${DARK}`);

    const flow = require(FLOW_PATH);
    await flow.run({ assert });
    // 先落盘：后面的清理即便挂住，证据已在。
    const early = writeReport();
    console.log(`\n[block254-live] early ${early.passed}/${early.total} pass · dark=${DARK}`);
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(client && client.pid);
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }

    const report = writeReport();
    console.log(`\n[block254-live] ${report.passed}/${report.total} pass · dark=${DARK} · evidence=acceptance/block-254/${jsonName}`);
    if (!report.allPass) process.exitCode = 1;
  }
}

await main();
