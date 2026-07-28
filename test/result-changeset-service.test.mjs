import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const {
  ResultChangeSetError,
  applyExactScriptPatch,
  createResultChangeSet,
  ensureBaselineArtifactRevision,
  inspectResultEditRecovery,
  materializeResultEdit,
  sha256,
} = require('../core/shared-backend/result-changeset-service');
const { resolveResultStudioScriptOverride } = require('../core/r-server/mcp/registry')._test;

function fixture(context, suffix = '') {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `biof3-rs5-${suffix}`));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const db = new Database(join(workspaceRoot, '.rs5-test.db'));
  context.after(() => { try { db.close(); } catch { /* already closed */ } });
  ensureResultStudioSchema(db);
  const repository = createResultStudioRepository(db, { ensureSchema: false });
  const binding = bindProjectRepository({ workspaceRoot, projectId: 'p_1' });
  const adapter = binding.adapter;
  const sourceScriptContent = 'palette <- "red"\nprint("render")\n';
  const sourceParametersContent = `{\n  "deg_table": {\n    "inputRef": "inputs/deg/deg.csv",\n    "sha256": "${'e'.repeat(64)}"\n  },\n  "palette": "red"\n}\n`;
  const gitPrefix = suffix.startsWith('git-prefix-') ? 'projects/p_1/' : '';
  const base = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main',
    expectedOld: '0'.repeat(40),
    message: 'RS5 source',
    files: [
      { path: `${gitPrefix}analysis/scripts/source/plot.R`, content: sourceScriptContent },
      { path: `${gitPrefix}analysis/scripts/source/parameters.json`, content: sourceParametersContent },
    ],
  });
  const sourceOutput = join(workspaceRoot, 'results/jobs/tj_source/output/volcano.png');
  mkdirSync(join(sourceOutput, '..'), { recursive: true });
  writeFileSync(sourceOutput, 'SOURCE-ARTIFACT');
  const sourceOutputHash = sha256(readFileSync(sourceOutput));
  repository.createChangeSet({
    changeSetId: 'cs_source', projectId: 'p_1', baseCommit: base.commit,
    workingBranchRef: 'refs/heads/biof3/source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'running' });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'preview_ready', candidateCommit: base.commit });
  const sourceRevision = repository.appendRevision({
    revisionId: 'rev_source', projectId: 'p_1', artifactFamilyId: 'volcano_family',
    artifactId: 'volcano_plot', sourceCommit: base.commit,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/source/plot.R', sha256: sha256(sourceScriptContent),
      artifactId: 'volcano_plot', rendererId: 'volcano-plot:volcano_plot',
      language: 'r', origin: 'execution_snapshot',
    },
    parametersRef: 'analysis/scripts/source/parameters.json',
    parametersHash: sha256(sourceParametersContent), toolJobId: 'tj_source',
    outputPath: 'results/jobs/tj_source/output/volcano.png', outputHash: sourceOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_source', candidateCommit: base.commit });
  const sourceJob = {
    id: 'tj_source', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { deg_table: '/immutable/source.csv', palette: 'red' },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', type: 'plot', path: sourceOutput }],
      executionProvenance: {
        toolJobId: 'tj_source', projectId: 'p_1',
        params: { normalized: { deg_table: { inputRef: 'inputs/deg/deg.csv', sha256: 'e'.repeat(64) }, palette: 'red' } },
        inputs: [{ id: 'deg_table', role: 'table', relativePath: 'inputs/deg/deg.csv', sha256: 'e'.repeat(64), sourceArtifactRef: 'deg_revision_1' }],
        script: { snapshotPath: '/snapshot/run.R', sha256: sha256(sourceScriptContent) },
        artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: sourceOutputHash }],
      },
    },
  };
  const intent = {
    contractVersion: '1', intentId: 'rei_rs5',
    artifactRef: { artifactId: 'volcano_plot', revisionId: 'rev_source' },
    requestedOutcome: 'use blue palette', editClass: 'presentation_rerender',
    proposedParameterPatch: { palette: 'blue' }, affectedNodeIds: ['plot'],
    requiresJob: true, requiresScientificConfirmation: false,
    classificationReason: 'palette:presentation_rerender(declared_parameter_impact)',
  };
  return { workspaceRoot, db, repository, adapter, sourceScriptContent, sourceOutput, sourceOutputHash, sourceRevision, sourceJob, intent };
}

