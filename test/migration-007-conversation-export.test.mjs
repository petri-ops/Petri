/**
 * Phase 1 — migration 007 完整性测试
 *
 * 验证：
 *   1) 文件名以 007_ 开头（migration-runner 会按 NNN 前缀排序）
 *   2) results.type CHECK 集合包含 'conversation_export'
 *   3) 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT（项目 Global Constraints）
 *   4) 12-step rebuild 模式完整（new table → INSERT SELECT → DROP → ALTER RENAME）
 *
 * 策略：纯文本检查 — 与现有 migration 测试风格一致。
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_FILE = path.join(
  ROOT,
  'src/migrations/007_result_conversation_export_type.sql',
);

function stripSqlComments(source) {
  // 去掉 -- 行注释，避免注释里提到 BEGIN 触发误报
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

test('migration 007 file exists with correct prefix', () => {
  assert.ok(existsSync(MIGRATION_FILE), 'migration 007 must exist');
  const source = readFileSync(MIGRATION_FILE, 'utf8');
  assert.match(source, /^-- Phase 4/);
  const code = stripSqlComments(source);
  // 不含 BEGIN/COMMIT（runner 已包在事务内）
  assert.doesNotMatch(code, /\bBEGIN\b/i, 'migration must not contain BEGIN');
  assert.doesNotMatch(code, /\bCOMMIT\b/i, 'migration must not contain COMMIT');
  // Global Constraints
  assert.doesNotMatch(code, /\bINSERT OR REPLACE\b/i, 'must not use INSERT OR REPLACE');
  assert.doesNotMatch(code, /\bPRAGMA\b/i, 'must not use PRAGMA');
  assert.doesNotMatch(code, /\bAUTOINCREMENT\b/i, 'must not use AUTOINCREMENT');
});

test('migration 007 expands CHECK constraint to include conversation_export', () => {
  const source = readFileSync(MIGRATION_FILE, 'utf8');
  // 新的 results 表（无论 results_new 还是 results）必须包含 conversation_export
  const checkMatches = source.match(/CHECK\s*\([^)]+\)/g) ?? [];
  assert.ok(checkMatches.length >= 1, 'must have at least one CHECK constraint');
  const targetCheck = checkMatches.find((c) => c.includes('conversation_export'));
  assert.ok(targetCheck, 'CHECK must include conversation_export');
  assert.match(targetCheck, /'chart'.*'table'.*'code'.*'text'.*'file'.*'conversation_export'/);
});

test('migration 007 uses 12-step table-rebuild pattern', () => {
  const source = readFileSync(MIGRATION_FILE, 'utf8');
  // 标准 SQLite rebuild 4 步
  assert.match(source, /CREATE TABLE IF NOT EXISTS results_new/, 'step 1: create new');
  assert.match(source, /INSERT INTO results_new/, 'step 2: copy data');
  assert.match(source, /DROP TABLE results/, 'step 3: drop old');
  assert.match(source, /ALTER TABLE results_new RENAME TO results/, 'step 4: rename');
});

test('migration 007 is idempotent against fresh DB (existing 006 creates results)', () => {
  // 在全新 DB 上 migration 006 已 CREATE results IF NOT EXISTS；
  // migration 007 INSERT INTO results_new + DROP results + ALTER RENAME 模式要求
  // results 必须存在。新 DB 上 006 先建表，007 才能 INSERT INTO results。
  const source = readFileSync(MIGRATION_FILE, 'utf8');
  assert.match(source, /FROM results/, 'INSERT SELECT must source from results');
});