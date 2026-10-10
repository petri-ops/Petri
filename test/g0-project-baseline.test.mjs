import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'petri-g0-lf0-'));
process.env.PETRI_DB_PATH = join(tempRoot, 'g0-lf0.db');
process.env.PETRI_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

// BLOCK-49 加映清债 —— 应用全量 migrations
{
  const _cr = createRequire(import.meta.url);
  const Database = _cr(resolve(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of _cr('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = _cr('node:fs').readFileSync(_cr('node:path').resolve(migDir, f), 'utf8');
    try {
      boot.exec(sql);
    } catch (e) {
      if (!/already exists|duplicate column/i.test(e.message)) throw e;
    }
  }
  boot.close();
}
const require = createRequire(import.meta.url);

const db = require('../core/petri-server/db');
const g0 = require('../core/shared-backend/g0-baseline');
const { resolveProjectRunLayout } = require('../core/shared-backend/project-run-layout');
const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools');

after(() => {
  try {
    if (db.db?.open) db.db.close();
  } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
});

test('new projects persist the current creating and opening G0 baseline identity', () => {
  const workspacePath = join(tempRoot, 'new-project');
  const project = db.createProject({ name: 'G0 current', modality: 'bulk', workspacePath });
  const current = g0.getCurrentG0Baseline();
  assert.equal(project.g0_baseline.createdBaselineId, current.baselineId);
  assert.equal(project.g0_baseline.createdBaselineVersion, current.baselineVersion);
  assert.equal(project.g0_baseline.createdManifestDigest, current.manifestDigest);
  assert.equal(project.g0_baseline.createdBundleDigest, current.bundleDigest);
  assert.equal(project.g0_baseline.openedBaselineId, current.baselineId);
  assert.equal(project.g0_baseline.compatibilityStatus, 'compatible');
  assert.equal(project.g0_baseline.executionAllowed, true);

  const stored = db.db.prepare('SELECT * FROM project_g0_baselines WHERE project_id = ?').get(project.id);
  assert.equal(stored.record_version, 1);
  assert.equal(stored.created_baseline_id, current.baselineId);
  assert.equal(stored.created_bundle_digest, current.bundleDigest);
  assert.equal(stored.compatibility_status, 'compatible');
});

test('legacy projects receive an explicit unknown creator identity on first open', () => {
  const id = 'legacy_project_fixture';
  const ts = new Date().toISOString();
  const workspacePath = join(tempRoot, 'legacy-project');
  db.db.prepare(
    `INSERT INTO projects (id, name, description, created_at, updated_at, modality, workspace_path, status)
     VALUES (?, ?, '', ?, ?, 'bulk', ?, 'active')`
  ).run(id, 'Legacy', ts, ts, workspacePath);

  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS count FROM project_g0_baselines WHERE project_id = ?').get(id).count,
    0,
  );
  const project = db.getProject(id);
  assert.equal(project.g0_baseline.createdBaselineId, g0.LEGACY_BASELINE_ID);
  assert.equal(project.g0_baseline.createdBaselineVersion, null);
  assert.equal(project.g0_baseline.compatibilityStatus, 'compatible');
  assert.equal(project.g0_baseline.compatibilityReason, 'legacy_unversioned_adopted');
  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS count FROM project_g0_baselines WHERE project_id = ?').get(id).count,
    1,
  );
});

test('opening the same compatible baseline is idempotent', () => {
  const project = db.createProject({
    name: 'Idempotent',
    modality: 'general',
    workspacePath: join(tempRoot, 'idempotent-project'),
  });
  const first = db.getProjectG0Baseline(project.id);
  const second = db.getProjectG0Baseline(project.id);
  assert.deepEqual(second, first);
  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS count FROM project_g0_baselines WHERE project_id = ?').get(project.id).count,
    1,
  );
});

