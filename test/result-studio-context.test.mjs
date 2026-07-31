import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RESULT_STUDIO_CONTEXT_VERSION,
  PUBLIC_EDIT_PHASES,
  projectPublicEditPhase,
  computeContextToken,
  buildResultStudioContextEnvelope,
  validateResultStudioContextEnvelope,
  authorizeContextOperation,
  summarizeContextForAgent,
} = require('../core/shared-backend/result-studio-context');
const {
  projectEditableParameters,
  resolveResultStudioContext,
  resolveContextChangeSet,
  createResultStudioContextTool,
  guardContextOperation,
} = require('../core/r-server/agent-tools/result-context-tools');
const {
  publicProgress,
  createResultContextEditTools,
} = require('../core/r-server/agent-tools/result-context-edit-tools');

const SCRIPT_SHA = 'a'.repeat(64);

function envelopeInput(overrides = {}) {
  return {
    projectId: 'project_1',
    conversationId: 'conv_1',
    artifact: {
      artifactId: 'deg_table',
      artifactFamilyId: 'family_1',
      name: 'deg_table.csv',
      kind: 'table',
      entityType: 'gene',
      idField: 'gene',
      interactionMode: 'table',
    },
    job: {
      toolJobId: 'job_1',
      projectId: 'project_1',
      toolId: 'deseq2',
      status: 'completed',
      artifactTruthStatus: 'valid',
    },
    revision: {
      revisionId: 'rev_1',
      currentRevisionId: 'rev_1',
      revisionOrdinal: 1,
      isCurrent: true,
      validationStatus: 'valid',
      reproducibilityStatus: 'verified',
    },
    script: {
      relativePath: 'analysis/scripts/family_1/rev_1/deg_table.R',
      sha256: SCRIPT_SHA,
      language: 'r',
      origin: 'project_materialized',
      parametersRef: 'analysis/scripts/family_1/rev_1/parameters.json',
      parametersHash: 'b'.repeat(64),
    },
    plugin: {
      pluginId: 'deseq2',
      descriptorVersion: 1,
      editableParameters: [
        { name: 'padj_cutoff', type: 'number', impact: 'scientific', default: 0.05 },
      ],
      actions: ['select_genes', 'derive_enrichment_input'],
    },
    capturedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Envelope 契约
// ---------------------------------------------------------------------------

test('RS-P3 envelope carries every engineering coordinate the model must not invent', () => {
  const built = buildResultStudioContextEnvelope(envelopeInput());
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const envelope = built.envelope;
  assert.equal(envelope.contextVersion, RESULT_STUDIO_CONTEXT_VERSION);
  for (const path of [
    'projectId', 'conversationId',
    'artifact.artifactId', 'artifact.artifactFamilyId', 'artifact.entityType', 'artifact.interactionMode',
    'job.toolJobId', 'job.toolId', 'job.artifactTruthStatus',
    'revision.revisionId', 'revision.currentRevisionId', 'revision.validationStatus', 'revision.reproducibilityStatus',
    'script.relativePath', 'script.sha256', 'script.parametersRef', 'script.parametersHash',
    'plugin.pluginId',
  ]) {
    const value = path.split('.').reduce((acc, key) => acc[key], envelope);
    assert.ok(value, `${path} must be projected`);
  }
  assert.deepEqual(envelope.publicPhases, [...PUBLIC_EDIT_PHASES]);
  assert.match(envelope.contextToken, /^[a-f0-9]{64}$/);
  assert.equal(validateResultStudioContextEnvelope(envelope).ok, true);
});

test('RS-P3 blocks a context whose attribution reaches only the job', () => {
  const built = buildResultStudioContextEnvelope(envelopeInput({
    script: { relativePath: '', sha256: '', language: 'r' },
  }));
  assert.equal(built.ok, false);
  assert.equal(built.envelope, null);
  assert.equal(built.diagnostics.some((item) => item.code === 'context_attribution_job_only'), true);
});

test('RS-P3 blocks a context without a persisted revision or with foreign job truth', () => {
  const noRevision = buildResultStudioContextEnvelope(envelopeInput({
    revision: { revisionId: '', currentRevisionId: null },
  }));
  assert.equal(noRevision.ok, false);
  assert.equal(noRevision.diagnostics.some((item) => item.code === 'context_revision_missing'), true);

  const foreign = buildResultStudioContextEnvelope(envelopeInput({
    job: { toolJobId: 'job_1', projectId: 'project_other', status: 'completed', artifactTruthStatus: 'valid' },
  }));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.diagnostics.some((item) => item.code === 'context_project_mismatch'), true);

  const blocked = buildResultStudioContextEnvelope(envelopeInput({
    job: { toolJobId: 'job_1', projectId: 'project_1', status: 'completed', artifactTruthStatus: 'blocked' },
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.diagnostics.some((item) => item.code === 'context_artifact_truth_invalid'), true);
});

test('RS-P3 admits only a compatible selection into the agent context', () => {
  const compatible = buildResultStudioContextEnvelope(envelopeInput({
    selection: {
      selectionId: 'sel_1', entityType: 'gene', entityIdCount: 3, truncated: false,
      entityIdsHash: 'c'.repeat(64), sampleEntityIds: ['TP53', 'EGFR', 'MYC'],
      hasFilter: false, compatibility: 'compatible', compatibilityReason: 'same_revision',
    },
  }));
  assert.equal(compatible.envelope.selection.selectionId, 'sel_1');
  assert.equal(compatible.envelope.selectionState.usableByAgent, true);

  for (const status of ['stale', 'invalid']) {
    const built = buildResultStudioContextEnvelope(envelopeInput({
      selection: {
        selectionId: 'sel_1', entityType: 'gene', entityIdCount: 3,
        compatibility: status, compatibilityReason: 'revision_changed',
      },
    }));
    assert.equal(built.ok, true);
    assert.equal(built.envelope.selection, null, `${status} selection must not reach the agent`);
    assert.equal(built.envelope.selectionState.present, true);
    assert.equal(built.envelope.selectionState.compatibility, status);
    assert.equal(built.envelope.selectionState.usableByAgent, false);
  }
});

// ---------------------------------------------------------------------------
// 2. contextToken 与陈旧上下文
// ---------------------------------------------------------------------------

test('RS-P3 context token changes when the revision or selection evidence changes', () => {
  const base = buildResultStudioContextEnvelope(envelopeInput()).envelope;
  const newRevision = buildResultStudioContextEnvelope(envelopeInput({
    revision: { revisionId: 'rev_2', currentRevisionId: 'rev_2', revisionOrdinal: 2, isCurrent: true, validationStatus: 'valid', reproducibilityStatus: 'verified' },
  })).envelope;
  const newSelection = buildResultStudioContextEnvelope(envelopeInput({
    selection: {
      selectionId: 'sel_1', entityType: 'gene', entityIdCount: 3,
      entityIdsHash: 'd'.repeat(64), compatibility: 'compatible',
    },
  })).envelope;
  assert.notEqual(base.contextToken, newRevision.contextToken);
  assert.notEqual(base.contextToken, newSelection.contextToken);
});

test('P6 context token tracks workflow content but not plan-time snapshot persistence', () => {
  const workflow = {
    graphId: 'wfg_context_graph',
    sourceDigest: 'f'.repeat(64),
    snapshotStatus: 'not_persisted',
    nodeId: 'job:job_1',
    stepCount: 2,
    downstreamNodeIds: ['job:job_2'],
  };
  const beforePlan = buildResultStudioContextEnvelope(envelopeInput({ workflow })).envelope;
  const afterPlan = buildResultStudioContextEnvelope(envelopeInput({
    workflow: { ...workflow, snapshotStatus: 'persisted' },
  })).envelope;
  const changedGraph = buildResultStudioContextEnvelope(envelopeInput({
    workflow: { ...workflow, graphId: 'wfg_context_graph_v2', sourceDigest: 'e'.repeat(64) },
  })).envelope;

  assert.equal(beforePlan.contextToken, afterPlan.contextToken,
    'persisting an unchanged server-projected graph must not invalidate its own click-time token');
  assert.notEqual(beforePlan.contextToken, changedGraph.contextToken,
    'a different authoritative workflow graph must still invalidate the token');
});

test('P4R-3 context token covers column/filter/sort updates within one selection id', () => {
  const selection = {
    selectionId: 'sel_columns', entityType: 'column', entityIdCount: 0, truncated: false,
    entityIdsHash: null, filterHash: null, sampleEntityIds: [], hasFilter: false,
    fields: ['padj'], sort: [{ field: 'padj', direction: 'asc' }],
    updatedAt: '2026-07-28T00:00:00.000Z', compatibility: 'compatible',
  };
  const first = buildResultStudioContextEnvelope(envelopeInput({ selection })).envelope;
  const fieldsChanged = buildResultStudioContextEnvelope(envelopeInput({
    selection: { ...selection, fields: ['log2FoldChange'], updatedAt: '2026-07-28T00:01:00.000Z' },
  })).envelope;
  const sortChanged = buildResultStudioContextEnvelope(envelopeInput({
    selection: { ...selection, sort: [{ field: 'padj', direction: 'desc' }] },
  })).envelope;
  assert.notEqual(first.contextToken, fieldsChanged.contextToken);
  assert.notEqual(first.contextToken, sortChanged.contextToken);
  assert.deepEqual(summarizeContextForAgent(fieldsChanged).selection.fields, ['log2FoldChange']);
});

test('RS-P3 rejects a stale or absent context token on a write operation', () => {
  const envelope = buildResultStudioContextEnvelope(envelopeInput()).envelope;
  assert.equal(authorizeContextOperation({ envelope, presentedToken: envelope.contextToken }).ok, true);

  const missing = authorizeContextOperation({ envelope, presentedToken: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics[0].code, 'context_token_required');

  const stale = authorizeContextOperation({ envelope, presentedToken: 'f'.repeat(64) });
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].code, 'context_token_stale');
  assert.equal(stale.diagnostics[0].detail, undefined);
  assert.equal(JSON.stringify(stale).includes(envelope.contextToken), false);

  // 只读操作允许无 token
  assert.equal(authorizeContextOperation({ envelope, presentedToken: null, requireToken: false }).ok, true);
});

test('RS-P3 rejects a hand-edited envelope whose token no longer matches its contents', () => {
  const envelope = buildResultStudioContextEnvelope(envelopeInput()).envelope;
  const tampered = { ...envelope, revision: { ...envelope.revision, revisionId: 'rev_hacked' } };
  const result = validateResultStudioContextEnvelope(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((item) => item.code === 'context_token_invalid'), true);
  assert.equal(authorizeContextOperation({ envelope: tampered, presentedToken: envelope.contextToken }).ok, false);
});

test('RS-P3 agent view stays bounded and never leaks internal ids or paths', () => {
  const envelope = buildResultStudioContextEnvelope(envelopeInput({
    selection: {
      selectionId: 'sel_1', entityType: 'gene', entityIdCount: 100000, truncated: true,
      entityIdsHash: 'c'.repeat(64),
      sampleEntityIds: Array.from({ length: 40 }, (_, index) => `GENE${index}`),
      hasFilter: true, filterDescription: 'padj < 0.05', compatibility: 'compatible',
    },
  })).envelope;
  const view = summarizeContextForAgent(envelope);
  const serialized = JSON.stringify(view);
  assert.equal(view.selection.entityIdCount, 100000);
  assert.equal(view.selection.sampleEntityIds.length, 12);
  assert.equal(serialized.includes('job_1'), false);
  assert.equal(serialized.includes('rev_1'), false);
  assert.equal(serialized.includes('sel_1'), false);
  assert.equal(serialized.includes('analysis/scripts'), false);
  assert.equal(serialized.includes(SCRIPT_SHA), false);
  assert.ok(serialized.length < 4000);
});

// ---------------------------------------------------------------------------
// 3. 公开阶段词表
// ---------------------------------------------------------------------------

test('RS-P3 projects engineering stages onto the five public phases only', () => {
  assert.deepEqual(PUBLIC_EDIT_PHASES, [
    'understand_intent', 'assess_impact', 'execute_or_recompute', 'validate', 'candidate_comparable',
  ]);
  assert.equal(projectPublicEditPhase('change_set').phase, 'assess_impact');
  assert.equal(projectPublicEditPhase('materialize').phase, 'execute_or_recompute');
  assert.equal(projectPublicEditPhase('commit').phase, 'execute_or_recompute');
  assert.equal(projectPublicEditPhase('job').phase, 'execute_or_recompute');
  assert.equal(projectPublicEditPhase('revision').phase, 'validate');
  assert.equal(projectPublicEditPhase('preview').phase, 'candidate_comparable');
  assert.equal(projectPublicEditPhase('failed').terminal, true);
  assert.equal(projectPublicEditPhase('cancelled').terminal, true);
  assert.equal(projectPublicEditPhase('unknown_stage').phase, null);

  const phases = publicProgress([
    { stage: 'change_set', status: 'running' },
    { stage: 'materialize', status: 'running' },
    { stage: 'materialize', status: 'completed' },
    { stage: 'commit', status: 'completed' },
    { stage: 'job', status: 'completed' },
    { stage: 'revision', status: 'completed' },
    { stage: 'preview', status: 'ready' },
  ]);
  assert.deepEqual(phases.map((item) => item.phase), [
    'assess_impact', 'execute_or_recompute', 'validate', 'candidate_comparable',
  ]);
  assert.equal(JSON.stringify(phases).includes('commit'), false);
});

// ---------------------------------------------------------------------------
// 4. 真相解析：模型不再手写内部 ID
// ---------------------------------------------------------------------------

function fixture(overrides = {}) {
  const revision = {
    revisionId: 'rev_1', projectId: 'project_1', artifactFamilyId: 'family_1', artifactId: 'deg_table',
    toolJobId: 'job_1', revisionOrdinal: 1, validationStatus: 'valid', reproducibilityStatus: 'verified',
    outputPath: 'results/deg_table.csv', outputHash: 'e'.repeat(64),
    parametersRef: 'analysis/scripts/family_1/rev_1/parameters.json', parametersHash: 'b'.repeat(64),
    sourceScriptRef: {
      relativePath: 'analysis/scripts/family_1/rev_1/deg_table.R',
      sha256: SCRIPT_SHA, language: 'r', origin: 'project_materialized',
    },
    ...(overrides.revision || {}),
  };
  const selection = overrides.selection === undefined
    ? {
      selectionId: 'sel_1', projectId: 'project_1', conversationId: 'conv_1', artifactId: 'deg_table',
      revisionId: 'rev_1', entityType: 'gene', entityIds: ['TP53', 'EGFR', 'MYC'], entityIdCount: 3,
      entityIdsTruncated: false, entityIdsHash: 'c'.repeat(64), filterHash: null,
      filterExpression: null, sort: [], displayState: { durable: true },
    }
    : overrides.selection;
  const changeSets = overrides.changeSets || [];
  const repository = {
    getRevision: (id) => (id === revision.revisionId ? revision : null),
    getCurrentRevision: () => (overrides.currentRevision === undefined ? revision : overrides.currentRevision),
    findRevisionByJobArtifact: ({ toolJobId, artifactId }) => (
      toolJobId === 'job_1' && artifactId === 'deg_table' ? revision : null
    ),
    findLatestSelection: () => selection,
    listChangeSets: () => changeSets,
    listRevisionsByChangeSet: (changeSetId) => (overrides.changeSetRevisions || {})[changeSetId] || [],
    getChangeSet: (id) => changeSets.find((item) => item.changeSetId === id) || null,
  };
  return {
    revision,
    repository,
    dependencies: {
      repository,
      db: { getUserById: () => null },
      getProject: () => ({ id: 'project_1', user_id: 'user_1', workspace_path: '/tmp/project_1' }),
      getToolJob: (id) => (id === 'job_1'
        ? {
          id: 'job_1', project_id: 'project_1', tool_id: 'deseq2', status: 'completed',
          result: {
            artifactTruth: { status: 'valid' },
            artifacts: [{ id: 'deg_table', name: 'deg_table.csv', type: 'table' }],
          },
        }
        : null),
      getPluginManifest: () => ({
        resultStudio: {
          descriptorVersion: 1,
          actions: ['select_genes', 'derive_enrichment_input'],
          parameters: { padj_cutoff: { type: 'number', default: 0.05 }, undeclared: { type: 'text' } },
          parameterImpacts: { padj_cutoff: 'scientific' },
          interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
        },
      }),
    },
  };
}

const ctx = { projectId: 'project_1', userId: 'user_1', conversationId: 'conv_1' };

test('RS-P3 resolves full coordinates from an artifact hint that carries no internal ids', () => {
  const fx = fixture();
  const resolved = resolveResultStudioContext(
    { ...ctx, activeArtifact: { jobId: 'job_1', name: 'deg_table.csv' } },
    fx.dependencies
  );
  assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics));
  assert.equal(resolved.envelope.revision.revisionId, 'rev_1');
  assert.equal(resolved.envelope.artifact.artifactFamilyId, 'family_1');
  assert.equal(resolved.envelope.job.toolJobId, 'job_1');
  assert.equal(resolved.envelope.selection.selectionId, 'sel_1');
  assert.equal(resolved.envelope.script.sha256, SCRIPT_SHA);
});

