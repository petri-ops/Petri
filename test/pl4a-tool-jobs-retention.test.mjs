// PL-4a — tool_jobs retention 契约测试：终态+90 天窗口删除；活跃/终态外永不删；
// is_public 与 demo 双保护；全局 job 目录级联清；目录缺失不炸。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const Database = nodeRequire('../core/petri-server/node_modules/better-sqlite3');
const { runRetentionSweep } = nodeRequire('../core/petri-server/jobs/retention-sweeper.js');
const { PUBLIC_DEMO_JOB_IDS } = nodeRequire('../core/petri-server/helpers/tools-assets.js');

const DAY = 24 * 60 * 60 * 1000;

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pl4a-retention-'));
  const db = new Database(join(dir, 't.db'));
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, params_json TEXT,
    status TEXT, created_at INTEGER, name TEXT, is_test_run INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0, result_json TEXT, completed_at INTEGER,
    error TEXT, conversation_id TEXT, ack_status TEXT, ack_error TEXT,
    ack_decided_by TEXT, ack_decided_at TEXT, project_id TEXT,
    process_pid INTEGER, heartbeat_at INTEGER, execution_target_id TEXT
  )`);
  db.exec('CREATE TABLE copilot_messages (id INTEGER PRIMARY KEY, ts TEXT, conversation_id TEXT)');
  db.exec('CREATE TABLE copilot_conversations (id TEXT PRIMARY KEY, status TEXT)');
  // loop 表桩（sweeper 顺序扫描需要它们存在）
  for (const t of ['loop_runs', 'loop_iterations', 'loop_actions', 'loop_evidence', 'loop_decisions', 'loop_state_snapshots']) {
    db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY)`);
  }
  db.exec('CREATE TABLE loop_runs_extra (loop_run_id TEXT)');
  return { db, dir };
}

function insertJob(db, { id, status, completedAt, isPublic = 0, projectId = null }) {
  db.prepare('INSERT INTO tool_jobs (id, status, created_at, completed_at, is_public, project_id) VALUES (?,?,?,?,?,?)')
    .run(id, status, Date.now(), completedAt, isPublic, projectId);
}

test('终态+超窗删除并级联清目录；活跃与终态外永不删', () => {
  const { db, dir } = makeDb();
  const jobsDir = join(dir, 'tool-jobs');
  mkdirSync(join(jobsDir, 'tj_old'), { recursive: true });
  writeFileSync(join(jobsDir, 'tj_old', 'out.png'), 'x');
  insertJob(db, { id: 'tj_old', status: 'completed', completedAt: Date.now() - 91 * DAY });
  insertJob(db, { id: 'tj_recent', status: 'completed', completedAt: Date.now() - 10 * DAY });
  insertJob(db, { id: 'tj_running', status: 'running', completedAt: Date.now() - 300 * DAY });
  insertJob(db, { id: 'tj_pending', status: 'pending', completedAt: null });

  const report = runRetentionSweep({ db, jobsDir });
  assert.equal(report.deleted.tool_jobs, 1, `只删超窗终态，实际 ${JSON.stringify(report.deleted)}`);
  assert.equal(report.deleted.tool_jobs_dirs, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tool_jobs WHERE id=?').get('tj_old').n, 0);
  for (const keep of ['tj_recent', 'tj_running', 'tj_pending']) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tool_jobs WHERE id=?').get(keep).n, 1, `${keep} 必须保留`);
  }
  assert.equal(existsSync(join(jobsDir, 'tj_old')), false, 'job 目录级联清除');
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('is_public 与 demo 双保护：超窗终态也不删', () => {
  const { db, dir } = makeDb();
  const demoId = [...PUBLIC_DEMO_JOB_IDS][0] || 'demo_job';
  insertJob(db, { id: 'tj_public', status: 'completed', completedAt: Date.now() - 300 * DAY, isPublic: 1 });
  insertJob(db, { id: demoId, status: 'completed', completedAt: Date.now() - 300 * DAY });
  const report = runRetentionSweep({ db, jobsDir: join(dir, 'tool-jobs') });
  assert.equal(report.deleted.tool_jobs, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tool_jobs').get().n, 2);
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('目录缺失不炸（行照删、dirs=0）；单表失败不毒化其它表', () => {
  const { db, dir } = makeDb();
  insertJob(db, { id: 'tj_nodir', status: 'failed', completedAt: Date.now() - 200 * DAY });
  const report = runRetentionSweep({ db, jobsDir: join(dir, 'tool-jobs') });
  assert.equal(report.deleted.tool_jobs, 1);
  assert.equal(report.deleted.tool_jobs_dirs, 0);
  assert.equal(report.failures.filter((f) => f.table === 'tool_jobs').length, 0);
  db.close(); rmSync(dir, { recursive: true, force: true });
});
