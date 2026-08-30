import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { sha256 } = require('../core/shared-backend/result-revision-source');
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance');
const { validateResultEditIntent } = require('../core/shared-backend/result-edit-intent');
const {
  buildAuthoritativeWorkflowGraph,
  workflowGraphDigest,
} = require('../core/shared-backend/result-workflow-graph');
const { stableStringify } = require('../core/shared-backend/scientific-task-spec');
const { REPLAY_PACKAGE_VERSION } = require('../core/shared-backend/scientific-replay-package');
const { restoreArtifactRevision } = require('../core/shared-backend/result-compare-service');
const {
  ResultReplayError,
  buildReplayExecutionParams,
  buildSourceCohortReplayPackage,
  createControlledReplayService,
  projectReplayExecutionCohort,
  validateResultChangeSetReplayPackage,
  verifyReplayPackageOutputJobs,
  verifyReplayOutputCohort,
} = require('../core/shared-backend/result-replay-service');

const CHILD_REQUIRED_FILES = [
  'task-spec.json',
  'context-checkpoint.json',
  'workflow-plan.json',
  'job-manifest.json',
  'artifact-manifest.json',
  'delivery-manifest.json',
  'provenance.json',
  'replay.json',
  'HANDOFF.md',
  'repro/reproduce.mjs',
];

function collectReplayPackageFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectReplayPackageFiles(root, absolute));
    } else if (entry.isFile() && relative(root, absolute) !== 'package-manifest.json') {
      files.push({
        relativePath: relative(root, absolute).split('\\').join('/'),
        sha256: sha256(readFileSync(absolute)),
        sizeBytes: statSync(absolute).size,
      });
    }
  }
  return files;
}

function writeValidChildReplayPackage(childDir, {
  sourceId,
  toolId,
  projectId,
  revisions,
}) {
  mkdirSync(join(childDir, 'repro'), { recursive: true });
  for (const relativePath of CHILD_REQUIRED_FILES) {
    const target = join(childDir, relativePath);
    const contents = relativePath === 'HANDOFF.md'
      ? '# Test Replay Package\n'
      : relativePath === 'repro/reproduce.mjs'
        ? 'process.exit(0);\n'
        : relativePath === 'job-manifest.json'
          ? `${JSON.stringify({ id: sourceId, toolId, projectId })}\n`
          : relativePath === 'replay.json'
            ? `${JSON.stringify({
              plugin: { id: toolId },
              artifacts: revisions.map((revision) => ({
                artifactId: revision.artifactId,
                sourceArtifactId: revision.artifactId,
                expected: { sha256: revision.outputHash },
              })),
            })}\n`
            : '{}\n';
    writeFileSync(target, contents);
  }
  const files = collectReplayPackageFiles(childDir);
  const manifestPayload = {
    replayPackageVersion: REPLAY_PACKAGE_VERSION,
    status: 'complete',
    sourceDigest: sha256(`source:${sourceId}`),
    privacyMode: 'references_only',
    requiredFiles: CHILD_REQUIRED_FILES,
    files,
    generatedAt: '2026-07-29T00:00:00.000Z',
  };
  const packageDigest = sha256(stableStringify(manifestPayload));
  writeFileSync(join(childDir, 'package-manifest.json'), `${JSON.stringify({ ...manifestPayload, packageDigest }, null, 2)}\n`);
  return { packageDigest, status: 'complete' };
}

