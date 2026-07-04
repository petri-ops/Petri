// M1-4 数据 migration runner 测试
// 运行：cd desktop-app && node --test test/migration-runner.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAppliedVersion, runMigrations } from '../src/migration-runner.js';

// 用临时 db 文件
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mig-test-'));
const tmpDb = path.join(tmpDir, 'test.db');

// 造两个临时 migration sql 文件
const migDir = path.join(tmpDir, 'migrations');
fs.mkdirSync(migDir, { recursive: true });
fs.writeFileSync(path.join(migDir, '001_init.sql'), `
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT);
`);
fs.writeFileSync(path.join(migDir, '002_add_col.sql'), `
ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active';
`);
fs.writeFileSync(path.join(migDir, '003_users.sql'), `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT);
`);

// === 场景 1：空库 → 跑全部 migration，版本到 3 ===
{
  const version = await runMigrations(tmpDb, migDir);
  assert.strictEqual(version, 3, `空库应到版本 3，实际 ${version}`);
  console.log('✓ 场景1 空库建表到 v3 通过');
}

// === 场景 2：已有库 → 再跑只跑增量（004 新增）===
{
  // 加一个 004
  fs.writeFileSync(path.join(migDir, '004_add_index.sql'), `
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
`);
  const version = await runMigrations(tmpDb, migDir);
  assert.strictEqual(version, 4, `已有库应到版本 4，实际 ${version}`);
  console.log('✓ 场景2 增量到 v4 通过');
}

// === 场景 3：getAppliedVersion 查询 ===
{
  const v = await getAppliedVersion(tmpDb);
  assert.strictEqual(v, 4, `getAppliedVersion 应返回 4`);
  console.log('✓ 场景3 getAppliedVersion 通过');
}

// === 场景 4：无 migration 目录 → 返回 0，不抛 ===
{
  const emptyDir = path.join(tmpDir, 'empty-migrations');
  fs.mkdirSync(emptyDir, { recursive: true });
  const v = await runMigrations(tmpDb, emptyDir);
  assert.strictEqual(v, 4, `无新 migration 应保持版本 4`);
  console.log('✓ 场景4 无新 migration 通过');
}

// === 场景 5：空库的 getAppliedVersion ===
{
  const freshDb = path.join(tmpDir, 'fresh.db');
  const v = await getAppliedVersion(freshDb);
  assert.strictEqual(v, 0, `空库 getAppliedVersion 应返回 0`);
  console.log('✓ 场景5 空库版本 0 通过');
}

// === 场景 6：已应用版本不会被重跑（确认 schema_migrations 记录全部版本）===
{
  // 用 createRequire 在 ESM 里拿 better-sqlite3
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(tmpDb);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  db.close();
  assert.deepStrictEqual(rows.map((r) => r.version), [1, 2, 3, 4], '应记录 1-4 全部版本');
  console.log('✓ 场景6 schema_migrations 记录通过');
}

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('\n所有 migration-runner 测试通过');
