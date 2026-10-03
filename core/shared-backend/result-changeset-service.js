'use strict';

const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./canonical-json');
const { validateResultEditIntent } = require('./result-edit-intent');
const { createRuntimeResourceSnapshot } = require('./runtime-resource-snapshot');
const { evaluatePreviewResourceBudget } = require('./result-studio-lifecycle');
const { verifyRevisionSourceMaterial } = require('./result-revision-source');
const { buildAuthoritativeWorkflowGraph } = require('./result-workflow-graph');
const { propagateDegThresholds } = require('./result-scientific-rerun');
require('./result-studio-private-path');
const {
  RESULT_CHANGESET_SERVICE_VERSION,
  ResultChangeSetError,
  cloneJsonObject,
  exactArtifact,
  gitFailureDiagnostic,
  hashFile,
  id,
  projectRelativeOutput,
  resolveExistingProjectFile,
  resultOf,
  safeSegment,
  sha256,
} = require('./result-changeset-service/internal');
const {
  assertInheritedCandidateInputLineage,
  buildTrustedExecutionParams,
  exactProvenanceArtifact,
  inheritServerIssuedInputLineage,
  resolveAuthoritativeDownstreamPlan,
  resolveCandidateDescriptor,
  resolveLineageAncestorJobs,
  validateCandidateJob,
} = require('./result-changeset-service/projections');
const {
  ensureBaselineArtifactCohort,
  ensureBaselineArtifactRevision,
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
  resolveExactFormalSourceRevision,
} = require('./result-changeset-service/baseline-cohort');
const {
  buildResultEditCheckpoint,
  inspectResultEditRecovery,
  resolveBaseCommit,
  saveResultEditCheckpoint,
  startResultEditChangeSet,
  transitionResultEditWithCheckpoint,
} = require('./result-changeset-service/checkpoints');
const {
  applyExactScriptPatch,
  materializeResultEdit,
} = require('./result-changeset-service/materialize');
const { deriveTrustedPreviewResourceEstimate } = require('./result-changeset-service/resource-model');
const { ensureChainRevisions } = require('./result-changeset-service/chain-preview');

// BLOCK-92 Wave C-1：原 2783 行巨文件按接缝拆入 result-changeset-service/ 子模块
// （internal / resource-model / materialize / projections / checkpoints /
// baseline-cohort），本文件保留 createResultChangeSet 主编排与既有公开导出面
// （re-export 零消费方改动）；ensureBaselineArtifactRevision 已移入 baseline-cohort。

