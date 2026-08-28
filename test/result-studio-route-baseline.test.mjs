import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = mkdtempSync(path.join(tmpdir(), 'biof3-result-route-baseline-'));
process.env.BIOF3_DB_PATH = path.join(root, 'route.db');
const require = createRequire(import.meta.url);
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'migrations'));
const route = require('../core/r-server/routes/result-studio');
const { readVerifiedFileSnapshot } = require('../core/r-server/helpers/verified-file-snapshot');
const { queryResultTable } = require('../core/shared-backend/result-studio-table-query');
const {
  attachExistingRepositoryWithExplicitConsent,
  baselineFailureDiagnostic,
  bindAuthoritativeQuerySelection,
  buildContextBoundPreviewBudget,
  findArtifactRecord,
  openVerifiedRevisionArtifact,
  publicResultStudioErrorMessage,
  resolveArtifactPath,
  resolveInteractionBaselineRevision,
} = route._test;

test('P7 existing Git attachment requires explicit affirmative consent before binding or persistence', () => {
  let bindCalls = 0;
  let consentWrites = 0;
  let bindingWrites = 0;
  const repository = {
    saveExistingRepositoryConsent: () => { consentWrites += 1; },
    saveRepositoryBinding: () => { bindingWrites += 1; },
  };
  const binder = () => { bindCalls += 1; return null; };

  const denied = attachExistingRepositoryWithExplicitConsent({
    projectId: 'p_1', workspaceRoot: '/tmp/project', allowExistingRepository: false,
  }, { repository, bindProjectRepository: binder });
  assert.deepEqual(denied, {
    ok: false, status: 400, code: 'explicit_existing_repository_consent_required',
  });
  assert.equal(bindCalls, 0);
  assert.equal(consentWrites, 0);
  assert.equal(bindingWrites, 0);
});

test('P7 explicit Git attachment persists consent and binding only after inspecting existing mode', () => {
  let bindOptions = null;
  const repository = {
    saveExistingRepositoryConsent: (decision) => ({
      ...decision,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }),
    saveRepositoryBinding: (binding) => ({ ...binding, createdAt: 'now', updatedAt: 'now' }),
  };
  const result = attachExistingRepositoryWithExplicitConsent({
    projectId: 'p_1', workspaceRoot: '/tmp/project', allowExistingRepository: true,
  }, {
    repository,
    bindProjectRepository: (options) => {
      bindOptions = options;
      return {
        status: 'ready', mode: 'existing', reason: null,
        workspaceRoot: '/tmp/project', managedPaths: ['analysis/scripts'],
        adapter: { gitDir: '/tmp/project/.git', workTree: '/tmp/project' },
        inspection: { runtime: { versionRaw: 'git version 2.50.1' } },
      };
    },
  });
  assert.equal(bindOptions.allowExistingRepository, true);
  assert.equal(bindOptions.createManagedIfMissing, false);
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    code: null,
    bindingStatus: 'ready',
    mode: 'existing',
    consent: { allowExistingRepository: true, decisionSource: 'explicit_api' },
  });
});

test('P7 production Git callers derive existing-repository access instead of hard-coding it', () => {
  // PHASE 2.1b: routes/result-studio.js is a thin facade (no app code), so the
  // production Git callers now live in result-studio/index.js (projectContext
  // closure) and the result-edit/result-selection agent-tools files.
  for (const relative of [
    '../core/r-server/routes/result-studio/index.js',
    '../core/shared-backend/result-studio-background-child.js',
    '../core/r-server/agent-tools/result-edit-tools.js',
    '../core/r-server/agent-tools/result-selection-tools.js',
  ]) {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), relative), 'utf8');
    assert.doesNotMatch(source, /allowExistingRepository\s*:\s*true/);
    assert.match(source, /hasExistingRepositoryConsent/);
  }
});
const routeDb = require('../core/r-server/db').db;

test.after(() => {
  try { routeDb.close(); } catch { /* already closed */ }
  rmSync(root, { recursive: true, force: true });
});

