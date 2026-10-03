/**
 * G0-RS2 — migration 首次使用验证。
 *
 * 背景（RS0 ADR-RS-2）：`src/migration-runner.js` 早已接线到 `src/main.js`，
 * 但 `src/migrations/` 目录此前**不存在**，因此 runner 从未真正执行过任何
 * migration —— readdirSync 抛错后被 catch 吞掉，静默返回当前版本。
 * `001_result_studio.sql` 是它的第一个真实使用者，所以这里必须验证 runner
 * 本身可用，而不是假设它开箱可用。
 *
 * 覆盖：
 * 1. .sql 文件与 result-studio-schema.js 逐字节一致（单一事实来源）
 * 2. 空库首装
 * 3. 已有库升级且不破坏既有表
 * 4. 重复执行幂等
 * 5. 失败 migration 整体回滚，不留半套表、不记版本
 * 6. 目录缺失时的静默 no-op（记录既有行为，避免误判为已升级）
 * 7. BIOF3_BETTER_SQLITE3_ROOT ABI 路径
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const Database = require('better-sqlite3');
const { getAppliedVersion, runMigrations, loadDatabaseConstructor } = require('../src/migration-runner');
const {
  RESULT_STUDIO_MIGRATION_VERSION,
  RESULT_STUDIO_TABLES,
  buildMigrationSql,
  inspectResultStudioSchema,
} = require('../core/shared-backend/result-studio-schema');
const {
  RESULT_WORKFLOW_GRAPH_MIGRATION_VERSION,
  buildWorkflowGraphMigrationSql,
} = require('../core/shared-backend/result-workflow-graph');
const {
  RESULT_REF_TRANSACTION_MIGRATION_VERSION,
  buildResultRefTransactionMigrationSql,
} = require('../core/shared-backend/result-ref-transaction-schema');

const REAL_MIGRATIONS_DIR = join(REPO_ROOT, 'src', 'migrations');
const MIGRATION_FILE = join(REAL_MIGRATIONS_DIR, '001_result_studio.sql');
const WORKFLOW_GRAPH_MIGRATION_FILE = join(REAL_MIGRATIONS_DIR, '002_result_workflow_graph.sql');
const REF_TRANSACTION_MIGRATION_FILE = join(REAL_MIGRATIONS_DIR, '003_result_ref_transactions.sql');
// UI-462（2026-10-03 用户裁决）退役「自有仓库接入」后，consent generator 模块已删除；
// 004 迁移文件本身保留（历史迁移不可回撤），其 additive 形态守卫随之撤销。
// runner 真相=src/migrations/ 内全部 .sql 的数字前缀；此处同源推导，
// 避免新增迁移（如 009_knowledge_space）时硬编码版本号静默漂移。
const LATEST_MIGRATION_VERSION = Math.max(
  0,
  ...readdirSync(REAL_MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => parseInt(f, 10))
    .filter((n) => Number.isFinite(n)),
);

// 收集本文件所有临时目录，统一在「文件级」after 钩子里清理。
// 文件级钩子在所有 test 级 after 钩子（含各用例的 db.close）之后运行，
// 从而避免在 Windows 上删除仍被打开的 SQLite 文件（EPERM）。
const tempDirs = [];

function tempDir(context, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

test.after(() => {
  for (const root of tempDirs) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // 清理失败不应影响测试结果（Windows 偶发的句柄残留）
    }
  }
});

function tableNames(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// 1. 单一事实来源
// ---------------------------------------------------------------------------

test('RS2 migration file matches the schema module byte for byte', () => {
  const onDisk = readFileSync(MIGRATION_FILE, 'utf8');
  assert.equal(
    onDisk,
    buildMigrationSql(),
    'src/migrations/001_result_studio.sql 与 result-studio-schema.js 不一致：'
    + '改 schema 后必须重新生成该文件，不要手工编辑。'
  );
});

test('RS2 migration file avoids constructs the runner forbids', () => {
  // 只检查可执行 SQL：文件头注释本身就列举了这些禁用构造，
  // 不剥注释会让检查命中自己的说明文字而误报。
  const sql = readFileSync(MIGRATION_FILE, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  // runner 已把整个文件包在 db.transaction 内，文件自带 BEGIN/COMMIT 会导致嵌套事务失败。
  assert.equal(/^\s*BEGIN\b/im.test(sql), false, 'migration 不得自带 BEGIN');
  assert.equal(/^\s*COMMIT\b/im.test(sql), false, 'migration 不得自带 COMMIT');
  assert.equal(/INSERT\s+OR\s+REPLACE/i.test(sql), false);
  assert.equal(/\bPRAGMA\b/i.test(sql), false);
  assert.equal(/\bAUTOINCREMENT\b/i.test(sql), false);
  // 只新增，不改现有表
  assert.equal(/\bDROP\s+TABLE\b/i.test(sql), false);
  assert.equal(/\bALTER\s+TABLE\b/i.test(sql), false);
});

test('P5 workflow graph migration is generated from its schema module and is additive', () => {
  assert.equal(readFileSync(WORKFLOW_GRAPH_MIGRATION_FILE, 'utf8'), buildWorkflowGraphMigrationSql());
  const sql = readFileSync(WORKFLOW_GRAPH_MIGRATION_FILE, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(/^\s*BEGIN\b/im.test(sql), false);
  assert.equal(/^\s*COMMIT\b/im.test(sql), false);
  assert.equal(/\bDROP\s+TABLE\b/i.test(sql), false);
  assert.equal(/\bALTER\s+TABLE\b/i.test(sql), false);
  assert.equal(/\bresult_workflow_graphs\b/i.test(sql), true);
});

test('P6 ref transaction migration is generated from its schema module and is additive', () => {
  assert.equal(readFileSync(REF_TRANSACTION_MIGRATION_FILE, 'utf8'), buildResultRefTransactionMigrationSql());
  const sql = readFileSync(REF_TRANSACTION_MIGRATION_FILE, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(/^\s*BEGIN\b/im.test(sql), false);
  assert.equal(/^\s*COMMIT\b/im.test(sql), false);
  assert.equal(/\bDROP\s+TABLE\b/i.test(sql), false);
  assert.equal(/\bALTER\s+TABLE\b/i.test(sql), false);
  assert.equal(/\bresult_ref_transactions\b/i.test(sql), true);
});

// ---------------------------------------------------------------------------
// 2-4. 真实 runner 行为
// ---------------------------------------------------------------------------

test('RS2 runner installs the schema into an empty database', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-empty-');
  const dbPath = join(root, 'fresh.db');

  assert.equal(getAppliedVersion(dbPath), 0);
  const version = await runMigrations(dbPath, REAL_MIGRATIONS_DIR);
  assert.equal(version, LATEST_MIGRATION_VERSION);

  const names = tableNames(dbPath);
  for (const table of RESULT_STUDIO_TABLES) {
    assert.equal(names.includes(table), true, `missing table ${table}`);
  }
  assert.equal(names.includes('result_workflow_graphs'), true);
  assert.equal(names.includes('result_ref_transactions'), true);
  assert.equal(names.includes('git_repository_consents'), true);

  const db = new Database(dbPath, { readonly: true });
  context.after(() => { try { db.close(); } catch { /* noop */ } });
  assert.equal(inspectResultStudioSchema(db).complete, true);
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
  // 期望集合同源推导自迁移目录，并点名校验四个 RS 专属 schema 版本确实就位
  const expectedVersions = readdirSync(REAL_MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => parseInt(f, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  assert.deepEqual(applied, expectedVersions);
  for (const named of [
    RESULT_STUDIO_MIGRATION_VERSION,
    RESULT_WORKFLOW_GRAPH_MIGRATION_VERSION,
    RESULT_REF_TRANSACTION_MIGRATION_VERSION,
    4, // 004_git_repository_consent.sql（UI-462 后 generator 模块退役，版本以迁移文件名为准）
  ]) {
    assert.equal(applied.includes(named), true, `missing named migration ${named}`);
  }
});

