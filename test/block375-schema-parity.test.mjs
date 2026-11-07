import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * BLOCK-375（S0）— 迁移 ↔ fresh-DDL 平价契约门。
 *
 * 背景（2026-11-07 全量分片抓真）：BLOCK-373 链哈希（迁移 022）给 artifact_revisions
 * 加了 prev_chain_hash/chain_hash 两列，但 result-studio-schema.js 的 fresh-install
 * DDL 没同步 → 测试夹具（走 ensureResultStudioSchema）写 revision 时
 * `no such column: chain_hash`，result-studio 域 110 个测试整簇红。
 *
 * 本门把该缺陷类转成机械规则：对同一张表，凡迁移以 ADD COLUMN/CREATE TABLE
 * 声明的列，必须也能在 fresh DDL 中找到（迁移是存量库真相，fresh DDL 是新装/
 * 测试夹具真相，两者必须等价）。新迁移加列而漏改 schema 模块 → 当场红。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'src', 'migrations');

/** 从迁移 SQL 抽出每张表的列声明（CREATE TABLE 全列 + ALTER TABLE ADD COLUMN 增量）。 */
function extractMigrationColumns(migrationsDir) {
  const tables = {};
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const createRe = /CREATE TABLE\s+(IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);\s*$/gm;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[2];
      const cols = tables[table] || (tables[table] = new Set());
      for (const rawLine of m[3].split('\n')) {
        const line = rawLine.trim().replace(/,$/, '');
        if (!line || line.startsWith('--')) continue;
        if (/^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(line)) continue;
        const name = line.split(/\s+/)[0];
        if (name && !name.toUpperCase().startsWith('--')) cols.add(name);
      }
    }
    const alterRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi;
    while ((m = alterRe.exec(sql)) !== null) {
      const cols = tables[m[1]] || (tables[m[1]] = new Set());
      cols.add(m[2]);
    }
  }
  return tables;
}

test('迁移 022 链哈希列在 fresh DDL 中在位（BLOCK-373 schema 漂移回归门）', () => {
  const db = new (require('better-sqlite3'))(':memory:');
  try {
    const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema.js');
    ensureResultStudioSchema(db);
    const cols = db.prepare('PRAGMA table_info(artifact_revisions)').all().map((r) => r.name);
    for (const col of ['prev_chain_hash', 'chain_hash']) {
      assert.ok(cols.includes(col), `artifact_revisions 缺列 ${col}（迁移 022 已声明；fresh DDL 未同步即红）`);
    }
  } finally {
    db.close();
  }
});

test('全量平价：迁移声明的每列都在 ensure 后的运行时 schema 中（两套真相等价）', () => {
  // BLOCK-375（S0）修正：migration 001 与 buildMigrationSql() 有逐字节一致契约，
  // fresh DDL 文本不可含 022 增量列（改文本=改历史迁移）——对齐改由
  // ensureResultStudioSchema 末尾幂等 ALTER（ensureArtifactChainHashColumns）承担。
  // 故平价判据=迁移声明列 ⊆ ensure 后 PRAGMA 实测列。
  const Database = require('better-sqlite3');
  const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema.js');
  const db = new Database(':memory:');
  try {
    ensureResultStudioSchema(db);
    const migrations = extractMigrationColumns(MIGRATIONS_DIR);
    const drift = [];
    for (const [table, cols] of Object.entries(migrations)) {
      let rows = [];
      try {
        rows = db.prepare(`PRAGMA table_info(${table})`).all();
      } catch {
        continue; // 该表不由 result-studio 域管理 → 不在本门范围
      }
      if (rows.length === 0) continue;
      const present = new Set(rows.map((r) => r.name));
      for (const col of cols) {
        if (!present.has(col)) drift.push(`${table}.${col}`);
      }
    }
    assert.deepEqual(
      drift,
      [],
      `迁移声明列在 ensure 后 schema 中缺席（写入路径将 no such column）：\n${drift.join('\n')}`,
    );
  } finally {
    db.close();
  }
});
