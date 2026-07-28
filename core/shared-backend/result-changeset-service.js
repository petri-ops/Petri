'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./scientific-task-spec');
const { validateResultEditIntent } = require('./result-edit-intent');
const { isPathContained } = require('./project-run-layout');
const { createRuntimeResourceSnapshot } = require('./runtime-resource-snapshot');
const { evaluatePreviewResourceBudget } = require('./result-studio-lifecycle');

const RESULT_CHANGESET_SERVICE_VERSION = 1;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS_BYTES = 1024 * 1024;
const SENSITIVE_PARAMETER = /(?:^|_)(?:api_?key|access_?token|secret|password|credential)(?:$|_)/i;

class ResultChangeSetError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultChangeSetError';
    this.code = code;
    this.detail = detail;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(filePath) {
  return fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256(parts.map((part) => String(part || '')).join('\0')).slice(0, 32)}`;
}

function safeSegment(value, field) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new ResultChangeSetError(`${field}_invalid`, `${field} must be a safe identifier.`);
  }
  return normalized;
}

function stableJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

function assertSafeParameterPatch(patch, normalizedSourceParams) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ResultChangeSetError('parameter_patch_invalid', 'proposedParameterPatch must be an object.');
  }
  const inspect = (value, keyPath) => {
    const key = keyPath[keyPath.length - 1] || '';
    if (SENSITIVE_PARAMETER.test(key)) {
      throw new ResultChangeSetError('sensitive_parameter_forbidden', `Sensitive parameter cannot enter a ChangeSet: ${keyPath.join('.')}`);
    }
    if (typeof value === 'string' && (path.isAbsolute(value) || value.includes('\0'))) {
      throw new ResultChangeSetError('parameter_path_forbidden', `Parameter patch cannot introduce an absolute or NUL path: ${keyPath.join('.')}`);
    }
    if (Array.isArray(value)) value.forEach((item, index) => inspect(item, [...keyPath, String(index)]));
    else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) inspect(child, [...keyPath, childKey]);
    }
  };
  for (const [key, value] of Object.entries(patch)) {
    const sourceValue = normalizedSourceParams && normalizedSourceParams[key];
    if (sourceValue && typeof sourceValue === 'object' && sourceValue.inputRef) {
      throw new ResultChangeSetError('artifact_input_read_only', `Artifact/file input parameter is read-only: ${key}`);
    }
    inspect(value, [key]);
  }
  if (Buffer.byteLength(stableStringify(patch)) > MAX_PARAMETERS_BYTES) {
    throw new ResultChangeSetError('parameter_patch_too_large', 'Parameter patch exceeds 1 MiB.');
  }
}

function applyExactScriptPatch(source, scriptPatch = []) {
  if (!Array.isArray(scriptPatch)) {
    throw new ResultChangeSetError('script_patch_invalid', 'scriptPatch must be an array.');
  }
  let result = source;
  for (const [index, edit] of scriptPatch.entries()) {
    const oldText = edit && edit.oldText;
    const newText = edit && edit.newText;
    if (typeof oldText !== 'string' || oldText.length === 0 || typeof newText !== 'string') {
      throw new ResultChangeSetError('script_patch_invalid', `scriptPatch[${index}] requires non-empty oldText and string newText.`);
    }
    const first = result.indexOf(oldText);
    if (first < 0) throw new ResultChangeSetError('script_patch_not_found', `scriptPatch[${index}] did not match.`);
    if (result.indexOf(oldText, first + oldText.length) >= 0) {
      throw new ResultChangeSetError('script_patch_ambiguous', `scriptPatch[${index}] matched more than once.`);
    }
    result = `${result.slice(0, first)}${newText}${result.slice(first + oldText.length)}`;
    if (Buffer.byteLength(result) > MAX_SCRIPT_BYTES) {
      throw new ResultChangeSetError('script_patch_too_large', 'Materialized script exceeds 2 MiB.');
    }
  }
  return result;
}

function materializeResultEdit(input = {}) {
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  if (!fs.existsSync(workspaceRoot)) throw new ResultChangeSetError('workspace_missing', 'Project workspace does not exist.');
  const changeSetId = safeSegment(input.changeSetId, 'change_set_id');
  const revisionId = safeSegment(input.revisionId, 'revision_id');
  const artifactFamilyId = safeSegment(input.artifactFamilyId, 'artifact_family_id');
  const artifactId = safeSegment(input.artifactId, 'artifact_id');
  const pluginId = safeSegment(input.pluginId, 'plugin_id');
  const language = String(input.language || '').toLowerCase() === 'python' ? 'python' : 'r';
  const extension = language === 'python' ? 'py' : 'R';
  const sourceScriptContent = input.sourceScriptContent;
  if (typeof sourceScriptContent !== 'string' || Buffer.byteLength(sourceScriptContent) > MAX_SCRIPT_BYTES) {
    throw new ResultChangeSetError('source_script_invalid', 'Source script must be text no larger than 2 MiB.');
  }
  const sourceScriptSha256 = sha256(sourceScriptContent);
  if (input.expectedSourceScriptSha256 && sourceScriptSha256 !== input.expectedSourceScriptSha256) {
    throw new ResultChangeSetError('source_script_hash_mismatch', 'Source script changed before materialization.');
  }
  const normalizedSourceParams = input.normalizedSourceParams && typeof input.normalizedSourceParams === 'object'
    ? input.normalizedSourceParams
    : {};
  const parameterPatch = input.proposedParameterPatch || {};
  assertSafeParameterPatch(parameterPatch, normalizedSourceParams);
  const parameters = { ...normalizedSourceParams, ...parameterPatch };
  const scriptContent = applyExactScriptPatch(sourceScriptContent, input.scriptPatch || []);
  const scriptSha256 = sha256(scriptContent);
  const parametersContent = stableJson(parameters);
  const parametersSha256 = sha256(parametersContent);
  const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
  const scriptRelativePath = path.posix.join(managedBase, `${artifactId}.${extension}`);
  const parametersRelativePath = path.posix.join(managedBase, 'parameters.json');
  const manifestRelativePath = path.posix.join(managedBase, 'materialization.json');
  const rendererId = `${pluginId}:${artifactId}`;
  const manifest = {
    resultStudioMaterializationVersion: 1,
    changeSetId,
    revisionId,
    artifactFamilyId,
    artifactId,
    rendererId,
    pluginId,
    language,
    sourceScriptSha256,
    scriptRelativePath,
    scriptSha256,
    parametersRelativePath,
    parametersSha256,
    intentRef: input.intentId || null,
  };
  const manifestContent = stableJson(manifest);

  const revisionRoot = path.join(workspaceRoot, '.biof3', 'revision');
  const finalDir = path.join(revisionRoot, changeSetId);
  const tempDir = path.join(revisionRoot, `.tmp-${changeSetId}-${crypto.randomUUID()}`);
  if (!isPathContained(revisionRoot, finalDir) || !isPathContained(revisionRoot, tempDir)) {
    throw new ResultChangeSetError('materialization_path_escape', 'Materialization path escaped the private revision root.');
  }
  if (fs.existsSync(finalDir)) throw new ResultChangeSetError('materialization_exists', 'ChangeSet materialization already exists.');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, `run-script.${extension}`), scriptContent, { flag: 'wx' });
    fs.writeFileSync(path.join(tempDir, 'parameters.json'), parametersContent, { flag: 'wx' });
    fs.writeFileSync(path.join(tempDir, 'materialization.json'), manifestContent, { flag: 'wx' });
    fs.renameSync(tempDir, finalDir);
  } catch (error) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    if (error instanceof ResultChangeSetError) throw error;
    throw new ResultChangeSetError('materialization_failed', error.message);
  }

  return {
    changeSetId,
    revisionId,
    artifactId,
    rendererId,
    language,
    privateRoot: finalDir,
    executableScriptPath: path.join(finalDir, `run-script.${extension}`),
    parametersPath: path.join(finalDir, 'parameters.json'),
    parameters,
    scriptRelativePath,
    scriptSha256,
    parametersRelativePath,
    parametersSha256,
    manifestRelativePath,
    gitFiles: [
      { path: scriptRelativePath, content: scriptContent },
      { path: parametersRelativePath, content: parametersContent },
      { path: manifestRelativePath, content: manifestContent },
    ],
    changedPaths: [
      { relativePath: scriptRelativePath, changeType: 'added', beforeHash: sourceScriptSha256, afterHash: scriptSha256 },
      { relativePath: parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: parametersSha256 },
      { relativePath: manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(manifestContent) },
    ],
  };
}

function exactArtifact(result, artifactId) {
  const matches = (Array.isArray(result && result.artifacts) ? result.artifacts : [])
    .filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function projectRelativeOutput(workspaceRoot, artifact) {
  const physical = artifact && artifact.path;
  if (!physical || !path.isAbsolute(physical)) {
    throw new ResultChangeSetError('candidate_output_outside_project', 'Candidate artifact output is not inside the project workspace.');
  }
  let realWorkspace;
  let realPhysical;
  try {
    realWorkspace = fs.realpathSync(workspaceRoot);
    realPhysical = fs.realpathSync(physical);
  } catch {
    throw new ResultChangeSetError('candidate_output_missing', 'Candidate artifact output is missing.');
  }
  if (!isPathContained(realWorkspace, realPhysical)) {
    throw new ResultChangeSetError('candidate_output_outside_project', 'Candidate artifact output is not inside the project workspace.');
  }
  return path.relative(realWorkspace, realPhysical).split(path.sep).join('/');
}

function resolveExistingProjectFile(workspaceRoot, relativePath, code) {
  try {
    const realWorkspace = fs.realpathSync(workspaceRoot);
    const realFile = fs.realpathSync(path.join(realWorkspace, relativePath));
    if (!isPathContained(realWorkspace, realFile)) throw new Error('outside');
    return realFile;
  } catch {
    throw new ResultChangeSetError(code, 'Referenced project file is missing or escapes the workspace.');
  }
}

function resolveBaseCommit(adapter, projectId) {
  const state = adapter.repositoryState();
  if (state.headCommit) return state.headCommit;
  const managedMain = adapter.revParse('refs/heads/biof3/main');
  if (managedMain) return managedMain;
  return adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main',
    expectedOld: '0'.repeat(40),
    message: `BioF3 Result Studio baseline for ${projectId}`,
    files: [{
      path: 'analysis/workflows/result-studio-baseline.json',
      content: stableJson({ resultStudioBaselineVersion: 1, projectId }),
    }],
  }).commit;
}

function saveResultEditCheckpoint({ repository, projectId, conversationId, changeSetId, candidateCommit = null, stage, recovery = null }) {
  if (!repository || typeof repository.saveCheckpoint !== 'function') return null;
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) return null;
  const revisionIds = repository.listRevisionsByChangeSet(changeSetId).map((revision) => revision.revisionId);
  const currentRevisionIds = repository.listCurrentRevisions(projectId).map((revision) => revision.revisionId);
  return repository.saveCheckpoint({
    checkpointId: deterministicId('rscp', projectId, conversationId || '', changeSetId),
    projectId,
    conversationId: conversationId || null,
    baseCommit: changeSet.baseCommit,
    candidateCommit: candidateCommit || changeSet.candidateCommit || null,
    changeSetId,
    changeSetStatus: changeSet.status,
    currentRevisionIds,
    pendingPreview: {
      stage,
      revisionIds,
      recovery,
    },
    jobRefs: changeSet.jobRefs,
  });
}

/**
 * 把一个已经完成且 Artifact Truth=valid 的普通 Job 登记成 lineage 的 v1。
 *
 * 这是 RS5 的生产入口：RS2 只有表和 Repository，RS3/RS4 若没有 v1 会一直
 * 得到 null revision。登记使用确定性 id，且每个 root Job/Artifact 拥有自己的
 * family；无法证明两个普通 Job 同源时绝不擅自把它们并入同一 lineage。
 */
function ensureBaselineArtifactRevision(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  if (!repository || !adapter) {
    throw new ResultChangeSetError('baseline_dependencies_missing', 'Baseline registration requires repository and Git adapter.');
  }
  const projectId = String(input.projectId || '').trim();
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  const sourceJob = input.sourceJob;
  const artifactId = String(input.artifactId || '').trim();
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
    || sourceJob.status !== 'completed') {
    throw new ResultChangeSetError('baseline_source_job_invalid', 'Baseline source must be a completed Job in the active project.');
  }
  const existing = repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJob.id,
    artifactId,
  });
  if (existing) return { revision: existing, created: false };

  const result = sourceJob.result || {};
  if (!result.artifactTruth || result.artifactTruth.status !== 'valid' || result.artifactTruth.blocking === true) {
    throw new ResultChangeSetError('baseline_artifact_truth_invalid', 'Only valid non-blocking Artifact Truth can become a baseline Revision.');
  }
  const artifact = exactArtifact(result, artifactId);
  if (!artifact) throw new ResultChangeSetError('baseline_artifact_missing', 'Baseline artifact id is not uniquely present.');
  const outputPath = projectRelativeOutput(workspaceRoot, artifact);
  const outputHash = hashFile(artifact.path);
  const provenanceArtifact = (result.executionProvenance?.artifacts || [])
    .find((entry) => entry && entry.id === artifactId);
  if (!outputHash || !provenanceArtifact || provenanceArtifact.sha256 !== outputHash) {
    throw new ResultChangeSetError('baseline_artifact_hash_mismatch', 'Baseline Artifact hash does not match execution provenance.');
  }

  const sourceScriptContent = input.sourceScriptContent;
  const sourceScriptSha256 = sha256(sourceScriptContent || '');
  if (typeof sourceScriptContent !== 'string' || !input.sourceScriptSha256
    || sourceScriptSha256 !== input.sourceScriptSha256
    || Buffer.byteLength(sourceScriptContent) > MAX_SCRIPT_BYTES) {
    throw new ResultChangeSetError('baseline_script_hash_mismatch', 'Baseline script snapshot is unavailable or changed.');
  }
  const pluginId = safeSegment(input.pluginId || sourceJob.tool_id || sourceJob.toolId, 'plugin_id');
  const language = String(input.language || '').toLowerCase() === 'python' ? 'python' : 'r';
  const extension = language === 'python' ? 'py' : 'R';
  const artifactFamilyId = deterministicId('af', projectId, sourceJob.id, artifactId);
  const revisionId = deterministicId('rev', projectId, sourceJob.id, artifactId, outputHash);
  const changeSetId = deterministicId('cs', 'baseline', projectId, sourceJob.id, artifactId, outputHash);
  const workingBranchRef = `refs/heads/biof3/baseline/${changeSetId}`;
  const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
  const scriptRelativePath = path.posix.join(managedBase, `${safeSegment(artifactId, 'artifact_id')}.${extension}`);
  const parametersRelativePath = path.posix.join(managedBase, 'parameters.json');
  const manifestRelativePath = path.posix.join(managedBase, 'materialization.json');
  const parameters = result.executionProvenance?.params?.normalized;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ResultChangeSetError('baseline_parameters_unavailable', 'Normalized execution parameters are required for a reproducible baseline.');
  }
  const parametersContent = stableJson(parameters);
  if (Buffer.byteLength(parametersContent) > MAX_PARAMETERS_BYTES) {
    throw new ResultChangeSetError('baseline_parameters_too_large', 'Normalized baseline parameters exceed 1 MiB.');
  }
  const parametersHash = sha256(parametersContent);
  const rendererId = `${pluginId}:${artifactId}`;
  const manifestContent = stableJson({
    resultStudioMaterializationVersion: 1,
    baseline: true,
    changeSetId,
    revisionId,
    artifactFamilyId,
    artifactId,
    rendererId,
    pluginId,
    language,
    sourceToolJobId: sourceJob.id,
    scriptRelativePath,
    scriptSha256: sourceScriptSha256,
    parametersRelativePath,
    parametersSha256: parametersHash,
  });
  const baseCommit = resolveBaseCommit(adapter, projectId);
  let changeSet = repository.getChangeSet(changeSetId);
  let candidateCommit = adapter.revParse(workingBranchRef);
  try {
    if (!changeSet) {
      repository.createChangeSet({
        changeSetId,
        projectId,
        intentRef: `baseline:${sourceJob.id}:${artifactId}`,
        baseCommit,
        workingBranchRef,
        createdBy: 'agent',
        parentArtifactRefs: [],
      });
      repository.transitionChangeSet({ changeSetId, to: 'running' });
      changeSet = repository.getChangeSet(changeSetId);
    }
    if (!candidateCommit) {
      const gitPathPrefix = String(dependencies.gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
      const files = [
        { path: scriptRelativePath, content: sourceScriptContent },
        { path: parametersRelativePath, content: parametersContent },
        { path: manifestRelativePath, content: manifestContent },
      ].map((file) => ({
        ...file,
        path: gitPathPrefix ? path.posix.join(gitPathPrefix, file.path) : file.path,
      }));
      candidateCommit = adapter.commitVirtualFiles({
        parentCommit: baseCommit,
        ref: workingBranchRef,
        expectedOld: '0'.repeat(40),
        message: `BioF3 baseline ${sourceJob.id}: ${artifactId}`,
        files,
      }).commit;
    }
    let revision = repository.getRevision(revisionId);
    if (!revision) {
      const inputArtifactRefs = (result.executionProvenance?.inputs || [])
        .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
        .map((entry) => ({
          artifactId: entry.sourceArtifactRef || entry.id,
          hash: entry.sha256 || null,
          role: entry.role || null,
        }));
      revision = repository.appendRevision({
        revisionId,
        projectId,
        artifactFamilyId,
        artifactId,
        parentRevisionIds: [],
        sourceCommit: candidateCommit,
        sourceScriptRef: {
          relativePath: scriptRelativePath,
          sha256: sourceScriptSha256,
          entryPoint: path.posix.basename(scriptRelativePath),
          artifactId,
          rendererId,
          language,
          origin: 'project_materialized',
        },
        inputArtifactRefs,
        parametersRef: parametersRelativePath,
        parametersHash,
        toolJobId: sourceJob.id,
        outputPath,
        outputHash,
        validationStatus: result.artifactTruth.status,
        reproducibilityStatus: 'available',
        changeSetId,
      });
    }
    changeSet = repository.getChangeSet(changeSetId);
    if (changeSet.status === 'running') {
      changeSet = repository.transitionChangeSet({
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        changedPaths: [
          { relativePath: scriptRelativePath, changeType: 'added', beforeHash: null, afterHash: sourceScriptSha256 },
          { relativePath: parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: parametersHash },
          { relativePath: manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(manifestContent) },
        ],
        jobRefs: [sourceJob.id],
        candidateArtifactRefs: [revisionId],
        validationSummary: { artifactTruthStatus: 'valid', baseline: true, outputSha256: outputHash },
      }).changeSet;
    }
    if (changeSet.status === 'preview_ready') {
      repository.adoptChangeSet({ changeSetId, candidateCommit });
    }
    return { revision: repository.getRevision(revisionId), created: true };
  } catch (error) {
    const current = repository.getChangeSet(changeSetId);
    if (current && current.status === 'running') {
      try {
        repository.transitionChangeSet({
          changeSetId,
          to: 'validation_failed',
          reason: error.code || 'baseline_registration_failed',
          validationSummary: { error: error.code || 'baseline_registration_failed' },
        });
      } catch { /* leave the durable running record for recovery */ }
    }
    throw error;
  }
}

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
  let disk = null;
  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(workspaceRoot);
      disk = { availableBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
    }
  } catch { /* unknown disk state remains explicit in the snapshot */ }
  const estimatedMemoryBytes = Math.max(0, Number(input.previewResourceEstimate?.memoryBytes || 0));
  const estimatedDiskBytes = Math.max(0, Number(input.previewResourceEstimate?.diskBytes || 0));
  const activePreviewJobs = Math.max(0, Number(dependencies.activePreviewJobs || 0));
  const resourceSnapshot = createRuntimeResourceSnapshot({ disk, activeJobs: activePreviewJobs, estimatedMemoryBytes });
  const previewBudget = evaluatePreviewResourceBudget({ resourceSnapshot, estimatedMemoryBytes, estimatedDiskBytes, activePreviewJobs });
  if (previewBudget.decision === 'blocked') {
    throw new ResultChangeSetError('preview_resource_budget_blocked', 'Preview Job cannot start within the current resource budget.', previewBudget);
  }
  if (previewBudget.decision === 'queued') {
    throw new ResultChangeSetError('preview_resource_queued', 'Preview Job is queued because the background preview budget is saturated.', previewBudget);
  }
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

  const sourceOutputPath = resolveExistingProjectFile(workspaceRoot, sourceRevision.outputPath, 'source_artifact_hash_mismatch');
  if (!sourceRevision.outputHash || hashFile(sourceOutputPath) !== sourceRevision.outputHash) {
    throw new ResultChangeSetError('source_artifact_hash_mismatch', 'Source Artifact changed or is missing before the edit.');
  }
  const sourceArtifactHash = sourceRevision.outputHash;
  const sourceScriptContent = input.sourceScriptContent;
  const sourceScriptHash = sha256(sourceScriptContent || '');
  if (!input.sourceScriptSha256 || sourceScriptHash !== input.sourceScriptSha256) {
    throw new ResultChangeSetError('source_script_hash_mismatch', 'Source script snapshot changed or is unavailable.');
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
    repository.createChangeSet({
      changeSetId,
      projectId,
      conversationId: input.conversationId || null,
      intentRef: input.intent.intentId,
      baseCommit,
      workingBranchRef,
      createdBy: input.createdBy === 'user' ? 'user' : 'agent',
      parentArtifactRefs: [sourceRevision.revisionId],
    });
    changeSetCreated = true;
    repository.transitionChangeSet({ changeSetId, to: 'running' });
    saveResultEditCheckpoint({ repository, projectId, conversationId: input.conversationId, changeSetId, stage: 'change_set' });
    if (cancelled()) throw new ResultChangeSetError('edit_cancelled', 'Edit was cancelled before materialization.');

    emit('materialize', 'running');
    const normalizedSourceParams = sourceResult.executionProvenance?.params?.normalized || {};
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
    const candidate = adapter.commitVirtualFiles({
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
    const executionParams = { ...(sourceJob.params || {}), ...input.intent.proposedParameterPatch };
    const execution = await executeJob({
      toolId: input.pluginId,
      params: executionParams,
      materializedScriptPath: materialized.executableScriptPath,
      materializedScriptSha256: materialized.scriptSha256,
      changeSetId,
      revisionId,
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
    const artifact = exactArtifact(candidateResult, sourceRevision.artifactId);
    if (!artifact) throw new ResultChangeSetError('candidate_artifact_missing', 'Candidate Artifact id is not uniquely present.');
    const outputPath = projectRelativeOutput(workspaceRoot, artifact);
    const outputHash = hashFile(artifact.path);
    const provenanceArtifact = (candidateResult.executionProvenance?.artifacts || [])
      .find((item) => item && item.id === sourceRevision.artifactId);
    if (!outputHash || !provenanceArtifact || provenanceArtifact.sha256 !== outputHash) {
      throw new ResultChangeSetError('candidate_artifact_hash_mismatch', 'Candidate Artifact hash does not match execution provenance.');
    }
    if (hashFile(sourceOutputPath) !== sourceArtifactHash) {
      throw new ResultChangeSetError('source_artifact_mutated', 'Source Artifact changed during candidate execution.');
    }

    emit('revision', 'running');
    const inputArtifactRefs = (candidateResult.executionProvenance?.inputs || [])
      .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
      .map((entry) => ({
        artifactId: entry.sourceArtifactRef || entry.id,
        hash: entry.sha256 || null,
        role: entry.role || null,
      }));
    const revision = repository.appendRevision({
      revisionId,
      projectId,
      artifactFamilyId: sourceRevision.artifactFamilyId,
      artifactId: sourceRevision.artifactId,
      parentRevisionIds: [sourceRevision.revisionId],
      sourceCommit: candidate.commit,
      sourceScriptRef: {
        relativePath: materialized.scriptRelativePath,
        sha256: materialized.scriptSha256,
        entryPoint: path.posix.basename(materialized.scriptRelativePath),
        artifactId: sourceRevision.artifactId,
        rendererId: materialized.rendererId,
        language: materialized.language,
        origin: 'project_materialized',
      },
      inputArtifactRefs,
      parametersRef: materialized.parametersRelativePath,
      parametersHash: materialized.parametersSha256,
      toolJobId: candidateJob.id,
      outputPath,
      outputHash,
      validationStatus: candidateResult.artifactTruth.status,
      reproducibilityStatus: 'verified',
      changeSetId,
    });
    const ready = repository.transitionChangeSet({
      changeSetId,
      to: 'preview_ready',
      candidateCommit: candidate.commit,
      changedPaths: materialized.changedPaths,
      jobRefs: [candidateJob.id],
      candidateArtifactRefs: [revision.revisionId],
      validationSummary: {
        artifactTruthStatus: candidateResult.artifactTruth.status,
        sourceArtifactPreserved: true,
        scriptSha256: materialized.scriptSha256,
        outputSha256: outputHash,
        // P4R-4 review projection: bounded user-facing intent and impact come
        // from the validated, server-trusted ResultEditIntent. The UI must not
        // guess them from an opaque intentRef or a Git message.
        intentSummary: input.intent.requestedOutcome.slice(0, 500),
        impactLevel: input.intent.editClass,
        affectedScope: input.intent.affectedScope || 'unknown',
        requiresJob: input.intent.requiresJob,
        affectedNodeCount: Array.isArray(input.intent.affectedNodeIds) ? input.intent.affectedNodeIds.length : 0,
      },
    }).changeSet;
    emit('revision', 'completed', { revisionId: revision.revisionId });
    emit('preview', 'ready');
    saveResultEditCheckpoint({ repository, projectId, conversationId: input.conversationId, changeSetId, candidateCommit: candidate.commit, stage: 'preview_ready', recovery: 'awaiting_user_decision' });
    return {
      ok: true,
      resultChangeSetServiceVersion: RESULT_CHANGESET_SERVICE_VERSION,
      changeSet: ready,
      revision,
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
    if (changeSetCreated) {
      const current = repository.getChangeSet(changeSetId);
      try {
        if (current && current.status === 'running') {
          if (error && error.code === 'edit_cancelled') {
            repository.transitionChangeSet({ changeSetId, to: 'abandoned', reason: error.code });
          } else {
            repository.transitionChangeSet({
              changeSetId,
              to: 'validation_failed',
              reason: error && error.code || 'result_edit_failed',
              validationSummary: { error: error && error.code || 'result_edit_failed' },
            });
          }
        }
      } catch { /* preserve the original failure; recovery scanner sees remaining state */ }
      try {
        saveResultEditCheckpoint({
          repository,
          projectId,
          conversationId: input.conversationId,
          changeSetId,
          stage: error && error.code === 'edit_cancelled' ? 'cancelled' : 'failed',
          recovery: error && error.code || 'result_edit_failed',
        });
      } catch { /* original failure remains authoritative */ }
    }
    emit(error && error.code === 'edit_cancelled' ? 'cancelled' : 'failed', 'terminal', {
      reason: error && error.code || 'result_edit_failed',
    });
    if (error instanceof ResultChangeSetError) {
      error.detail = { ...(error.detail || {}), changeSetId, progress };
      throw error;
    }
    throw new ResultChangeSetError('result_edit_failed', error.message, { changeSetId, progress });
  }
}

function inspectResultEditRecovery({ repository, adapter, workspaceRoot, projectId } = {}) {
  if (!repository || !adapter || !workspaceRoot || !projectId) {
    throw new ResultChangeSetError('recovery_dependencies_missing', 'Recovery inspection requires repository, adapter, workspaceRoot and projectId.');
  }
  return repository.findInterruptedChangeSets(projectId).map((entry) => {
    const changeSet = entry.changeSet;
    const privateRoot = path.join(path.resolve(workspaceRoot), '.biof3', 'revision', changeSet.changeSetId);
    const manifestPath = path.join(privateRoot, 'materialization.json');
    const candidateCommit = adapter.revParse(changeSet.workingBranchRef);
    const materializationPresent = fs.existsSync(manifestPath);
    let recovery = entry.recovery;
    if (changeSet.status === 'running') {
      recovery = materializationPresent && candidateCommit
        ? 'resume_from_materialized_candidate'
        : 'restart_materialization_required';
    }
    return {
      changeSet,
      recovery,
      materializationPresent,
      candidateCommit,
      safeToAdopt: false,
    };
  });
}

module.exports = {
  RESULT_CHANGESET_SERVICE_VERSION,
  ResultChangeSetError,
  sha256,
  applyExactScriptPatch,
  materializeResultEdit,
  resolveBaseCommit,
  ensureBaselineArtifactRevision,
  createResultChangeSet,
  saveResultEditCheckpoint,
  inspectResultEditRecovery,
};
