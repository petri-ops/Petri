/**
 * BLOCK-330 — db 装配层循环加载收敛 + dev-verify 证据文件名平台化的契约锁。
 *
 * 抓真背景（BLOCK-328 实机）：`db/schema.js` 顶层 `require('./connection')` 只为借副作用，
 * 而 `db/connection.js` 顶层回调 `require('./schema')`——先 require schema 的调用方（测试/工具/
 * 迁移脚本）会在环内拿到半成品导出直接崩（`initSchema is not a function`），BLOCK-328 的前置挂载
 * 只是把崩点后移到 `getCurrentG0Baseline` 的 TDZ。本包删掉那行副作用 require，依赖恢复单向。
 *
 * 三条锁：①schema 可被独立 require（真进程跑，不是看源码）；②生产顺序 db.js→connection→schema
 * 行为零变化（DDL 仍建表）；③源码不得把环加回来。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(resolve(root, relative), 'utf8');
/** 去掉整行注释（本仓习惯用注释解释「为什么不再这么写」，匹配源码时必须排除）。 */
const readCode = (relative) => read(relative)
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

function runNode(script, env = {}) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

/** 与 test/block328 同法：standalone 不自带 src/migrations，先建好桌面侧表再起 db.js。 */
function bootstrapMigrations(dbPath) {
  const Database = require(resolve(root, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  const db = new Database(dbPath);
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
}

test('BLOCK-330 — schema 可被独立 require（环已断，真进程验证）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b330-schema-'));
  try {
    const result = runNode(`
      const s = require('./core/petri-server/db/schema.js');
      console.log(JSON.stringify({
        initSchema: typeof s.initSchema,
        retry: typeof s.initSchemaWithBusyRetry,
        delays: [...s.BUSY_RETRY_DELAYS_MS],
      }));
    `, { PETRI_DB_PATH: path.join(tmp, 'unused.db'), PETRI_LOCAL_DATA_DIR: path.join(tmp, 'data') });
    assert.equal(result.status, 0, `独立 require schema 崩溃：${result.stderr.slice(-800)}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      initSchema: 'function',
      retry: 'function',
      delays: [2000, 5000],
    });
    // 独立 require 不得顺带打开数据库（那才是「借副作用」的残留）
    assert.equal(fs.existsSync(path.join(tmp, 'unused.db')), false, 'schema 不应在 require 期建库/连库');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('BLOCK-330 — 生产装配顺序 db.js→connection→schema 行为零变化（DDL 仍建表）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b330-assembly-'));
  try {
    const dbPath = path.join(tmp, 'petri.db');
    bootstrapMigrations(dbPath);
    const result = runNode(`
      const db = require('./core/petri-server/db.js');
      const table = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scientific_task_specs'").get();
      console.log(JSON.stringify({
        getDatabase: typeof db.getDatabase,
        getUserById: typeof db.getUserById,
        schemaTableCreated: Boolean(table),
      }));
    `, { PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: path.join(tmp, 'data') });
    assert.equal(result.status, 0, `装配层 require 崩溃：${result.stderr.slice(-800)}`);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.getDatabase, 'function');
    assert.equal(payload.getUserById, 'function');
    assert.equal(payload.schemaTableCreated, true, 'schema 的 DDL 仍必须在连接后执行');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('BLOCK-330 — 源码契约：依赖方向单向，环不得被加回来', () => {
  const schema = readCode('core/petri-server/db/schema.js');
  const connection = readCode('core/petri-server/db/connection.js');
  assert.doesNotMatch(schema, /require\(['"]\.\/connection['"]\)/,
    'schema.js 顶层 require connection 是纯副作用，会把 CJS 环带回来');
  assert.match(connection, /require\(['"]\.\/schema['"]\)\.initSchemaWithBusyRetry\(db\)/,
    'DDL 仍由 connection 在 pragma 之后触发（时序不变）');
  // 单一退避表：不能再出现第二份字面量副本（BLOCK-328 留过 busyRetryDelays() 幽灵副本）
  assert.doesNotMatch(schema, /function busyRetryDelays/);
  assert.equal((schema.match(/\[2000, 5000\]/g) || []).length, 1, '退避表只声明一处');
});

test('BLOCK-330 — dev-verify 证据名按平台落盘（加性，不迁移旧文件）', async () => {
  const lib = require(resolve(root, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b330-evidence-'));
  try {
    const run = lib.createRun({ name: 'block999-something-live', evidenceDir: dir });
    run.assert('probe', true);
    const payload = await run.finish();
    assert.equal(payload.platform, process.platform);
    const files = fs.readdirSync(dir);
    assert.deepEqual(files, [`block999-something-live-${process.platform}.json`],
      'id 已以 -live 结尾时不再叠加 -live（旧 ...-live-live.json 双拼不再复制）');
    const other = lib.createRun({ name: 'plain-check', evidenceDir: dir });
    other.assert('probe', true);
    await other.finish();
    assert.ok(fs.existsSync(path.join(dir, `plain-check-live-${process.platform}.json`)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
