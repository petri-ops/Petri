#!/usr/bin/env node
'use strict';

/**
 * scripts/block353-packaged-check.mjs — BLOCK-353 打包态回归全项检查。
 *
 * ① 结构核对表（必需路径逐项）
 * ② 空数据目录启动四项健康（migration 表数 / SPA / 后端 health / R+Python 探针）——
 *    打包二进制 ELECTRON_RUN_AS_NODE 跑 Resources/core/petri-server/server.js（空临时数据目录）
 * ③ 打包态一次完整任务（T2 数据任务：real provider 真跑 → 产物断言）+ 与 dev 基线对照
 * ④ 差异清单（dev/packaged 同口径对照）
 *
 * 输出 acceptance/block-353/packaged-regression.json。GUI app 直启静默挂起=BLOCK-350 已登记
 * 的 headless 环境限（TCC/Gatekeeper），本检查以「打包后端 + 打包产物」为 headless 可达口径。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'dist', 'mac-arm64', 'Petri.app');
const RES = path.join(APP, 'Contents', 'Resources');
const OUT_DIR = path.join(ROOT, 'acceptance', 'block-353');
const PORT = 3105;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { at: new Date().toISOString(), app: 'dist/mac-arm64/Petri.app', sections: {} };

// ---------- ① 结构核对 ----------
const MUST = [
  'Contents/MacOS/Petri',
  'Contents/Frameworks/Electron Framework.framework',
  'Contents/Resources/app.asar',
  'Contents/Resources/app.asar.unpacked',
  'Contents/Resources/core/petri-server/server.js',
  'Contents/Resources/core/petri-server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'Contents/Resources/core/shared-backend',
  'Contents/Resources/frontend/dist/index.html',
  'Contents/Resources/skills/coding-playbook/skill.json',
  'Contents/Resources/src/main/env-coordinator.js',
  'Contents/Resources/src/main/backend-proc-manager.js',
  'Contents/Resources/node_modules/express/package.json',
  'Contents/Resources/g0-build-subject.json',
];
out.sections.structure = { must: MUST.map((rel) => ({ rel, ok: fs.existsSync(path.join(APP, rel)) })), allOk: MUST.every((rel) => fs.existsSync(path.join(APP, rel))) };

// ---------- ②③④ 空目录启动 + 完整任务 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block353-pkg-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// real provider 种子（凭据经本机凭据库解析，落临时 ai-settings 的 credential_updates 通道——
// 与 evals-harness 同通道；密钥明文不落报告）
let key = '';
try {
  const realDir = path.join(os.homedir(), 'Documents', 'BioF3-Local');
  const { createCredentialStore } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'credential-store.js'));
  key = String(createCredentialStore({ settingsDir: realDir }).get('openai-compatible') || '');
} catch { key = ''; }
fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
  active_chat_model_id: 'block353-pkg',
  chat_model_presets: [{
    id: 'block353-pkg', provider: 'openai-compatible', model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1', contextWindow: 32000,
  }],
  credential_updates: { 'openai-compatible': key || 'missing' },
}, null, 2));

const health = { ok: false };
const bin = path.join(APP, 'Contents', 'MacOS', 'Petri');
const serverJs = path.join(RES, 'core', 'petri-server', 'server.js');
const childEnv = () => ({
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  ELECTRON_RUN_AS_NODE: '1',
  R_SERVER_PORT: String(PORT),
  PETRI_LOCAL_DATA_DIR: dataDir,
  PETRI_DB_PATH: path.join(dataDir, 'petri.db'),
  // ABI 优先级：core 副本（Electron-ABI 权威）先于解出树
  NODE_PATH: [path.join(RES, 'core', 'petri-server', 'node_modules'), path.join(RES, 'node_modules')].join(':'),
});

const child = spawn(bin, [serverJs], {
  env: childEnv(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
child.stdout.on('data', (c) => log.push(String(c)));
child.stderr.on('data', (c) => log.push(String(c)));

const call = (method, p, body) => new Promise((resolve) => {
  const payload = body ? JSON.stringify(body) : null;
  const r = require('node:http').request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (rs) => {
    let b = ''; rs.on('data', (c) => { b += c; }); rs.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b.slice(0, 200) }); } });
  });
  r.on('error', (e) => resolve({ err: e.message }));
  if (payload) r.write(payload);
  r.end();
});

// T2 种子（BLOCK-348 tasks.json 同一脏 CSV）
const tasks = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance', 'block-348', 'tasks.json'), 'utf8'));
const t2 = tasks.tasks.find((t) => t.id === 't2-data-cleaning');

try {
  // ② 前置：打包迁移（产品由主进程先跑 migration-runner 再 spawn 后端；headless 复刻同语义——
  // 打包 Resources/src/migrations/*.sql 按序 exec，用打包二进制 ELECTRON_RUN_AS_NODE + 打包 better-sqlite3 副本）
  const migrationsDir = path.join(RES, 'src', 'migrations');
  const migDb = path.join(dataDir, 'petri.db');
  const migScript = `
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const db = new Database(${JSON.stringify(migDb)});
    db.pragma('journal_mode = WAL');
    const files = fs.readdirSync(${JSON.stringify(migrationsDir)}).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(${JSON.stringify(migrationsDir)}, f), 'utf8');
      db.exec(sql);
    }
    console.log('MIGRATED ' + files.length + ' files, tables=' + db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n);
  `;
  // 写进打包 core 目录（migrate.cjs 的 require 解析起点=此处，命中打包 Core 自带
  // node_modules 的 Electron-ABI better-sqlite3——临时目录会让 require 落到解出树的
  // node-ABI 副本；BLOCK-353 实机五轮试错结论）。
  const migScriptPath = path.join(RES, 'core', 'petri-server', 'block353-migrate.cjs');
  fs.writeFileSync(migScriptPath, migScript);
  let migOut = '';
  try {
    migOut = execFileSync(bin, [migScriptPath], { env: childEnv(), encoding: 'utf8', timeout: 120000 });
  } finally {
    try { fs.unlinkSync(migScriptPath); } catch { /* 清理探针文件 */ }
  }
  const migMatch = migOut.match(/MIGRATED (\d+) files, tables=(\d+)/);
  out.sections.migration = { files: migMatch ? Number(migMatch[1]) : 0, tables: migMatch ? Number(migMatch[2]) : 0 };

  // 等后端 health
  for (let i = 0; i < 45 && !health.ok; i += 1) {
    await sleep(1000);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
      health.ok = r.ok;
      if (r.ok) health.readyMs = Math.round((i + 1) * 1000);
    } catch { /* wait */ }
  }
  if (health.ok) {
    // ② 四项健康
    const migrationDb = require('better-sqlite3')(migDb, { readonly: true });
    const tableCount = migrationDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    migrationDb.close();
    const runtime = await call('GET', '/api/runtime/status');
    const spa = await (async () => { const r = await fetch(`http://127.0.0.1:${PORT}/`); const t = await r.text(); return { status: r.status, isIndex: t.includes('<') && t.length > 200 }; })();
    out.sections.fourHealth = {
      backendHealth: health.ok, backendReadyMs: health.readyMs || null,
      migrationTables: tableCount, migrationHealthy: tableCount >= 20,
      migrationFiles: out.sections.migration.files,
      spa: spa.status === 200 && spa.isIndex,
      // SPA 口径：打包后端不服务前端静态文件（载体=Electron 窗口+frontend/dist，结构核对已含 index.html）；headless 无窗口故本值如实为 false
      runtimeProbes: { r: runtime?.runtime?.r?.installed === true, python: runtime?.runtime?.python?.installed === true },
    };

    // ③ 完整任务（T2 数据任务，real provider 真跑）
    const project = await call('POST', '/api/data/projects', { name: `block353-t2-${Date.now().toString(36)}` });
    const projectId = project.project?.id;
    const detail = await call('GET', `/api/data/projects/${projectId}`);
    const ws = detail.project?.workspace_path || detail.project?.workspacePath;
    for (const seed of t2.seedWorkspace) {
      fs.mkdirSync(path.dirname(path.join(ws, seed.path)), { recursive: true });
      fs.writeFileSync(path.join(ws, seed.path), seed.content);
    }
    const conv = await call('POST', '/api/ai/conversations', { title: 'block353-t2', project_id: projectId });
    const convId = conv.conversation?.id || conv.data?.id;
    const start = await call('POST', '/api/ai/agent', {
      conversationId: convId, modelPresetId: 'block353-pkg',
      messages: [{ role: 'user', content: t2.prompt }],
      context: { accessMode: 'full', projectId },
    });
    const agentTaskId = start.taskId;
    const events = [];
    const t0 = Date.now();
    let done = false;
    // 终态轮询（meta 字段兜底宽匹配；产物判据为权威——事件端点形态差异如实记录）
    while (Date.now() - t0 < 480000 && !done) {
      await sleep(3000);
      try {
        const meta = await call('GET', `/api/ai/agent/task/${encodeURIComponent(agentTaskId)}/meta`);
        const st = meta && (meta.agentStatus || meta.status || meta.taskStatus || meta.state);
        if (st && ['done', 'completed', 'error', 'failed', 'cancelled'].includes(String(st))) {
          done = ['done', 'completed'].includes(String(st));
          events.push({ event: 'terminal', status: String(st), at: new Date().toISOString() });
          break;
        }
      } catch { /* 继续轮询 */ }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'packaged-t2-trace.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const toolCalls = events.filter((e) => e.event === 'tool_call').map((e) => e.name);
    const completed = done;
    // 产物断言（同 block-348 T2 判据）
    const read = (rel) => { const p = findFile(ws, rel); return p ? fs.readFileSync(p, 'utf8') : null; };
    const findFile = (dir, rel) => { const target = rel; const stack = [dir]; while (stack.length) { const d = stack.pop(); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const full = path.join(d, e.name); if (e.isDirectory()) stack.push(full); else if (full.endsWith(`/${target}`)) return full; } } return null; };
    const cleaned = read('data/cleaned.csv');
    const chart = read('out/chart.html');
    const summary = read('out/summary.md');
    const criteria = {
      cleanedCsvHasNormalizedDate: Boolean(cleaned && cleaned.includes('2025-03-07')),
      cleanedCsvHasSlashNormalized: Boolean(cleaned && cleaned.includes('2025-02-09')),
      chartSvg: Boolean(chart && chart.includes('<svg')),
      summaryRows33: Boolean(summary && summary.includes('33')),
      realProvider: Boolean(key),
      toolCalls: toolCalls.length,
      toolCallNames: [...new Set(toolCalls)].slice(0, 10),
    };
    out.sections.fullTask = { status: completed ? 'completed' : 'not-completed', agentTaskId, criteria };
    // dev 对照（block-348 results.json 的 T2 记录）
    const devBaseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance', 'block-348', 'results.json'), 'utf8'));
    const devT2 = devBaseline.tasks.find((t) => t.id === 't2-data-cleaning');
    out.sections.devComparison = {
      devT2Status: devBaseline.tasks.find((t) => t.id === 't2-data-cleaning') ? devT2.status : null,
      devT2CriteriaPass: devT2 ? devT2.criteriaResults.every((c) => c.pass !== false) : null,
      packagedStatus: out.sections.fullTask.status,
      packagedCriteria: criteria,
      consistent: completed && criteria.cleanedCsvHasNormalizedDate && criteria.cleanedCsvHasSlashNormalized && criteria.chartSvg && criteria.summaryRows33,
    };
    // 清理
    await call('DELETE', `/api/data/projects/${projectId}`);
  } else {
    out.sections.fourHealth = { backendHealth: false, bootLogTail: log.join('').slice(-400) };
  }
} catch (e) {
  out.error = String(e && e.stack || e).slice(0, 500);
} finally {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'packaged-regression.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`[block353] structure=${out.sections.structure.allOk} health=${JSON.stringify(out.sections.fourHealth || {}).slice(0, 160)}`);
console.log(`[block353] fullTask=${out.sections.fullTask ? out.sections.fullTask.status : 'n/a'} → acceptance/block-353/packaged-regression.json`);