test('P6 Revision table-page route passes the persisted output hash to the bounded reader', () => {
  // PHASE 2.1b: the readTablePage call moved to the revisions subdomain module.
  const source = readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../core/r-server/routes/result-studio/revisions.js',
  ), 'utf8');
  assert.match(
    source,
    /readTablePage\(\{\s*filePath,\s*expectedSha256:\s*revision\.outputHash,/,
  );
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

test('P6 query Selection persists only server-recomputed Artifact Truth evidence', () => {
  const file = path.join(root, 'selection-truth.csv');
  const rows = Array.from({ length: 20 }, (_, index) => `G${index},${index / 100}`);
  const bytes = `gene,padj\n${rows.join('\n')}\n`;
  writeFileSync(file, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filterExpression = { logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 1 }] };
  const authoritative = queryResultTable({
    filePath: file,
    expectedSha256: sha256,
    idField: 'gene',
    filterExpression,
    sort: [],
    offset: 0,
    limit: 1,
  });
  const artifactRecord = {
    id: 'deg_table', filename: 'selection-truth.csv', path: file, sha256,
  };
  const selection = {
    selectionId: 'sel_truth',
    projectId: 'p_truth',
    artifactId: 'deg_table',
    revisionId: 'rev_truth',
    entityType: 'gene',
    entityIds: authoritative.selectionEvidence.sampleEntityIds,
    entityIdCount: authoritative.selectionEvidence.entityIdCount,
    entityIdsTruncated: true,
    entityIdsHash: authoritative.selectionEvidence.entityIdsHash,
    filterHash: authoritative.filterHash,
    filterExpression,
    sort: [],
    displayState: { origin: 'query', durable: true },
  };
  const dependencies = {
    getToolJob: () => ({
      id: 'job_truth', project_id: 'p_truth', tool_id: 'deseq2',
      result: { artifactTruth: { status: 'valid', blocking: false }, artifacts: [artifactRecord] },
    }),
    getPluginManifest: () => ({ resultStudio: {
      artifacts: [{ id: 'deg_table', filename: 'selection-truth.csv', type: 'table' }],
      interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
    } }),
    resolveArtifactPath: () => ({
      absolutePath: file,
      artifactRecord,
      expectedSha256: sha256,
    }),
  };
  const input = {
    req: {},
    project: { id: 'p_truth' },
    selection,
    repository: { getRevision: () => ({
      revisionId: 'rev_truth', projectId: 'p_truth', artifactId: 'deg_table',
      toolJobId: 'job_truth', outputHash: sha256,
    }) },
  };

  const bound = bindAuthoritativeQuerySelection(input, dependencies);
  assert.equal(bound.error, undefined);
  assert.equal(bound.authoritative, true);
  assert.equal(bound.selection.entityIdCount, 20);
  assert.equal(bound.selection.entityIdsHash, authoritative.selectionEvidence.entityIdsHash);
  assert.equal(bound.selection.displayState.evidenceAuthority, 'server_artifact_truth');

  const forged = bindAuthoritativeQuerySelection({
    ...input,
    selection: {
      ...selection,
      entityIds: [],
      entityIdCount: 500_000,
      entityIdsHash: 'f'.repeat(64),
    },
  }, dependencies);
  assert.equal(forged.error.code, 'selection_query_evidence_mismatch');
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

test('P6 Revision downloads stream only the descriptor whose bytes match Revision Truth', async () => {
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

  const opened = await openVerifiedRevisionArtifact(workspace, revision);
  writeFileSync(file, 'gene,score\nSAME_INODE_MUTATION,100\n');
  assert.equal(await readVerifiedFileSnapshot(opened, { encoding: 'utf8' }), bytes);

  writeFileSync(file, 'gene,score\nBRAF,0\n');
  await assert.rejects(
    () => openVerifiedRevisionArtifact(workspace, revision),
    /artifact_hash_mismatch/,
  );
});
