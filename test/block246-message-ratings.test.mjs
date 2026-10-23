/**
 * BLOCK-246 C4 — 消息评价契约测试（迁移单源 / store 语义 / HTTP 面）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block246-rate-'));
process.env.PETRI_DB_PATH = path.join(sandbox, 'block246-rate.db');
process.env.PETRI_LOCAL_DATA_DIR = sandbox;

const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(REPO_ROOT, 'src', 'migrations'));

const {
  MESSAGE_RATING_MIGRATION_VERSION,
  buildMessageRatingMigrationSql,
  ensureMessageRatingSchema,
  inspectMessageRatingSchema,
} = require('../core/shared-backend/message-rating-schema');
const {
  MAX_MESSAGE_RATING_REASON_CHARS,
  createMessageRatingStore,
} = require('../core/shared-backend/message-rating-store');

const sqlite = require('../core/petri-server/db').db;

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // Windows 偶发句柄残留不影响结果
  }
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // 同上
  }
});

test('017 migration file matches the schema builder byte for byte', () => {
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, 'src', 'migrations', '017_message_ratings.sql'), 'utf8');
  assert.equal(onDisk, buildMessageRatingMigrationSql());
  assert.equal(MESSAGE_RATING_MIGRATION_VERSION, 17);
});

test('017 migration avoids constructs the runner forbids', () => {
  const sql = buildMessageRatingMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(/^\s*BEGIN\b/im.test(sql), false);
  assert.equal(/^\s*COMMIT\b/im.test(sql), false);
  assert.equal(/INSERT\s+OR\s+REPLACE/i.test(sql), false);
  assert.equal(/\bPRAGMA\b/i.test(sql), false);
  assert.equal(/AUTOINCREMENT/i.test(sql), false);
});

test('schema is created idempotently', () => {
  ensureMessageRatingSchema(sqlite);
  ensureMessageRatingSchema(sqlite);
  assert.equal(inspectMessageRatingSchema(sqlite).complete, true);
});

test('set / overwrite / clear semantics with validation', () => {
  const store = createMessageRatingStore(sqlite);
  const up = store.set({ messageKey: 'k1', rating: 'up', conversationId: 'c1', projectId: 'p1' });
  assert.equal(up.ok, true);
  assert.equal(up.rating.rating, 'up');
  assert.equal(up.rating.conversationId, 'c1');

  const down = store.set({ messageKey: 'k1', rating: 'down', reason: '编造了参数' });
  assert.equal(down.rating.rating, 'down');
  assert.equal(down.rating.reason, '编造了参数');
  // 覆盖不新增行（同一 messageKey 只有一行）
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM message_ratings').get().n;
  assert.equal(count, 1);

  assert.equal(store.set({ messageKey: 'k1', rating: 'meh' }).ok, false);
  assert.match(store.set({ messageKey: 'k1', rating: 'meh' }).error, /评价取值不支持/);
  assert.equal(store.set({ rating: 'up' }).ok, false);
  assert.match(
    store.set({ messageKey: 'k1', rating: 'up', reason: 'x'.repeat(MAX_MESSAGE_RATING_REASON_CHARS + 1) }).error,
    /评价理由过长/,
  );

  store.set({ messageKey: 'k1', rating: null });
  assert.equal(store.get('k1'), null);
});

test('HTTP: PUT upserts, reads back, and rejects invalid ratings', async () => {
  const express = require('express');
  const app = express();
  require('../core/petri-server/routes/message-ratings')(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const put = await fetch(`${base}/api/message-ratings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageKey: 'http-1', rating: 'down', reason: '跑偏了' }),
    });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).rating.rating, 'down');

    const got = await fetch(`${base}/api/message-ratings/http-1`);
    assert.equal(got.status, 200);
    assert.equal((await got.json()).rating.reason, '跑偏了');

    const bad = await fetch(`${base}/api/message-ratings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageKey: 'http-1', rating: 'sideways' }),
    });
    assert.equal(bad.status, 400);

    const missing = await fetch(`${base}/api/message-ratings/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
