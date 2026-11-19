/**
 * BLOCK-497 MIGRATION-IDEMPOTENT — 自愈补列收窄版记账契约（HK-01 红绿先行）。
 *
 * 缺口（AUDIT-LOG 🟡 2026-11-17 实机案底；用户 2026-11-19 发令 A1 开工）：
 *   core/petri-server/helpers/project-worktree.js 的 ensureProjectWorktreeColumn 自愈补列
 *   不记 schema_migrations；无头栈（dev-verify 直接 `node server.js`）先开同一 petri.db 补列后，
 *   桌面壳 src/migration-runner.js 在 boot 重放 021_project_worktree_of.sql（裸 ALTER TABLE）
 *   → duplicate column 拒启。
 *
 * 裁决形态（docs/block495-candidate-pool-review-2026-11-19.md §2 推荐，用户 A 组 #1 开工）：
 *   自愈补列成功后**收窄版记账**——仅当 MAX(schema_migrations.version)===20（恰差 021 一版）
 *   才补记 v21；其余版本态不记（防 v15 库被跳版误记 16~20）；schema_migrations 缺席不记
 *   （全新库由迁移建表自会补齐）；补列+记账同事务（记账失败回滚补列，不留半态）。
 *
 * 红绿判据：
 *   红（修复前）：自愈补列后台账仍 v20 → runMigrations 重放 021 → duplicate column 抛错；
 *   绿（修复后）：自愈补列+记账 v21 → runMigrations 跳过 021 → 无错；v15 库不记账（防跳版）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ensureProjectWorktreeColumn } = require('../core/petri-server/helpers/project-worktree.js');
const { runMigrations } = require('../src/migration-runner.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 构造「已应用到 vN、projects 表存在但无 worktree_of」的库（021 前形态）。 */
function makeV20StyleDb(tmp, appliedVersion) {
  const dbPath = path.join(tmp, `petri-v${appliedVersion}.db`);
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);
  const insert = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');
  for (let v = 1; v <= appliedVersion; v += 1) insert.run(v);
  // projects 表取 021 前关键列（worktree_of 不在）
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, updated_at TEXT)');
  db.close();
  return dbPath;
}

/** 把真实 021 迁移拷进临时目录（复用仓库 SQL 原文，不内联副本）。 */
function make021OnlyMigrationsDir(tmp) {
  const dir = path.join(tmp, 'migrations-021-only');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'src', 'migrations', '021_project_worktree_of.sql'), path.join(dir, '021_project_worktree_of.sql'));
  return dir;
}

const appliedVersionOf = (dbPath) => {
  const db = new Database(dbPath);
  try {
    return db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v ?? 0;
  } finally {
    db.close();
  }
};

const hasWorktreeOf = (dbPath) => {
  const db = new Database(dbPath);
  try {
    return db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'worktree_of');
  } finally {
    db.close();
  }
};

test('自愈补列后桌面迁移重放 021 不再拒启（缺口感复现→收窄版记账转绿）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block497-migration-'));
  try {
    const dbPath = makeV20StyleDb(tmp, 20);
    ensureProjectWorktreeColumn(new Database(dbPath));
    assert.equal(hasWorktreeOf(dbPath), true, '自愈必须补列（原行为保持）');
    assert.equal(appliedVersionOf(dbPath), 21, '收窄版记账：恰差一版（v20）时补列必须补记 v21');
    const dir = make021OnlyMigrationsDir(tmp);
    const version = await runMigrations(dbPath, dir);
    assert.equal(version, 21, '021 已记账 → 重放跳过（不再 duplicate column 拒启）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('跳版守卫：v15 库自愈补列但记账保持 v15（防误记 16~20）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block497-guard-'));
  try {
    const dbPath = makeV20StyleDb(tmp, 15);
    ensureProjectWorktreeColumn(new Database(dbPath));
    assert.equal(hasWorktreeOf(dbPath), true, '补列照常');
    assert.equal(appliedVersionOf(dbPath), 15, 'MAX(version)!==20 时不记账（防跳版误记）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('projects 表缺席（全新库）自愈静默交给迁移', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block497-fresh-'));
  try {
    const dbPath = path.join(tmp, 'fresh.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);
    db.close();
    assert.doesNotThrow(() => ensureProjectWorktreeColumn(new Database(dbPath)), '全新库自愈必须静默跳过');
    assert.equal(hasWorktreeOf(dbPath), false, '无 projects 表即无补列');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
