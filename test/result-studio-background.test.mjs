import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const Database = require(require.resolve('better-sqlite3', {
  paths: [path.resolve('core/petri-server'), path.resolve('.')],
}));
const {
  backgroundChildForkOptions,
  closeResultStudioBackground,
  createDeduplicatedBackgroundRunner,
  runResultStudioBackground,
} = require('../core/shared-backend/result-studio-background');
const {
  ensureResultStudioSchema,
} = require('../core/shared-backend/result-studio-schema');
const {
  ensureResultRefTransactionSchema,
} = require('../core/shared-backend/result-ref-transaction-schema');
const {
  createResultStudioRepository,
} = require('../core/shared-backend/result-studio-repository');

const roots = [];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const PREVIOUS_RUNTIME_LEASE = Object.freeze({
  instanceId: '1'.repeat(32),
  startedAt: '2026-01-01T00:00:00.000Z',
});
const CURRENT_RUNTIME_LEASE = Object.freeze({
  instanceId: '2'.repeat(32),
  // Keep restart ordering independent of how long the preceding child-process
  // stress tests take under a loaded CI runner.
  startedAt: '2026-01-02T00:00:00.000Z',
});

test('packaged Electron background child is forced into Node mode', () => {
  const options = backgroundChildForkOptions({ P7_SENTINEL: 'preserved' }, '30.5.1');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(options.env.P7_SENTINEL, 'preserved');
  assert.deepEqual(options.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
  assert.equal(backgroundChildForkOptions({ P7_SENTINEL: 'node' }, null).env.ELECTRON_RUN_AS_NODE, undefined);
});

async function waitForReplacementGeneration(ctx, timeoutMs = 70_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await runResultStudioBackground('not-an-operation', {
        databasePath: ctx.databasePath,
        workspaceRoot: ctx.workspaceRoot,
        projectId: ctx.projectId,
      });
      assert.fail('unsupported operation unexpectedly succeeded');
    } catch (error) {
      if (error?.code === 'background_operation_invalid') return;
      if (error?.code !== 'background_generation_draining') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('timed-out canonical write did not drain within the final watchdog budget');
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-rs-background-'));
  roots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(path.join(workspaceRoot, 'results'), { recursive: true });
  const databasePath = path.join(root, 'petri.db');
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 10000');
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL
    );
    CREATE TABLE tool_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      params_json TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      project_id TEXT
    );
  `);
  ensureResultStudioSchema(sqlite);
  // Background children intentionally open the already-migrated product DB
  // without mutating its schema. Keep this fixture at the same migration
  // boundary now that lifecycle inspection reads the durable ref journal.
  ensureResultRefTransactionSchema(sqlite);
  const repository = createResultStudioRepository(sqlite, { ensureSchema: false });

  const artifactPath = path.join(workspaceRoot, 'results', 'plot.png');
  const artifactContent = Buffer.from('canonical-result-artifact');
  writeFileSync(artifactPath, artifactContent);
  const artifactHash = sha256(artifactContent);
  const scriptContent = 'print("result")\n';
  const scriptHash = sha256(scriptContent);
  const projectId = 'p_background_test';
  const jobId = 'tj_background_test';
  const result = {
    artifactTruth: { status: 'valid', blocking: false },
    artifacts: [{ id: 'plot', path: artifactPath }],
    executionProvenance: {
      script: { snapshotPath: path.join(workspaceRoot, 'script.R'), sha256: scriptHash },
      artifacts: [{ id: 'plot', sha256: artifactHash }],
      inputs: [],
      params: { normalized: { colour: 'blue' } },
    },
  };
  writeFileSync(result.executionProvenance.script.snapshotPath, scriptContent);
  sqlite.prepare('INSERT INTO projects(id, workspace_path) VALUES (?, ?)').run(projectId, workspaceRoot);
  sqlite.prepare(`
    INSERT INTO tool_jobs(id, user_id, tool_id, params_json, status, result_json, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    'local-user',
    'background-test-tool',
    JSON.stringify({ colour: 'blue' }),
    'completed',
    JSON.stringify(result),
    projectId,
  );
  const input = {
    projectId,
    workspaceRoot,
    sourceJob: {
      id: jobId,
      project_id: projectId,
      tool_id: 'background-test-tool',
      status: 'completed',
      result,
    },
    artifactId: 'plot',
    pluginId: 'background-test-tool',
    language: 'r',
    sourceScriptContent: scriptContent,
    sourceScriptSha256: scriptHash,
  };
  return {
    root,
    sqlite,
    databasePath,
    workspaceRoot,
    projectId,
    repository,
    input,
  };
}

