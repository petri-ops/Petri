'use strict';

/**
 * Controlled ArtifactRevision replay.
 *
 * Replay is intentionally a two-step, server-issued confirmation flow. The
 * caller may select a persisted Revision and present expectation hashes, but
 * may not supply a tool id, params, script patch, command, shell request or
 * workflow plan. Source, normalized parameters and input identities are read
 * again from Git / SQLite / Job provenance immediately before execution.
 *
 * The actual computation is delegated to createResultChangeSet(), which uses
 * the existing registered-tool -> tool_job -> Artifact Truth path and leaves a
 * non-current candidate Revision for review. This module never adopts it.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stableStringify } = require('./canonical-json');
const { isPathContained } = require('./project-run-layout');
const {
  resolveExecutionInputPath,
  verifyExecutionProvenance,
} = require('./execution-provenance');
const {
  verifyWorkflowGraphIntegrity,
  workflowGraphDigest,
} = require('./result-workflow-graph');
const { createResultChangeSet, sha256 } = require('./result-changeset-service');
const {
  ResultRevisionSourceError,
  verifyRevisionSourceMaterial,
} = require('./result-revision-source');
const {
  buildResultRevisionReplayPackage,
  relativeInside,
  validateScientificReplayPackage,
} = require('./scientific-replay-package');


// BLOCK-92 Wave C-8 — 回放包契约与校验/证明/打包簇外迁
// （./result-replay-service/cohort-package.js，纯搬运零行为变化）。
const {
  CONTROLLED_REPLAY_VERSION,
  DEFAULT_CONFIRMATION_TTL_MS,
  SHA256,
  GIT_COMMIT,
  SAFE_ID,
  RESULT_CHANGESET_REPLAY_PACKAGE_VERSION,
  REPLAY_PACKAGE_STATUSES,
  COHORT_MANIFEST_FIELDS,
  COHORT_WORKFLOW_FIELDS,
  COHORT_WORKFLOW_NODE_FIELDS,
  COHORT_WORKFLOW_EDGE_FIELDS,
  COHORT_REVISION_FIELDS,
  COHORT_JOB_FIELDS,
  REQUEST_FIELDS,
  ResultReplayError,
  fail,
  object,
  cloneJson,
  stableHash,
  assertAllowedReplayRequest,
  safeIdentifier,
  expectedInputMap,
  hashFile,
  resolveIntactInput,
  projectSourceJobParams,
  buildReplayExecutionParams,
  assertExpectedHashes,
  assertRevisionOutput,
  parseJobResult,
  verifyReplayOutputCohort,
  buildRevisionReplayProofs,
  projectReplayExecutionCohort,
  replayCohortFingerprint,
  hasExactFields,
  isSafeIdentifier,
  isSafeCohortRelativePath,
  isStrictlyContainedPath,
  isSafeWorkflowNodeId,
  validUniqueIdentifiers,
  readRegularJsonInside,
  resolveCohortChildDirectory,
  validateCohortPackageRoot,
  validateCohortWorkflowGraph,
  validateCohortChildPackage,
  validateResultChangeSetReplayPackage,
} = require('./result-replay-service/cohort-package');

async function buildSourceCohortReplayPackage({
  builder,
  execution,
  selectedRevision,
  sourceChangeSet,
  projectRoot,
  packageDir,
  workflowGraph,
} = {}) {
  if (typeof builder !== 'function' || !execution || !sourceChangeSet || !projectRoot || !packageDir) {
    fail('replay_package_dependencies_missing', 'ReplayPackage cohort builder dependencies are incomplete.', 500);
  }
  const buildGroup = async (group, targetDir) => {
    const representative = group.revisions.find((revision) => revision.revisionId === selectedRevision.revisionId)
      || group.revisions.find((revision) => revision.revisionId === execution.rootRevision.revisionId)
      || group.revisions[0];
    const built = await Promise.resolve(builder({
      revision: representative,
      changeSet: sourceChangeSet,
      job: group.job,
      projectRoot,
      packageDir: targetDir,
      workflowGraph,
      formalArtifactIds: group.formalArtifactIds,
    }));
    const validation = built?.validation?.ok
      ? built.validation
      : validateScientificReplayPackage(built?.packageDir || targetDir);
    if (!validation.ok || !SHA256.test(String(built?.packageManifest?.packageDigest || ''))) {
      fail('replay_package_invalid', 'A Result Studio ReplayPackage Job failed integrity validation.');
    }
    return { group, built, validation };
  };
  if (execution.groups.length === 1) {
    const only = await buildGroup(execution.groups[0], packageDir);
    return {
      ...only.built,
      jobs: [{
        sourceToolJobId: only.group.sourceToolJobId,
        toolId: only.group.toolId,
        formalArtifactIds: only.group.formalArtifactIds,
        replay: only.built.replay,
      }],
      cohort: false,
    };
  }

  fs.mkdirSync(packageDir, { recursive: true });
  const builtGroups = [];
  for (const group of execution.groups) {
    const jobId = safeIdentifier(group.sourceToolJobId, 'replay_source_job_id');
    builtGroups.push(await buildGroup(group, path.join(packageDir, 'jobs', jobId)));
  }
  const payload = {
    resultChangeSetReplayPackageVersion: 1,
    sourceChangeSetId: sourceChangeSet.changeSetId,
    sourceCandidateCommit: sourceChangeSet.candidateCommit,
    selectedSourceRevisionId: selectedRevision.revisionId,
    executionRootRevisionId: execution.rootRevision.revisionId,
    workflowGraph: {
      contractVersion: workflowGraph.contractVersion,
      projectId: workflowGraph.projectId,
      validationStatus: workflowGraph.validationStatus,
      graphId: workflowGraph.graphId,
      sourceDigest: workflowGraph.sourceDigest,
      rootToolJobId: workflowGraph.rootToolJobId,
      nodes: workflowGraph.nodes,
      edges: workflowGraph.edges,
    },
    revisions: execution.groups.flatMap((group) => group.revisions.map((revision) => ({
      revisionId: revision.revisionId,
      toolJobId: revision.toolJobId,
      artifactFamilyId: revision.artifactFamilyId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
    }))),
    jobs: builtGroups.map(({ group, built }) => ({
      sourceToolJobId: group.sourceToolJobId,
      toolId: group.toolId,
      formalArtifactIds: group.formalArtifactIds,
      relativePath: relativeInside(packageDir, built.packageDir),
      packageDigest: built.packageManifest.packageDigest,
      status: built.packageManifest.status,
    })),
  };
  const packageDigest = stableHash(payload);
  const manifest = { ...payload, packageDigest };
  fs.writeFileSync(path.join(packageDir, 'cohort-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const validation = validateResultChangeSetReplayPackage(packageDir);
  if (!validation.ok) fail('replay_package_invalid', 'Result Studio cohort ReplayPackage failed integrity validation.');
  return {
    packageDir,
    packageManifest: {
      resultChangeSetReplayPackageVersion: 1,
      status: builtGroups.every(({ built }) => built.packageManifest.status === 'complete') ? 'complete' : 'partial_history',
      packageDigest,
    },
    validation,
    jobs: builtGroups.map(({ group, built }) => ({
      sourceToolJobId: group.sourceToolJobId,
      toolId: group.toolId,
      formalArtifactIds: group.formalArtifactIds,
      replay: built.replay,
    })),
    cohort: true,
  };
}

async function verifyReplayPackageOutputJobs({
  replayPackage,
  changeSetResult,
  getToolJob,
  workspaceRoot,
  verifyReplayOutputs,
} = {}) {
  const packages = Array.isArray(replayPackage?.jobs) ? replayPackage.jobs : [];
  if (packages.length <= 1) {
    const replayJob = getToolJob(changeSetResult.toolJobId);
    return Promise.resolve(verifyReplayOutputs({
      replay: packages[0]?.replay || replayPackage?.replay,
      job: replayJob,
      workspaceRoot,
    }));
  }
  const replayJobIds = changeSetResult?.changeSet?.jobRefs;
  if (!Array.isArray(replayJobIds) || replayJobIds.length !== packages.length) {
    fail('replay_output_job_cohort_mismatch', 'Replay ChangeSet Job cohort differs from the ReplayPackage.');
  }
  const verified = [];
  for (let index = 0; index < packages.length; index += 1) {
    const packageJob = packages[index];
    const replayJob = getToolJob(replayJobIds[index]);
    if (!replayJob || String(replayJob.tool_id || replayJob.toolId || '').trim() !== packageJob.toolId) {
      fail('replay_output_job_order_drift', 'Replay Job order or plugin identity differs from the authoritative workflow.');
    }
    const result = await Promise.resolve(verifyReplayOutputs({
      replay: packageJob.replay,
      job: replayJob,
      workspaceRoot,
    }));
    if (!result?.exactMatch) fail('replay_output_hash_mismatch', 'A ReplayPackage Job did not reproduce its source output cohort.');
    verified.push({
      sourceToolJobId: packageJob.sourceToolJobId,
      replayToolJobId: replayJob.id,
      outputCohortHash: result.outputCohortHash,
      artifactCount: result.artifactCount,
    });
  }
  return {
    exactMatch: true,
    artifactCount: verified.reduce((sum, entry) => sum + Number(entry.artifactCount || 0), 0),
    outputCohortHash: stableHash(verified),
    jobs: verified,
  };
}

function assertPluginCompatibility({ sourceJob, sourceProjection, plugin }) {
  const sourcePlugin = sourceProjection.reproduction.plugin || {};
  const toolId = String(sourceJob?.tool_id || sourceJob?.toolId || '').trim();
  if (!plugin || !toolId || sourcePlugin.id !== toolId || String(plugin.id || '') !== toolId) {
    fail('replay_plugin_unavailable', 'The exact source plugin is unavailable.');
  }
  if (!sourcePlugin.version || !plugin.version || String(sourcePlugin.version) !== String(plugin.version)) {
    fail('replay_plugin_version_drift', 'The installed plugin version does not match the source Revision.');
  }
  const sourceLanguage = String(sourceProjection.language || '').toLowerCase();
  const pluginLanguage = String(plugin.language || '').toLowerCase();
  if (!sourceLanguage || sourceLanguage !== pluginLanguage) {
    fail('replay_plugin_language_drift', 'The installed plugin language does not match the source Revision.');
  }
  return { toolId, language: pluginLanguage };
}

function replayFingerprint({ projectId, revision, sourceProjection, sourceJob, executionParams, contextToken }) {
  const sourceResult = parseJobResult(sourceJob);
  const provenanceInputs = Array.isArray(sourceResult.executionProvenance?.inputs)
    ? sourceResult.executionProvenance.inputs
    : [];
  return stableHash({
    controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
    projectId,
    revisionId: revision.revisionId,
    sourceCommit: revision.sourceCommit,
    sourceSha256: sourceProjection.sha256,
    parametersHash: sourceProjection.parameters?.sha256 || null,
    normalizedParameters: sourceProjection.parameters?.rawValues || null,
    inputHashes: provenanceInputs.map((input) => ({ id: input.id, relativePath: input.relativePath, sha256: input.sha256 })),
    executionParamKeys: Object.keys(executionParams).sort(),
    toolJobId: sourceJob.id,
    toolId: sourceJob.tool_id || sourceJob.toolId,
    pluginVersion: sourceProjection.reproduction.plugin?.version || null,
    contextToken: contextToken || null,
  });
}

function createReplayIntent({ token, revision, workflowGraph = null, affectedNodeIds = [] }) {
  const workflowSubgraph = workflowGraph && affectedNodeIds.length > 1;
  return {
    contractVersion: '1',
    intentId: `rei_replay_${sha256(token).slice(0, 24)}`,
    artifactRef: { artifactId: revision.artifactId, revisionId: revision.revisionId },
    requestedOutcome: '受控重放该 ArtifactRevision',
    // A byte-identical replay still recomputes scientific output.  The
    // separate confirmation phase is the explicit scientific confirmation;
    // do not downgrade the execution to a presentation-only edit merely
    // because source and parameters are unchanged.
    editClass: 'scientific_recompute',
    proposedParameterPatch: {},
    affectedNodeIds,
    affectedScope: workflowSubgraph ? 'workflow_subgraph' : 'current_result_only',
    requiresJob: true,
    requiresScientificConfirmation: true,
    classificationReason: 'controlled_revision_replay',
    ...(workflowGraph ? {
      workflowGraph: {
        graphId: workflowGraph.graphId,
        sourceDigest: workflowGraph.sourceDigest,
      },
    } : {}),
  };
}

function wrapSourceError(error) {
  if (error instanceof ResultReplayError) throw error;
  if (error instanceof ResultRevisionSourceError) {
    throw new ResultReplayError(error.code, error.message, error.status, error.detail);
  }
  throw error;
}

function resolveQualifiedReplayCohort({ repository, projectId, revision, getToolJob } = {}) {
  if (typeof repository?.resolveRestorableRevision !== 'function') {
    fail('replay_source_cohort_qualification_unavailable', 'Exact ReplayPackage proof requires Repository cohort qualification.');
  }
  let qualified;
  try {
    qualified = repository.resolveRestorableRevision({ revisionId: revision.revisionId, projectId });
  } catch (error) {
    fail(error.code || 'replay_source_cohort_invalid', error.message || 'Adopted source cohort is incomplete.', 409, error.detail || null);
  }
  if (qualified.changeSet.status !== 'adopted' || !qualified.changeSet.adoptedAt) {
    fail('replay_package_requires_adopted_revision', 'Exact ReplayPackage proof requires an adopted Revision cohort.');
  }
  const graphRef = qualified.changeSet.validationSummary?.workflowGraph || null;
  if (!graphRef?.graphId || !SHA256.test(String(graphRef.sourceDigest || ''))
      || typeof repository.getWorkflowGraph !== 'function') {
    fail('replay_workflow_graph_missing', 'Scientific replay requires a source-bound persisted workflow graph.');
  }
  let workflowGraph;
  try {
    workflowGraph = repository.getWorkflowGraph(graphRef.graphId);
  } catch (error) {
    fail('replay_workflow_graph_stale', 'Persisted workflow graph failed repository integrity validation.', 409, {
      cause: error.code || 'workflow_graph_read_failed',
    });
  }
  if (!workflowGraph) {
    fail('replay_workflow_graph_missing', 'Scientific replay workflow graph is unavailable.');
  }
  if (workflowGraph.graphId !== graphRef.graphId
      || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest) {
    fail('replay_workflow_graph_drift', 'Persisted workflow graph no longer matches the adopted ChangeSet.');
  }
  const execution = projectReplayExecutionCohort({
    sourceRevisions: qualified.cohort,
    selectedRevision: revision,
    workflowGraph,
    getToolJob,
  });
  return {
    sourceChangeSet: qualified.changeSet,
    sourceRevisions: qualified.cohort,
    workflowGraph,
    execution,
    fingerprint: replayCohortFingerprint({
      sourceChangeSet: qualified.changeSet,
      sourceRevisions: qualified.cohort,
      workflowGraph,
      execution,
    }),
  };
}

function createControlledReplayService(options = {}) {
  const records = options.records || new Map();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? options.ttlMs
    : DEFAULT_CONFIRMATION_TTL_MS;
  const makeToken = typeof options.makeToken === 'function'
    ? options.makeToken
    : () => `rrc_${crypto.randomUUID().replace(/-/g, '')}`;
  const runChangeSet = options.createResultChangeSet || createResultChangeSet;
  const buildReplayPackage = options.buildResultRevisionReplayPackage || buildResultRevisionReplayPackage;
  const buildReplayCohort = options.buildSourceCohortReplayPackage || buildSourceCohortReplayPackage;
  const verifyReplayOutputs = options.verifyReplayOutputCohort || verifyReplayOutputCohort;
  const verifyReplayJobs = options.verifyReplayPackageOutputJobs || verifyReplayPackageOutputJobs;
  const mapReplayProofs = options.buildRevisionReplayProofs || buildRevisionReplayProofs;
  const persistReplayProof = options.persistReplayProof || ((repository, input) => {
    if (typeof repository?.recordReplayProofAndVerifyCohort !== 'function') {
      fail('replay_proof_repository_unavailable', 'Replay proof persistence is unavailable.', 500);
    }
    return repository.recordReplayProofAndVerifyCohort(input);
  });

  function inspect(input = {}, dependencies = {}) {
    const projectId = safeIdentifier(input.projectId, 'project_id');
    const revisionId = safeIdentifier(input.revisionId, 'revision_id');
    const repository = dependencies.repository;
    const getToolJob = dependencies.getToolJob;
    const getPlugin = dependencies.getPlugin;
    if (!repository || typeof getToolJob !== 'function' || typeof getPlugin !== 'function') {
      fail('replay_dependencies_missing', 'Replay dependencies are incomplete.', 500);
    }
    const revision = repository.getRevision(revisionId);
    if (!revision || revision.projectId !== projectId) fail('revision_not_found', 'Revision is not available in this project.', 404);
    const sourceJob = getToolJob(revision.toolJobId);
    const plugin = sourceJob ? getPlugin(sourceJob.tool_id || sourceJob.toolId) : null;
    let sourceProjection;
    try {
      sourceProjection = verifyRevisionSourceMaterial({
        projectId,
        revision,
        expectSha256: input.expectedSourceSha256 || null,
      }, {
        repository,
        adapter: dependencies.adapter,
        gitPathPrefix: dependencies.gitPathPrefix,
        workspaceRoot: dependencies.workspaceRoot,
        getToolJob,
        allowRawParameters: true,
      });
    } catch (error) {
      wrapSourceError(error);
    }
    if (!sourceProjection.reproduction.replayable) {
      fail('replay_not_available', 'Revision does not have complete replay material.');
    }
    assertExpectedHashes({
      sourceProjection,
      sourceJob,
      expectedSourceSha256: input.expectedSourceSha256,
      expectedParametersHash: input.expectedParametersHash,
      expectedInputHashes: input.expectedInputHashes,
    });
    assertRevisionOutput({ revision, workspaceRoot: dependencies.workspaceRoot });
    const { toolId, language } = assertPluginCompatibility({ sourceJob, sourceProjection, plugin });
    const executionParams = buildReplayExecutionParams({ sourceJob, sourceProjection, workspaceRoot: dependencies.workspaceRoot });
    const fingerprint = replayFingerprint({
      projectId, revision, sourceProjection, sourceJob, executionParams, contextToken: input.contextToken,
    });
    return {
      projectId,
      revisionId,
      revision,
      sourceJob,
      sourceProjection,
      toolId,
      language,
      executionParams,
      normalizedSourceParams: cloneJson(sourceProjection.parameters.rawValues),
      fingerprint,
      inputHashes: Object.fromEntries(
        (parseJobResult(sourceJob).executionProvenance?.inputs || [])
          .filter((item) => item?.id)
          .map((item) => [item.id, item.sha256])
      ),
    };
  }

  function prepare(input = {}, dependencies = {}) {
    assertAllowedReplayRequest(input.request || input);
    const material = inspect(input, dependencies);
    const qualified = resolveQualifiedReplayCohort({
      repository: dependencies.repository,
      projectId: material.projectId,
      revision: material.revision,
      getToolJob: dependencies.getToolJob,
    });
    const fingerprint = stableHash({ revision: material.fingerprint, cohort: qualified.fingerprint });
    const confirmationToken = makeToken();
    const createdAt = now();
    const record = {
      confirmationToken,
      projectId: material.projectId,
      revisionId: material.revisionId,
      conversationId: input.conversationId || null,
      contextToken: input.contextToken || null,
      fingerprint,
      createdAt,
      expiresAt: createdAt + ttlMs,
      state: 'ready',
      sourceJobId: material.sourceJob.id,
      toolId: material.toolId,
      language: material.language,
      sourceSha256: material.sourceProjection.sha256,
      parametersHash: material.sourceProjection.parameters.sha256,
      inputHashes: material.inputHashes,
      sourceChangeSetId: qualified.sourceChangeSet.changeSetId,
      sourceCohortFingerprint: qualified.fingerprint,
      executionRootRevisionId: qualified.execution.rootRevision.revisionId,
      executionJobCount: qualified.execution.groups.length,
      sourceRevisionCount: qualified.sourceRevisions.length,
      promise: null,
      result: null,
      error: null,
    };
    records.set(confirmationToken, record);
    return {
      ok: true,
      controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
      status: 'confirmation_required',
      confirmationToken,
      expiresAt: record.expiresAt,
      fingerprint,
      revision: {
        revisionId: material.revisionId,
        artifactId: material.revision.artifactId,
        revisionOrdinal: material.revision.revisionOrdinal,
        sourceSha256: record.sourceSha256,
        parametersHash: record.parametersHash,
        inputCount: material.sourceProjection.reproduction.inputs.length,
      },
      execution: {
        toolId: material.toolId,
        pluginVersion: material.sourceProjection.reproduction.plugin.version,
        runtime: material.sourceProjection.reproduction.runtime,
        createsToolJob: true,
        createsCandidateRevision: true,
        adoptsCandidate: false,
        mutatesCurrentRevision: false,
        createsReplayPackage: true,
        requiresExactOutputCohort: true,
        sourceRevisionCount: qualified.sourceRevisions.length,
        affectedJobCount: qualified.execution.groups.length,
        acceptsWorkflowPlan: false,
        acceptsShell: false,
      },
    };
  }

  async function confirm(input = {}, dependencies = {}) {
    assertAllowedReplayRequest(input.request || input);
    const projectId = safeIdentifier(input.projectId, 'project_id');
    const revisionId = safeIdentifier(input.revisionId, 'revision_id');
    const confirmationToken = String(input.confirmationToken || '').trim();
    const record = records.get(confirmationToken);
    if (!confirmationToken || !record) fail('replay_confirmation_invalid', 'Replay confirmation is invalid or unavailable.', 409);
    if (record.projectId !== projectId || record.revisionId !== revisionId) {
      fail('replay_confirmation_scope_mismatch', 'Replay confirmation belongs to another project or Revision.');
    }
    if ((record.contextToken || null) !== (input.contextToken || null)) {
      fail('replay_context_stale', 'Result context changed after replay preflight.');
    }
    if (record.expiresAt <= now()) {
      record.state = 'expired';
      fail('replay_confirmation_expired', 'Replay confirmation expired; run preflight again.');
    }
    if (record.state === 'running' && record.promise) return record.promise;
    if (record.state === 'completed' && record.result) return { ...record.result, idempotent: true };
    if (record.state === 'failed' && record.error) throw record.error;
    if (record.state !== 'ready') fail('replay_confirmation_consumed', 'Replay confirmation is no longer executable.');

    const repository = dependencies.repository;
    const getToolJob = dependencies.getToolJob;
    const getPlugin = dependencies.getPlugin;
    const executeJob = dependencies.executeJob;
    if (!repository || typeof getToolJob !== 'function' || typeof getPlugin !== 'function'
      || typeof executeJob !== 'function' || !dependencies.adapter) {
      fail('replay_dependencies_missing', 'Replay execution dependencies are incomplete.', 500);
    }

    // Mark running before the first await. Concurrent duplicate confirmations
    // observe the same promise and can never create a second Job.
    record.state = 'running';
    const promise = (async () => {
      try {
        const refreshed = inspect({
          projectId,
          revisionId,
          conversationId: record.conversationId,
          contextToken: record.contextToken,
          expectedSourceSha256: record.sourceSha256,
          expectedParametersHash: record.parametersHash,
          expectedInputHashes: record.inputHashes,
        }, dependencies);
        const revision = refreshed.revision;
        if (!revision || revision.projectId !== projectId) {
          fail('replay_source_stale', 'Replay source is no longer available in this project.');
        }
        const qualified = resolveQualifiedReplayCohort({ repository, projectId, revision, getToolJob });
        const currentFingerprint = stableHash({ revision: refreshed.fingerprint, cohort: qualified.fingerprint });
        if (currentFingerprint !== record.fingerprint
            || qualified.sourceChangeSet.changeSetId !== record.sourceChangeSetId
            || qualified.execution.rootRevision.revisionId !== record.executionRootRevisionId) {
          fail('replay_material_stale', 'Replay material or authoritative workflow changed after preflight.');
        }
        const { sourceChangeSet, sourceRevisions, workflowGraph, execution } = qualified;
        const rootRevision = execution.rootRevision;
        const rootMaterial = rootRevision.revisionId === revision.revisionId
          ? refreshed
          : inspect({
              projectId,
              revisionId: rootRevision.revisionId,
              conversationId: record.conversationId,
              contextToken: record.contextToken,
            }, dependencies);
        const packageDir = path.join(
          dependencies.workspaceRoot,
          '.biof3',
          'replay-packages',
          revisionId,
          confirmationToken,
        );
        const replayPackage = await buildReplayCohort({
          builder: buildReplayPackage,
          execution,
          selectedRevision: revision,
          sourceChangeSet,
          projectRoot: dependencies.workspaceRoot,
          packageDir,
          workflowGraph,
        });
        const packageValidation = replayPackage?.validation?.ok
          ? replayPackage.validation
          : replayPackage?.cohort
            ? validateResultChangeSetReplayPackage(replayPackage?.packageDir || packageDir)
            : validateScientificReplayPackage(replayPackage?.packageDir || packageDir);
        if (!packageValidation.ok || !SHA256.test(String(replayPackage?.packageManifest?.packageDigest || ''))) {
          fail('replay_package_invalid', 'Result Studio ReplayPackage failed integrity validation.');
        }
        const changeSetResult = await runChangeSet({
          projectId,
          conversationId: record.conversationId,
          workspaceRoot: dependencies.workspaceRoot,
          intent: createReplayIntent({
            token: confirmationToken,
            revision: rootRevision,
            workflowGraph,
            affectedNodeIds: execution.affectedNodeIds,
          }),
          sourceRevision: rootRevision,
          // Use only the execution params reconstructed from intact,
          // project-contained provenance inputs. The persisted source Job row
          // remains the identity and provenance authority.
          sourceJob: { ...rootMaterial.sourceJob, params: cloneJson(rootMaterial.executionParams) },
          sourceScriptSha256: rootMaterial.sourceProjection.sha256,
          normalizedSourceParams: rootMaterial.normalizedSourceParams,
          pluginId: rootMaterial.toolId,
          language: rootMaterial.language,
          scriptPatch: [],
          scientificConfirmed: true,
          createdBy: 'user',
          authoritativeSubgraph: execution.authoritativeSubgraph,
        }, {
          repository,
          adapter: dependencies.adapter,
          gitPathPrefix: dependencies.gitPathPrefix,
          getToolJob,
          getResultStudioDescriptor: dependencies.getResultStudioDescriptor,
          executeJob,
          authoritativeSubgraphTrusted: execution.authoritativeSubgraph != null,
          activePreviewJobs: dependencies.activePreviewJobs || 0,
          onProgress: dependencies.onProgress,
          shouldCancel: dependencies.shouldCancel,
        });
        if (!changeSetResult || changeSetResult.ok !== true || changeSetResult.adopted !== false
          || changeSetResult.revision?.parentRevisionIds?.[0] !== rootRevision.revisionId) {
          fail('replay_candidate_invalid', 'Controlled replay did not create the expected isolated candidate.');
        }
        const exactOutput = await verifyReplayJobs({
          replayPackage,
          changeSetResult,
          getToolJob,
          workspaceRoot: dependencies.workspaceRoot,
          verifyReplayOutputs,
        });
        if (!exactOutput?.exactMatch) {
          fail('replay_output_hash_mismatch', 'Replay output cohort did not exactly reproduce the adopted Revision.');
        }
        const replayRevisions = repository.listRevisionsByChangeSet(changeSetResult.changeSet.changeSetId);
        const proofs = mapReplayProofs({ sourceRevisions, replayRevisions });
        const selectedProof = proofs.find((proof) => proof.sourceRevisionId === revisionId);
        if (!selectedProof) fail('replay_revision_cohort_mismatch', 'Selected Revision is absent from the exact replay proof.');
        const proofRecord = await Promise.resolve(persistReplayProof(repository, {
          projectId,
          changeSetId: sourceChangeSet.changeSetId,
          replayPackageDigest: replayPackage.packageManifest.packageDigest,
          proofs,
        }));
        const response = {
          ok: true,
          controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
          status: 'preview_ready',
          replayFingerprint: record.fingerprint,
          changeSetId: changeSetResult.changeSet.changeSetId,
          toolJobId: selectedProof.replayToolJobId,
          revisionId: selectedProof.replayRevisionId,
          parentRevisionId: revisionId,
          adopted: false,
          replayPackage: {
            relativePath: relativeInside(dependencies.workspaceRoot, replayPackage.packageDir),
            packageDigest: replayPackage.packageManifest.packageDigest,
            status: replayPackage.packageManifest.status,
          },
          reproducibility: {
            exactMatch: true,
            outputCohortHash: exactOutput.outputCohortHash,
            artifactCount: exactOutput.artifactCount,
            sourceChangeSetId: sourceChangeSet.changeSetId,
            replayChangeSetId: changeSetResult.changeSet.changeSetId,
            sourceCohortVerified: proofRecord?.replayProof?.exactMatch === true,
          },
          idempotent: false,
        };
        record.state = 'completed';
        record.result = response;
        return response;
      } catch (error) {
        const wrapped = error instanceof ResultReplayError
          ? error
          : new ResultReplayError(error.code || 'replay_execution_failed', error.message || 'Controlled replay failed.', 409, error.detail || null);
        record.state = 'failed';
        record.error = wrapped;
        throw wrapped;
      }
    })();
    record.promise = promise;
    return promise;
  }

  return { prepare, confirm, records };
}


module.exports = {
  CONTROLLED_REPLAY_VERSION,
  DEFAULT_CONFIRMATION_TTL_MS,
  ResultReplayError,
  assertAllowedReplayRequest,
  buildReplayExecutionParams,
  verifyReplayOutputCohort,
  buildRevisionReplayProofs,
  projectReplayExecutionCohort,
  validateResultChangeSetReplayPackage,
  buildSourceCohortReplayPackage,
  verifyReplayPackageOutputJobs,
  createControlledReplayService,
};
