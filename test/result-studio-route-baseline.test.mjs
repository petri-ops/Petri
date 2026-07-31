import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = mkdtempSync(path.join(tmpdir(), 'biof3-result-route-baseline-'));
process.env.BIOF3_DB_PATH = path.join(root, 'route.db');
const require = createRequire(import.meta.url);
const route = require('../core/r-server/routes/result-studio');
const { baselineFailureDiagnostic, resolveInteractionBaselineRevision } = route._test;
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
