/**
 * nso-w2-db-single-source.test.mjs — BLOCK-360（NSO-W2-4）DB 路径/pragma 单源 + 迁移定序 + 退出 checkpoint。
 *
 * 缺口（评估 F-19 + 本批实码核对）：
 *  ①migration-runner 字典序 sort + parseInt：重号（两个 021_*.sql）时第二个 ver<=applied 被
 *    **永久静默跳过**；非法文件名静默忽略；裸 new Database 无 busy_timeout（启动期撞锁即败）。
 *  ②桌面 _db-singleton 只认 PETRI_LOCAL_DATA_DIR，核心 connection 只认 PETRI_DB_PATH——两条
 *    precedence 各写一份，env 分歧时可指向不同库；pragma 集合也各写一份（busy_timeout/mmap 分叉）。
 *  ③桌面侧连接退出时从不 close（closeAll 零生产调用点）→ WAL 不收敛。
 * 单源=core/shared-backend/db-connection-policy.js（桌面经 resolveCore 引用，与 config-helper 同桥）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  resolveDbPath,
  orderMigrationFiles,
  applyCanonicalPragmas,
  CANONICAL_PRAGMAS,
} = require('../core/shared-backend/db-connection-policy.js');

test('W2-4 resolveDbPath：PETRI_DB_PATH 优先，其次 PETRI_LOCAL_DATA_DIR/petri.db，都缺返回 null', () => {
  assert.equal(resolveDbPath({ PETRI_DB_PATH: '/a/x.db', PETRI_LOCAL_DATA_DIR: '/b' }), '/a/x.db');
  assert.equal(resolveDbPath({ PETRI_LOCAL_DATA_DIR: '/b' }), path.join('/b', 'petri.db'));
  assert.equal(resolveDbPath({}), null);
});

test('W2-4 orderMigrationFiles：按数值定序（非字典序），非 .sql 忽略', () => {
  const ordered = orderMigrationFiles(['010_b.sql', '002_a.sql', '1000_z.sql', 'README.md', '021_c.sql']);
  assert.deepEqual(ordered.map((m) => m.version), [2, 10, 21, 1000]);
  assert.equal(ordered[0].file, '002_a.sql');
});

test('W2-4 负测：重号版本 fail-fast（此前第二个文件被永久静默跳过）', () => {
  assert.throws(() => orderMigrationFiles(['021_a.sql', '021_b.sql']), /migration_version_duplicate/);
});

test('W2-4 负测：非法迁移文件名 fail-fast（不静默忽略）', () => {
  assert.throws(() => orderMigrationFiles(['21_short.sql']), /migration_name_invalid/);
  assert.throws(() => orderMigrationFiles(['abc_x.sql']), /migration_name_invalid/);
});

test('W2-4 applyCanonicalPragmas：同一 pragma 集合落到真实连接（WAL/busy_timeout/mmap/autocheckpoint）', () => {
  const Database = require('better-sqlite3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w2-db-'));
  try {
    const db = new Database(path.join(dir, 'p.db'));
    applyCanonicalPragmas(db, { busyTimeoutMs: 4321 });
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('busy_timeout', { simple: true }), 4321);
    assert.equal(db.pragma('wal_autocheckpoint', { simple: true }), 1000);
    assert.ok(Number(db.pragma('mmap_size', { simple: true })) >= 0, 'mmap 已设置');
    db.close();
    assert.ok(CANONICAL_PRAGMAS.length >= 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W2-4 迁移执行器：重号目录 fail-fast，不应用任何半截迁移', async () => {
  const { runMigrations } = require('../src/migration-runner.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w2-mig-'));
  try {
    const migDir = path.join(dir, 'm');
    fs.mkdirSync(migDir);
    fs.writeFileSync(path.join(migDir, '001_a.sql'), 'CREATE TABLE t1(x);');
    fs.writeFileSync(path.join(migDir, '002_b.sql'), 'CREATE TABLE t2(x);');
    fs.writeFileSync(path.join(migDir, '002_c.sql'), 'CREATE TABLE t3(x);');
    await assert.rejects(runMigrations(path.join(dir, 'p.db'), migDir), /migration_version_duplicate/);
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'p.db'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't%'").all();
    db.close();
    assert.deepEqual(tables, [], '定序校验先于任何应用');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W2-4 退出收敛：main.js will-quit 关闭桌面侧连接（closeAll 带 WAL checkpoint）', () => {
  const singleton = require('../src/database/_db-singleton.js');
  assert.equal(typeof singleton.closeAll, 'function');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(src, /will-quit[\s\S]{0,400}closeAll\(\{\s*checkpoint:\s*true\s*\}\)/, 'will-quit 必须调用 closeAll({ checkpoint: true })');
});

test('W2-4 单源接线：桌面与核心两侧都从 db-connection-policy 取路径与 pragma（不再各写一份）', () => {
  const desktop = fs.readFileSync(path.join(ROOT, 'src', 'database', '_db-singleton.js'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'db', 'connection.js'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'src', 'migration-runner.js'), 'utf8');
  for (const [name, text] of [['_db-singleton', desktop], ['connection', core], ['migration-runner', runner]]) {
    assert.match(text, /db-connection-policy/, `${name} 必须引用单源策略模块`);
  }
  assert.doesNotMatch(core, /db\.pragma\('busy_timeout = 10000'\)/, '核心侧不得再内联 busy_timeout');
});