test('RS-P3 only exposes plugin parameters with a declared impact', () => {
  const fx = fixture();
  const resolved = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies);
  assert.deepEqual(resolved.envelope.plugin.editableParameters.map((item) => item.name), ['padj_cutoff']);
  assert.deepEqual(
    projectEditableParameters({ parameters: { a: {}, b: {} }, parameterImpacts: { b: 'presentation' } })
      .map((item) => item.name),
    ['b']
  );
});

test('RS-P3 refuses a cross-project revision hint and an unopened result', () => {
  const fx = fixture({ revision: { projectId: 'project_other' } });
  const foreign = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.diagnostics[0].code, 'context_artifact_not_open');

  const empty = resolveResultStudioContext({ ...ctx, activeArtifact: {} }, fixture().dependencies);
  assert.equal(empty.ok, false);
  assert.equal(empty.diagnostics[0].code, 'context_artifact_not_open');
});

test('P4R-4 restores a historical Revision selection even when current is newer', () => {
  const fx = fixture({ currentRevision: { revisionId: 'rev_2', artifactFamilyId: 'family_1' } });
  const resolved = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.envelope.selection.selectionId, 'sel_1');
  assert.equal(resolved.envelope.selectionState.compatibility, 'compatible');
  assert.equal(resolved.envelope.revision.isCurrent, false);
});