function successfulExecutor(fx, artifactText = 'CANDIDATE') {
  return async ({ materializedScriptPath, materializedScriptSha256, params }) => {
    assert.equal(existsSync(materializedScriptPath), true);
    assert.equal(sha256(readFileSync(materializedScriptPath)), materializedScriptSha256);
    assert.equal(params.palette, 'blue');
    const output = join(fx.workspaceRoot, `results/jobs/tj_candidate_${artifactText}/output/volcano.png`);
    mkdirSync(join(output, '..'), { recursive: true });
    writeFileSync(output, artifactText);
    const outputHash = sha256(readFileSync(output));
    return {
      job: {
        id: `tj_candidate_${artifactText}`, project_id: 'p_1', status: 'completed',
        result: {
          artifactTruth: { status: 'valid', blocking: false },
          artifacts: [{ id: 'volcano_plot', type: 'plot', path: output }],
          executionProvenance: {
            inputs: [{ id: 'deg_table', role: 'table', sha256: 'e'.repeat(64), sourceArtifactRef: 'deg_revision_1' }],
            artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: outputHash }],
          },
        },
      },
    };
  };
}

function request(fx, overrides = {}) {
  return {
    projectId: 'p_1', conversationId: 'conv_1', workspaceRoot: fx.workspaceRoot,
    intent: fx.intent, sourceRevision: fx.sourceRevision, sourceJob: fx.sourceJob,
    sourceScriptContent: fx.sourceScriptContent, sourceScriptSha256: sha256(fx.sourceScriptContent),
    pluginId: 'volcano-plot', language: 'r',
    scriptPatch: [{ oldText: 'palette <- "red"', newText: 'palette <- "blue"' }],
    createdBy: 'agent', ...overrides,
  };
}