async function createResultChangeSet(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  const executeJob = dependencies.executeJob;
  if (!repository || !adapter || typeof executeJob !== 'function') {
    throw new ResultChangeSetError('service_dependencies_missing', 'Repository, Git adapter and existing execution bridge are required.');
  }
  const intentValidation = validateResultEditIntent(input.intent);
  if (!intentValidation.ok) throw new ResultChangeSetError('intent_invalid', 'ResultEditIntent failed validation.', intentValidation.errors);
  if (input.intent.editClass === 'view_only' || input.intent.requiresJob !== true) {
    throw new ResultChangeSetError('edit_does_not_require_job', 'This edit must not create a ChangeSet or Job.');
  }
  if (input.intent.requestedOutcome.length > 500) {
    throw new ResultChangeSetError('requested_outcome_too_long', 'requestedOutcome exceeds 500 characters.');
  }
  if (input.intent.requiresScientificConfirmation && input.scientificConfirmed !== true) {
    throw new ResultChangeSetError('scientific_confirmation_required', 'Scientific confirmation is required before materialization or execution.');
  }
  const projectId = String(input.projectId || '').trim();
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  const sourceRevision = input.sourceRevision;
  const sourceJob = input.sourceJob;
  if (!sourceRevision || sourceRevision.projectId !== projectId
    || sourceRevision.revisionId !== input.intent.artifactRef.revisionId
    || sourceRevision.artifactId !== input.intent.artifactRef.artifactId) {
    throw new ResultChangeSetError('source_revision_mismatch', 'Source revision does not match the intent and active project.');
  }
  if (!sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
    || sourceJob.id !== sourceRevision.toolJobId || sourceJob.status !== 'completed') {
    throw new ResultChangeSetError('source_job_mismatch', 'Source revision is not backed by a completed Job in the active project.');
  }
  const sourceResult = sourceJob.result || {};
  if (!sourceResult.artifactTruth || sourceResult.artifactTruth.status !== 'valid' || sourceResult.artifactTruth.blocking === true) {
    throw new ResultChangeSetError('source_artifact_truth_invalid', 'Source revision does not have valid Artifact Truth.');
  }
  if (!exactArtifact(sourceResult, sourceRevision.artifactId)) {
    throw new ResultChangeSetError('source_artifact_missing', 'Source artifact id is not unique in its Job result.');
  }
  const inheritedInputLineage = inheritServerIssuedInputLineage(sourceResult);

  const sourceOutputPath = resolveExistingProjectFile(workspaceRoot, sourceRevision.outputPath, 'source_artifact_hash_mismatch');
  if (!sourceRevision.outputHash || hashFile(sourceOutputPath) !== sourceRevision.outputHash) {
    throw new ResultChangeSetError('source_artifact_hash_mismatch', 'Source Artifact changed or is missing before the edit.');
  }
  const sourceArtifactHash = sourceRevision.outputHash;
  let sourceProjection;
  try {
    sourceProjection = verifyRevisionSourceMaterial({ projectId, revision: sourceRevision }, {
      repository,
      adapter,
      gitPathPrefix: dependencies.gitPathPrefix,
      workspaceRoot,
      getToolJob: dependencies.getToolJob || (() => sourceJob),
      allowRawParameters: true,
    });
  } catch (error) {
    if (error && error.code) throw new ResultChangeSetError(error.code, error.message, error.detail);
    throw error;
  }
  const sourceScriptContent = sourceProjection.content;
  const sourceScriptHash = sourceProjection.sha256;
  if (input.sourceScriptSha256 && sourceScriptHash !== input.sourceScriptSha256) {
    throw new ResultChangeSetError('source_script_hash_mismatch', 'Source script does not match the active Revision.');
  }
  if (!sourceProjection.parameters?.values) {
    throw new ResultChangeSetError('source_parameters_missing', 'Exact Revision parameters are unavailable.');
  }
  const downstreamPlan = resolveAuthoritativeDownstreamPlan({
    input,
    dependencies,
    projectId,
    workspaceRoot,
    sourceRevision,
    sourceOutputHash: sourceArtifactHash,
  });
  const exactSourceParams = sourceProjection.parameters.rawValues || sourceProjection.parameters.values;
  if (input.normalizedSourceParams
      && stableStringify(input.normalizedSourceParams) !== stableStringify(exactSourceParams)) {
    throw new ResultChangeSetError('source_parameters_mismatch', 'Edit parameters do not match the selected Revision.');
  }
  const trustedExecution = buildTrustedExecutionParams({
    sourceJob,
    sourceProjection,
    workspaceRoot,
    parameterPatch: input.intent.proposedParameterPatch,
  });
  const normalizedSourceParams = trustedExecution.normalized;
  const descriptor = resolveCandidateDescriptor({ dependencies, toolId: input.pluginId });
  const resourceEstimate = deriveTrustedPreviewResourceEstimate({
    descriptor,
    sourceJob,
    sourceResult,
    workspaceRoot,
    trustedExecution,
    sourceOutputPath,
    sourceRevision,
    proposedParameterPatch: input.intent.proposedParameterPatch,
    downstreamPlan,
  });
  let disk = null;
  try {
    const statfs = dependencies.statfsSync || fs.statfsSync;
    if (typeof statfs === 'function') {
      const stat = statfs(workspaceRoot);
      disk = {
        availableBytes: Number(stat.bavail) * Number(stat.bsize),
        totalBytes: Number(stat.blocks) * Number(stat.bsize),
      };
    }
  } catch { /* unknown disk state remains explicit and blocks execution */ }
  const maxBackgroundPreviews = Number.isInteger(dependencies.maxBackgroundPreviews)
    && dependencies.maxBackgroundPreviews > 0
    ? dependencies.maxBackgroundPreviews
    : 2;
  const snapshotFactory = dependencies.createRuntimeResourceSnapshot || createRuntimeResourceSnapshot;
  const resourceSnapshot = snapshotFactory({
    disk,
    activeJobs: 0,
    estimatedMemoryBytes: resourceEstimate.memoryBytes,
  });
  const previewBudget = {
    ...evaluatePreviewResourceBudget({
      resourceSnapshot,
      estimatedMemoryBytes: resourceEstimate.memoryBytes,
      estimatedDiskBytes: resourceEstimate.diskBytes,
      activePreviewJobs: 0,
      maxBackgroundPreviews,
      maxPreviewMemoryBytes: dependencies.maxPreviewMemoryBytes,
    }),
    resourceEstimate,
  };
  if (previewBudget.decision === 'blocked') {
    throw new ResultChangeSetError('preview_resource_budget_blocked', 'Preview Job cannot start within the current resource budget.', previewBudget);
  }

  const changeSetId = input.changeSetId || id('cs');
  const revisionId = input.revisionId || id('rev');
  const baseCommit = sourceRevision.sourceCommit && adapter.revParse(sourceRevision.sourceCommit)
    ? sourceRevision.sourceCommit
    : resolveBaseCommit(adapter, projectId);
  const workingBranchRef = `refs/heads/biof3/changeset/${safeSegment(changeSetId, 'change_set_id')}`;
  const progress = [];
  const emit = (stage, status, detail = {}) => {
    const event = { resultEditProgressVersion: 1, sequence: progress.length + 1, changeSetId, stage, status, ...detail };
    progress.push(event);
    if (typeof dependencies.onProgress === 'function') dependencies.onProgress(event);
  };
  const cancelled = () => typeof dependencies.shouldCancel === 'function' && dependencies.shouldCancel();
  let changeSetCreated = false;

  try {
    emit('change_set', 'running');
    let started;
    try {
      started = startResultEditChangeSet({ repository, stage: 'change_set', maxConcurrentPreviews: maxBackgroundPreviews, changeSet: {
        changeSetId,
        projectId,
        conversationId: input.conversationId || null,
        intentRef: input.intent.intentId,
        baseCommit,
        workingBranchRef,
        createdBy: input.createdBy === 'user' ? 'user' : 'agent',
        parentArtifactRefs: [sourceRevision.revisionId],
      } });
    } catch (error) {
      if (error?.code !== 'preview_concurrency_saturated') throw error;
      throw new ResultChangeSetError(
        'preview_resource_queued',
        'Preview Job is queued because the background preview budget is saturated.',
        {
          ...previewBudget,
          decision: 'queued',
          reasons: [...new Set([...previewBudget.reasons, 'preview_concurrency_saturated'])],
          activePreviewJobs: error.detail?.activePreviewJobs ?? maxBackgroundPreviews,
          maxBackgroundPreviews: error.detail?.maxBackgroundPreviews ?? maxBackgroundPreviews,
        },
      );
    }
    previewBudget.activePreviewJobs = started.previewSlot?.activePreviewJobsBefore ?? 0;
    changeSetCreated = true;
    if (cancelled()) throw new ResultChangeSetError('edit_cancelled', 'Edit was cancelled before materialization.');

    emit('materialize', 'running');
    const materialized = materializeResultEdit({
      workspaceRoot,
      changeSetId,
      revisionId,
      artifactFamilyId: sourceRevision.artifactFamilyId,
      artifactId: sourceRevision.artifactId,
      pluginId: input.pluginId,
      language: input.language,
      sourceScriptContent,
      expectedSourceScriptSha256: sourceScriptHash,
      normalizedSourceParams,
      proposedParameterPatch: input.intent.proposedParameterPatch,
      scriptPatch: input.scriptPatch || [],
      intentId: input.intent.intentId,
    });
    emit('materialize', 'completed', { scriptSha256: materialized.scriptSha256 });
    saveResultEditCheckpoint({ repository, projectId, conversationId: input.conversationId, changeSetId, stage: 'materialized' });

    const gitPathPrefix = String(dependencies.gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
    let candidate = adapter.commitVirtualFiles({
      parentCommit: baseCommit,
      ref: workingBranchRef,
      expectedOld: '0'.repeat(40),
      message: `BioF3 ChangeSet ${changeSetId}: ${input.intent.requestedOutcome}\n\nArtifact: ${sourceRevision.artifactId}`,
      files: materialized.gitFiles.map((file) => ({
        ...file,
        path: gitPathPrefix ? path.posix.join(gitPathPrefix, file.path) : file.path,
      })),
    });
    emit('commit', 'completed', { candidateCommit: candidate.commit });
    saveResultEditCheckpoint({ repository, projectId, conversationId: input.conversationId, changeSetId, candidateCommit: candidate.commit, stage: 'candidate_committed' });
    if (cancelled()) throw new ResultChangeSetError('edit_cancelled', 'Edit was cancelled before execution.');

    emit('job', 'running');
    const executionParams = trustedExecution.runtime;
    const execution = await executeJob({
      toolId: input.pluginId,
      params: executionParams,
      materializedScriptPath: materialized.executableScriptPath,
      materializedScriptSha256: materialized.scriptSha256,
      changeSetId,
      revisionId,
      resultStudioInputLineage: inheritedInputLineage.inputLineage
        ? cloneJsonObject(inheritedInputLineage.inputLineage, 'source_input_lineage_invalid')
        : null,
    });
    const candidateJob = execution && execution.job;
    if (!candidateJob || candidateJob.status !== 'completed'
      || String(candidateJob.project_id || candidateJob.projectId || '') !== projectId) {
      throw new ResultChangeSetError('candidate_job_failed', 'Renderer Job did not complete in the active project.', {
        toolJobId: candidateJob && candidateJob.id || execution && execution.toolJobId || null,
      });
    }
    if (cancelled()) throw new ResultChangeSetError('edit_cancelled', 'Edit was cancelled after execution; candidate was not registered.');
    emit('job', 'completed', { toolJobId: candidateJob.id });

    const candidateResult = candidateJob.result || {};
    if (!candidateResult.artifactTruth || candidateResult.artifactTruth.status !== 'valid'
      || candidateResult.artifactTruth.blocking === true) {
      throw new ResultChangeSetError('candidate_artifact_truth_invalid', 'Candidate Job did not produce valid Artifact Truth.');
    }
    const rootValidation = validateCandidateJob({
      dependencies,
      toolId: input.pluginId,
      job: candidateJob,
      workspaceRoot,
      expectedScriptSha256: materialized.scriptSha256,
      rawParams: executionParams,
    });
    assertInheritedCandidateInputLineage(candidateResult, inheritedInputLineage);
    const expectedCandidateParams = { ...normalizedSourceParams, ...input.intent.proposedParameterPatch };
    if (stableStringify(candidateResult.executionProvenance?.params?.normalized || {})
        !== stableStringify(expectedCandidateParams)) {
      throw new ResultChangeSetError(
        'candidate_parameters_drift',
        'Candidate Job parameters differ from the immutable Revision parameters plus the approved patch.'
      );
    }
    const artifact = exactArtifact(candidateResult, sourceRevision.artifactId);
    if (!artifact) throw new ResultChangeSetError('candidate_artifact_missing', 'Candidate Artifact id is not uniquely present.');
    projectRelativeOutput(workspaceRoot, artifact);
    const outputHash = hashFile(artifact.path);
    const provenanceArtifact = (candidateResult.executionProvenance?.artifacts || [])
      .find((item) => item && item.id === sourceRevision.artifactId);
    if (!outputHash || !provenanceArtifact || provenanceArtifact.sha256 !== outputHash) {
      throw new ResultChangeSetError('candidate_artifact_hash_mismatch', 'Candidate Artifact hash does not match execution provenance.');
    }
    const primaryFormalArtifact = rootValidation.formalArtifacts
      .find((entry) => entry.artifactId === sourceRevision.artifactId);
    if (!primaryFormalArtifact || primaryFormalArtifact.sha256 !== outputHash) {
      throw new ResultChangeSetError('candidate_formal_artifact_missing', 'Selected Artifact is not part of the validated formal output cohort.');
    }
    if (hashFile(sourceOutputPath) !== sourceArtifactHash) {
      throw new ResultChangeSetError('source_artifact_mutated', 'Source Artifact changed during candidate execution.');
    }

    // P6 affected-subgraph rerun. Every child is an admitted direct exact-byte
    // hand-off that was rebuilt from the persisted graph before this service
    // was entered.  We intentionally materialize/run it only after the root
    // candidate has produced verifiable Artifact Truth, then add its immutable
    // source snapshot to one final candidate commit.
    const downstreamCandidates = [];
    for (const downstream of downstreamPlan) {
      if (cancelled()) throw new ResultChangeSetError('edit_cancelled', 'Edit was cancelled before downstream execution.');
      const downstreamRevisionId = id('rev');
      const propagatedThresholds = propagateDegThresholds({
        sourceDescriptor: resolveCandidateDescriptor({ dependencies, toolId: input.pluginId }),
        downstreamDescriptor: resolveCandidateDescriptor({ dependencies, toolId: downstream.toolId }),
        sourceParameterPatch: input.intent.proposedParameterPatch,
        downstreamNormalizedParams: downstream.normalizedSourceParams,
        downstreamRawParams: downstream.rawSourceParams,
      });
      if (!propagatedThresholds.ok) {
        throw new ResultChangeSetError(propagatedThresholds.code, propagatedThresholds.message, propagatedThresholds.detail || null);
      }
      const downstreamNormalizedParams = {
        ...propagatedThresholds.normalizedParams,
        deg_table: {
          inputRef: `inputs/deg_table/${path.basename(artifact.path)}`,
          sha256: outputHash,
        },
      };
      const downstreamExecutionParams = {
        ...propagatedThresholds.rawParams,
        deg_table: artifact.path,
      };
      const downstreamMaterialization = materializeResultEdit({
        workspaceRoot,
        changeSetId,
        materializationKey: downstreamRevisionId,
        revisionId: downstreamRevisionId,
        artifactFamilyId: downstream.sourceRevision.artifactFamilyId,
        artifactId: downstream.sourceRevision.artifactId,
        pluginId: downstream.toolId,
        language: downstream.language,
        sourceScriptContent: downstream.sourceScriptContent,
        expectedSourceScriptSha256: downstream.sourceScriptSha256,
        normalizedSourceParams: downstreamNormalizedParams,
        proposedParameterPatch: {},
        scriptPatch: [],
        intentId: input.intent.intentId,
      });
      const downstreamLineage = {
        deg_table: {
          lineageVersion: 1,
          kind: 'artifact',
          sourceRevisionId: revisionId,
          sourceToolJobId: candidateJob.id,
          sourceArtifactId: sourceRevision.artifactId,
          sourceOutputHash: outputHash,
          materializationHash: outputHash,
        },
      };
      emit('downstream_job', 'running', { nodeId: downstream.nodeId, toolId: downstream.toolId });
      const downstreamExecution = await executeJob({
        toolId: downstream.toolId,
        params: downstreamExecutionParams,
        materializedScriptPath: downstreamMaterialization.executableScriptPath,
        materializedScriptSha256: downstreamMaterialization.scriptSha256,
        changeSetId,
        revisionId: downstreamRevisionId,
        resultStudioInputLineage: downstreamLineage,
      });
      const downstreamJob = downstreamExecution && downstreamExecution.job;
      if (!downstreamJob || downstreamJob.status !== 'completed'
          || String(downstreamJob.project_id || downstreamJob.projectId || '') !== projectId) {
        throw new ResultChangeSetError('downstream_job_failed', 'A verified direct descendant did not complete in the active project.', {
          toolJobId: downstreamJob && downstreamJob.id || downstreamExecution && downstreamExecution.toolJobId || null,
        });
      }
      const downstreamResult = resultOf(downstreamJob);
      if (downstreamResult.artifactTruth?.status !== 'valid' || downstreamResult.artifactTruth?.blocking === true) {
        throw new ResultChangeSetError('downstream_artifact_truth_invalid', 'A verified direct descendant did not produce valid Artifact Truth.');
      }
      const downstreamValidation = validateCandidateJob({
        dependencies,
        toolId: downstream.toolId,
        job: downstreamJob,
        workspaceRoot,
        expectedScriptSha256: downstreamMaterialization.scriptSha256,
        rawParams: downstreamExecutionParams,
      });
      const downstreamArtifact = exactArtifact(downstreamResult, downstream.sourceRevision.artifactId);
      const downstreamProvenanceArtifact = exactProvenanceArtifact(downstreamResult, downstream.sourceRevision.artifactId);
      if (!downstreamArtifact || !downstreamProvenanceArtifact) {
        throw new ResultChangeSetError('downstream_candidate_artifact_missing', 'A direct descendant candidate is missing its required primary Artifact.');
      }
      const downstreamOutputPath = projectRelativeOutput(workspaceRoot, downstreamArtifact);
      const downstreamOutputHash = hashFile(downstreamArtifact.path);
      if (!downstreamOutputHash || downstreamProvenanceArtifact.sha256 !== downstreamOutputHash) {
        throw new ResultChangeSetError('downstream_candidate_artifact_hash_mismatch', 'A direct descendant candidate Artifact does not match execution provenance.');
      }
      const downstreamPrimaryFormalArtifact = downstreamValidation.formalArtifacts
        .find((entry) => entry.artifactId === downstream.sourceRevision.artifactId);
      if (!downstreamPrimaryFormalArtifact || downstreamPrimaryFormalArtifact.sha256 !== downstreamOutputHash) {
        throw new ResultChangeSetError('downstream_formal_artifact_missing', 'Downstream selected Artifact is not part of the validated formal output cohort.');
      }
      const downstreamProvenance = downstreamResult.executionProvenance || {};
      if (stableStringify(downstreamProvenance.params?.normalized || {}) !== stableStringify(downstreamNormalizedParams)) {
        throw new ResultChangeSetError('downstream_parameters_drift', 'A direct descendant candidate differs from its immutable parameters plus the candidate DEG input.');
      }
      const lineageInput = (downstreamProvenance.inputs || []).filter((entry) => entry && entry.id === 'deg_table');
      const receivedLineage = lineageInput.length === 1 ? lineageInput[0].lineage : null;
      if (lineageInput.length !== 1 || lineageInput[0].sha256 !== outputHash
          || !receivedLineage || receivedLineage.lineageVersion !== 1 || receivedLineage.kind !== 'artifact'
          || receivedLineage.sourceRevisionId !== revisionId || receivedLineage.sourceToolJobId !== candidateJob.id
          || receivedLineage.sourceArtifactId !== sourceRevision.artifactId
          || receivedLineage.sourceOutputHash !== outputHash || receivedLineage.materializationHash !== outputHash) {
        throw new ResultChangeSetError('downstream_lineage_drift', 'A direct descendant candidate did not receive the exact candidate DEG Artifact lineage.');
      }
      if (hashFile(downstream.sourceOutputPath) !== downstream.sourceOutputHash) {
        throw new ResultChangeSetError('downstream_source_artifact_mutated', 'A direct descendant source Artifact changed during candidate execution.');
      }
      downstreamCandidates.push({
        ...downstream,
        revisionId: downstreamRevisionId,
        job: downstreamJob,
        result: downstreamResult,
        materialization: downstreamMaterialization,
        validation: downstreamValidation,
        outputPath: downstreamOutputPath,
        outputHash: downstreamOutputHash,
      });
      emit('downstream_job', 'completed', { nodeId: downstream.nodeId, toolJobId: downstreamJob.id });
    }

    if (downstreamCandidates.length > 0) {
      candidate = adapter.commitVirtualFiles({
        parentCommit: candidate.commit,
        ref: workingBranchRef,
        expectedOld: candidate.commit,
        message: `BioF3 ChangeSet ${changeSetId}: verified downstream materialization`,
        files: downstreamCandidates.flatMap((entry) => entry.materialization.gitFiles).map((file) => ({
          ...file,
          path: gitPathPrefix ? path.posix.join(gitPathPrefix, file.path) : file.path,
        })),
      });
      emit('commit', 'completed', { candidateCommit: candidate.commit, downstream: true });
      saveResultEditCheckpoint({ repository, projectId, conversationId: input.conversationId, changeSetId, candidateCommit: candidate.commit, stage: 'downstream_candidate_committed' });
    }

    emit('revision', 'running');
    const inputArtifactRefs = (candidateResult.executionProvenance?.inputs || [])
      .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
      .map((entry) => ({
        artifactId: entry.sourceArtifactRef || entry.id,
        hash: entry.sha256 || null,
        role: entry.role || null,
      }));
    const sourceRevisionForFormalArtifact = ({ formalArtifact, selectedRevision, sourceFormalJob }) => {
      const formalSourceRevision = resolveExactFormalSourceRevision({
        repository,
        projectId,
        selectedRevision,
        sourceToolJobId: sourceFormalJob.id,
        artifactId: formalArtifact.artifactId,
      });
      const sourceProvenanceArtifact = exactProvenanceArtifact(resultOf(sourceFormalJob), formalArtifact.artifactId);
      if (!formalSourceRevision || formalSourceRevision.projectId !== projectId
          || formalSourceRevision.toolJobId !== sourceFormalJob.id
          || formalSourceRevision.artifactId !== formalArtifact.artifactId
          || !sourceProvenanceArtifact || sourceProvenanceArtifact.sha256 !== formalSourceRevision.outputHash) {
        throw new ResultChangeSetError(
          'candidate_formal_source_revision_missing',
          'Every produced formal output requires an exact source Revision in the same Job cohort.',
          { toolJobId: sourceFormalJob.id, artifactId: formalArtifact.artifactId }
        );
      }
      return formalSourceRevision;
    };
    const rootRevisionInputs = rootValidation.formalArtifacts.map((formalArtifact) => {
      const formalSourceRevision = sourceRevisionForFormalArtifact({
        formalArtifact,
        selectedRevision: sourceRevision,
        sourceFormalJob: sourceJob,
      });
      const formalRevisionId = formalArtifact.artifactId === sourceRevision.artifactId ? revisionId : id('rev');
      return {
        revisionId: formalRevisionId,
        projectId,
        artifactFamilyId: formalSourceRevision.artifactFamilyId,
        artifactId: formalArtifact.artifactId,
        parentRevisionIds: [formalSourceRevision.revisionId],
        sourceCommit: candidate.commit,
        sourceScriptRef: {
          relativePath: materialized.scriptRelativePath,
          sha256: materialized.scriptSha256,
          entryPoint: path.posix.basename(materialized.scriptRelativePath),
          artifactId: formalArtifact.artifactId,
          rendererId: `${input.pluginId}:${formalArtifact.artifactId}`,
          language: materialized.language,
          origin: 'project_materialized',
        },
        inputArtifactRefs,
        parametersRef: materialized.parametersRelativePath,
        parametersHash: materialized.parametersSha256,
        toolJobId: candidateJob.id,
        outputPath: projectRelativeOutput(workspaceRoot, formalArtifact),
        outputHash: formalArtifact.sha256,
        validationStatus: rootValidation.status,
        reproducibilityStatus: rootValidation.reproducibilityStatus,
        changeSetId,
      };
    });
    const downstreamRevisionIds = new Set();
    const downstreamRevisionInputs = downstreamCandidates.flatMap((entry) => {
      const downstreamInputArtifactRefs = (entry.result.executionProvenance?.inputs || [])
        .filter((item) => item && (item.sourceArtifactRef || item.id))
        .map((item) => ({
          artifactId: item.sourceArtifactRef || item.id,
          hash: item.sha256 || null,
          role: item.role || null,
        }));
      return entry.validation.formalArtifacts.map((formalArtifact) => {
        const formalSourceRevision = sourceRevisionForFormalArtifact({
          formalArtifact,
          selectedRevision: entry.sourceRevision,
          sourceFormalJob: entry.sourceJob,
        });
        const formalRevisionId = formalArtifact.artifactId === entry.sourceRevision.artifactId
          ? entry.revisionId
          : id('rev');
        downstreamRevisionIds.add(formalRevisionId);
        return {
          revisionId: formalRevisionId,
          projectId,
          artifactFamilyId: formalSourceRevision.artifactFamilyId,
          artifactId: formalArtifact.artifactId,
          parentRevisionIds: [formalSourceRevision.revisionId, revisionId],
          sourceCommit: candidate.commit,
          sourceScriptRef: {
            relativePath: entry.materialization.scriptRelativePath,
            sha256: entry.materialization.scriptSha256,
            entryPoint: path.posix.basename(entry.materialization.scriptRelativePath),
            artifactId: formalArtifact.artifactId,
            rendererId: `${entry.toolId}:${formalArtifact.artifactId}`,
            language: entry.materialization.language,
            origin: 'project_materialized',
          },
          inputArtifactRefs: downstreamInputArtifactRefs,
          parametersRef: entry.materialization.parametersRelativePath,
          parametersHash: entry.materialization.parametersSha256,
          toolJobId: entry.job.id,
          outputPath: projectRelativeOutput(workspaceRoot, formalArtifact),
          outputHash: formalArtifact.sha256,
          validationStatus: entry.validation.status,
          reproducibilityStatus: entry.validation.reproducibilityStatus,
          changeSetId,
        };
      });
    });
    const revisionInputs = [...rootRevisionInputs, ...downstreamRevisionInputs];
    const lineageAncestorJobs = resolveLineageAncestorJobs({
      inherited: inheritedInputLineage,
      getToolJob: dependencies.getToolJob,
    });
    const candidateJobsById = new Map(lineageAncestorJobs.map((job) => [job.id, job]));
    candidateJobsById.set(candidateJob.id, candidateJob);
    for (const entry of downstreamCandidates) candidateJobsById.set(entry.job.id, entry.job);
    const candidateJobs = [...candidateJobsById.values()];
    const executedCandidateJobs = [candidateJob, ...downstreamCandidates.map((entry) => entry.job)];
    const requiredToolJobIds = executedCandidateJobs.map((job) => job.id);
    const graphBuilder = dependencies.buildCandidateWorkflowGraph || buildAuthoritativeWorkflowGraph;
    const candidateGraphResult = graphBuilder({
      projectId,
      sourceToolJobId: candidateJob.id,
      jobs: candidateJobs,
      repository,
      requiredToolJobIds,
      stagedRevisions: revisionInputs,
    });
    if (!candidateGraphResult || candidateGraphResult.ok !== true || !candidateGraphResult.graph) {
      throw new ResultChangeSetError(
        'candidate_workflow_graph_invalid',
        'Candidate Jobs could not be projected into one complete authoritative workflow graph.',
        { diagnostics: candidateGraphResult?.diagnostics || [] }
      );
    }
    const candidateWorkflowGraph = candidateGraphResult.graph;
    const batch = repository.appendRevisionBatch({
      revisions: revisionInputs,
      workflowGraph: candidateWorkflowGraph,
      transition: {
        changeSetId,
        to: 'preview_ready',
        candidateCommit: candidate.commit,
        changedPaths: [...materialized.changedPaths, ...downstreamCandidates.flatMap((entry) => entry.materialization.changedPaths)],
        jobRefs: [candidateJob.id, ...downstreamCandidates.map((entry) => entry.job.id)],
        candidateArtifactRefs: revisionInputs.map((entry) => entry.revisionId),
        validationSummary: {
          artifactTruthStatus: candidateResult.artifactTruth.status,
          sourceArtifactPreserved: true,
          scriptSha256: materialized.scriptSha256,
          outputSha256: outputHash,
          workflowGraph: candidateWorkflowGraph
            ? { graphId: candidateWorkflowGraph.graphId, sourceDigest: candidateWorkflowGraph.sourceDigest }
            : null,
          sourceWorkflowGraph: input.authoritativeSubgraph
            ? { graphId: input.authoritativeSubgraph.graphId, sourceDigest: input.authoritativeSubgraph.sourceDigest }
            : null,
          validatorIds: [rootValidation.validatorId, ...downstreamCandidates.map((entry) => entry.validation.validatorId)],
          formalArtifactCount: revisionInputs.length,
          formalArtifactCohort: revisionInputs.map((entry) => ({
            toolJobId: entry.toolJobId,
            artifactId: entry.artifactId,
            outputHash: entry.outputHash,
          })),
          executedNodeIds: [input.authoritativeSubgraph?.rootNodeId || `job:${sourceRevision.toolJobId}`,
            ...downstreamCandidates.map((entry) => entry.nodeId)],
          downstreamArtifactTruthStatuses: downstreamCandidates.map((entry) => ({
            artifactId: entry.sourceRevision.artifactId,
            status: entry.result.artifactTruth.status,
          })),
          // P4R-4 review projection: bounded user-facing intent and impact come
          // from the validated, server-trusted ResultEditIntent. The UI must not
          // guess them from an opaque intentRef or a Git message.
          intentSummary: input.intent.requestedOutcome.slice(0, 500),
          impactLevel: input.intent.editClass,
          affectedScope: input.intent.affectedScope || 'unknown',
          requiresJob: input.intent.requiresJob,
          affectedNodeCount: Array.isArray(input.intent.affectedNodeIds) ? input.intent.affectedNodeIds.length : 0,
        },
      },
      beforeCommit: () => {
        saveResultEditCheckpoint({
          repository,
          projectId,
          conversationId: input.conversationId,
          changeSetId,
          candidateCommit: candidate.commit,
          stage: 'preview_ready',
          recovery: 'awaiting_user_decision',
        });
      },
    });
    const revision = batch.revisions.find((entry) => entry.revisionId === revisionId);
    const downstreamRevisions = batch.revisions.filter((entry) => downstreamRevisionIds.has(entry.revisionId));
    const cohortRevisions = batch.revisions;
    const ready = batch.changeSet;
    emit('revision', 'completed', { revisionId: revision.revisionId, downstreamRevisionIds: downstreamRevisions.map((entry) => entry.revisionId) });
    emit('preview', 'ready');
    return {
      ok: true,
      resultChangeSetServiceVersion: RESULT_CHANGESET_SERVICE_VERSION,
      changeSet: ready,
      revision,
      downstreamRevisions,
      cohortRevisions,
      candidateCommit: candidate.commit,
      toolJobId: candidateJob.id,
      materialization: {
        scriptRelativePath: materialized.scriptRelativePath,
        scriptSha256: materialized.scriptSha256,
        parametersRelativePath: materialized.parametersRelativePath,
        parametersSha256: materialized.parametersSha256,
      },
      progress,
      adopted: false,
      previewBudget,
    };
  } catch (error) {
    const gitFailure = gitFailureDiagnostic(error);
    if (changeSetCreated) {
      const current = repository.getChangeSet(changeSetId);
      try {
        if (current && current.status === 'running') {
          const cancelledEdit = error && error.code === 'edit_cancelled';
          transitionResultEditWithCheckpoint({
            repository,
            projectId,
            conversationId: input.conversationId,
            changeSetId,
            to: cancelledEdit ? 'abandoned' : 'validation_failed',
            stage: cancelledEdit ? 'cancelled' : 'failed',
            recovery: error && error.code || 'result_edit_failed',
            transition: {
              reason: error && error.code || 'result_edit_failed',
              ...(!cancelledEdit ? {
                validationSummary: {
                  error: error && error.code || 'result_edit_failed',
                  ...(gitFailure ? { gitFailure } : {}),
                },
              } : {}),
            },
          });
        }
      } catch { /* preserve the original failure; recovery scanner sees remaining state */ }
    }
    emit(error && error.code === 'edit_cancelled' ? 'cancelled' : 'failed', 'terminal', {
      reason: error && error.code || 'result_edit_failed',
    });
    if (error instanceof ResultChangeSetError) {
      error.detail = { ...(error.detail || {}), changeSetId, progress };
      throw error;
    }
    throw new ResultChangeSetError('result_edit_failed', error.message, {
      changeSetId,
      progress,
      causeCode: error && error.code || 'result_edit_failed',
      ...(gitFailure ? { gitFailure } : {}),
    });
  }
}


module.exports = {
  RESULT_CHANGESET_SERVICE_VERSION,
  ResultChangeSetError,
  sha256,
  applyExactScriptPatch,
  materializeResultEdit,
  resolveBaseCommit,
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
  ensureBaselineArtifactCohort,
  ensureBaselineArtifactRevision,
  buildResultEditCheckpoint,
  createResultChangeSet,
  ensureChainRevisions,
  saveResultEditCheckpoint,
  inspectResultEditRecovery,
  _test: { resolveExactFormalSourceRevision },
};