test('P4R-4 never replays the current Revision selection into a historical view', () => {
  const fx = fixture({
    currentRevision: { revisionId: 'rev_2', artifactFamilyId: 'family_1' },
    selection: {
      selectionId: 'sel_current', projectId: 'project_1', conversationId: 'conv_1', artifactId: 'deg_table',
      revisionId: 'rev_2', entityType: 'gene', entityIds: ['MYC'], entityIdCount: 1,
      entityIdsTruncated: false, entityIdsHash: 'd'.repeat(64), filterHash: null,
      filterExpression: null, sort: [], displayState: { durable: true },
    },
  });
  const resolved = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.envelope.selection, null);
  assert.equal(resolved.envelope.selectionState.compatibility, 'stale');
  assert.equal(resolved.envelope.revision.isCurrent, false);
});

test('RS-P3 context tool returns a bounded view and no internal ids', async () => {
  const fx = fixture();
  const tool = createResultStudioContextTool(fx.dependencies);
  const result = await tool({}, { ...ctx, activeArtifact: { revisionId: 'rev_1' } });
  assert.equal(result.ok, true);
  assert.match(result.context.contextToken, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(result.context);
  assert.equal(serialized.includes('job_1'), false);
  assert.equal(serialized.includes('rev_1'), false);
  assert.equal(serialized.includes('family_1'), false);
});

test('RS-P3 context tool reports an actionable diagnostic when no result is open', async () => {
  const fx = fixture();
  const tool = createResultStudioContextTool(fx.dependencies);
  const result = await tool({}, { ...ctx, activeArtifact: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'context_artifact_not_open');
  assert.deepEqual(result.publicPhases, [...PUBLIC_EDIT_PHASES]);
});

// ---------------------------------------------------------------------------
// 5. ChangeSet 上下文绑定
// ---------------------------------------------------------------------------

test('RS-P3 binds the single open change set and refuses to guess between several', () => {
  const single = fixture({
    changeSets: [{ changeSetId: 'cs_1', projectId: 'project_1', status: 'preview_ready', candidateCommit: 'a'.repeat(40) }],
    changeSetRevisions: { cs_1: [{ artifactFamilyId: 'family_1' }] },
  });
  const bound = resolveContextChangeSet({
    repository: single.repository, projectId: 'project_1', artifactFamilyId: 'family_1',
  });
  assert.equal(bound.ok, true);
  assert.equal(bound.changeSet.changeSetId, 'cs_1');

  const many = fixture({
    changeSets: [
      { changeSetId: 'cs_1', projectId: 'project_1', status: 'preview_ready' },
      { changeSetId: 'cs_2', projectId: 'project_1', status: 'running' },
    ],
    changeSetRevisions: { cs_1: [{ artifactFamilyId: 'family_1' }], cs_2: [{ artifactFamilyId: 'family_1' }] },
  });
  const ambiguous = resolveContextChangeSet({
    repository: many.repository, projectId: 'project_1', artifactFamilyId: 'family_1',
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error, 'context_change_set_ambiguous');

  const none = resolveContextChangeSet({
    repository: fixture().repository, projectId: 'project_1', artifactFamilyId: 'family_1',
  });
  assert.equal(none.ok, false);
  assert.equal(none.error, 'context_change_set_absent');
});

// ---------------------------------------------------------------------------
// 6. context-bound 编排：不新增第二套执行真相
// ---------------------------------------------------------------------------

test('RS-P3 context-bound plan fills the internal ids the model never supplied', async () => {
  const fx = fixture();
  let received = null;
  const progress = [];
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async (args) => { received = args; return { ok: true, status: 'ready', intent: { intentId: 'rei_1' } }; },
    changeSetTools: {},
  });
  const result = await tools.plan(
    { requestedOutcome: '把显著基因标出来', workflowPlan: { steps: [{ id: 'invented' }] } },
    {
      ...ctx,
      activeArtifact: { jobId: 'job_1', name: 'deg_table.csv' },
      emitResultEditProgress: (event) => progress.push(event),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(received.toolJobId, 'job_1');
  assert.equal(received.artifactId, 'deg_table');
  assert.equal(received.revisionId, 'rev_1');
  assert.equal(received.selectionId, 'sel_1');
  assert.equal(received.workflowPlan, null);
  assert.equal(result.publicPhase, 'assess_impact');
  assert.deepEqual(progress.map(({ stage, status }) => [stage, status]), [
    ['intent', 'completed'], ['plan', 'running'], ['plan', 'completed'],
  ]);
});

test('P6 context-bound plan exposes a stable diagnostic code when workflow truth blocks planning', async () => {
  const fx = fixture();
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({
      ok: false,
      status: 'blocked',
      diagnostics: [{
        code: 'workflow_lineage_missing',
        message: 'Internal workflow coordinates stay outside the public error code.',
        detail: { toolJobId: 'private_job_id' },
      }],
    }),
    changeSetTools: {},
  });

  const result = await tools.plan(
    { requestedOutcome: '调整阈值' },
    { ...ctx, activeArtifact: { revisionId: 'rev_1' } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error, 'workflow_lineage_missing');
});

test('P6 context-bound enrichment privately binds a compatible gene SelectionContext', async () => {
  const fx = fixture();
  let selectionCall = null;
  let revisionCalls = 0;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    resultSelectionRun: async (args) => {
      selectionCall = args;
      return { ok: true, selectionAction: { entityIdCount: 3, entityIdsHash: 'c'.repeat(64) } };
    },
    resultEnrichmentFromRevision: async () => {
      revisionCalls += 1;
      return { ok: true };
    },
    changeSetTools: {},
  });
  const activeArtifact = { revisionId: 'rev_1' };
  const resolved = resolveResultStudioContext({ ...ctx, activeArtifact }, fx.dependencies);

  const result = await tools.deriveEnrichmentFromCurrentResult({
    contextToken: resolved.envelope.contextToken,
    species: 'human',
    geneIdType: 'SYMBOL',
    analysisType: 'all',
  }, { ...ctx, activeArtifact });

  assert.equal(result.ok, true);
  assert.deepEqual(selectionCall, {
    selectionId: 'sel_1',
    action: 'go_kegg',
    species: 'human',
    geneIdType: 'SYMBOL',
    analysisType: 'all',
  });
  assert.equal(revisionCalls, 0);
  assert.equal(result.context.selectionEntityCount, 3);
});

