import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const {
  ResultRevisionSourceError,
  projectRevisionSource,
  sha256,
} = require('../core/shared-backend/result-revision-source');

function fixture(context) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-revision-source-'));
  context.after(() => {
      // BLOCK-104 P2 — Windows 派生 git 进程延迟释放句柄；清理 best-effort 同上。
      try {
        rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* best-effort cleanup */
      }
    });
  const sqlite = new Database(join(workspaceRoot, 'source.db'));
  context.after(() => sqlite.close());
  ensureResultStudioSchema(sqlite);
  const repository = createResultStudioRepository(sqlite, { ensureSchema: false });
  const binding = bindProjectRepository({ workspaceRoot, projectId: 'p_1' });
  const source = 'message("exact revision source")\n';
  const parameters = '{\n  "alpha": 0.05,\n  "seed": 42\n}\n';
  const sourcePath = 'analysis/scripts/family_1/rev_1/table.R';
  const parametersPath = 'analysis/scripts/family_1/rev_1/parameters.json';
  const committed = binding.adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/source-test',
    expectedOld: '0'.repeat(40),
    message: 'exact revision source fixture',
    files: [
      { path: sourcePath, content: source },
      { path: parametersPath, content: parameters },
    ],
  });
  repository.createChangeSet({
    changeSetId: 'cs_1', projectId: 'p_1', baseCommit: committed.commit,
    workingBranchRef: 'refs/heads/biof3/source-test', createdBy: 'agent',
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
    inputArtifactRefs: [{ artifactId: 'counts', hash: 'c'.repeat(64), role: 'counts' }],
    parametersRef: parametersPath, parametersHash: sha256(parameters), toolJobId: 'job_1',
    outputPath: 'results/jobs/job_1/output/table.csv', outputHash: 'd'.repeat(64),
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_1',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_1', candidateCommit: committed.commit });
  const job = {
    id: 'job_1', project_id: 'p_1', tool_id: 'deseq2', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'table', type: 'table' }],
      executionProvenance: {
        toolJobId: 'job_1', projectId: 'p_1',
        plugin: { id: 'deseq2', version: '1.2.3', language: 'r', packageConstraints: { DESeq2: '>=1.40' } },
        runtime: { name: 'R', command: '/private/runtime/Rscript', version: '4.5.2', readiness: true },
        params: { normalized: { alpha: 0.05, seed: 42 }, sha256: 'e'.repeat(64) },
        inputs: [{ id: 'counts', role: 'counts', relativePath: 'inputs/counts.csv', sha256: 'c'.repeat(64) }],
        script: { snapshotPath: '/private/job/run.R', sha256: sha256(source), entryPoint: 'run.R' },
        command: { executable: '/private/runtime/Rscript', args: ['/private/job/run.R'], cwd: '/private/job' },
        artifacts: [{ id: 'table', filename: 'table.csv', sha256: 'd'.repeat(64) }],
      },
    },
  };
  return {
    workspaceRoot, repository, adapter: binding.adapter, source, parameters, sourcePath, parametersPath,
    getToolJob: (id) => id === job.id ? job : null,
  };
}

test('projects exact source and bounded reproduction metadata from the Revision commit', (context) => {
  const fx = fixture(context);
  const projected = projectRevisionSource({ projectId: 'p_1', revisionId: 'rev_1' }, fx);
  assert.equal(projected.content, fx.source);
  assert.equal(projected.sha256, sha256(fx.source));
  assert.equal(projected.relativePath, fx.sourcePath);
  assert.equal(projected.parameters.sha256, sha256(fx.parameters));
  assert.deepEqual(projected.parameters.values, { alpha: 0.05, seed: 42 });
  assert.equal(projected.scope, 'artifact_specific_materialization');
  assert.equal(projected.reproduction.requiresConfirmation, true);
  assert.equal(projected.reproduction.runtime.version, '4.5.2');
  assert.deepEqual(projected.reproduction.inputs, [{ artifactId: 'counts', role: 'counts', sha256: 'c'.repeat(64), status: 'missing' }]);
  assert.equal(JSON.stringify(projected).includes('/private/'), false, 'projection must not leak absolute runtime or snapshot paths');
  assert.equal('sourceCommit' in projected, false, 'ordinary source response must not expose the Git object id');
});

test('fails closed on cross-project access, expected hash drift, Git content drift and parameter drift', (context) => {
  const fx = fixture(context);
  assert.throws(
    () => projectRevisionSource({ projectId: 'p_other', revisionId: 'rev_1' }, fx),
    (error) => error instanceof ResultRevisionSourceError && error.code === 'revision_not_found',
  );
  assert.throws(
    () => projectRevisionSource({ projectId: 'p_1', revisionId: 'rev_1', expectSha256: '0'.repeat(64) }, fx),
    (error) => error.code === 'source_expectation_stale',
  );

  const revision = fx.repository.getRevision('rev_1');
  const sourceDrift = { ...revision, revisionId: 'rev_source_drift', sourceScriptRef: { ...revision.sourceScriptRef, sha256: 'a'.repeat(64) } };
  assert.throws(
    () => projectRevisionSource({ projectId: 'p_1', revision: sourceDrift }, fx),
    (error) => error.code === 'source_hash_mismatch',
  );
  const parameterDrift = { ...revision, revisionId: 'rev_parameter_drift', parametersHash: 'b'.repeat(64) };
  assert.throws(
    () => projectRevisionSource({ projectId: 'p_1', revision: parameterDrift }, fx),
    (error) => error.code === 'parameters_hash_mismatch',
  );
});

test('project-file opening is offered only when a matching physical workspace file exists', (context) => {
  const fx = fixture(context);
  assert.equal(projectRevisionSource({ projectId: 'p_1', revisionId: 'rev_1' }, fx).openableRelativePath, null);
  const physical = join(fx.workspaceRoot, ...fx.sourcePath.split('/'));
  mkdirSync(join(physical, '..'), { recursive: true });
  writeFileSync(physical, fx.source);
  assert.equal(projectRevisionSource({ projectId: 'p_1', revisionId: 'rev_1' }, fx).openableRelativePath, fx.sourcePath);
  writeFileSync(physical, 'drifted\n');
  assert.equal(projectRevisionSource({ projectId: 'p_1', revisionId: 'rev_1' }, fx).openableRelativePath, null);
});

test('fails closed on path escape, missing Git source and unavailable source commit', (context) => {
  const fx = fixture(context);
  const revision = fx.repository.getRevision('rev_1');
  assert.throws(
    () => projectRevisionSource({
      projectId: 'p_1',
      revision: { ...revision, sourceScriptRef: { ...revision.sourceScriptRef, relativePath: '../outside.R' } },
    }, fx),
    (error) => error.code === 'sourceScriptRef.relativePath_invalid',
  );
  assert.throws(
    () => projectRevisionSource({
      projectId: 'p_1',
      revision: { ...revision, sourceScriptRef: { ...revision.sourceScriptRef, relativePath: 'analysis/scripts/missing.R' } },
    }, fx),
    (error) => error.code === 'source_unavailable',
  );
  const unavailableCommit = '0'.repeat(40);
  assert.throws(
    () => projectRevisionSource({ projectId: 'p_1', revision: { ...revision, sourceCommit: unavailableCommit } }, {
      ...fx,
      repository: {
        ...fx.repository,
        getChangeSet: () => ({ projectId: 'p_1', candidateCommit: unavailableCommit }),
      },
    }),
    (error) => error.code === 'source_commit_unavailable',
  );
});
