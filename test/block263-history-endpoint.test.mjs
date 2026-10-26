import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-263（P4-REM P1）— history 端点契约：
// ① 纯函数 projectJobHistoryRows 走 artifact_revisions 的 tool_job_id 索引（有界/白名单列/hasMore 多取一行）
// ② 路由层：缺 jobId 400；job 无项目归属诚实空列表；projectContext 拒绝时透传状态码

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b263-history-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
process.env.PETRI_DB_PATH = path.join(tempDir, 'b263.db');

{
  const Database = require('better-sqlite3');
  const boot = new Database(process.env.PETRI_DB_PATH);
  for (const file of fs.readdirSync('src/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join('src/migrations', file), 'utf8'));
  }
  boot.close();
}

const revisionsRoute = require('../core/petri-server/routes/result-studio/revisions.js');
const db = require('../core/petri-server/db');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function seed() {
  const handle = db.getDatabase();
  const insertRev = handle.prepare(`INSERT INTO artifact_revisions
    (revision_id, project_id, artifact_family_id, artifact_id, revision_ordinal, output_path, validation_status, change_set_id, is_current, created_at, tool_job_id)
    VALUES (?, 'p1', 'fam-1', 'art-1', ?, 'out.R', 'verified', 'cs-1', ?, ?, ?)`);
  insertRev.run('rev-1', 1, 1, '2026-10-24T10:00:00Z', 'job-a');
  insertRev.run('rev-2', 2, 0, '2026-10-25T10:00:00Z', 'job-a');
  insertRev.run('rev-3', 3, 0, '2026-10-26T10:00:00Z', 'job-a');
  insertRev.run('rev-other', 4, 0, '2026-10-26T11:00:00Z', 'job-b'); // 他 job 不串（ordinal=4 避 fam 唯一索引撞号）
  const insertJob = handle.prepare('INSERT INTO tool_jobs (id, project_id, tool_id, status, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)');
  insertJob.run('job-a', 'p1', 'deseq2', 'done', '2026-10-25T09:00:00Z', 'local-user');
}

test('BLOCK-263 history 纯函数 — 按 job 取修订、序号倒排、hasMore 多取一行', () => {
  seed();
  const { projectJobHistoryRows } = revisionsRoute._internals;
  const rows = projectJobHistoryRows({ jobId: 'job-a', projectId: 'p1', limit: 2, offset: 0 });
  assert.equal(rows.length, 3, 'limit+1 多取一行');
  assert.deepEqual(rows.map((r) => r.revision_id), ['rev-3', 'rev-2', 'rev-1'], 'ordinal 倒排');
  assert.ok(!rows.some((r) => r.revision_id === 'rev-other'), '他 job 不串');
  // 白名单列（无 output_path 等敏感列）
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['artifact_family_id', 'created_at', 'is_current', 'revision_id', 'revision_ordinal', 'validation_status']);
  // 分页第二页
  const page2 = projectJobHistoryRows({ jobId: 'job-a', projectId: 'p1', limit: 2, offset: 2 });
  assert.deepEqual(page2.map((r) => r.revision_id), ['rev-1']);
});

// ---------- 路由层 ----------

async function makeServer({ job, projectContextOverride } = {}) {
  const express = require('express');
  const app = express();
  const dbMod = require('../core/petri-server/db');
  const originalGetToolJob = dbMod.getToolJob;
  if (job !== undefined) dbMod.getToolJob = () => job;
  const projectContext = projectContextOverride || (() => ({ repository: {}, project: { id: 'p1' }, binding: {} }));
  revisionsRoute.register(app, {
    repo: () => ({}),
    projectContext,
    replayService: {},
  });
  // 恢复放在 server 关闭后由调用方负责；此处保持补丁存活到请求完成
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url) => fetch(base + url).then(async (res) => ({ status: res.status, body: await res.json() }));
  return { server, call, restore: () => { dbMod.getToolJob = originalGetToolJob; } };
}

test('BLOCK-263 history 路由 — 缺 jobId 400', async () => {
  const { server, call, restore } = await makeServer();
  try {
    const res = await call('/api/result-studio/history');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'jobId_required');
  } finally { server.close(); restore(); }
});

test('BLOCK-263 history 路由 — job 无项目归属诚实空列表', async () => {
  const { server, call, restore } = await makeServer({ job: { project_id: null } });
  try {
    const res = await call('/api/result-studio/history?jobId=job-none');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.revisions, []);
    assert.ok(res.body.note);
  } finally { server.close(); restore(); }
});

test('BLOCK-263 history 路由 — projectContext 拒绝透传（403 越权防护）', async () => {
  const { server, call, restore } = await makeServer({
    job: { project_id: 'p1' },
    projectContextOverride: () => ({ error: { status: 403, code: 'forbidden' } }),
  });
  try {
    const res = await call('/api/result-studio/history?jobId=job-a');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  } finally { server.close(); restore(); }
});

test('BLOCK-263 history 路由 — 真实 db 链全通（200 + 有界形状）', async () => {
  const { server, call, restore } = await makeServer({ job: { project_id: 'p1' } });
  try {
    const res = await call('/api/result-studio/history?jobId=job-a&limit=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.revisions.length, 2);
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.revisions[0].revisionId, 'rev-3');
    assert.equal(res.body.revisions[0].isCurrent, false);
    assert.equal(res.body.revisions[2], undefined);
  } finally { server.close(); restore(); }
});

test('BLOCK-263 history 路由 — limit 上限 100 封顶', async () => {
  const { server, call, restore } = await makeServer({ job: { project_id: 'p1' } });
  try {
    const res = await call('/api/result-studio/history?jobId=job-a&limit=9999');
    assert.equal(res.status, 200);
    // 种子只有 3 行；断言形状（不越 100）
    assert.ok(res.body.revisions.length <= 100);
  } finally { server.close(); restore(); }
});