test('P6 context-bound enrichment uses the full Revision when no compatible gene selection exists', async () => {
  const fx = fixture({ selection: null });
  let revisionCall = null;
  let selectionCalls = 0;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    resultSelectionRun: async () => {
      selectionCalls += 1;
      return { ok: true };
    },
    resultEnrichmentFromRevision: async (args) => {
      revisionCall = args;
      return { ok: true, enrichmentAction: { sourceArtifactId: 'deg_table' } };
    },
    changeSetTools: {},
  });
  const activeArtifact = { revisionId: 'rev_1' };
  const resolved = resolveResultStudioContext({ ...ctx, activeArtifact }, fx.dependencies);

  const result = await tools.deriveEnrichmentFromCurrentResult({
    contextToken: resolved.envelope.contextToken,
    species: 'human',
    geneIdType: 'SYMBOL',
    analysisType: 'all',
    padjCutoff: 0.05,
    lfcCutoff: 0.25,
  }, { ...ctx, activeArtifact });

  assert.equal(result.ok, true);
  assert.equal(selectionCalls, 0);
  assert.equal(revisionCall.revisionId, 'rev_1');
  assert.equal(revisionCall.padjCutoff, 0.05);
});

test('P5 binds volcano labels only from the current compatible selection', async () => {
  const fx = fixture();
  let received = null;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    getPluginManifest: () => ({
      resultStudio: {
        descriptorVersion: 1, actions: ['select_genes'],
        parameters: { label_genes: { type: 'text', default: '' } },
        parameterImpacts: { label_genes: 'presentation' },
        interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
      },
    }),
    planTool: async (args) => {
      received = args;
      return { ok: true, status: 'ready', intent: { intentId: 'rei_labels', artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' } } };
    },
    changeSetTools: {},
  });
  const result = await tools.plan({ requestedOutcome: '标注我选择的基因', useCurrentSelectionForLabels: true }, {
    ...ctx, activeArtifact: { revisionId: 'rev_1' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.selectionLabelsBound, 3);
  assert.deepEqual(received.proposedParameterPatch, { label_genes: 'TP53,EGFR,MYC' });

  const conflict = await tools.plan({
    requestedOutcome: '标注我选择的基因', useCurrentSelectionForLabels: true,
    proposedParameterPatch: { label_genes: 'MODEL_SUPPLIED' },
  }, { ...ctx, activeArtifact: { revisionId: 'rev_1' } });
  assert.equal(conflict.error, 'selection_label_binding_conflict');
});

test('RS-P3 context-bound create rejects a stale token before any job or changeset exists', async () => {
  const fx = fixture();
  let created = false;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true }),
    changeSetTools: { create: async () => { created = true; return { ok: true }; } },
  });
  const result = await tools.create(
    { contextToken: 'f'.repeat(64), intent: { artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' } } },
    { ...ctx, activeArtifact: { revisionId: 'rev_1' } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'context_token_stale');
  assert.equal(result.remediation, 'result_studio_context');
  assert.equal(created, false);
});

test('RS-P3 context-bound create refuses an intent planned against another revision', async () => {
  const fx = fixture();
  let created = false;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true }),
    changeSetTools: { create: async () => { created = true; return { ok: true }; } },
  });
  const envelope = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies).envelope;
  const result = await tools.create(
    { contextToken: envelope.contextToken, intent: { artifactRef: { artifactId: 'deg_table', revisionId: 'rev_old' } } },
    { ...ctx, activeArtifact: { revisionId: 'rev_1' } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'context_intent_mismatch');
  assert.equal(created, false);
});

