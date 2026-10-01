// PL-4b — 结果治理端点契约测试：batch-delete 终态门/保护面/逐条结果/目录级联；
// storage-summary 形状；export 空 ids fail-closed + zip 流。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const nodeRequire = createRequire(import.meta.url);
const Database = nodeRequire('../core/biof3-server/node_modules/better-sqlite3');
const { createToolsPlatformRoutes } = nodeRequire('../core/biof3-server/routes/tools-platform.js');
const { PUBLIC_DEMO_JOB_IDS } = nodeRequire('../core/biof3-server/helpers/tools-assets.js');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pl4b-governance-'));
  const db = new Database(join(dir, 't.db'));
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, params_json TEXT,
    status TEXT, created_at INTEGER, name TEXT, is_test_run INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0, result_json TEXT, completed_at INTEGER,
    error TEXT, conversation_id TEXT, ack_status TEXT, ack_error TEXT,
    ack_decided_by TEXT, ack_decided_at TEXT, project_id TEXT,
    process_pid INTEGER, heartbeat_at INTEGER, execution_target_id TEXT
  )`);
  return { db, dir };
}

function makeApp(db, jobsDir) {
  const app = express();
  const removed = [];
  const register = createToolsPlatformRoutes({
    db,
    jobsDir,
    canAccessToolJob: () => true,
    isCancellableJob: (job) => ['pending', 'running'].includes(job.status),
    cleanupLocalToolJobDir: (id) => { removed.push(id); return { removed: true }; },
  });
  register(app);
  return { app, removed };
}

test('batch-delete：终态删/活跃拒/公开拒/缺失报 not_found，逐条结果', async () => {
  const { db, dir } = makeFixture();
  const jobsDir = join(dir, 'tool-jobs'); mkdirSync(jobsDir, { recursive: true });
  const { app, removed } = makeApp(db, jobsDir);
  db.prepare('INSERT INTO tool_jobs (id, status, completed_at) VALUES (?,?,?)').run('tj_done', 'done', Date.now());
  db.prepare('INSERT INTO tool_jobs (id, status, completed_at) VALUES (?,?,?)').run('tj_failed', 'failed', Date.now());
  db.prepare('INSERT INTO tool_jobs (id, status) VALUES (?,?)').run('tj_running', 'running');
  db.prepare('INSERT INTO tool_jobs (id, status, is_public) VALUES (?,?,1)').run('tj_public', 'done');
  const demoId = [...PUBLIC_DEMO_JOB_IDS][0];
  if (demoId) db.prepare('INSERT INTO tool_jobs (id, status, completed_at) VALUES (?,?,?)').run(demoId, 'done', Date.now());

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const resp = await fetch(`${base}/api/tools/jobs/batch-delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ['tj_done', 'tj_failed', 'tj_running', 'tj_public', 'tj_missing', demoId].filter(Boolean) }),
  });
  const data = await resp.json();
  assert.equal(resp.status, 200);
  assert.equal(data.deleted, 2);
  const by = Object.fromEntries(data.results.map((r) => [r.id, r.error || 'ok']));
  assert.equal(by.tj_done, 'ok');
  assert.equal(by.tj_failed, 'ok');
  assert.equal(by.tj_running, 'job_not_terminal');
  assert.equal(by.tj_public, 'cannot_delete_public_demo');
  assert.equal(by.tj_missing, 'not_found');
  if (demoId) assert.equal(by[demoId], 'cannot_delete_public_demo');
  assert.deepEqual(removed.sort(), ['tj_done', 'tj_failed'].sort(), '目录级联只对已删行');
  // 空 ids fail-closed
  const resp2 = await fetch(`${base}/api/tools/jobs/batch-delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [] }),
  });
  assert.equal(resp2.status, 400);
  server.close();
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('storage-summary：形状与空目录诚实回退', async () => {
  const { db, dir } = makeFixture();
  const { app } = makeApp(db, join(dir, 'tool-jobs'));
  db.prepare('INSERT INTO tool_jobs (id, status) VALUES (?,?)').run('a', 'done');
  db.prepare('INSERT INTO tool_jobs (id, status) VALUES (?,?)').run('b', 'running');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const resp = await fetch(`http://127.0.0.1:${server.address().port}/api/tools/storage-summary`);
  const data = await resp.json();
  assert.equal(resp.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.rows.done, 1);
  assert.equal(data.rows.running, 1);
  assert.equal(typeof data.disk.jobDirs, 'number');
  server.close();
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('export：空 ids fail-closed；有 ids 返回 zip 流', async () => {
  const { db, dir } = makeFixture();
  const jobsDir = join(dir, 'tool-jobs'); mkdirSync(jobsDir, { recursive: true });
  mkdirSync(join(jobsDir, 'tj_e1'), { recursive: true });
  writeFileSync(join(jobsDir, 'tj_e1', 'volcano.png'), 'pngdata');
  db.prepare('INSERT INTO tool_jobs (id, status, completed_at) VALUES (?,?,?)').run('tj_e1', 'done', Date.now());
  const { app } = makeApp(db, jobsDir);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const empty = await fetch(`${base}/api/tools/jobs/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [] }),
  });
  assert.equal(empty.status, 400);
  const resp = await fetch(`${base}/api/tools/jobs/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['tj_e1'] }),
  });
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type') || '', /zip/);
  const buf = Buffer.from(await resp.arrayBuffer());
  assert.ok(buf.length > 100, 'zip 非空');
  assert.equal(buf.slice(0, 2).toString('hex'), '504b', 'PK zip 魔数');
  server.close();
  db.close(); rmSync(dir, { recursive: true, force: true });
});