after(() => {
  closeResultStudioBackground();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('deduplicated baseline work preserves one Git/SQLite result and is immediately visible', async () => {
  const ctx = fixture();
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const runner = createDeduplicatedBackgroundRunner(runResultStudioBackground);
  const payload = {
    databasePath: ctx.databasePath,
    workspaceRoot: ctx.workspaceRoot,
    projectId: ctx.projectId,
    input: ctx.input,
  };
  const first = runner.run('same-baseline', 'ensure-baseline', payload);
  const second = runner.run('same-baseline', 'ensure-baseline', payload);
  assert.strictEqual(first, second, 'same-key concurrent work must share one promise');
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(right, left);
  assert.equal(left.created, true);
  assert.equal(
    ctx.sqlite.prepare('select count(*) count from artifact_revisions where project_id = ?').get(ctx.projectId).count,
    1,
    'the main SQLite connection must see the child commit immediately',
  );
  assert.equal(
    ctx.sqlite.prepare('select count(*) count from git_repository_bindings where project_id = ?').get(ctx.projectId).count,
    1,
  );

  // Prove visibility in the opposite direction too: a main-connection mutation
  // must be observed by the already-running child on its next inspection.
  ctx.sqlite.prepare('update artifact_revisions set output_hash = ? where project_id = ?')
    .run('0'.repeat(64), ctx.projectId);
  const inspected = await runResultStudioBackground('inspect-workspace', {
    databasePath: ctx.databasePath,
    workspaceRoot: ctx.workspaceRoot,
    projectId: ctx.projectId,
    conversationId: null,
  });
  assert.equal(inspected.lifecycle.revisionIntegrity.intact, false);
  assert.ok(inspected.lifecycle.revisionIntegrity.issues.some((issue) => issue.kind === 'artifact_hash_drift'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  eventLoop.disable();
  assert.ok(
    eventLoop.count > 0 && eventLoop.max / 1e6 <= 250,
    `background baseline/status work blocked the event loop for ${eventLoop.max / 1e6}ms`,
  );
  ctx.sqlite.close();
});

test('timed-out canonical write drains safely and the next generation starts cleanly', async () => {
  const ctx = fixture();
  await assert.rejects(
    runResultStudioBackground('ensure-baseline', {
      databasePath: ctx.databasePath,
      workspaceRoot: ctx.workspaceRoot,
      projectId: ctx.projectId,
      input: ctx.input,
    }, { timeoutMs: 1 }),
    (error) => error && error.code === 'background_timeout',
  );

  await assert.rejects(
    runResultStudioBackground('not-an-operation', {
      databasePath: ctx.databasePath,
      workspaceRoot: ctx.workspaceRoot,
      projectId: ctx.projectId,
    }),
    (error) => error && error.code === 'background_generation_draining',
    'new work must not enter the generation completing a timed-out write',
  );
  await waitForReplacementGeneration(ctx);
  ctx.sqlite.close();
});

test('child re-reads Project and Job truth and refuses missing database files', async () => {
  const ctx = fixture();
  const stale = structuredClone(ctx.input);
  stale.sourceJob.status = 'completed';
  ctx.sqlite.prepare('update tool_jobs set status=? where id=?').run('running', stale.sourceJob.id);
  await assert.rejects(
    runResultStudioBackground('ensure-baseline', {
      databasePath: ctx.databasePath,
      workspaceRoot: ctx.workspaceRoot,
      projectId: ctx.projectId,
      input: stale,
    }),
    (error) => error && error.code === 'background_source_job_incomplete',
  );
  await assert.rejects(
    runResultStudioBackground('inspect-workspace', {
      databasePath: path.join(ctx.root, 'missing.db'),
      workspaceRoot: ctx.workspaceRoot,
      projectId: ctx.projectId,
    }),
    (error) => error && error.code === 'SQLITE_CANTOPEN',
  );
  assert.equal(
    await import('node:fs').then(({ existsSync }) => existsSync(path.join(ctx.root, 'missing.db'))),
    false,
  );
  ctx.sqlite.close();
});

test('explicit close rejects active work and permits a replacement child', async () => {
  const ctx = fixture();
  const active = runResultStudioBackground('ensure-baseline', {
    databasePath: ctx.databasePath,
    workspaceRoot: ctx.workspaceRoot,
    projectId: ctx.projectId,
    input: ctx.input,
  });
  const closing = closeResultStudioBackground();
  await assert.rejects(active, (error) => error && error.code === 'background_closed');
  await closing;
  await assert.rejects(
    runResultStudioBackground('not-an-operation', {
      databasePath: ctx.databasePath,
      workspaceRoot: ctx.workspaceRoot,
      projectId: ctx.projectId,
    }),
    (error) => error && error.code === 'background_operation_invalid',
  );
  ctx.sqlite.close();
});

test('P6 recovery runs in the canonical background child and closes incomplete restart state', async () => {
  const ctx = fixture();
  ctx.repository.createChangeSet({
    changeSetId: 'cs_background_interrupted',
    projectId: ctx.projectId,
    baseCommit: '0'.repeat(40),
    workingBranchRef: 'refs/heads/petri/changeset/cs_background_interrupted',
    createdBy: 'agent',
  });
  ctx.repository.transitionChangeSet({ changeSetId: 'cs_background_interrupted', to: 'running' });
  ctx.repository.saveCheckpoint({
    checkpointId: 'cp_background_interrupted',
    projectId: ctx.projectId,
    baseCommit: '0'.repeat(40),
    changeSetId: 'cs_background_interrupted',
    changeSetStatus: 'running',
    currentRevisionIds: [],
    pendingPreview: {
      stage: 'materialized',
      revisionIds: [],
      runtimeLease: PREVIOUS_RUNTIME_LEASE,
    },
    createdAt: '2026-01-01T00:01:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
  });

  const result = await runResultStudioBackground('recover-workspace', {
    databasePath: ctx.databasePath,
    workspaceRoot: ctx.workspaceRoot,
    projectId: ctx.projectId,
    conversationId: null,
    runtimeLease: CURRENT_RUNTIME_LEASE,
  });
  assert.equal(result.recovered, true);
  assert.equal(result.after.status, 'ready');
  assert.equal(ctx.repository.getChangeSet('cs_background_interrupted').status, 'validation_failed');
  assert.equal(ctx.repository.getCheckpoint('cp_background_interrupted').changeSetStatus, 'validation_failed');
  assert.equal(result.after.consistency.status, 'consistent');
  ctx.sqlite.close();
});

test('P6 background recovery leaves a current-runtime operation untouched', async () => {
  const ctx = fixture();
  ctx.repository.createChangeSet({
    changeSetId: 'cs_background_active',
    projectId: ctx.projectId,
    baseCommit: '0'.repeat(40),
    workingBranchRef: 'refs/heads/petri/changeset/cs_background_active',
    createdBy: 'agent',
  });
  ctx.repository.transitionChangeSet({ changeSetId: 'cs_background_active', to: 'running' });
  ctx.repository.saveCheckpoint({
    checkpointId: 'cp_background_active', projectId: ctx.projectId, baseCommit: '0'.repeat(40),
    changeSetId: 'cs_background_active', changeSetStatus: 'running', currentRevisionIds: [],
    pendingPreview: { stage: 'materialized', revisionIds: [], runtimeLease: CURRENT_RUNTIME_LEASE },
  });
  const result = await runResultStudioBackground('recover-workspace', {
    databasePath: ctx.databasePath,
    workspaceRoot: ctx.workspaceRoot,
    projectId: ctx.projectId,
    runtimeLease: CURRENT_RUNTIME_LEASE,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.after.status, 'ready');
  assert.equal(result.after.activeOperations.length, 1);
  assert.equal(ctx.repository.getChangeSet('cs_background_active').status, 'running');
  ctx.sqlite.close();
});