test('RS5 registers a real Job Artifact as an idempotent current baseline', (context) => {
  const fx = fixture(context, 'baseline');
  const output = join(fx.workspaceRoot, 'results/jobs/tj_baseline/output/baseline.png');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, 'BASELINE');
  const outputHash = sha256(readFileSync(output));
  const sourceJob = {
    id: 'tj_baseline', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { palette: 'red' },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      tool: { id: 'volcano-plot', language: 'r' },
      artifacts: [{ id: 'baseline_plot', name: 'baseline.png', path: output }],
      executionProvenance: {
        params: { normalized: { palette: 'red' } },
        inputs: [],
        artifacts: [{ id: 'baseline_plot', sha256: outputHash }],
      },
    },
  };
  const first = ensureBaselineArtifactRevision({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob,
    artifactId: 'baseline_plot', pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: fx.sourceScriptContent,
    sourceScriptSha256: sha256(fx.sourceScriptContent),
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(first.created, true);
  assert.equal(first.revision.isCurrent, true);
  assert.equal(first.revision.toolJobId, 'tj_baseline');
  assert.equal(first.revision.sourceScriptRef.origin, 'project_materialized');
  assert.equal(fx.repository.getChangeSet(first.revision.changeSetId).status, 'adopted');
  assert.equal(existsSync(join(fx.workspaceRoot, first.revision.sourceScriptRef.relativePath)), false,
    'virtual baseline commit must not write the project work tree');
  const committedScript = fx.adapter.showFile({
    ref: first.revision.sourceCommit,
    filePath: first.revision.sourceScriptRef.relativePath,
  });
  assert.equal(committedScript, fx.sourceScriptContent);

  const second = ensureBaselineArtifactRevision({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob,
    artifactId: 'baseline_plot', pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: fx.sourceScriptContent,
    sourceScriptSha256: sha256(fx.sourceScriptContent),
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(second.created, false);
  assert.equal(second.revision.revisionId, first.revision.revisionId);
});

test('RS5 exact script patches reject missing and ambiguous matches', () => {
  assert.equal(applyExactScriptPatch('x=1\n', [{ oldText: 'x=1', newText: 'x=2' }]), 'x=2\n');
  assert.throws(() => applyExactScriptPatch('x=1\nx=1\n', [{ oldText: 'x=1', newText: 'x=2' }]),
    (error) => error instanceof ResultChangeSetError && error.code === 'script_patch_ambiguous');
  assert.throws(() => applyExactScriptPatch('x=1\n', [{ oldText: 'y=1', newText: 'y=2' }]),
    (error) => error.code === 'script_patch_not_found');
});

test('RS5 materialization is private, immutable, and refuses input rebinding', (context) => {
  const fx = fixture(context, 'materialize-');
  const materialized = materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_mat', revisionId: 'rev_mat',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    language: 'r', sourceScriptContent: fx.sourceScriptContent,
    expectedSourceScriptSha256: sha256(fx.sourceScriptContent),
    normalizedSourceParams: fx.sourceJob.result.executionProvenance.params.normalized,
    proposedParameterPatch: { palette: 'blue' }, scriptPatch: [], intentId: 'rei_mat',
  });
  assert.equal(existsSync(materialized.executableScriptPath), true);
  assert.equal(existsSync(join(fx.workspaceRoot, materialized.scriptRelativePath)), false);
  assert.equal(readFileSync(fx.sourceOutput, 'utf8'), 'SOURCE-ARTIFACT');
  assert.throws(() => materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_bad_input', revisionId: 'rev_bad_input',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    sourceScriptContent: fx.sourceScriptContent,
    normalizedSourceParams: fx.sourceJob.result.executionProvenance.params.normalized,
    proposedParameterPatch: { deg_table: 'other.csv' },
  }), (error) => error.code === 'artifact_input_read_only');
});

