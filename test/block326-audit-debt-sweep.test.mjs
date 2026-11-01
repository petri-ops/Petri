/**
 * BLOCK-326 — 审计台工程债清偿批回归测试。
 *
 * 钉住：
 * - ① SIGTERM 后 petri-server 进程真正退出（teardown 关库→server.close→exit(0)；
 *   2026-11-01 🟡 实机抓真：只关库不退出，supervisor SIGTERM 停不掉，孤儿累积持有 DB/端口）；
 * - ② 四个补导出的 flow 可被 dev-verify runner 寻址（--list 不再必红）；
 * - ③ npm run state 把 living-plan+active 纳入 active 槽位；BLOCK-322/STAGE-34 registry
 *   状态已翻转（不再漏报/陈旧 active）；
 * - ⑤ decision-api no_key 早退也落 degraded 台账行（point 透传时）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve2, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve2(port)); });
    srv.on('error', reject);
  });
}

test('BLOCK-326 ① SIGTERM 后 petri-server 进程限时退出', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b326-sigterm-'));
  const dbPath = path.join(tempDir, 'petri.db');
  {
    const Database = require('better-sqlite3');
    const boot = new Database(dbPath);
    const migrationsDir = path.join(root, 'src', 'migrations');
    for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    boot.close();
  }
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'core', 'petri-server', 'server.js')], {
    env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: path.join(tempDir, 'data'), R_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    // 等健康
    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      healthy = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
        .then((r) => r.ok).catch(() => false);
    }
    assert.ok(healthy, '隔离后端就绪');
    // SIGTERM → 应在 6s 内退出（关库→server.close→exit(0)，2000ms 兜底）
    const exited = new Promise((resolve2) => child.once('exit', (code, signal2) => resolve2({ code, signal: signal2 })));
    const t0 = Date.now();
    child.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise((resolve2) => setTimeout(() => resolve2(null), 6000)),
    ]);
    assert.ok(result, 'SIGTERM 后 6s 内退出（修复前：进程存活，孤儿累积）');
    assert.ok(Date.now() - t0 < 6000);
  } finally {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ }
  }
});

test('BLOCK-326 ② dev-verify --list 可跑且四个补导出 flow 在册', async () => {
  const runCjs = path.join(root, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'run.cjs');
  const result = await new Promise((resolve2) => {
    const child = spawn(process.execPath, [runCjs, '--list'], { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve2({ code, out }));
  });
  assert.equal(result.code, 0, `--list 退出码=${result.code}（修复前必红 exit 2）`);
  for (const id of ['b264-evidence-live', 'b266-composer-shrink', 'b268-scratchpad-live', 'b269-browser-bridge-live']) {
    assert.ok(result.out.includes(id), `--list 含 ${id}`);
  }
});

test('BLOCK-326 ③ state 含 living-plan 槽位 + registry 两处翻转落地', async () => {
  const stateOut = await new Promise((resolve2) => {
    const child = spawn(process.execPath, [path.join(root, '.agents', 'skills', 'petri-dev-infra', 'scripts', 'workspace-state.mjs')], { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve2({ code, out }));
  });
  assert.equal(stateOut.code, 0);
  assert.ok(stateOut.out.includes('G0-LF'), 'living-plan 且 active 的 G0-LF 应出现在 active 槽位（修复前静默漏报）');
  assert.ok(!stateOut.out.includes('当前无 active 工作包'), '存在 active living-plan 时不得报「无 active 工作包」');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'DOC-REGISTRY.json'), 'utf8'));
  assert.equal(registry.documents.find((d) => d.id === 'BLOCK-322-MODEL3D-FULL-SPECTRUM').status, 'completed', 'BLOCK-322 收口漏回写已补');
  assert.equal(registry.documents.find((d) => d.id === 'STAGE-34-EXECUTION-RUNLIST').status, 'completed', 'STAGE-34 十三包全收口后翻转');
});

test('BLOCK-326 ④ C6 夹具对齐现白名单（源码契约）', () => {
  const source = fs.readFileSync(
    path.join(root, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'block322-p3-constraints-live.cjs'), 'utf8',
  );
  assert.ok(source.includes("kind: 'bond'"), '夹具改用从未在册的 bond（mate 已入白名单）');
  assert.ok(source.includes('align/distance/angle/mate'), '断言文案对齐 scene3d.js 现值');
  assert.ok(!/kind: 'mate'/.test(source.split('C6_unsupported')[0].split('badKind')[1] || ''), 'badKind 夹具不再用 mate');
});

test('BLOCK-326 ⑤ decision-api no_key 早退也落 degraded 台账行', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b326-nokey-'));
  const dbPath = path.join(tempDir, 'petri.db');
  {
    const Database = require('better-sqlite3');
    const boot = new Database(dbPath);
    const migrationsDir = path.join(root, 'src', 'migrations');
    for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    boot.close();
  }
  const savedKey = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  process.env.PETRI_DB_PATH = dbPath;
  process.env.PETRI_LOCAL_DATA_DIR = path.join(tempDir, 'data');
  try {
    const decisionApi = require(resolve(root, 'core/petri-server/helpers/decision-api.js'));
    const outcome = await decisionApi.askDecision({
      state: 'block326-no-key-probe',
      questions: { next: { type: 'choice', categories: ['a', 'b'] } },
      meta: { point: 'next-work' },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'no_key');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT degraded, reason FROM decision_log WHERE point = 'next-work' ORDER BY id DESC LIMIT 1").get();
    db.close();
    assert.ok(row, 'no_key 早退应落一行台账（修复前：0 行，实跑不可见）');
    assert.equal(row.degraded, 1);
    assert.equal(row.reason, 'no_key');
  } finally {
    if (savedKey !== undefined) process.env.TYPESAFE_API_KEY = savedKey;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ }
  }
});
