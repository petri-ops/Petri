import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { sha256 } = require('../core/shared-backend/result-revision-source');
const {
  ResultReplayError,
  createControlledReplayService,
} = require('../core/shared-backend/result-replay-service');

function fixture(context, runChangeSet) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-controlled-replay-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const sqlite = new Database(join(workspaceRoot, 'replay.db'));
  context.after(() => sqlite.close());
  ensureResultStudioSchema(sqlite);
  const repository = createResultStudioRepository(sqlite, { ensureSchema: false });
  const binding = bindProjectRepository({ workspaceRoot, projectId: 'p_1' });
  const inputPath = join(workspaceRoot, 'inputs', 'counts.csv');
  const outputPath = join(workspaceRoot, 'results', 'jobs', 'job_1', 'output', 'table.csv');
  mkdirSync(join(inputPath, '..'), { recursive: true });
  mkdirSync(join(outputPath, '..'), { recursive: true });
  writeFileSync(inputPath, 'gene,s1\nA,1\n');
  writeFileSync(outputPath, 'gene,score\nA,2\n');
  const inputHash = sha256('gene,s1\nA,1\n');
  const outputHash = sha256('gene,score\nA,2\n');
  const source = 'message("controlled replay")\n';
  const normalized = { alpha: 0.05, counts: { inputRef: 'inputs/counts.csv', sha256: inputHash } };
  const parameters = `${JSON.stringify(normalized, null, 2)}\n`;
  const sourcePath = 'analysis/scripts/family_1/rev_1/table.R';
  const parametersPath = 'analysis/scripts/family_1/rev_1/parameters.json';
  const committed = binding.adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/replay-source', expectedOld: '0'.repeat(40), message: 'replay source',
    files: [{ path: sourcePath, content: source }, { path: parametersPath, content: parameters }],
  });
  repository.createChangeSet({
    changeSetId: 'cs_1', projectId: 'p_1', baseCommit: committed.commit,
    workingBranchRef: 'refs/heads/biof3/replay-source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_1', to: 'running' });
  repository.transitionChangeSet({ changeSetId: 'cs_1', to: 'preview_ready', candidateCommit: committed.commit });
  repository.appendRevision({
    revisionId: 'rev_1', projectId: 'p_1', artifactFamilyId: 'family_1', artifactId: 'table',
    sourceCommit: committed.commit,
    sourceScriptRef: {
      relativePath: sourcePath, sha256: sha256(source), entryPoint: 'table.R', artifactId: 'table',
      rendererId: 'deseq2:table', language: 'r', origin: 'project_materialized',
    },
    inputArtifactRefs: [{ artifactId: 'counts', hash: inputHash, role: 'counts' }],
    parametersRef: parametersPath, parametersHash: sha256(parameters), toolJobId: 'job_1',
    outputPath: 'results/jobs/job_1/output/table.csv', outputHash,
    validationStatus: 'valid', reproducibilityStatus: 'verified', changeSetId: 'cs_1',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_1', candidateCommit: committed.commit });
  const job = {
    id: 'job_1', project_id: 'p_1', tool_id: 'deseq2', status: 'completed',
    params: { alpha: 0.05, counts: inputPath },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'table', type: 'table', path: outputPath }],
      executionProvenance: {
        toolJobId: 'job_1', projectId: 'p_1',
        plugin: { id: 'deseq2', version: '1.2.3', language: 'r', packageConstraints: {} },
        runtime: { name: 'R', version: '4.5.2', readiness: true },
        params: { normalized, sha256: sha256(JSON.stringify(normalized)) },
        inputs: [{ id: 'counts', role: 'counts', relativePath: 'inputs/counts.csv', sha256: inputHash }],
        script: { snapshotPath: join(workspaceRoot, 'run.R'), sha256: sha256(source), entryPoint: 'run.R' },
        artifacts: [{ id: 'table', filename: 'table.csv', sha256: outputHash }],
      },
    },
  };
  const dependencies = {
    repository,
    adapter: binding.adapter,
    gitPathPrefix: '',
    workspaceRoot,
    getToolJob: (id) => id === job.id ? job : null,
    getPlugin: (id) => id === 'deseq2' ? { id, version: '1.2.3', language: 'r' } : null,
    executeJob: async () => { throw new Error('fake ChangeSet must own execution'); },
  };
  const service = createControlledReplayService({
    makeToken: () => 'rrc_test',
    createResultChangeSet: runChangeSet,
  });
  const request = {
    projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
    contextToken: 'c'.repeat(64), expectedSourceSha256: sha256(source),
    expectedParametersHash: sha256(parameters),
  };
  return { workspaceRoot, repository, service, dependencies, request, inputPath };
}