test('RS-P3 context-bound create delegates to the existing changeset service and reports public phases', async () => {
  const fx = fixture();
  let delegated = null;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true, status: 'ready', intent: {
      intentId: 'rei_trusted',
      artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' },
      selectionRef: 'sel_1',
      requestedOutcome: '调整阈值',
      proposedParameterPatch: { padj_cutoff: 0.01 },
      editClass: 'scientific_recompute',
      affectedNodeIds: [],
      requiresJob: true,
      requiresScientificConfirmation: true,
    } }),
    changeSetTools: {
      create: async (args) => {
        delegated = args;
        return {
          ok: true,
          changeSet: { changeSetId: 'cs_1', status: 'preview_ready' },
          revision: { revisionId: 'rev_2' },
          toolJobId: 'job_2',
          progress: [
            { stage: 'change_set', status: 'running' },
            { stage: 'materialize', status: 'completed' },
            { stage: 'commit', status: 'completed' },
            { stage: 'job', status: 'completed' },
            { stage: 'revision', status: 'completed' },
            { stage: 'preview', status: 'ready' },
          ],
        };
      },
    },
  });
  const runCtx = { ...ctx, activeArtifact: { revisionId: 'rev_1' } };
  const planned = await tools.plan({ requestedOutcome: '调整阈值' }, runCtx);
  const envelope = resolveResultStudioContext(runCtx, fx.dependencies).envelope;
  const result = await tools.create(
    {
      contextToken: envelope.contextToken,
      intent: planned.intent,
      scientificConfirmed: true,
    },
    runCtx
  );
  assert.equal(result.ok, true);
  assert.equal(delegated.scientificConfirmed, true);
  assert.deepEqual(result.publicProgress.map((item) => item.phase), [
    'assess_impact', 'execute_or_recompute', 'validate', 'candidate_comparable',
  ]);
  assert.equal(JSON.stringify(result.publicProgress).includes('commit'), false);
});