test('RS2 runner upgrades an existing database without touching its tables', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-upgrade-');
  const dbPath = join(root, 'existing.db');

  // 模拟已有用户库：一张业务表 + 一行数据
  const seed = new Database(dbPath);
  seed.exec('CREATE TABLE tool_jobs (id TEXT PRIMARY KEY, status TEXT)');
  seed.prepare('INSERT INTO tool_jobs (id, status) VALUES (?, ?)').run('job_1', 'completed');
  seed.close();

  const version = await runMigrations(dbPath, REAL_MIGRATIONS_DIR);
  assert.equal(version, LATEST_MIGRATION_VERSION);

  const db = new Database(dbPath, { readonly: true });
  context.after(() => { try { db.close(); } catch { /* noop */ } });
  // 既有数据完好
  assert.equal(db.prepare('SELECT status FROM tool_jobs WHERE id = ?').get('job_1').status, 'completed');
  // RS 表已就位
  assert.equal(inspectResultStudioSchema(db).complete, true);
  assert.equal(tableNames(dbPath).includes('result_ref_transactions'), true);
});

test('RS2 runner is idempotent across repeated startups', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-idem-');
  const dbPath = join(root, 'repeat.db');

  const first = await runMigrations(dbPath, REAL_MIGRATIONS_DIR);
  const second = await runMigrations(dbPath, REAL_MIGRATIONS_DIR);
  const third = await runMigrations(dbPath, REAL_MIGRATIONS_DIR);
  assert.equal(first, LATEST_MIGRATION_VERSION);
  assert.equal(second, LATEST_MIGRATION_VERSION);
  assert.equal(third, LATEST_MIGRATION_VERSION);

  const db = new Database(dbPath, { readonly: true });
  context.after(() => { try { db.close(); } catch { /* noop */ } });
  // 版本只记录一次，不重复插入
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  assert.equal(rows.length, LATEST_MIGRATION_VERSION);
});

