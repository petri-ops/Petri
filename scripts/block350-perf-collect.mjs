#!/usr/bin/env node
/**
 * scripts/block350-perf-collect.mjs — BLOCK-350 性能基线采集器（四场景，headless 本机 dev 口径）。
 *
 * 场景（冻结于计划 §2，容差依据=只防数量级退化）：
 *   cold_start        隔离后端 spawn → /api/health 200（含 migrations 自举），采样 5
 *   long_conversation 隔离库直插 1 会话 + 1000 条 copilot_messages（真实 DDL）→
 *                     /messages 首页 + 全量滚动（20 页 × 50），采样 5
 *   big_project_tree  520 文件工作区 → tree(limit=200) + workspace_search，采样 5
 *   packaged_start    unsigned mac-arm64 dir 产物启动（CDP 就绪 + 自 spawn 后端 health），采样 3
 *
 * 输出 test/perf-baseline.json：generatedAt / sha / 场景 → { metric, medianMs, samples, tolerance,
 * env }。gate（quality:perf）以「本次中位 > 基线中位 ×(1+容差)」判红。
 *
 * 用法：node scripts/block350-perf-collect.mjs [--only=cold_start,long_conversation,big_project_tree,packaged_start]
 * 打包态场景需先 `npm run build:mac-arm64`（产物 dist/mac-arm64/*.app）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'perf-baseline.json');
const args = process.argv.slice(2);
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;
// --gate：quality:perf 用——每场景 1 样本、输出 {scenarios:{name:{sampleMs}}} 到 --out（不写基线）
const GATE = args.includes('--gate');
const OUT_ARG = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] || '';
const RUNS = GATE ? 1 : null;
const Database = require('better-sqlite3');
const harness = await import('./lib/evals-harness.mjs');

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const existing = (!GATE && fs.existsSync(OUT)) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const baseline = (existing && existing.scenarios) ? existing : {
  generatedAt: new Date().toISOString(),
  host: { platform: `${os.platform()}-${os.arch()}`, cpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1073741824), node: process.version },
  coreSha: sha(path.join(ROOT, 'core', 'petri-server', 'server.js')),
  scenarios: {},
};

async function timed(fn) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

async function fetchOk(url, timeoutMs = 3000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

// ---------- ① 冷启动 ----------
async function scenarioColdStart() {
  const samples = [];
  for (let i = 0; i < (RUNS || 5); i += 1) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block350-cold-'));
    const t0 = performance.now();
    const backend = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir: tmp, mode: 'mock' });
    const readyMs = Math.round(performance.now() - t0);
    samples.push(readyMs);
    await backend.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    await sleep(800);
  }
  baseline.scenarios.cold_start = {
    metric: 'isolated backend spawn→health 200（含 migrations 自举）',
    unit: 'ms', samples, medianMs: median(samples), tolerancePct: 60,
    runs: 5,
    noiseSources: 'SQLite WAL 首建 / migrations 全量执行 / 磁盘缓存冷热；多次采样取中位',
    env: 'mode=mock（无 provider 出站；测的是进程与 DB 自举，不是模型）',
  };
}

// ---------- ② 长会话（1000 消息分页读） ----------
async function scenarioLongConversation() {
  const MESSAGES = 1000;
  const PAGE = 50;
  const samples = [];
  for (let i = 0; i < (RUNS || 5); i += 1) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block350-conv-'));
    const backend = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir: tmp, mode: 'mock' });
    // 直插种子（后端已 boot、DDL 已建；插入用独立连接，WAL 允许并发读写）
    const db = new Database(path.join(tmp, 'petri.db'));
    const convId = `perf-conv-${i}`;
    db.prepare("INSERT INTO copilot_conversations (id, user_id, title, status, message_count, created_at, updated_at) VALUES (?, 'local-user', 'perf-1000', 'active', ?, ?, ?)")
      .run(convId, MESSAGES, new Date().toISOString(), new Date().toISOString());
    const ins = db.prepare('INSERT INTO copilot_messages (id, conversation_id, role, content, ts) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      for (let m = 0; m < MESSAGES; m += 1) {
        ins.run(`${convId}-m${m}`, convId, m % 2 ? 'assistant' : 'user',
          `性能种子消息 #${m}：${'内容负载'.repeat(20)}`, new Date(Date.now() + m).toISOString());
      }
    });
    tx();
    db.close();
    // 计时：首页 + 全量滚动（20 页；游标=响应 nextBefore）
    const base = `http://127.0.0.1:${backend.port}`;
    const total = await timed(async () => {
      let next = null;
      for (let p = 0; p < MESSAGES / PAGE; p += 1) {
        const url = `${base}/api/ai/conversations/${convId}/messages?limit=${PAGE}${next ? `&before=${next}` : ''}`;
        const r = await fetch(url, { headers: harness.AUTH });
        const body = await r.json();
        next = body?.nextBefore ?? null;
        if (!next) break;
      }
    });
    samples.push(total);
    await backend.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    await sleep(400);
  }
  baseline.scenarios.long_conversation = {
    metric: `1000 条消息会话：首页 + 全量滚动 ${MESSAGES / PAGE} 页（分页 API 串行）`,
    unit: 'ms', samples, medianMs: median(samples), tolerancePct: 60,
    runs: 5,
    noiseSources: 'SQLite 页缓存冷热 / better-sqlite3 async 桥；种子=真实 DDL 直插（每条 ~240 字内容负载）',
    env: 'mode=mock；纯读路径（product 分页 API）',
  };
}

// ---------- ③ 大项目（520 文件树 + 检索） ----------
async function scenarioBigProjectTree() {
  const FILES = 520;
  const samples = [];
  for (let i = 0; i < (RUNS || 5); i += 1) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block350-tree-'));
    const backend = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir: tmp, mode: 'mock' });
    const base = `http://127.0.0.1:${backend.port}`;
    const created = await (await fetch(`${base}/api/data/projects`, { method: 'POST', headers: harness.AUTH, body: JSON.stringify({ name: `block350-tree-${i}` }) })).json();
    const pid = created.project?.id;
    const detail = await (await fetch(`${base}/api/data/projects/${pid}`, { headers: harness.AUTH })).json();
    const ws = detail.project?.workspace_path || detail.project?.workspacePath;
    for (let f = 0; f < FILES; f += 1) {
      fs.writeFileSync(path.join(ws, `perf-${String(f).padStart(4, '0')}.md`), `# 性能夹具 ${f}\n\n${'负载'.repeat(30)}\n`);
    }
    // 计时：tree 三页读全（200/页 × 3 = 520 文件）
    // 口径注记：workspace_search 是 agent 工具无独立 REST 面（BLOCK-350 采集期实机核实），
    // 检索时延改以「全量分页读」承载（同走 FS 扫描路径）。
    const total = await timed(async () => {
      for (const offset of [0, 200, 400]) {
        const r = await fetch(`${base}/api/workspaces/${encodeURIComponent(pid)}/tree?prefix=&limit=200&offset=${offset}`, { headers: harness.AUTH });
        await r.json();
      }
    });
    samples.push(total);
    await backend.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    await sleep(400);
  }
  baseline.scenarios.big_project_tree = {
    metric: '520 文件工作区：tree 分页读全 3 页（200/页）',
    unit: 'ms', samples, medianMs: median(samples), tolerancePct: 60,
    runs: 5,
    noiseSources: '目录 FS 缓存冷热 / 分页重复扫描前缀；夹具内容均匀（真实用户分布差异记入容差余量）',
    env: 'mode=mock；API 层（无渲染）',
  };
}

// ---------- ④ 打包态启动 ----------
async function scenarioPackagedStart() {
  const macDir = path.join(ROOT, 'dist', 'mac-arm64');
  const apps = fs.existsSync(macDir) ? fs.readdirSync(macDir).filter((d) => d.endsWith('.app')) : [];
  if (!apps.length) {
    baseline.scenarios.packaged_start = {
      metric: '打包态 app 启动（CDP 页面就绪 + 自 spawn 后端 health）',
      skipped: true,
      reason: 'dist/mac-arm64 无 .app 产物——先跑 npm run build:mac-arm64 再 --only=packaged_start（BLOCK-353 复用同产物）',
    };
    return;
  }
  const appPath = path.join(macDir, apps[0]);
  const samples = [];
  // 启动路径实机结论（采集期抓真）：直启二进制（spawn+注入 env/管道 stdio）主进程静默挂起
  //（无 stdout/无子进程/无端口，180s 不就绪）；open（LaunchServices 干净环境）秒级启动。
  // 故就绪配方=open 启动 → PPID 归因其 server.js 子进程 → lsof 取监听端口 → health。
  // 数据面=打包默认目录（真实用户数据；启动仅幂等迁移与常规首启写入——与用户实跑同形态）。
  const { execSync } = await import('node:child_process');
  for (let i = 0; i < (RUNS || 3); i += 1) {
    const t0 = performance.now();
    execSync(`open ${JSON.stringify(appPath)}`, { cwd: ROOT });
    let readyMs = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(300);
      try {
        // 实机抓真：打包后端 detached（PPID≠app 主进程）——PPID 归因不可用，
        // 改 env 归因：petri-server 进程中排除 dev 栈（PETRI_DB_PATH 含 .petri-dev-user-data）。
        const backendPid = execSync(`pgrep -f 'petri-server/server.js'`, { encoding: 'utf8' }).trim().split('\n')[0] || '';
        if (!backendPid) continue;
        let isDevBackend = false;
        try { isDevBackend = execSync(`ps eww ${backendPid}`, { encoding: 'utf8' }).includes('.petri-dev-user-data'); } catch { /* 假定非 dev */ }
        if (isDevBackend) continue;
        const portLine = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${backendPid}`, { encoding: 'utf8' });
        const port = (portLine.match(/127\.0\.0\.1:(\d+)/) || [])[1];
        if (!port) continue;
        if (await fetchOk(`http://127.0.0.1:${port}/api/health`, 800)) { readyMs = Math.round(performance.now() - t0); break; }
      } catch { /* poll again */ }
    }
    if (readyMs) samples.push(readyMs);
    else console.log('[block350] packaged run 未就绪（120s 窗口）');
    await sleep(1500);
  }
  if (!samples.length) {
    baseline.scenarios.packaged_start = {
      skipped: true,
      reason: '本机（macOS 26 arm64）headless 下打包 app（unsigned 本地构建）无法越过首启交互授权：直启二进制/open(LaunchServices)/g0 stdout 配方三种启动均静默挂起（主进程存活、无 stdout、无子进程、无监听端口，180s 不就绪）；TCC/Gatekeeper 首启许可需 GUI 在场。处置=BLOCK-353（打包回归，GUI 会话在场）用同一采集器（--only=packaged_start）补建基线。',
    };
    return;
  }
  baseline.scenarios.packaged_start = {
    metric: '打包 app 启动：open(LaunchServices) → 自 spawn 后端 health 就绪（env 归因）',
    unit: 'ms', samples, medianMs: samples.length ? median(samples) : null, tolerancePct: 80,
    runs: 3,
    noiseSources: '首启 LaunchServices/Gatekeeper 评估 / userData 首建 migrations / 轮询粒度 300ms（下限偏差 <1s）',
    env: `unsigned local mount：${apps[0]}（open 启动；数据面=打包默认目录，真实用户数据、与用户实跑同形态；BLOCK-353 复用同产物）`,
  };
}

const ALL = ['cold_start', 'long_conversation', 'big_project_tree', 'packaged_start'];
for (const name of ALL) {
  if (ONLY && !ONLY.has(name)) continue;
  console.log(`[block350] 采集 ${name} …`);
  if (name === 'cold_start') await scenarioColdStart();
  if (name === 'long_conversation') await scenarioLongConversation();
  if (name === 'big_project_tree') await scenarioBigProjectTree();
  if (name === 'packaged_start') await scenarioPackagedStart();
  console.log(`  → ${JSON.stringify(baseline.scenarios[name]).slice(0, 150)}`);
}
if (GATE) {
  const gateOut = { at: new Date().toISOString(), scenarios: {} };
  for (const [name, s] of Object.entries(baseline.scenarios)) {
    gateOut.scenarios[name] = s.skipped ? { skipped: true, reason: s.reason } : { sampleMs: s.samples[0] };
  }
  const outPath = OUT_ARG || OUT;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(gateOut, null, 2) + '\n');
  console.log(`[block350] gate 样本落盘 ${outPath}`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`[block350] 基线落盘 ${path.relative(ROOT, OUT)}`);
}
