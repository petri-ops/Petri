import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = mkdtempSync(path.join(tmpdir(), 'biof3-result-route-baseline-'));
process.env.BIOF3_DB_PATH = path.join(root, 'route.db');
const require = createRequire(import.meta.url);
const route = require('../core/r-server/routes/result-studio');
const {
  baselineFailureDiagnostic,
  buildContextBoundPreviewBudget,
  findArtifactRecord,
  openVerifiedRevisionArtifact,
  publicResultStudioErrorMessage,
  resolveArtifactPath,
  resolveInteractionBaselineRevision,
} = route._test;
const routeDb = require('../core/r-server/db').db;

test.after(() => {
  try { routeDb.close(); } catch { /* already closed */ }
  rmSync(root, { recursive: true, force: true });
});

test('P6 interaction route re-enters baseline ensure when an existing formal Revision lacks cohort qualification', () => {
  const existing = { revisionId: 'rev_existing', artifactId: 'plot' };
  const repository = {
    findRevisionByJobArtifact: () => existing,
  };
  let inspections = 0;
  const result = resolveInteractionBaselineRevision({
    repository,
    projectId: 'p_1',
    sourceJob: { id: 'tj_1', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed' },
    artifactId: 'plot',
    pluginDescriptor: { artifacts: [{ id: 'plot' }], validator: { id: 'validator-v2' } },
  }, {
    inspectBaselineArtifactCohort: () => {
      inspections += 1;
      return { qualified: false, reason: 'baseline_cohort_unqualified', revision: null, cohortRevisions: [] };
    },
  });
  assert.equal(inspections, 1);
  assert.equal(result.requiresEnsure, true);
  assert.equal(result.revision, null);
  assert.equal(result.qualification.reason, 'baseline_cohort_unqualified');
});

test('P6 interaction route reuses only the exact Revision returned by qualified cohort inspection', () => {
  const unrelatedExisting = { revisionId: 'rev_any', artifactId: 'plot' };
  const qualified = { revisionId: 'rev_qualified', artifactId: 'plot' };
  const result = resolveInteractionBaselineRevision({
    repository: { findRevisionByJobArtifact: () => unrelatedExisting },
    projectId: 'p_1',
    sourceJob: { id: 'tj_1', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed' },
    artifactId: 'plot',
    pluginDescriptor: { artifacts: [{ id: 'plot' }], validator: { id: 'validator-v2' } },
  }, {
    inspectBaselineArtifactCohort: () => ({
      qualified: true,
      reason: null,
      revision: qualified,
      cohortRevisions: [qualified],
    }),
  });
  assert.equal(result.requiresEnsure, false);
  assert.equal(result.revision, qualified);
});

test('P6 interaction route reuses a qualified adopted candidate instead of forking a new baseline family', () => {
  const candidate = { revisionId: 'rev_candidate', artifactId: 'plot', isCurrent: true };
  let baselineInspections = 0;
  const result = resolveInteractionBaselineRevision({
    repository: { findRevisionByJobArtifact: () => candidate },
    projectId: 'p_1',
    sourceJob: { id: 'tj_candidate', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed' },
    artifactId: 'plot',
    pluginDescriptor: { artifacts: [{ id: 'plot' }], validator: { id: 'validator-v2' } },
  }, {
    inspectPersistedArtifactCohort: () => ({
      qualified: true, reason: null, revision: candidate, cohortRevisions: [candidate],
    }),
    inspectBaselineArtifactCohort: () => {
      baselineInspections += 1;
      return { qualified: false, revision: null, cohortRevisions: [] };
    },
  });
  assert.equal(result.requiresEnsure, false);
  assert.equal(result.revision, candidate);
  assert.equal(baselineInspections, 0);
});

test('P6 interaction diagnostic exposes only bounded Git invocation facts', () => {
  const diagnostic = baselineFailureDiagnostic({
    code: 'git_hash_object_failed',
    message: 'Cannot write isolated Git blob.',
    detail: {
      command: 'hash-object', status: null, systemCode: 'ETIMEDOUT', signal: 'SIGTERM',
      killed: true, attempts: 2, stderr: '/Users/private/project secret', stdout: 'rev_private',
    },
  });
  assert.deepEqual(diagnostic, {
    code: 'git_hash_object_failed',
    message: 'Cannot write isolated Git blob.',
    technical: {
      command: 'hash-object', systemCode: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, attempts: 2,
    },
  });
  assert.equal(JSON.stringify(diagnostic).includes('/Users/'), false);
  assert.equal(JSON.stringify(diagnostic).includes('rev_private'), false);
});

test('P6 interaction diagnostic preserves an actionable missing-script code without coordinates', () => {
  const diagnostic = baselineFailureDiagnostic(Object.assign(
    new Error('Execution script snapshot is unavailable.'),
    { code: 'source_script_missing', detail: { snapshotPath: '/Users/private/run.R' } },
  ));
  assert.deepEqual(diagnostic, {
    code: 'source_script_missing',
    message: 'Execution script snapshot is unavailable.',
  });
  assert.equal(JSON.stringify(diagnostic).includes('/Users/'), false);
});

test('P6 workspace errors never project absolute coordinates into the renderer', () => {
  assert.equal(
    publicResultStudioErrorMessage(
      new Error('ENOENT: missing /Users/private/project/results/table.csv'),
      'Result Studio workspace inspection failed.',
    ),
    'Result Studio workspace inspection failed.',
  );
  assert.equal(
    publicResultStudioErrorMessage(
      new Error('open C:\\private\\project\\result.csv failed'),
      'Result Studio workspace recovery failed.',
    ),
    'Result Studio workspace recovery failed.',
  );
  assert.equal(
    publicResultStudioErrorMessage(
      new Error('Checkpoint advanced after the recovery scan.'),
      'fallback',
    ),
    'Checkpoint advanced after the recovery scan.',
  );
});

test('P6 preview budget diagnostic fails closed without a trusted edit context', () => {
  const snapshotCalls = [];
  const dependencies = {
    createRuntimeResourceSnapshot: (input) => {
      snapshotCalls.push(input);
      return {
        state: 'ready',
        memory: { availableBytes: 10_000, estimatedBytes: input.estimatedMemoryBytes },
        disk: { availableBytes: 20_000 },
        activeJobs: input.activeJobs,
      };
    },
  };
  const diagnostic = buildContextBoundPreviewBudget({
    disk: { availableBytes: 20_000, totalBytes: 40_000 },
    activePreviewJobs: 1,
    // Extra caller-shaped fields must never become an executable estimate.
    estimatedMemoryBytes: 1,
    estimatedDiskBytes: 1,
  }, dependencies);

  assert.deepEqual(snapshotCalls, [{
    disk: { availableBytes: 20_000, totalBytes: 40_000 },
    activeJobs: 1,
    estimatedMemoryBytes: null,
  }]);
  assert.equal(diagnostic.snapshot.memory.estimatedBytes, null);
  assert.equal(diagnostic.budget.decision, 'blocked');
  assert.deepEqual(diagnostic.budget.reasons, ['resource_estimate_unavailable']);
  assert.equal(diagnostic.budget.estimatedMemoryBytes, null);
  assert.equal(diagnostic.budget.estimatedDiskBytes, null);
  assert.deepEqual(diagnostic.budget.resourceEstimate, {
    estimateVersion: 1,
    available: false,
    source: 'context_bound_edit_required',
    reason: 'trusted_edit_context_unavailable',
  });
});

test('P6 interaction binds one current physical file to exact Job Artifact Truth bytes', () => {
  const file = path.join(root, 'verified-table.csv');
  const bytes = 'gene,score\nTP53,4.2\n';
  writeFileSync(file, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const artifact = { id: 'table', filename: 'verified-table.csv', path: file, sha256 };
  const bound = findArtifactRecord({
    artifactTruth: { status: 'valid', blocking: false },
    artifacts: [artifact],
  }, file, 'verified-table.csv');

  assert.equal(bound.error, undefined);
  assert.equal(bound.artifactRecord, artifact);
  assert.equal(bound.expectedSha256, sha256);
  assert.equal(bound.actualSha256, sha256);
});

test('P6 interaction rejects missing, ambiguous and unhashed Job Artifact Truth as unavailable', () => {
  const file = path.join(root, 'unavailable-table.csv');
  const bytes = 'gene,score\nEGFR,2.1\n';
  writeFileSync(file, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const validTruth = { status: 'valid', blocking: false };
  const cases = [
    {
      name: 'job truth missing',
      result: { artifacts: [{ id: 'table', filename: 'unavailable-table.csv', path: file, sha256 }] },
      reason: 'job_artifact_truth_unavailable',
    },
    {
      name: 'record missing',
      result: { artifactTruth: validTruth, artifacts: [{ id: 'other', filename: 'other.csv', sha256 }] },
      reason: 'artifact_record_missing',
    },
    {
      name: 'identity ambiguous',
      result: {
        artifactTruth: validTruth,
        artifacts: [
          { id: 'left', filename: 'unavailable-table.csv', path: file, sha256 },
          { id: 'right', filename: 'unavailable-table.csv', path: file, sha256 },
        ],
      },
      reason: 'artifact_identity_ambiguous',
    },
    {
      name: 'sha missing',
      result: {
        artifactTruth: validTruth,
        artifacts: [{ id: 'table', filename: 'unavailable-table.csv', path: file }],
      },
      reason: 'artifact_sha256_unavailable',
    },
  ];

  for (const fixture of cases) {
    const resolved = findArtifactRecord(fixture.result, file, 'unavailable-table.csv');
    assert.equal(resolved.error.status, 409, fixture.name);
    assert.equal(resolved.error.code, 'artifact_truth_unavailable', fixture.name);
    assert.equal(resolved.error.reason, fixture.reason, fixture.name);
  }
});

test('P6 interaction reports byte drift instead of reading a changed Artifact', () => {
  const file = path.join(root, 'drifted-table.csv');
  writeFileSync(file, 'gene,score\nMYC,9.1\n');
  const expectedSha256 = createHash('sha256').update('gene,score\nMYC,1.0\n').digest('hex');
  const resolved = findArtifactRecord({
    artifactTruth: { status: 'valid', blocking: false },
    artifacts: [{ id: 'table', filename: 'drifted-table.csv', path: file, sha256: expectedSha256 }],
  }, file, 'drifted-table.csv');

  assert.equal(resolved.error.status, 409);
  assert.equal(resolved.error.code, 'artifact_truth_drift');
  assert.equal(resolved.error.reason, 'artifact_hash_drift');
});

test('P6 artifact path resolution never falls back to an undeclared physical output file', () => {
  const jobRoot = path.join(root, 'undeclared-job');
  const outputDir = path.join(jobRoot, 'output');
  const file = path.join(outputDir, 'physical-only.csv');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(file, 'gene,score\nKRAS,3.0\n');
  const resolved = resolveArtifactPath({
    req: { user: { id: 'local-user' } },
    job: {
      id: 'tj_undeclared',
      result: {
        artifactTruth: { status: 'valid', blocking: false },
        artifacts: [],
      },
    },
    project: { id: 'p_undeclared' },
    artifactName: 'physical-only.csv',
  }, {
    resolveProjectRunLayout: () => ({ jobRoot, jobDir: jobRoot, outputDir }),
  });

  assert.equal(resolved.error.status, 409);
  assert.equal(resolved.error.code, 'artifact_truth_unavailable');
  assert.equal(resolved.error.reason, 'artifact_record_missing');
});

test('P6 Revision downloads stream only the descriptor whose bytes match Revision Truth', () => {
  const workspace = path.join(root, 'revision-workspace');
  const relativePath = 'results/revision-table.csv';
  const file = path.join(workspace, relativePath);
  const bytes = 'gene,score\nBRAF,7.5\n';
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const revision = {
    outputPath: relativePath,
    outputHash: createHash('sha256').update(bytes).digest('hex'),
  };

  const opened = openVerifiedRevisionArtifact(workspace, revision);
  assert.equal(readFileSync(opened.fd, 'utf8'), bytes);
  closeSync(opened.fd);

  writeFileSync(file, 'gene,score\nBRAF,0\n');
  assert.throws(
    () => openVerifiedRevisionArtifact(workspace, revision),
    /artifact_hash_mismatch/,
  );
});