// ---------------------------------------------------------------------------
// 5. 失败回滚
// ---------------------------------------------------------------------------

test('RS2 a failing migration rolls back completely and records no version', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-fail-');
  const dbPath = join(root, 'broken.db');
  const migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });

  // 前半句合法、后半句非法 → 整个文件必须回滚
  writeFileSync(
    join(migrationsDir, '001_partial.sql'),
    'CREATE TABLE rs_first (id TEXT PRIMARY KEY);\nTHIS IS NOT VALID SQL;\n',
    'utf8'
  );

  await assert.rejects(() => runMigrations(dbPath, migrationsDir), /Migration 001_partial\.sql failed/);

  const names = tableNames(dbPath);
  assert.equal(names.includes('rs_first'), false, '失败的 migration 不得留下半套表');
  assert.equal(getAppliedVersion(dbPath), 0, '失败的 migration 不得记录版本');
});

test('RS2 a later failing migration preserves the earlier applied one', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-seq-');
  const dbPath = join(root, 'seq.db');
  const migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, '001_ok.sql'), 'CREATE TABLE rs_ok (id TEXT PRIMARY KEY);\n', 'utf8');
  writeFileSync(join(migrationsDir, '002_bad.sql'), 'NOT SQL AT ALL;\n', 'utf8');

  await assert.rejects(() => runMigrations(dbPath, migrationsDir));

  assert.equal(tableNames(dbPath).includes('rs_ok'), true, '已成功的 migration 必须保留');
  assert.equal(getAppliedVersion(dbPath), 1, '只记录成功到的版本');
});

// ---------------------------------------------------------------------------
// 6. 目录缺失的既有行为
// ---------------------------------------------------------------------------

test('RS2 documents the silent no-op when the migrations directory is absent', async (context) => {
  const root = tempDir(context, 'biof3-rs2-mig-absent-');
  const dbPath = join(root, 'noop.db');

  // 这正是 RS2 之前的真实状态：目录不存在 → runner 返回当前版本且不报错。
  // 保留该行为，但用测试固定住语义：返回 0 表示"什么都没装"，
  // 不得被解读为"已升级到最新"。
  const version = await runMigrations(dbPath, join(root, 'does-not-exist'));
  assert.equal(version, 0);
  assert.equal(tableNames(dbPath).includes('git_repository_bindings'), false);
});

// ---------------------------------------------------------------------------
// 7. ABI 路径
// ---------------------------------------------------------------------------

test('RS2 loadDatabaseConstructor honours BIOF3_BETTER_SQLITE3_ROOT', (context) => {
  const original = process.env.BIOF3_BETTER_SQLITE3_ROOT;
  context.after(() => {
    if (original === undefined) delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
    else process.env.BIOF3_BETTER_SQLITE3_ROOT = original;
  });

  // 未设置 → 用根依赖
  delete process.env.BIOF3_BETTER_SQLITE3_ROOT;
  assert.equal(typeof loadDatabaseConstructor(), 'function');

  // 指向 core → 用 core 自己的依赖树（打包后 Electron ABI 与终端 Node 不同）
  process.env.BIOF3_BETTER_SQLITE3_ROOT = join(REPO_ROOT, 'core', 'shared-backend');
  const scoped = loadDatabaseConstructor();
  assert.equal(typeof scoped, 'function');

  // 解析出来的构造器必须真的能开库
  const root = tempDir(context, 'biof3-rs2-abi-');
  const db = new scoped(join(root, 'abi.db'));
  try {
    db.exec('CREATE TABLE probe (id TEXT PRIMARY KEY)');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'probe'").get().name, 'probe');
  } finally {
    db.close();
  }
});