test('controlled replay rejects caller-authored execution material and requires explicit confirmation', async (context) => {
  const calls = [];
  const fx = fixture(context, async (input) => {
    calls.push(input);
    return {
      ok: true, adopted: false, toolJobId: 'job_2', changeSet: { changeSetId: 'cs_2' },
      revision: { revisionId: 'rev_2', parentRevisionIds: ['rev_1'] },
    };
  });
  assert.throws(
    () => fx.service.prepare({ ...fx.request, workflowPlan: { nodes: [] } }, fx.dependencies),
    (error) => error instanceof ResultReplayError && error.code === 'replay_request_field_not_allowed',
  );
  const prepared = fx.service.prepare(fx.request, fx.dependencies);
  assert.equal(prepared.status, 'confirmation_required');
  assert.equal(prepared.execution.acceptsWorkflowPlan, false);
  assert.equal(prepared.execution.acceptsShell, false);
  assert.equal(prepared.execution.mutatesCurrentRevision, false);
  assert.equal(calls.length, 0, 'preflight must not create a Job or ChangeSet');

  const confirmed = await fx.service.confirm({
    projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
    contextToken: 'c'.repeat(64), confirmationToken: prepared.confirmationToken,
  }, fx.dependencies);
  assert.equal(confirmed.status, 'preview_ready');
  assert.equal(confirmed.adopted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].intent.editClass, 'scientific_recompute');
  assert.equal(calls[0].intent.requiresScientificConfirmation, true);
  assert.equal(calls[0].scientificConfirmed, true);
  assert.deepEqual(calls[0].scriptPatch, []);
  assert.equal(calls[0].sourceJob.params.counts, realpathSync(fx.inputPath));
  assert.deepEqual(calls[0].normalizedSourceParams.counts, {
    inputRef: 'inputs/counts.csv', sha256: sha256('gene,s1\nA,1\n'),
  });
  assert.equal(fx.repository.getCurrentRevision('family_1', 'p_1').revisionId, 'rev_1');
});

test('confirmation is idempotent and revalidates input bytes immediately before execution', async (context) => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fx = fixture(context, async () => {
    calls += 1;
    await gate;
    return {
      ok: true, adopted: false, toolJobId: 'job_2', changeSet: { changeSetId: 'cs_2' },
      revision: { revisionId: 'rev_2', parentRevisionIds: ['rev_1'] },
    };
  });
  const prepared = fx.service.prepare(fx.request, fx.dependencies);
  const confirm = {
    projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
    contextToken: 'c'.repeat(64), confirmationToken: prepared.confirmationToken,
  };
  const first = fx.service.confirm(confirm, fx.dependencies);
  const second = fx.service.confirm(confirm, fx.dependencies);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1, 'double confirmation must create one candidate only');
  assert.equal(a.revisionId, b.revisionId);
  const third = await fx.service.confirm(confirm, fx.dependencies);
  assert.equal(third.idempotent, true);

  const fxDrift = fixture(context, async () => { throw new Error('must not execute'); });
  const preparedDrift = fxDrift.service.prepare(fxDrift.request, fxDrift.dependencies);
  writeFileSync(fxDrift.inputPath, 'gene,s1\nA,999\n');
  await assert.rejects(
    fxDrift.service.confirm({
      projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
      contextToken: 'c'.repeat(64), confirmationToken: preparedDrift.confirmationToken,
    }, fxDrift.dependencies),
    (error) => error.code === 'source_input_drift',
  );
});

test('confirmation rejects stale context and cross-project scope', async (context) => {
  const fx = fixture(context, async () => { throw new Error('must not execute'); });
  assert.throws(
    () => fx.service.prepare(fx.request, {
      ...fx.dependencies,
      getPlugin: () => ({ id: 'deseq2', version: '9.0.0', language: 'r' }),
    }),
    (error) => error.code === 'replay_plugin_version_drift',
  );
  const prepared = fx.service.prepare(fx.request, fx.dependencies);
  await assert.rejects(
    fx.service.confirm({
      projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
      contextToken: 'd'.repeat(64), confirmationToken: prepared.confirmationToken,
    }, fx.dependencies),
    (error) => error.code === 'replay_context_stale',
  );
  await assert.rejects(
    fx.service.confirm({
      projectId: 'p_other', revisionId: 'rev_1', conversationId: 'conv_1',
      contextToken: 'c'.repeat(64), confirmationToken: prepared.confirmationToken,
    }, fx.dependencies),
    (error) => error.code === 'replay_confirmation_scope_mismatch',
  );
});
