import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-g0-lf0-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'g0-lf0.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');
const require = createRequire(import.meta.url);
const db = require('../core/r-server/db');
const g0 = require('../core/shared-backend/g0-baseline');
const { resolveProjectRunLayout } = require('../core/shared-backend/project-run-layout');
const { createWorkspaceTools } = require('../core/r-server/agent-tools/workspace-tools');

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
  ).run('g0-future-1', '1.0.0', 'f'.repeat(64), project.id);

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
