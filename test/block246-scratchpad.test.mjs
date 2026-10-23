/**
 * BLOCK-246 C13 — 速记板（scratchpad）契约测试。
 *
 * 三层各钉一遍：
 * 1. 迁移单源：`016_scratchpad.sql` 必须与 `scratchpad-schema.js` 的 build 函数逐字节一致
 *    （禁止手改 .sql 造成第二真相），且不含 runner 禁止的构造。
 * 2. store 语义：上限/清洗/搜索转义/排序分页/删除。
 * 3. HTTP 面：201/400/204/404 与错误文案透传（真实 express + fetch，不起 electron）。
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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block246-'));
process.env.PETRI_DB_PATH = path.join(sandbox, 'block246.db');
process.env.PETRI_LOCAL_DATA_DIR = sandbox;

const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(REPO_ROOT, 'src', 'migrations'));

const {
  SCRATCHPAD_MIGRATION_VERSION,
  buildScratchpadMigrationSql,
  ensureScratchpadSchema,
  inspectScratchpadSchema,
} = require('../core/shared-backend/scratchpad-schema');
const {
  MAX_SCRATCHPAD_TEXT_CHARS,
  MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS,
  MAX_SCRATCHPAD_LIST_LIMIT,
  createScratchpadStore,
  escapeLike,
} = require('../core/shared-backend/scratchpad-store');

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

// ---------------------------------------------------------------------------
// 1. 迁移单源
// ---------------------------------------------------------------------------

test('016 migration file matches the schema builder byte for byte', () => {
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, 'src', 'migrations', '016_scratchpad.sql'), 'utf8');
  assert.equal(onDisk, buildScratchpadMigrationSql());
  assert.equal(SCRATCHPAD_MIGRATION_VERSION, 16);
});

test('016 migration avoids constructs the runner forbids', () => {
  const sql = buildScratchpadMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(/^\s*BEGIN\b/im.test(sql), false);
  assert.equal(/^\s*COMMIT\b/im.test(sql), false);
  assert.equal(/INSERT\s+OR\s+REPLACE/i.test(sql), false);
  assert.equal(/\bPRAGMA\b/i.test(sql), false);
  assert.equal(/AUTOINCREMENT/i.test(sql), false);
});

test('ensureScratchpadSchema is idempotent and inspect reports completeness', () => {
  assert.deepEqual(ensureScratchpadSchema(sqlite).tables, ['scratchpad_entries']);
  assert.deepEqual(ensureScratchpadSchema(sqlite).tables, ['scratchpad_entries']);
  const inspected = inspectScratchpadSchema(sqlite);
  assert.equal(inspected.complete, true);
  assert.deepEqual(inspected.missing, []);
});

// ---------------------------------------------------------------------------
// 2. store 语义
// ---------------------------------------------------------------------------

test('create stores an entry with source and returns it', () => {
  const store = createScratchpadStore(sqlite);
  const result = store.create({
    kind: 'text',
    title: 'PCA 笔记',
    body: '  scale=True 之后再 subset  ',
    sourceKind: 'conversation',
    sourceRef: 'conv_123',
    projectId: 'proj_1',
  });
  assert.equal(result.ok, true);
  assert.match(result.entry.entryId, /^scr_/);
  assert.equal(result.entry.title, 'PCA 笔记');
  assert.equal(result.entry.body, '  scale=True 之后再 subset  ');
  assert.equal(result.entry.sourceKind, 'conversation');
  assert.equal(result.entry.sourceRef, 'conv_123');
  assert.equal(result.entry.contractVersion, 1);
  assert.equal(store.get(result.entry.entryId).entryId, result.entry.entryId);
});

test('create rejects empty body / unknown kind / unknown source with readable reasons', () => {
  const store = createScratchpadStore(sqlite);
  assert.deepEqual(store.create({ body: '   ' }), { ok: false, error: '速记内容为空' });
  assert.equal(store.create({ kind: 'video', body: 'x' }).ok, false);
  assert.match(store.create({ kind: 'video', body: 'x' }).error, /速记类型不支持/);
  assert.match(store.create({ body: 'x', sourceKind: 'telepathy' }).error, /速记来源不支持/);
});

test('text over the cap is rejected instead of silently truncated', () => {
  const store = createScratchpadStore(sqlite);
  const tooLong = 'a'.repeat(MAX_SCRATCHPAD_TEXT_CHARS + 1);
  const result = store.create({ body: tooLong });
  assert.equal(result.ok, false);
  assert.match(result.error, /速记过长/);
  assert.match(result.error, new RegExp(String(MAX_SCRATCHPAD_TEXT_CHARS)));
  // 边界：恰好等于上限必须通过（码点计数，不是字节数）
  const exact = store.create({ body: 'a'.repeat(MAX_SCRATCHPAD_TEXT_CHARS) });
  assert.equal(exact.ok, true);
});

test('image entries must be a data/http url and respect the size cap', () => {
  const store = createScratchpadStore(sqlite);
  assert.equal(store.create({ kind: 'image', body: 'not-a-url' }).ok, false);
  assert.equal(store.create({ kind: 'image', body: 'data:image/png;base64,AAAA' }).ok, true);
  assert.equal(store.create({ kind: 'image', body: 'https://example.test/a.png' }).ok, true);
  const huge = `data:image/png;base64,${'A'.repeat(MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS)}`;
  const result = store.create({ kind: 'image', body: huge });
  assert.equal(result.ok, false);
  assert.match(result.error, /图片过大/);
});

test('title over the cap is clipped with an ellipsis (title is a label, not the asset)', () => {
  const store = createScratchpadStore(sqlite);
  const result = store.create({ body: 'x', title: 'T'.repeat(200) });
  assert.equal(result.ok, true);
  assert.equal(result.entry.title.endsWith('…'), true);
  assert.equal(Array.from(result.entry.title).length, 121);
});

test('search matches body and title, and LIKE wildcards are escaped', () => {
  const store = createScratchpadStore(sqlite);
  store.create({ kind: 'text', title: '差异表达', body: 'DESeq2 的 padj 阈值' });
  store.create({ kind: 'text', title: 'percent', body: '留空' });

  const hit = store.list({ query: 'DESeq2' });
  assert.equal(hit.total, 1);
  assert.equal(hit.entries[0].title, '差异表达');

  const byTitle = store.list({ query: '差异' });
  assert.equal(byTitle.total >= 1, true);

  // `%` 是字面量：桌上只有一条正文含 `%`（percent 那条标题不含）；不得命中全表
  store.create({ kind: 'text', body: '完成度 90%' });
  const percent = store.list({ query: '%' });
  assert.equal(percent.total, 1);
  assert.equal(percent.entries[0].body.includes('%'), true);
  assert.equal(escapeLike('a%b_c\\d'), 'a\\%b\\_c\\\\d');
});

test('list is newest-first, clamps the page size, and pages by offset', () => {
  const store = createScratchpadStore(sqlite);
  for (let i = 0; i < 5; i += 1) {
    store.create({ kind: 'text', body: `分页样本 ${i}` });
  }
  const firstPage = store.list({ limit: 2 });
  assert.equal(firstPage.entries.length, 2);
  assert.equal(firstPage.limit, 2);
  const secondPage = store.list({ limit: 2, offset: 2 });
  assert.notEqual(firstPage.entries[0].entryId, secondPage.entries[0].entryId);

  const clamped = store.list({ limit: 999 });
  assert.equal(clamped.limit, MAX_SCRATCHPAD_LIST_LIMIT);
  // created_at 降序（同毫秒时 entry_id 兜底，仍必须是稳定序）
  const all = store.list({ limit: MAX_SCRATCHPAD_LIST_LIMIT }).entries;
  for (let i = 1; i < all.length; i += 1) {
    assert.equal(all[i - 1].createdAt >= all[i].createdAt, true);
  }
});

test('remove reports whether anything was deleted', () => {
  const store = createScratchpadStore(sqlite);
  const created = store.create({ body: '待删除' });
  assert.equal(store.remove(created.entry.entryId), true);
  assert.equal(store.remove(created.entry.entryId), false);
  assert.equal(store.get(created.entry.entryId), null);
});

// ---------------------------------------------------------------------------
// 3. HTTP 面
// ---------------------------------------------------------------------------

async function withServer(run) {
  const express = require('express');
  const app = express();
  // 路由自带 express.json（与生产一致）；此处再加一层会二次消费请求流 → 500。
  require('../core/petri-server/routes/scratchpad')(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('HTTP: create → list → delete round-trip with honest error codes', async () => {
  await withServer(async (base) => {
    const created = await fetch(`${base}/api/scratchpad`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '来自路由的速记', title: '路由', sourceKind: 'file', sourceRef: 'a/b.txt' }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.entry.sourceRef, 'a/b.txt');

    const listed = await fetch(`${base}/api/scratchpad?query=${encodeURIComponent('路由')}&limit=5`);
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.equal(listedBody.ok, true);
    assert.equal(listedBody.entries.some((entry) => entry.entryId === createdBody.entry.entryId), true);

    const rejected = await fetch(`${base}/api/scratchpad`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, '速记内容为空');

    const removed = await fetch(`${base}/api/scratchpad/${createdBody.entry.entryId}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);

    const removedAgain = await fetch(`${base}/api/scratchpad/${createdBody.entry.entryId}`, { method: 'DELETE' });
    assert.equal(removedAgain.status, 404);
  });
});