function fixture(context, runChangeSet) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-controlled-replay-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const sqlite = new Database(join(workspaceRoot, 'replay.db'));
  context.after(() => sqlite.close());
  ensureResultStudioSchema(sqlite);
  const repository = createResultStudioRepository(sqlite);
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
  const provenancePayload = {
    executionProvenanceVersion: 1,
    toolJobId: 'job_1', projectId: 'p_1',
    plugin: { id: 'deseq2', version: '1.2.3', language: 'r', packageConstraints: {} },
    runtime: { name: 'R', version: '4.5.2', readiness: true },
    params: { normalized, sha256: sha256(JSON.stringify(normalized)) },
    inputs: [{ id: 'counts', role: 'counts', relativePath: 'inputs/counts.csv', sha256: inputHash }],
    script: { snapshotPath: join(workspaceRoot, 'run.R'), sha256: sha256(source), entryPoint: 'run.R' },
    artifacts: [{ id: 'table', filename: 'table.csv', sha256: outputHash }],
  };
  const job = {
    id: 'job_1', project_id: 'p_1', tool_id: 'deseq2', status: 'completed',
    params: { alpha: 0.05, counts: inputPath },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'table', type: 'table', path: outputPath }],
      executionProvenance: {
        ...provenancePayload,
        provenanceHash: computeExecutionProvenanceHash(provenancePayload),
      },
    },
  };
  const graphResult = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1',
    sourceToolJobId: job.id,
    jobs: [job],
    repository,
  });
  assert.equal(graphResult.ok, true);
  repository.createChangeSet({
    changeSetId: 'cs_1', projectId: 'p_1', baseCommit: committed.commit,
    workingBranchRef: 'refs/heads/biof3/replay-source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_1', to: 'running' });
  repository.appendRevisionBatch({
    revisions: [{
      revisionId: 'rev_1', projectId: 'p_1', artifactFamilyId: 'family_1', artifactId: 'table',
      sourceCommit: committed.commit,
      sourceScriptRef: {
        relativePath: sourcePath, sha256: sha256(source), entryPoint: 'table.R', artifactId: 'table',
        rendererId: 'deseq2:table', language: 'r', origin: 'project_materialized',
      },
      inputArtifactRefs: [{ artifactId: 'counts', hash: inputHash, role: 'counts' }],
      parametersRef: parametersPath, parametersHash: sha256(parameters), toolJobId: 'job_1',
      outputPath: 'results/jobs/job_1/output/table.csv', outputHash,
      validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_1',
    }],
    workflowGraph: graphResult.graph,
    transition: {
      changeSetId: 'cs_1',
      to: 'preview_ready',
      candidateCommit: committed.commit,
      candidateArtifactRefs: ['rev_1'],
      jobRefs: ['job_1'],
      validationSummary: {
        formalArtifactCount: 1,
        validatorIds: ['fixture-validator'],
        workflowGraph: {
          graphId: graphResult.graph.graphId,
          sourceDigest: graphResult.graph.sourceDigest,
        },
      },
    },
  });
  repository.adoptChangeSet({ changeSetId: 'cs_1', candidateCommit: committed.commit });
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
    buildResultRevisionReplayPackage: () => ({
      packageDir: workspaceRoot,
      packageManifest: { packageDigest: 'f'.repeat(64), status: 'complete' },
      replay: {},
      validation: { ok: true },
    }),
    verifyReplayOutputCohort: () => ({
      exactMatch: true,
      artifactCount: 1,
      outputCohortHash: 'e'.repeat(64),
    }),
    buildRevisionReplayProofs: () => [{
      sourceRevisionId: 'rev_1',
      replayRevisionId: 'rev_2',
      replayToolJobId: 'job_2',
      sourceOutputHash: outputHash,
      replayOutputHash: outputHash,
    }],
    persistReplayProof: () => ({ replayProof: { exactMatch: true } }),
  });
  const request = {
    projectId: 'p_1', revisionId: 'rev_1', conversationId: 'conv_1',
    contextToken: 'c'.repeat(64), expectedSourceSha256: sha256(source),
    expectedParametersHash: sha256(parameters),
  };
  return { workspaceRoot, repository, service, dependencies, request, inputPath };
}

test('P5 rehydrates an HTTP-uploaded input from result_json when public params omit its path', (context) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-replay-uploaded-input-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const jobRoot = join(workspaceRoot, 'results', 'jobs', 'job_uploaded');
  const scriptPath = join(jobRoot, 'run-script.R');
  const inputPath = join(jobRoot, 'counts.csv');
  mkdirSync(jobRoot, { recursive: true });
  writeFileSync(scriptPath, 'print("replay")\n');
  writeFileSync(inputPath, 'gene,s1\nA,1\n');
  const inputHash = sha256(readFileSync(inputPath));
  const sourceJob = {
    id: 'job_uploaded',
    params_json: JSON.stringify({ alpha: 0.05 }),
    result_json: JSON.stringify({
      executionProvenance: {
        script: { snapshotPath: scriptPath },
        inputs: [{
          id: 'counts',
          relativePath: 'inputs/counts/counts.csv',
          sha256: inputHash,
        }],
      },
    }),
  };
  const runtime = buildReplayExecutionParams({
    sourceJob,
    workspaceRoot,
    sourceProjection: {
      parameters: {
        rawValues: {
          alpha: 0.05,
          counts: { inputRef: 'inputs/counts/counts.csv', sha256: inputHash },
        },
      },
    },
  });
  assert.equal(runtime.counts, realpathSync(inputPath));
  assert.equal(runtime.alpha, 0.05);
});

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
  assert.equal(validateResultEditIntent(calls[0].intent).ok, true);
  assert.deepEqual(
    calls[0].intent.workflowGraph,
    fx.repository.getChangeSet('cs_1').validationSummary.workflowGraph,
  );
  assert.equal(calls[0].scientificConfirmed, true);
  assert.deepEqual(calls[0].scriptPatch, []);
  assert.equal(calls[0].sourceJob.params.counts, realpathSync(fx.inputPath));
  assert.deepEqual(calls[0].normalizedSourceParams.counts, {
    inputRef: 'inputs/counts.csv', sha256: sha256('gene,s1\nA,1\n'),
  });
  assert.equal(fx.repository.getCurrentRevision('family_1', 'p_1').revisionId, 'rev_1');
});