test('RS5 success creates commit, Job-backed Revision and preview without adopting it', async (context) => {
  const fx = fixture(context, 'success-');
  const events = [];
  const result = await createResultChangeSet(request(fx), {
    repository: fx.repository, adapter: fx.adapter, executeJob: successfulExecutor(fx),
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.changeSet.status, 'preview_ready');
  assert.equal(result.changeSet.validationSummary.intentSummary, 'use blue palette');
  assert.equal(result.changeSet.validationSummary.impactLevel, 'presentation_rerender');
  assert.equal(result.changeSet.validationSummary.requiresJob, true);
  assert.equal(result.changeSet.validationSummary.affectedNodeCount, 1);
  const reopenedProjection = createResultStudioRepository(fx.db, { ensureSchema: false })
    .getChangeSet(result.changeSet.changeSetId);
  assert.deepEqual(reopenedProjection.validationSummary, result.changeSet.validationSummary);
  assert.equal(result.adopted, false);
  assert.equal(result.revision.parentRevisionIds[0], 'rev_source');
  assert.equal(result.revision.toolJobId, 'tj_candidate_CANDIDATE');
  assert.equal(result.revision.sourceScriptRef.artifactId, 'volcano_plot');
  assert.equal(result.revision.sourceScriptRef.origin, 'project_materialized');
  assert.equal(result.revision.reproducibilityStatus, 'verified');
  assert.equal(fx.adapter.showFile({ ref: result.candidateCommit, filePath: result.materialization.scriptRelativePath }).includes('blue'), true);
  assert.equal(existsSync(join(fx.workspaceRoot, result.materialization.scriptRelativePath)), false);
  assert.equal(readFileSync(fx.sourceOutput, 'utf8'), 'SOURCE-ARTIFACT');
  assert.equal(sha256(readFileSync(fx.sourceOutput)), fx.sourceOutputHash);
  assert.equal(fx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  assert.equal(events.at(-1).stage, 'preview');
  const checkpoint = fx.repository.getLatestCheckpoint({ projectId: 'p_1', conversationId: 'conv_1' });
  assert.equal(checkpoint.changeSetId, result.changeSet.changeSetId);
  assert.equal(checkpoint.changeSetStatus, 'preview_ready');
  assert.equal(checkpoint.pendingPreview.stage, 'preview_ready');
  assert.deepEqual(checkpoint.pendingPreview.revisionIds, [result.revision.revisionId]);
});

test('RS5 AI and manual edits use the same ChangeSet and Revision contracts', async (context) => {
  const agentFx = fixture(context, 'origin-agent-');
  const agent = await createResultChangeSet(request(agentFx, { createdBy: 'agent' }), {
    repository: agentFx.repository, adapter: agentFx.adapter, executeJob: successfulExecutor(agentFx, 'AGENT'),
  });
  const userFx = fixture(context, 'origin-user-');
  const user = await createResultChangeSet(request(userFx, { createdBy: 'user' }), {
    repository: userFx.repository, adapter: userFx.adapter, executeJob: successfulExecutor(userFx, 'USER'),
  });
  assert.equal(agent.changeSet.contractVersion, user.changeSet.contractVersion);
  assert.equal(agent.revision.contractVersion, user.revision.contractVersion);
  assert.equal(agent.changeSet.createdBy, 'agent');
  assert.equal(user.changeSet.createdBy, 'user');
  assert.equal(agent.changeSet.status, user.changeSet.status);
});

test('RS5 prefixes Git paths for a project nested in an existing repository', async (context) => {
  const fx = fixture(context, 'git-prefix-');
  const result = await createResultChangeSet(request(fx), {
    repository: fx.repository, adapter: fx.adapter, executeJob: successfulExecutor(fx, 'PREFIX'),
    gitPathPrefix: 'projects/p_1',
  });
  assert.equal(
    fx.adapter.showFile({
      ref: result.candidateCommit,
      filePath: `projects/p_1/${result.materialization.scriptRelativePath}`,
    }).includes('blue'),
    true
  );
  assert.equal(result.revision.sourceScriptRef.relativePath, result.materialization.scriptRelativePath);
});

test('RS5 failed and cancelled execution never changes the current Revision', async (context) => {
  const failedFx = fixture(context, 'failed-');
  await assert.rejects(() => createResultChangeSet(request(failedFx), {
    repository: failedFx.repository, adapter: failedFx.adapter,
    executeJob: async () => ({ job: { id: 'tj_failed', project_id: 'p_1', status: 'failed' } }),
  }), (error) => error.code === 'candidate_job_failed');
  const failed = failedFx.repository.listChangeSets({ projectId: 'p_1' }).find((cs) => cs.changeSetId !== 'cs_source');
  assert.equal(failed.status, 'validation_failed');
  assert.equal(failedFx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
  assert.equal(failedFx.repository.listRevisionsByChangeSet(failed.changeSetId).length, 0);

  const cancelledFx = fixture(context, 'cancelled-');
  let checks = 0;
  await assert.rejects(() => createResultChangeSet(request(cancelledFx), {
    repository: cancelledFx.repository, adapter: cancelledFx.adapter,
    executeJob: successfulExecutor(cancelledFx), shouldCancel: () => ++checks >= 2,
  }), (error) => error.code === 'edit_cancelled');
  const cancelled = cancelledFx.repository.listChangeSets({ projectId: 'p_1' }).find((cs) => cs.changeSetId !== 'cs_source');
  assert.equal(cancelled.status, 'abandoned');
  assert.equal(cancelledFx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
});

test('RS5 blocks cross-project sources before creating a ChangeSet', async (context) => {
  const fx = fixture(context, 'scope-');
  await assert.rejects(() => createResultChangeSet(request(fx, {
    sourceRevision: { ...fx.sourceRevision, projectId: 'p_other' },
  }), { repository: fx.repository, adapter: fx.adapter, executeJob: successfulExecutor(fx) }),
  (error) => error.code === 'source_revision_mismatch');
  assert.equal(fx.repository.listChangeSets({ projectId: 'p_1' }).length, 1);
});

test('RS5 scientific edits require confirmation before any ChangeSet write', async (context) => {
  const fx = fixture(context, 'confirm-');
  const scientificIntent = {
    ...fx.intent,
    editClass: 'scientific_recompute',
    requiresScientificConfirmation: true,
    proposedParameterPatch: { padj_cutoff: 0.01 },
  };
  await assert.rejects(() => createResultChangeSet(request(fx, { intent: scientificIntent }), {
    repository: fx.repository, adapter: fx.adapter, executeJob: successfulExecutor(fx),
  }), (error) => error.code === 'scientific_confirmation_required');
  assert.equal(fx.repository.listChangeSets({ projectId: 'p_1' }).length, 1);
});

test('RS5 recovery reports durable materialization and never marks interrupted work adoptable', (context) => {
  const fx = fixture(context, 'recovery-');
  const changeSetId = 'cs_interrupted';
  fx.repository.createChangeSet({
    changeSetId, projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_interrupted', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
  const materialized = materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId, revisionId: 'rev_interrupted',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    sourceScriptContent: fx.sourceScriptContent, normalizedSourceParams: {}, proposedParameterPatch: {},
  });
  fx.adapter.commitVirtualFiles({
    parentCommit: fx.sourceRevision.sourceCommit,
    ref: 'refs/heads/biof3/changeset/cs_interrupted', expectedOld: '0'.repeat(40),
    message: 'interrupted', files: materialized.gitFiles,
  });
  const recovery = inspectResultEditRecovery({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot, projectId: 'p_1',
  });
  const interrupted = recovery.find((entry) => entry.changeSet.changeSetId === changeSetId);
  assert.equal(interrupted.recovery, 'resume_from_materialized_candidate');
  assert.equal(interrupted.materializationPresent, true);
  assert.match(interrupted.candidateCommit, /^[a-f0-9]{40}$/);
  assert.equal(interrupted.safeToAdopt, false);
});

test('RS5 execution bridge accepts only a hashed script inside the ChangeSet root', (context) => {
  const fx = fixture(context, 'bridge-');
  const root = join(fx.workspaceRoot, '.biof3/revision/cs_bridge');
  mkdirSync(root, { recursive: true });
  const script = join(root, 'run-script.R');
  writeFileSync(script, 'print(1)\n');
  const dbModule = { getProject: () => ({ workspace_path: fx.workspaceRoot }) };
  assert.equal(resolveResultStudioScriptOverride({
    override: { changeSetId: 'cs_bridge', path: script, sha256: sha256(readFileSync(script)) },
    plugin: { language: 'r' }, projectId: 'p_1', dbModule,
  }), realpathSync(script));
  assert.throws(() => resolveResultStudioScriptOverride({
    override: { changeSetId: 'cs_bridge', path: script, sha256: '0'.repeat(64) },
    plugin: { language: 'r' }, projectId: 'p_1', dbModule,
  }), /materialized_script_hash_mismatch/);
  const outside = join(fx.workspaceRoot, 'outside.R');
  writeFileSync(outside, 'print(2)\n');
  const link = join(root, 'escape.R');
  symlinkSync(outside, link);
  assert.throws(() => resolveResultStudioScriptOverride({
    override: { changeSetId: 'cs_bridge', path: link, sha256: sha256(readFileSync(outside)) },
    plugin: { language: 'r' }, projectId: 'p_1', dbModule,
  }), /materialized_script_outside_changeset/);
});