test('P6 drawer-bound scientific confirmation cannot be promoted by the model tool arguments', async () => {
  const fx = fixture();
  let delegated = null;
  const canonical = {
    intentId: 'rei_drawer_confirmation',
    artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' },
    selectionRef: 'sel_1',
    requestedOutcome: '调整阈值',
    proposedParameterPatch: { padj_cutoff: 0.01 },
    editClass: 'scientific_recompute',
    affectedNodeIds: [],
    requiresJob: true,
    requiresScientificConfirmation: true,
  };
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true, status: 'confirmation_required', intent: canonical }),
    changeSetTools: { create: async (args) => { delegated = args; return { ok: true, progress: [] }; } },
  });

  const uncheckedContext = {
    ...ctx,
    activeArtifact: { revisionId: 'rev_1' },
    resultStudioScientificConfirmation: false,
  };
  const uncheckedPlan = await tools.plan({ requestedOutcome: '调整阈值' }, uncheckedContext);
  const uncheckedEnvelope = resolveResultStudioContext(uncheckedContext, fx.dependencies).envelope;
  const blocked = await tools.create({
    contextToken: uncheckedEnvelope.contextToken,
    intent: uncheckedPlan.intent,
    scientificConfirmed: true,
  }, uncheckedContext);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'scientific_confirmation_required');
  assert.equal(delegated, null);

  const acknowledgedContext = {
    ...ctx,
    activeArtifact: { revisionId: 'rev_1' },
    resultStudioScientificConfirmation: true,
  };
  const acknowledgedPlan = await tools.plan({ requestedOutcome: '调整阈值' }, acknowledgedContext);
  const acknowledgedEnvelope = resolveResultStudioContext(acknowledgedContext, fx.dependencies).envelope;
  const created = await tools.create({
    contextToken: acknowledgedEnvelope.contextToken,
    intent: acknowledgedPlan.intent,
    scientificConfirmed: false,
  }, acknowledgedContext);
  assert.equal(created.ok, true);
  assert.equal(delegated.scientificConfirmed, true);
});

