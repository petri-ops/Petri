#!/usr/bin/env node
'use strict';

/**
 * scripts/g1-release-smoke.mjs — G1 六序⑥前半：未签名打包产物隔离冒烟。
 * 复用 block353-packaged-check 的「结构+迁移+启动+健康」口径，**不跑 T2 真实 provider**
 * （那属 G1 序列4 W4 外部依赖，仍挂账）。隔离端口 3105 + 临时数据目录，
 * owner 3000/3001/9222 零触碰；未签名/adhoc 如实标注，不伪造签名状态。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'dist', 'mac-arm64', 'Petri.app');
const RES = path.join(APP, 'Contents', 'Resources');
const BIN = path.join(APP, 'Contents', 'MacOS', 'Petri');
const SERVER = path.join(RES, 'core', 'petri-server', 'server.js');
const PORT = 3105;
const OUT = path.join(ROOT, 'acceptance', 'g1-release-pipeline', 'smoke.json');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-g1-smoke-'));
const childEnv = () => ({
  HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir(),
  ELECTRON_RUN_AS_NODE: '1', R_SERVER_PORT: String(PORT),
  PETRI_LOCAL_DATA_DIR: dataDir, PETRI_DB_PATH: path.join(dataDir, 'petri.db'),
  NODE_PATH: [path.join(RES, 'core', 'petri-server', 'node_modules'), path.join(RES, 'node_modules')].join(':'),
});

async function request(p) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { signal: AbortSignal.timeout(2000) });
  return { status: r.status, text: (await r.text()).slice(0, 400) };
}

(async () => {
  const out = { startedAt: new Date().toISOString(), artifacts: {}, checks: {} };
  // ① 结构 + 产物 sha/体积
  for (const rel of ['dist/Petri-0.0.4-arm64.dmg', 'dist/Petri-0.0.4.dmg']) {
    const p = path.join(ROOT, rel);
    out.artifacts[rel] = { bytes: fs.statSync(p).size, sha256: sha(p) };
  }
  out.checks.serverPresent = fs.existsSync(SERVER);
  // ② addon ABI 实测（打包 helper + 打包 addon）
  const helper = path.join(APP, 'Contents', 'Frameworks', 'Petri Helper.app', 'Contents', 'MacOS', 'Petri Helper');
  const addon = path.join(RES, 'core', 'petri-server', 'node_modules', 'better-sqlite3', 'bin', 'darwin-arm64-149', 'better-sqlite3.node');
  try {
    const probeOut = execFileSync(helper, ['-e', `const db=require(${JSON.stringify(addon)}); console.log('OK',process.versions.modules,typeof db.Database)`], {
      env: { ...childEnv(), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20000,
    }).trim();
    out.checks.packagedAddon = { ok: probeOut.startsWith('OK'), detail: probeOut };
  } catch (e) {
    out.checks.packagedAddon = { ok: false, detail: String(e.stderr || e.message).slice(0, 300) };
  }
  // ③ 迁移 + 启动 + 健康（复用 block353 口径）
  const migScript = path.join(RES, 'core', 'petri-server', 'g1-smoke-migrate.cjs');
  const migrationsDir = path.join(RES, 'src', 'migrations');
  const migDb = path.join(dataDir, 'petri.db');
  fs.writeFileSync(migScript, `
    const Database = require('better-sqlite3');
    const fs = require('node:fs');
    const path = require('node:path');
    const db = new Database(${JSON.stringify(migDb)});
    db.pragma('journal_mode = WAL');
    const files = fs.readdirSync(${JSON.stringify(migrationsDir)}).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) db.exec(fs.readFileSync(path.join(${JSON.stringify(migrationsDir)}, f), 'utf8'));
    console.log('MIGRATED ' + files.length + ' files, tables=' + db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n);
  `);
  try {
    out.checks.migration = execFileSync(BIN, [migScript], { env: childEnv(), encoding: 'utf8', timeout: 120000 }).trim();
  } catch (e) {
    out.checks.migration = `FAILED ${String(e.stderr || e.message).slice(0, 300)}`;
  } finally {
    try { fs.unlinkSync(migScript); } catch { /* 清理 */ }
  }
  const child = spawn(BIN, [SERVER], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  try {
    let health = null;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try { health = await request('/api/health'); if (health.status === 200) break; } catch { /* retry */ }
    }
    out.checks.health = health;
    out.checks.spa = await request('/').catch(() => null);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  out.checks.serverLogTail = log.slice(-500);
  out.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const pass = out.checks.packagedAddon.ok && /MIGRATED/.test(out.checks.migration) && out.checks.health?.status === 200;
  console.log(`[g1-smoke] ${pass ? 'PASS' : 'FAIL'} -> ${OUT}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('[g1-smoke] ERROR', e); process.exit(2); });