test('P5 single-Job scientific replay fails closed when its persisted workflow graph is missing', (context) => {
  const fx = fixture(context, async () => { throw new Error('must not execute'); });
  const repositoryWithoutGraph = {
    ...fx.repository,
    getWorkflowGraph: () => null,
  };
  assert.throws(
    () => fx.service.prepare(fx.request, {
      ...fx.dependencies,
      repository: repositoryWithoutGraph,
    }),
    (error) => error instanceof ResultReplayError && error.code === 'replay_workflow_graph_missing',
  );
});

test('P5 single-Job historical restore preserves a replayable authoritative workflow graph', (context) => {
  const fx = fixture(context, async () => { throw new Error('preflight must not execute'); });
  const sourceRevision = fx.repository.getRevision('rev_1');
  const replacementSource = 'message("replacement current")\n';
  const replacementParameters = '{\n  "alpha": 0.1\n}\n';
  const replacementSourcePath = 'analysis/scripts/family_1/rev_current/table.R';
  const replacementParametersPath = 'analysis/scripts/family_1/rev_current/parameters.json';
  const replacementCommit = fx.dependencies.adapter.commitVirtualFiles({
    parentCommit: sourceRevision.sourceCommit,
    ref: 'refs/heads/biof3/replay-current',
    expectedOld: '0'.repeat(40),
    message: 'replacement current',
    files: [
      { path: replacementSourcePath, content: replacementSource },
      { path: replacementParametersPath, content: replacementParameters },
    ],
  });
  fx.repository.createChangeSet({
    changeSetId: 'cs_current',
    projectId: 'p_1',
    baseCommit: sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/replay-current',
    createdBy: 'agent',
    parentArtifactRefs: ['rev_1'],
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_current', to: 'running' });
  fx.repository.appendRevisionBatch({
    revisions: [{
      revisionId: 'rev_current',
      projectId: 'p_1',
      artifactFamilyId: 'family_1',
      artifactId: 'table',
      parentRevisionIds: ['rev_1'],
      sourceCommit: replacementCommit.commit,
      sourceScriptRef: {
        ...sourceRevision.sourceScriptRef,
        relativePath: replacementSourcePath,
        sha256: sha256(replacementSource),
        entryPoint: 'table.R',
      },
      inputArtifactRefs: sourceRevision.inputArtifactRefs,
      parametersRef: replacementParametersPath,
      parametersHash: sha256(replacementParameters),
      toolJobId: sourceRevision.toolJobId,
      outputPath: sourceRevision.outputPath,
      outputHash: sourceRevision.outputHash,
      validationStatus: 'valid',
      reproducibilityStatus: 'available',
      changeSetId: 'cs_current',
    }],
    transition: {
      changeSetId: 'cs_current',
      to: 'preview_ready',
      candidateCommit: replacementCommit.commit,
      candidateArtifactRefs: ['rev_current'],
      jobRefs: ['job_1'],
      validationSummary: {
        formalArtifactCount: 1,
        validatorIds: ['fixture-validator'],
      },
    },
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_current', candidateCommit: replacementCommit.commit });

  const restored = restoreArtifactRevision({
    projectId: 'p_1',
    workspaceRoot: fx.workspaceRoot,
    revisionId: 'rev_1',
    createdBy: 'user',
  }, fx.dependencies);
  const restoredGraphRef = restored.changeSet.validationSummary.workflowGraph;
  assert.ok(restoredGraphRef?.graphId);
  assert.deepEqual(restored.changeSet.validationSummary.restoredWorkflowGraph, restoredGraphRef);

  const prepared = fx.service.prepare({
    ...fx.request,
    revisionId: restored.revision.revisionId,
  }, fx.dependencies);
  assert.equal(prepared.status, 'confirmation_required');
  assert.equal(prepared.revision.revisionId, restored.revision.revisionId);
  assert.equal(prepared.execution.sourceRevisionCount, 1);
  assert.equal(prepared.execution.affectedJobCount, 1);
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

test('exact replay proof covers the complete formal output cohort and rejects one-byte drift', (context) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'biof3-controlled-replay-cohort-'));
  context.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const pngPath = join(workspaceRoot, 'results', 'job_2', 'volcano.png');
  const svgPath = join(workspaceRoot, 'results', 'job_2', 'volcano.svg');
  const reportPath = join(workspaceRoot, 'results', 'job_2', 'run-report.txt');
  mkdirSync(join(pngPath, '..'), { recursive: true });
  writeFileSync(pngPath, 'PNG deterministic bytes');
  writeFileSync(svgPath, '<svg>deterministic</svg>');
  writeFileSync(reportPath, 'non-formal execution report');
  const pngHash = sha256('PNG deterministic bytes');
  const svgHash = sha256('<svg>deterministic</svg>');
  const replay = {
    plugin: { id: 'volcano-plot', version: '1.0.0' },
    script: { sha256: 'a'.repeat(64) },
    artifacts: [
      { artifactId: 'volcano_png', sourceArtifactId: 'volcano_png', expected: { sha256: pngHash } },
      { artifactId: 'volcano_svg', sourceArtifactId: 'volcano_svg', expected: { sha256: svgHash } },
    ],
  };
  const job = {
    id: 'job_2',
    status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [
        { id: 'volcano_png', path: pngPath },
        { id: 'volcano_svg', path: svgPath },
        { id: 'run_report', path: reportPath },
      ],
      executionProvenance: {
        plugin: { id: 'volcano-plot', version: '1.0.0' },
        script: { sha256: 'a'.repeat(64) },
        artifacts: [
          { id: 'volcano_png', sha256: pngHash },
          { id: 'volcano_svg', sha256: svgHash },
          { id: 'run_report', sha256: sha256('non-formal execution report') },
        ],
      },
    },
  };
  const verified = verifyReplayOutputCohort({ replay, job, workspaceRoot });
  assert.equal(verified.exactMatch, true);
  assert.equal(verified.artifactCount, 2);
  assert.match(verified.outputCohortHash, /^[a-f0-9]{64}$/);

  writeFileSync(svgPath, '<svg>drift</svg>');
  assert.throws(
    () => verifyReplayOutputCohort({ replay, job, workspaceRoot }),
    (error) => error instanceof ResultReplayError && error.code === 'replay_output_hash_mismatch',
  );
});

test('P5 multi-Job replay is rooted by the persisted DEG to GO graph even when the selected Revision is downstream', () => {
  const revisions = [
    {
      revisionId: 'rev_deg', projectId: 'p_1', toolJobId: 'job_deg',
      artifactFamilyId: 'family_deg', artifactId: 'deg_table', outputHash: 'a'.repeat(64),
    },
    {
      revisionId: 'rev_summary', projectId: 'p_1', toolJobId: 'job_deg',
      artifactFamilyId: 'family_summary', artifactId: 'deg_summary', outputHash: 'b'.repeat(64),
    },
    {
      revisionId: 'rev_go', projectId: 'p_1', toolJobId: 'job_go',
      artifactFamilyId: 'family_go', artifactId: 'go_bp_results', outputHash: 'c'.repeat(64),
    },
  ];
  const replayJob = (id, toolId, artifacts) => {
    const provenance = {
      executionProvenanceVersion: 1,
      projectId: 'p_1',
      toolJobId: id,
      inputs: [],
      artifacts,
    };
    provenance.provenanceHash = computeExecutionProvenanceHash(provenance);
    return {
      id, project_id: 'p_1', tool_id: toolId, status: 'completed',
      result: {
        artifactTruth: { status: 'valid', blocking: false },
        executionProvenance: provenance,
      },
    };
  };
  const jobs = new Map([
    ['job_deg', replayJob('job_deg', 'deseq2', [
      { id: 'deg_summary', sha256: 'b'.repeat(64) },
      { id: 'deg_table', sha256: 'a'.repeat(64) },
    ])],
    ['job_go', replayJob('job_go', 'go-kegg', [
      { id: 'go_bp_results', sha256: 'c'.repeat(64) },
    ])],
  ]);
  const nodes = [
    {
      id: 'job:job_deg', toolJobId: 'job_deg', toolId: 'deseq2',
      artifactIds: ['deg_summary', 'deg_table'],
      provenanceHash: jobs.get('job_deg').result.executionProvenance.provenanceHash,
      dependsOn: [],
    },
    {
      id: 'job:job_go', toolJobId: 'job_go', toolId: 'go-kegg',
      artifactIds: ['go_bp_results'],
      provenanceHash: jobs.get('job_go').result.executionProvenance.provenanceHash,
      dependsOn: ['job:job_deg'],
    },
  ];
  const edges = [{
      kind: 'artifact', fromNodeId: 'job:job_deg', toNodeId: 'job:job_go', inputId: 'deg_table',
      sourceToolJobId: 'job_deg', sourceRevisionId: 'rev_deg', sourceArtifactId: 'deg_table',
      sourceOutputHash: 'a'.repeat(64), selectionId: null, selectionHash: null,
  }];
  const sourceDigest = workflowGraphDigest({
    projectId: 'p_1', rootToolJobId: 'job_deg', nodes, edges,
  });
  const graph = {
    contractVersion: 1,
    graphId: `wfg_${sourceDigest.slice(0, 24)}`, sourceDigest, validationStatus: 'valid',
    projectId: 'p_1', rootToolJobId: 'job_deg',
    nodes,
    edges,
  };
  const projected = projectReplayExecutionCohort({
    sourceRevisions: revisions,
    selectedRevision: revisions[2],
    workflowGraph: graph,
    getToolJob: (id) => jobs.get(id) || null,
  });
  assert.equal(projected.rootRevision.revisionId, 'rev_deg');
  assert.deepEqual(projected.groups.map((group) => group.formalArtifactIds), [
    ['deg_summary', 'deg_table'],
    ['go_bp_results'],
  ]);
  assert.deepEqual(projected.affectedNodeIds, ['job:job_deg', 'job:job_go']);
  assert.equal(projected.authoritativeSubgraph.children[0].childRevisionId, 'rev_go');
});

test('P5 verifies every replay Job in authoritative order before producing one cohort hash', async () => {
  const calls = [];
  const jobs = new Map([
    ['candidate_deg', { id: 'candidate_deg', tool_id: 'deseq2' }],
    ['candidate_go', { id: 'candidate_go', tool_id: 'go-kegg' }],
  ]);
  const replayPackage = {
    jobs: [
      { sourceToolJobId: 'source_deg', toolId: 'deseq2', replay: { task: 'deg' } },
      { sourceToolJobId: 'source_go', toolId: 'go-kegg', replay: { task: 'go' } },
    ],
  };
  const verified = await verifyReplayPackageOutputJobs({
    replayPackage,
    changeSetResult: { changeSet: { jobRefs: ['candidate_deg', 'candidate_go'] } },
    getToolJob: (id) => jobs.get(id) || null,
    workspaceRoot: '/unused',
    verifyReplayOutputs: ({ replay, job }) => {
      calls.push([replay.task, job.id]);
      return { exactMatch: true, artifactCount: replay.task === 'deg' ? 2 : 1, outputCohortHash: replay.task.repeat(32).slice(0, 64) };
    },
  });
  assert.deepEqual(calls, [['deg', 'candidate_deg'], ['go', 'candidate_go']]);
  assert.equal(verified.artifactCount, 3);
  assert.match(verified.outputCohortHash, /^[a-f0-9]{64}$/);
  await assert.rejects(
    verifyReplayPackageOutputJobs({
      replayPackage,
      changeSetResult: { changeSet: { jobRefs: ['candidate_go', 'candidate_deg'] } },
      getToolJob: (id) => jobs.get(id) || null,
      workspaceRoot: '/unused',
      verifyReplayOutputs: () => ({ exactMatch: true, artifactCount: 1, outputCohortHash: 'e'.repeat(64) }),
    }),
    (error) => error instanceof ResultReplayError && error.code === 'replay_output_job_order_drift',
  );
});

test('P5 cohort ReplayPackage binds and independently validates every per-Job package', async (context) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'biof3-replay-cohort-package-'));
  context.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const packageDir = join(projectRoot, '.biof3', 'replay-packages', 'cohort');
  const revisions = [
    { revisionId: 'rev_deg', toolJobId: 'job_deg', artifactFamilyId: 'family_deg', artifactId: 'deg_table', outputHash: 'a'.repeat(64) },
    { revisionId: 'rev_go', toolJobId: 'job_go', artifactFamilyId: 'family_go', artifactId: 'go_bp_results', outputHash: 'b'.repeat(64) },
  ];
  const execution = {
    rootRevision: revisions[0],
    groups: [
      { sourceToolJobId: 'job_deg', toolId: 'deseq2', job: { id: 'job_deg' }, revisions: [revisions[0]], formalArtifactIds: ['deg_table'] },
      { sourceToolJobId: 'job_go', toolId: 'go-kegg', job: { id: 'job_go' }, revisions: [revisions[1]], formalArtifactIds: ['go_bp_results'] },
    ],
  };
  const graphNodes = [
    {
      id: 'job:job_deg', toolJobId: 'job_deg', toolId: 'deseq2',
      artifactIds: ['deg_table'], provenanceHash: 'c'.repeat(64), dependsOn: [],
    },
    {
      id: 'job:job_go', toolJobId: 'job_go', toolId: 'go-kegg',
      artifactIds: ['go_bp_results'], provenanceHash: 'd'.repeat(64), dependsOn: ['job:job_deg'],
    },
  ];
  const graphEdges = [{
    kind: 'artifact', fromNodeId: 'job:job_deg', toNodeId: 'job:job_go',
    sourceToolJobId: 'job_deg', sourceRevisionId: 'rev_deg', sourceArtifactId: 'deg_table',
    sourceOutputHash: 'a'.repeat(64), selectionId: null, selectionHash: null, inputId: 'deg_table',
  }];
  const sourceDigest = workflowGraphDigest({
    projectId: 'p_1',
    rootToolJobId: 'job_deg',
    nodes: graphNodes,
    edges: graphEdges,
  });
  const workflowGraph = {
    contractVersion: 1,
    projectId: 'p_1',
    validationStatus: 'valid',
    graphId: `wfg_${sourceDigest.slice(0, 24)}`,
    sourceDigest,
    rootToolJobId: 'job_deg',
    nodes: graphNodes,
    edges: graphEdges,
  };
  const built = await buildSourceCohortReplayPackage({
    builder: ({ job, packageDir: childDir }) => {
      mkdirSync(childDir, { recursive: true });
      const group = execution.groups.find((candidate) => candidate.sourceToolJobId === job.id);
      const packageManifest = writeValidChildReplayPackage(childDir, {
        sourceId: job.id,
        toolId: group.toolId,
        projectId: 'p_1',
        revisions: group.revisions,
      });
      return {
        packageDir: childDir,
        packageManifest,
        replay: { jobId: job.id },
        validation: { ok: true },
      };
    },
    execution,
    selectedRevision: revisions[1],
    sourceChangeSet: { changeSetId: 'cs_source', candidateCommit: 'f'.repeat(40) },
    projectRoot,
    packageDir,
    workflowGraph,
  });
  assert.equal(built.cohort, true);
  assert.equal(built.jobs.length, 2);
  assert.equal(validateResultChangeSetReplayPackage(packageDir).ok, true);
  writeFileSync(
    join(packageDir, 'jobs', 'job_go', 'package-manifest.json'),
    JSON.stringify({ requiredFiles: ['missing.json'], files: [], packageDigest: 'e'.repeat(64) }),
  );
  assert.equal(validateResultChangeSetReplayPackage(packageDir).ok, false);
});

