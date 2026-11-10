#!/usr/bin/env node
/**
 * scripts/block350-perf-collect.mjs — BLOCK-350 性能基线采集器（四场景，headless 本机 dev 口径）。
 *
 * 场景（L0-2 判据重立，蓝图 L-27/L-30）：
 *   warm_backend_spawn 同机连跑的隔离后端 spawn → /api/health 200（含 migrations 自举）——
 *                     OS 页缓存热的 warm 自举口径，**不冒充冷启动**；真冷启动五段腿
 *                     独立见 coldStartTrueLeg 指针（stageCoverage 口径），采样 5
 *   long_conversation 隔离库直插 1 会话 + 1000 条 copilot_messages（真实 DDL）→
 *                     /messages 首页 + 全量滚动（20 页 × 50），采样 5
 *   big_project_tree  520 文件工作区 → tree(limit=200) 三页读全，采样 5
 *   packaged_start    unsigned mac-arm64 dir 产物启动（ELECTRON_RUN_AS_NODE 后端 health），采样 3
 *
 * 基线绑定（L-30）：host 与 HOT_PATH_FILES 组合 sha **每次采集都重算**；gate 校验，
 * 任一热路径文件/host 变化 → 基线失效须重采。gate 采样 = 3 轮取中位（不再是 min-of-2）。
 *
 * 输出 test/perf-baseline.json：generatedAt / host / coreSha / coldStartTrueLeg / 场景。
 * 用法：node scripts/block350-perf-collect.mjs [--only=warm_backend_spawn,long_conversation,big_project_tree,packaged_start]
 * 打包态场景需先 `npm run build:mac-arm64`（产物 dist/mac-arm64/*.app）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { computeHotPathSha, describeHost } from './lib/block350-hot-paths.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'perf-baseline.json');
const args = process.argv.slice(2);
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;
// --gate：quality:perf 用——输出 {scenarios:{name:{sampleMs}}} 到 --out（不写基线）
const GATE = args.includes('--gate');
const OUT_ARG = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] || '';
// L0-2（L-27）：gate 采样 3 轮取中位（原 min-of-2 会把慢轮藏进较快样本）；
// 非 gate 5 轮（packaged 3）。
const RUNS = GATE ? 3 : null;
const Database = require('better-sqlite3');
const harness = await import('./lib/evals-harness.mjs');

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const existing = (!GATE && fs.existsSync(OUT)) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const baseline = (existing && existing.scenarios) ? existing : {
  generatedAt: new Date().toISOString(),
  host: describeHost(),
  coreSha: computeHotPathSha(ROOT),
  scenarios: {},
};
// L-30：host 与热路径 sha 每次采集都刷新（gate 端校验漂移即要求重采，见 block350-hot-paths.mjs）
baseline.host = describeHost();
baseline.coreSha = computeHotPathSha(ROOT);
// L-27 冷热分离：本门四场景均为 warm 自举口径；真冷启动五段腿单列（指针 + 存在性由 gate 校验）
baseline.coldStartTrueLeg = {
  script: 'scripts/post-s7-cold-start-x5.cjs',
  stages: ['require', 'migrations', 'backendHealth', 'spa200', 'cdpPageReady'],
  evidence: 'acceptance/post-s7-2026-11-10/h10/cold-start-x5.json',
  note: '真冷启动五段腿（stageCoverage 口径）独立于本门四场景；本门不冒充冷启动读数',
};

async function timed(fn) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

// ---------- ① warm 后端自举（原 cold_start——L-27 冷热分离改名，不冒充冷启动） ----------
async function scenarioWarmBackendSpawn() {
  const samples = [];
  for (let i = 0; i < (RUNS || 5); i += 1) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block350-warm-'));
    const t0 = performance.now();
    const backend = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir: tmp, mode: 'mock' });
    const readyMs = Math.round(performance.now() - t0);
    samples.push(readyMs);
    await backend.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    await sleep(800);
  }
  baseline.scenarios.warm_backend_spawn = {
    metric: 'isolated backend spawn→health 200（含 migrations 自举；同机连跑=OS 页缓存热的 warm 口径，非整 Electron 冷启动）',
    unit: 'ms', samples, medianMs: median(samples), tolerancePct: 25,
    runs: RUNS || 5,
    noiseSources: 'SQLite WAL 首建 / migrations 全量执行 / 同机负载抖动；3-5 次采样取中位；真冷启动归 coldStartTrueLeg 腿',
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
    runs: RUNS || 5,
    noiseSources: 'SQLite 页缓存冷热 / better-sqlite3 async 桥；种子=真实 DDL 直插（每条 ~240 字内容负载）；低中位场景由 absoluteSlackMs 地板主导',
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
    runs: RUNS || 5,
    noiseSources: '目录 FS 缓存冷热 / 分页重复扫描前缀；夹具内容均匀（真实用户分布差异记入容差余量）；低中位场景由 absoluteSlackMs 地板主导',
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
  const resDir = path.join(appPath, 'Contents', 'Resources');
  const bin = path.join(appPath, 'Contents', 'MacOS', apps[0].replace(/\.app$/, ''));
  const samples = [];
  // BLOCK-353 打通后的 headless 口径：打包二进制 ELECTRON_RUN_AS_NODE 跑 Resources/core/petri-server
  //（GUI app 直启在 headless 受 TCC/Gatekeeper 限——350 旧配方结论，GUI 会话归用户实机）。
  // 指标=空数据目录 + 打包迁移（21 SQL）→ 后端 health 就绪总时长。
  const { execFileSync } = await import('node:child_process');
  for (let i = 0; i < (RUNS || 3); i += 1) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `block350-pkg-${i}-`));
    const t0 = Date.now();
    try {
      const serverJs = path.join(resDir, 'core', 'petri-server', 'server.js');
      // 迁移（打包 Resources/src/migrations 全量 SQL，经打包 electron 运行时 + 打包 better-sqlite3）
      const migScriptPath = path.join(resDir, 'core', 'petri-server', 'block350-migrate.cjs');
      fs.writeFileSync(migScriptPath, `
        const Database = require('better-sqlite3');
        const fs = require('fs');
        const path = require('path');
        const db = new Database(${JSON.stringify(path.join(dataDir, 'petri.db'))});
        db.pragma('journal_mode = WAL');
        const dir = ${JSON.stringify(path.join(resDir, 'src', 'migrations'))};
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
        for (const f of files) { db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); }
        console.log('MIGRATED ' + files.length);
        db.close();
      `);
      execFileSync(bin, [migScriptPath], {
        cwd: path.join(resDir, 'core', 'petri-server'),
        env: {
          HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_PATH: [path.join(resDir, 'core', 'petri-server', 'node_modules'), path.join(resDir, 'node_modules')].join(':'),
        },
        encoding: 'utf8', timeout: 120000,
      });
      fs.unlinkSync(migScriptPath);
      const child = spawn(bin, [serverJs], {
        // whitelist env（BLOCK-353 同款）：node 父进程全量继承会让打包 Electron 静默挂
        //（毒性变量二分未锁定，白名单实测通——353 检查脚本同款）
        env: {
          HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
          ELECTRON_RUN_AS_NODE: '1',
          R_SERVER_PORT: '3106',
          PETRI_LOCAL_DATA_DIR: dataDir,
          PETRI_DB_PATH: path.join(dataDir, 'petri.db'),
          NODE_PATH: [path.join(resDir, 'core', 'petri-server', 'node_modules'), path.join(resDir, 'node_modules')].join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let ok = false;
      while (Date.now() - t0 < 120000 && !ok) {
        await sleep(300);
        try {
          const r = await fetch('http://127.0.0.1:3106/api/health', { signal: AbortSignal.timeout(800) });
          if (r.ok) { ok = true; }
        } catch { /* poll */ }
      }
      if (ok) samples.push(Math.round(Date.now() - t0));
    else console.log(`[block350] pkg run ${i}: health 未就绪（${Math.round((Date.now() - t0)/1000)}s）`);
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    } catch (e) {
      console.log(`[block350] packaged run ${i} 失败：${String(e && e.message).slice(0, 120)}`);
    }
    await sleep(1500);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (!samples.length) {
    baseline.scenarios.packaged_start = {
      skipped: true,
      reason: '打包后端 headless 口径采样失败（GUI app 直启受 TCC/Gatekeeper 限；ELECTRON_RUN_AS_NODE 链见 BLOCK-353 报告 §2 修复记录）。',
    };
    return;
  }
  baseline.scenarios.packaged_start = {
    metric: '打包后端启动（ELECTRON_RUN_AS_NODE 跑 Resources/core，空数据目录+打包迁移 21 SQL）→ health 就绪',
    unit: 'ms', samples, medianMs: samples.length ? median(samples) : null, tolerancePct: 30,
    runs: RUNS || 3,
    noiseSources: '打包迁移 21 SQL 全量执行 / SQLite WAL 首建 / Electron 运行时冷启动 / 轮询粒度 300ms',
    env: `unsigned local mount：${apps[0]}（ELECTRON_RUN_AS_NODE 后端口径；数据面=临时空目录；BLOCK-353 修复链）`,
  };
}

