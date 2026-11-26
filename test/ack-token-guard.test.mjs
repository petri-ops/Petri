/**
 * harness M1（owner msg_8640320d302e）：ack_token 并发保护——唯一索引 + CAS。
 * HK-01：唯一索引幂等创建 + ack 更新带状态条件（并发重入返回 null）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const schema = fs.readFileSync(path.join(ROOT, 'core/petri-server/db/schema.js'), 'utf8');
const db = fs.readFileSync(path.join(ROOT, 'core/petri-server/db.js'), 'utf8');

test('HK-01-1：ack_token 唯一索引（部分索引、NULL 不冲突、幂等）', () => {
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS[^\n]*ack_token[^\n]*WHERE ack_token IS NOT NULL/);
});

test('HK-01-2：ackToolJob approve 带 CAS 条件（ack_status IS NULL）', () => {
  const at = db.indexOf('function ackToolJob(');
  const fn = db.slice(at, at + 900);
  assert.match(fn, /UPDATE tool_jobs SET ack_status=\? WHERE id=\? AND ack_status IS NULL/);
  assert.match(fn, /\.changes/);
  assert.match(fn, /return null/);
});

test('HK-01-3：迁移前备份说明在场（不静默改生产 DB）', () => {
  assert.match(schema, /备份|backup/);
  assert.match(schema, /ack_token/);
});