test('future-baseline projects remain readable but formal layouts and writes are blocked', async () => {
  const workspacePath = join(tempRoot, 'future-project');
  const project = db.createProject({ name: 'Future', modality: 'bulk', workspacePath });
  writeFileSync(join(workspacePath, 'existing.txt'), 'readable');
  db.db.prepare(
    `UPDATE project_g0_baselines SET
      created_baseline_id = ?,
      created_baseline_version = ?,
      created_manifest_digest = ?
     WHERE project_id = ?`
  ).run('g0-future-2', '2.0.0', 'f'.repeat(64), project.id);

  const reopened = db.getProject(project.id);
  assert.equal(reopened.g0_baseline.compatibilityStatus, 'blocked');
  assert.equal(reopened.g0_baseline.compatibilityReason, 'future_baseline_unsupported');
  assert.equal(reopened.g0_baseline.executionAllowed, false);

  assert.throws(
    () => resolveProjectRunLayout({
      projectId: project.id,
      toolJobId: 'job_future',
      db,
      skipPermissionCheck: true,
    }),
    /future_baseline_unsupported/,
  );

  const tools = createWorkspaceTools({ dbProvider: () => db });
  const read = await tools.readFile({ path: 'existing.txt' }, {
    projectId: project.id,
    userId: 'local-user',
    accessMode: 'full',
  });
  assert.equal(read.ok, true);
  assert.equal(read.content, 'readable');

  const write = await tools.writeFile({ path: 'new.txt', content: 'blocked' }, {
    projectId: project.id,
    userId: 'local-user',
    accessMode: 'full',
  });
  assert.equal(write.ok, false);
  assert.equal(write.error, 'project_g0_baseline_incompatible');
});

test('deleting a project deletes its G0 identity record', () => {
  const project = db.createProject({
    name: 'Delete baseline',
    modality: 'general',
    workspacePath: join(tempRoot, 'delete-project'),
  });
  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS count FROM project_g0_baselines WHERE project_id = ?').get(project.id).count,
    1,
  );
  db.deleteProject(project.id);
  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS count FROM project_g0_baselines WHERE project_id = ?').get(project.id).count,
    0,
  );
});

test('an earlier LF0 project baseline table upgrades idempotently and backfills exact identities', () => {
  const migrationDbPath = join(tempRoot, 'g0-lf0-old-schema.db');
  const Database = require('../core/petri-server/node_modules/better-sqlite3');
  const migrationDb = new Database(migrationDbPath);
  // migrationDb 需有 projects 表（spawn 子进程的 agent-task-store schema 检查）
  migrationDb.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT,
    updated_at TEXT,
    modality TEXT,
    workspace_path TEXT,
    status TEXT DEFAULT 'active',
    g0_baseline_id TEXT,
    g0_baseline_version TEXT,
    g0_baseline_manifest_digest TEXT
  )`);
  const current = g0.getCurrentG0Baseline();
  migrationDb.exec(`CREATE TABLE project_g0_baselines (
    project_id TEXT PRIMARY KEY,
    record_version INTEGER NOT NULL,
    created_baseline_id TEXT NOT NULL,
    created_baseline_version TEXT,
    created_manifest_digest TEXT,
    opened_baseline_id TEXT NOT NULL,
    opened_baseline_version TEXT NOT NULL,
    opened_manifest_digest TEXT NOT NULL,
    compatibility_status TEXT NOT NULL,
    compatibility_reason TEXT NOT NULL,
    first_recorded_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
  )`);
  migrationDb.prepare(
    `INSERT INTO project_g0_baselines VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'compatible', 'current_baseline', ?, ?)`,
  ).run(
    'old_schema_project',
    current.baselineId,
    current.baselineVersion,
    current.manifestDigest,
    current.baselineId,
    current.baselineVersion,
    current.manifestDigest,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  migrationDb.close();

  const probe = spawnSync(
    process.execPath,
    ['-e', `
      const db = require('./core/petri-server/db');
      const columns = db.db.prepare('PRAGMA table_info(project_g0_baselines)').all().map((item) => item.name);
      const row = db.db.prepare('SELECT * FROM project_g0_baselines WHERE project_id = ?').get('old_schema_project');
      process.stdout.write(JSON.stringify({ columns, row }));
      db.db.close();
    `],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PETRI_DB_PATH: migrationDbPath,
        PETRI_LOCAL_DATA_DIR: join(tempRoot, 'old-schema-local-data'),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.ok(result.columns.includes('created_bundle_digest'));
  assert.ok(result.columns.includes('opened_bundle_digest'));
  assert.equal(result.row.created_bundle_digest, current.bundleDigest);
  assert.equal(result.row.opened_bundle_digest, current.bundleDigest);
});