test('P5 HTTP replay preserves generated downstream Artifact lineage through the registered tool boundary', () => {
  const routeSource = readFileSync(join(import.meta.dirname, '..', 'core/biof3-server/routes/result-studio.js'), 'utf8');
  const replayRouteStart = routeSource.indexOf("app.post('/api/result-studio/revisions/:revisionId/replay'");
  const replayRouteEnd = routeSource.indexOf("app.get('/api/result-studio/changesets/:changeSetId/compare'", replayRouteStart);
  assert.ok(replayRouteStart >= 0 && replayRouteEnd > replayRouteStart, 'controlled replay route is unavailable');
  const replayRoute = routeSource.slice(replayRouteStart, replayRouteEnd);
  assert.match(replayRoute, /const persistedConversationId = persistedToolJobConversation\(sourceJob\)/);
  assert.match(replayRoute, /const conversationId = persistedConversationId \|\| requestedConversationId/);
  assert.match(replayRoute, /executeJob:\s*async\s*\(\{[\s\S]*?resultStudioInputLineage\s*=\s*null[\s\S]*?\}\)\s*=>/);
  assert.match(replayRoute, /mcpRegistry\.callTool\([\s\S]*?conversationId,[\s\S]*?resultStudioInputLineage[\s\S]*?\);/);
});