test('P4R-3 create rejects a model-mutated planned intent and any script patch', async () => {
  const fx = fixture();
  let created = false;
  const canonical = {
    intentId: 'rei_sealed',
    artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' },
    selectionRef: 'sel_1',
    requestedOutcome: '调整阈值',
    proposedParameterPatch: { padj_cutoff: 0.01 },
    editClass: 'scientific_recompute',
    affectedNodeIds: [],
    requiresJob: true,
    requiresScientificConfirmation: true,
  };
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true, status: 'confirmation_required', intent: canonical }),
    changeSetTools: { create: async () => { created = true; return { ok: true }; } },
  });
  const runCtx = { ...ctx, activeArtifact: { revisionId: 'rev_1' } };
  const planned = await tools.plan({ requestedOutcome: '调整阈值' }, runCtx);
  const envelope = resolveResultStudioContext(runCtx, fx.dependencies).envelope;

  const downgraded = await tools.create({
    contextToken: envelope.contextToken,
    intent: { ...planned.intent, editClass: 'presentation_rerender', requiresScientificConfirmation: false },
    scientificConfirmed: false,
  }, runCtx);
  assert.equal(downgraded.error, 'context_intent_untrusted');
  assert.equal(created, false);

  const scriptPatched = await tools.create({
    contextToken: envelope.contextToken,
    intent: planned.intent,
    scientificConfirmed: true,
    scriptPatch: [{ oldText: 'a', newText: 'b' }],
  }, runCtx);
  assert.equal(scriptPatched.error, 'context_script_patch_forbidden');
  assert.equal(created, false);
});