const ALL = ['warm_backend_spawn', 'long_conversation', 'big_project_tree', 'packaged_start'];
for (const name of ALL) {
  if (ONLY && !ONLY.has(name)) continue;
  console.log(`[block350] 采集 ${name} …`);
  if (name === 'warm_backend_spawn') await scenarioWarmBackendSpawn();
  if (name === 'long_conversation') await scenarioLongConversation();
  if (name === 'big_project_tree') await scenarioBigProjectTree();
  if (name === 'packaged_start') await scenarioPackagedStart();
  console.log(`  → ${JSON.stringify(baseline.scenarios[name]).slice(0, 150)}`);
}
if (GATE) {
  const gateOut = { at: new Date().toISOString(), scenarios: {} };
  for (const [name, s] of Object.entries(baseline.scenarios)) {
    // L0-2（L-27）：gate 每场景 3 轮取中位（原 min-of-2 会把慢轮藏进较快样本）；
    // skipped 场景透传（是否判红由 gate 依 PETRI_ALLOW_SKIP 裁决——L-28 skipped 默认判红）。
    gateOut.scenarios[name] = s.skipped ? { skipped: true, reason: s.reason } : { sampleMs: median(s.samples) };
  }
  const outPath = OUT_ARG || OUT;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(gateOut, null, 2) + '\n');
  console.log(`[block350] gate 样本落盘 ${outPath}`);
} else {
  // L0-2：清除不在当前场景集（ALL）内的陈旧键（如已改名的 cold_start——残键会让
  // gate 遍历到旧口径读数）；--only 只影响本轮采集，ALL 内未采场景保留既有读数。
  for (const key of Object.keys(baseline.scenarios)) {
    if (!ALL.includes(key)) { delete baseline.scenarios[key]; console.log(`[block350] 移除陈旧场景键 ${key}（不在当前场景集）`); }
  }
  baseline.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`[block350] 基线落盘 ${path.relative(ROOT, OUT)}`);
}