test('P4R-3 selection change requires a fresh plan even when the caller learned the new token', async () => {
  const fx = fixture();
  let selection = fx.repository.findLatestSelection();
  const repository = { ...fx.repository, findLatestSelection: () => selection };
  const dependencies = { ...fx.dependencies, repository };
  const canonical = {
    intentId: 'rei_selection',
    artifactRef: { artifactId: 'deg_table', revisionId: 'rev_1' },
    selectionRef: 'sel_1', requestedOutcome: '标记所选基因', proposedParameterPatch: { padj_cutoff: 0.01 },
    editClass: 'scientific_recompute', affectedNodeIds: [], requiresJob: true,
    requiresScientificConfirmation: true,
  };
  let created = false;
  const tools = createResultContextEditTools({
    ...dependencies,
    planTool: async () => ({ ok: true, status: 'confirmation_required', intent: canonical }),
    changeSetTools: { create: async () => { created = true; return { ok: true }; } },
  });
  const runCtx = { ...ctx, activeArtifact: { revisionId: 'rev_1' } };
  const planned = await tools.plan({ requestedOutcome: '标记所选基因' }, runCtx);
  selection = { ...selection, selectionId: 'sel_2', entityIdsHash: 'd'.repeat(64), updatedAt: '2026-07-28T00:10:00.000Z' };
  const refreshed = resolveResultStudioContext(runCtx, dependencies).envelope;
  const replay = await tools.create({
    contextToken: refreshed.contextToken, intent: planned.intent, scientificConfirmed: true,
  }, runCtx);
  assert.equal(replay.error, 'context_intent_selection_mismatch');
  assert.equal(created, false);
});

test('RS-P3 context-bound adopt requires a token and binds the change set automatically', async () => {
  const fx = fixture({
    changeSets: [{ changeSetId: 'cs_1', projectId: 'project_1', status: 'preview_ready', candidateCommit: 'a'.repeat(40) }],
    changeSetRevisions: { cs_1: [{ artifactFamilyId: 'family_1' }] },
  });
  let adopted = null;
  const tools = createResultContextEditTools({
    ...fx.dependencies,
    planTool: async () => ({ ok: true }),
    changeSetTools: { adopt: async (args) => { adopted = args; return { ok: true, changeSet: { status: 'adopted' } }; } },
  });
  const active = { ...ctx, activeArtifact: { revisionId: 'rev_1' } };

  const missingToken = await tools.adopt({}, active);
  assert.equal(missingToken.ok, false);
  assert.equal(missingToken.error, 'context_token_required');
  assert.equal(adopted, null);

  const envelope = resolveResultStudioContext(active, fx.dependencies).envelope;
  const result = await tools.adopt({ contextToken: envelope.contextToken }, active);
  assert.equal(result.ok, true);
  assert.equal(adopted.changeSetId, 'cs_1');
});

test('RS-P3 guard blocks every context-bound write when attribution is job-only', () => {
  const fx = fixture({ revision: { sourceScriptRef: null } });
  const guarded = guardContextOperation(
    { ...ctx, activeArtifact: { revisionId: 'rev_1' } },
    { contextToken: 'a'.repeat(64) },
    fx.dependencies
  );
  assert.equal(guarded.ok, false);
  assert.equal(guarded.response.error, 'context_attribution_job_only');
});

test('RS-P3 token is stable across repeated projections of unchanged truth', () => {
  const fx = fixture();
  const first = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies).envelope;
  const second = resolveResultStudioContext({ ...ctx, activeArtifact: { revisionId: 'rev_1' } }, fx.dependencies).envelope;
  assert.equal(first.contextToken, second.contextToken);
  const { contextToken, ...rest } = first;
  assert.equal(computeContextToken(rest), contextToken);
});
