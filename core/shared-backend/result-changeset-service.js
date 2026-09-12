'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./canonical-json');
const { validateResultEditIntent } = require('./result-edit-intent');
const { isPathContained } = require('./project-run-layout');
const { createRuntimeResourceSnapshot } = require('./runtime-resource-snapshot');
const { evaluatePreviewResourceBudget } = require('./result-studio-lifecycle');
const { getResultStudioRuntimeLease } = require('./result-studio-runtime-lease');
const { verifyRevisionSourceMaterial } = require('./result-revision-source');
const {
  buildAuthoritativeWorkflowGraph,
  verifyWorkflowGraphIntegrity,
} = require('./result-workflow-graph');
const { validateResultStudioCandidate } = require('./result-plugin-validator');
const {
  DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS,
  propagateDegThresholds,
} = require('./result-scientific-rerun');
const { resolveExecutionInputPath, verifyExecutionProvenance } = require('./execution-provenance');
const { executeDurableRefTransaction } = require('./result-ref-transaction');
const {
  ResultStudioPrivatePathError,
  resolveWorkspaceAnchor,
  ensurePrivateDirectory,
  inspectPrivateDirectory,
  inspectPrivateEntry,
  createPrivateFileExclusiveSync,
  renamePrivateDirectorySync,
  removePrivatePathSync,
} = require('./result-studio-private-path');

const RESULT_CHANGESET_SERVICE_VERSION = 1;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS_BYTES = 1024 * 1024;
const ZERO_OID = '0'.repeat(40);
const DEFAULT_PREVIEW_BASE_MEMORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_PREVIEW_INPUT_MEMORY_MULTIPLIER = 4;
const DEFAULT_PREVIEW_OUTPUT_DISK_MULTIPLIER = 2;
const PREVIEW_METADATA_RESERVE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_MODEL_MULTIPLIER = 64;
const SENSITIVE_PARAMETER = /(?:^|_)(?:api_?key|access_?token|secret|password|credential)(?:$|_)/i;

class ResultChangeSetError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultChangeSetError';
    this.code = code;
    this.detail = detail;
  }
}

function resultChangeSetPrivatePathError(error) {
  if (!(error instanceof ResultStudioPrivatePathError)) return error;
  return new ResultChangeSetError(error.code, error.message, error.detail);
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

function resourceNumber(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function boundedResourceProduct(...values) {
  let product = 1;
  for (const value of values) {
    product *= value;
    if (!Number.isFinite(product) || product > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  }
  return Math.ceil(product);
}

function trustedFileSize(workspaceRoot, candidate, code) {
  try {
    const root = fs.realpathSync(workspaceRoot);
    const target = fs.realpathSync(candidate);
    const stat = fs.statSync(target);
    if (!isPathContained(root, target) || !stat.isFile()) throw new Error('outside');
    return stat.size;
  } catch {
    throw new ResultChangeSetError(code, 'A trusted resource-estimation file is missing or escapes the project.');
  }
}

function trustedPreviewResourceModel(descriptor) {
  const raw = descriptor?.previewResourceModel;
  if (raw == null) {
    return {
      baseMemoryBytes: DEFAULT_PREVIEW_BASE_MEMORY_BYTES,
      inputMemoryMultiplier: DEFAULT_PREVIEW_INPUT_MEMORY_MULTIPLIER,
      outputDiskMultiplier: DEFAULT_PREVIEW_OUTPUT_DISK_MULTIPLIER,
      raster: null,
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin preview resource model is invalid.');
  }
  const baseMemoryBytes = resourceNumber(raw.baseMemoryBytes, { minimum: 1 });
  const inputMemoryMultiplier = resourceNumber(raw.inputMemoryMultiplier, {
    minimum: 0,
    maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
  });
  const outputDiskMultiplier = resourceNumber(raw.outputDiskMultiplier, {
    minimum: 1,
    maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
  });
  if (baseMemoryBytes == null || inputMemoryMultiplier == null || outputDiskMultiplier == null) {
    throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin preview resource model has invalid numeric bounds.');
  }
  let raster = null;
  if (raw.raster != null) {
    const candidate = raw.raster;
    const parameterIds = ['widthParameter', 'heightParameter', 'dpiParameter'];
    const bytesPerPixel = resourceNumber(candidate?.bytesPerPixel, { minimum: 1, maximum: 32 });
    const workingSetMultiplier = resourceNumber(candidate?.workingSetMultiplier, {
      minimum: 1,
      maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
    });
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || parameterIds.some((key) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(candidate[key] || ''))
          || !descriptor?.parameters?.[candidate[key]])
        || bytesPerPixel == null || workingSetMultiplier == null) {
      throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin raster resource model is invalid.');
    }
    raster = {
      widthParameter: candidate.widthParameter,
      heightParameter: candidate.heightParameter,
      dpiParameter: candidate.dpiParameter,
      bytesPerPixel,
      workingSetMultiplier,
    };
  }
  return { baseMemoryBytes, inputMemoryMultiplier, outputDiskMultiplier, raster };
}

function deriveTrustedPreviewResourceEstimate({
  descriptor,
  sourceJob,
  sourceResult,
  workspaceRoot,
  trustedExecution,
  sourceOutputPath,
  sourceRevision,
  proposedParameterPatch = {},
  downstreamPlan = [],
} = {}) {
  const model = trustedPreviewResourceModel(descriptor);
  const provenanceInputs = Array.isArray(sourceResult?.executionProvenance?.inputs)
    ? sourceResult.executionProvenance.inputs
    : [];
  let inputBytes = 0;
  for (const input of provenanceInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    const physical = trustedExecution?.runtime?.[inputId];
    if (typeof physical !== 'string' || !path.isAbsolute(physical)) {
      throw new ResultChangeSetError('preview_resource_estimate_unavailable', 'A verified source input is unavailable for resource estimation.');
    }
    inputBytes += trustedFileSize(workspaceRoot, physical, 'preview_resource_estimate_unavailable');
  }

  const descriptorArtifactIds = Array.isArray(descriptor?.artifacts)
    ? descriptor.artifacts.map((artifact) => String(artifact?.id || '').trim()).filter(Boolean)
    : [];
  const selectedOutputBytes = trustedFileSize(workspaceRoot, sourceOutputPath, 'preview_resource_estimate_unavailable');
  let sourceOutputBytes = selectedOutputBytes;
  let sourceOutputMeasurement = 'selected_revision_artifact';
  if (descriptorArtifactIds.length > 0) {
    const descriptorArtifacts = descriptorArtifactIds.map((artifactId) => exactArtifact(sourceResult, artifactId));
    // Historical Revisions may predate complete formal-output cohort registration.
    // Their selected Revision has already passed the exact physical hash check
    // above, so it is a trusted conservative floor. Only use all descriptor
    // outputs when every one has a concrete current physical path; a partial
    // list must never manufacture an estimate from missing artifacts.
    if (descriptorArtifacts.every((artifact) => artifact?.path)) {
      sourceOutputBytes = descriptorArtifacts.reduce((total, artifact) => total + trustedFileSize(
        workspaceRoot,
        artifact.path,
        'preview_resource_estimate_unavailable',
      ), 0);
      sourceOutputMeasurement = 'complete_descriptor_artifacts';
    }
  }
  const downstreamOutputBytes = (Array.isArray(downstreamPlan) ? downstreamPlan : [])
    .reduce((total, entry) => total + trustedFileSize(
      workspaceRoot,
      entry.sourceOutputPath,
      'preview_resource_estimate_unavailable',
    ), 0);

  const usage = sourceResult?.resourceUsage;
  const historicalRssBytes = Number(usage?.sampling?.processSampleCount) > 0
    ? resourceNumber(usage?.peak?.rssBytes, { minimum: 1 })
    : null;
  const inputWorkingSet = boundedResourceProduct(inputBytes, model.inputMemoryMultiplier);
  let memoryBytes = Math.max(
    model.baseMemoryBytes + inputWorkingSet,
    historicalRssBytes == null ? 0 : boundedResourceProduct(historicalRssBytes, 1.25),
  );
  let rasterBytes = 0;
  let rasterParameterSource = null;
  if (model.raster) {
    const parameters = { ...(trustedExecution?.normalized || {}), ...(proposedParameterPatch || {}) };
    const defaultParameter = (parameterId) => resourceNumber(
      descriptor?.parameters?.[parameterId]?.default,
      { minimum: 1 },
    );
    const exactWidth = resourceNumber(parameters[model.raster.widthParameter], { minimum: 1 });
    const exactHeight = resourceNumber(parameters[model.raster.heightParameter], { minimum: 1 });
    const exactDpi = resourceNumber(parameters[model.raster.dpiParameter], { minimum: 1 });
    const width = exactWidth ?? defaultParameter(model.raster.widthParameter);
    const height = exactHeight ?? defaultParameter(model.raster.heightParameter);
    const dpi = exactDpi ?? defaultParameter(model.raster.dpiParameter);
    if (width != null && height != null && dpi != null) {
      rasterParameterSource = exactWidth != null && exactHeight != null && exactDpi != null
        ? 'trusted_execution_parameters'
        : 'trusted_descriptor_defaults_for_legacy_revision';
      rasterBytes = boundedResourceProduct(width, dpi, height, dpi, model.raster.bytesPerPixel);
      memoryBytes = Math.max(memoryBytes, boundedResourceProduct(rasterBytes, model.raster.workingSetMultiplier));
    } else {
      // A pre-descriptor historical revision has no user-provided dimensions to
      // trust. The base/input/output model remains a deterministic server-side
      // guard while the response records that no raster term was available.
      rasterParameterSource = 'not_available_in_legacy_revision';
    }
  }
  const diskBytes = Math.max(
    PREVIEW_METADATA_RESERVE_BYTES,
    boundedResourceProduct(sourceOutputBytes + downstreamOutputBytes, model.outputDiskMultiplier)
      + rasterBytes + PREVIEW_METADATA_RESERVE_BYTES,
  );
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0
      || !Number.isSafeInteger(diskBytes) || diskBytes <= 0) {
    throw new ResultChangeSetError('preview_resource_estimate_unavailable', 'A finite trusted preview resource estimate could not be derived.');
  }
  return {
    estimateVersion: 1,
    source: 'server_job_descriptor_input_truth',
    memoryBytes,
    diskBytes,
    inputBytes,
    sourceOutputBytes,
    sourceOutputMeasurement,
    selectedRevisionId: sourceRevision?.revisionId || null,
    downstreamOutputBytes,
    historicalRssBytes,
    rasterBytes,
    rasterParameterSource,
  };
}

function stableJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

function gitFailureDiagnostic(error) {
  if (!error || error.name !== 'GitAdapterError' || !error.detail || typeof error.detail !== 'object') {
    return null;
  }
  const detail = error.detail;
  return {
    operation: typeof error.code === 'string' ? error.code : 'git_command_failed',
    command: typeof detail.command === 'string' ? detail.command : null,
    status: Number.isInteger(detail.status) ? detail.status : null,
    systemCode: typeof detail.systemCode === 'string' ? detail.systemCode : null,
    signal: typeof detail.signal === 'string' ? detail.signal : null,
    killed: detail.killed === true,
    attempts: Number.isInteger(detail.attempts) ? detail.attempts : 1,
    stderr: typeof detail.stderr === 'string' ? detail.stderr.slice(0, 2000) : '',
  };
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
  let workspaceRoot;
  try {
    workspaceRoot = resolveWorkspaceAnchor(input.workspaceRoot);
  } catch (error) {
    const wrapped = resultChangeSetPrivatePathError(error);
    if (wrapped instanceof ResultChangeSetError && wrapped.code === 'private_workspace_missing') {
      throw new ResultChangeSetError('workspace_missing', 'Project workspace does not exist.', wrapped.detail);
    }
    throw wrapped;
  }
  const changeSetId = safeSegment(input.changeSetId, 'change_set_id');
  const materializationKey = input.materializationKey == null
    ? null
    : safeSegment(input.materializationKey, 'materialization_key');
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

  const revisionComponents = ['.biof3', 'revision'];
  // A ChangeSet has one root materialization and, only for an already
  // verified server-projected affected subgraph, isolated descendant
  // materializations.  They remain under the same private root so the MCP
  // override path guard can enforce a single ChangeSet boundary.
  const finalComponents = materializationKey
    ? [...revisionComponents, changeSetId, 'downstream', materializationKey]
    : [...revisionComponents, changeSetId];
  const tempComponents = [...revisionComponents, `.tmp-${changeSetId}-${crypto.randomUUID()}`];
  let tempCreated = false;
  let finalDir;
  try {
    ensurePrivateDirectory(workspaceRoot, revisionComponents);
    if (materializationKey) {
      const rootMaterialization = inspectPrivateDirectory(
        workspaceRoot,
        [...revisionComponents, changeSetId],
        { allowMissing: true },
      );
      if (!rootMaterialization) {
        throw new ResultChangeSetError(
          'materialization_root_missing',
          'Downstream materialization requires the root ChangeSet materialization.',
        );
      }
      ensurePrivateDirectory(workspaceRoot, [...revisionComponents, changeSetId, 'downstream']);
    }
    if (inspectPrivateEntry(workspaceRoot, finalComponents, { allowMissing: true }) !== null) {
      throw new ResultChangeSetError('materialization_exists', 'ChangeSet materialization already exists.');
    }
    ensurePrivateDirectory(workspaceRoot, tempComponents);
    tempCreated = true;
    createPrivateFileExclusiveSync(
      workspaceRoot,
      [...tempComponents, `run-script.${extension}`],
      scriptContent,
    );
    createPrivateFileExclusiveSync(workspaceRoot, [...tempComponents, 'parameters.json'], parametersContent);
    createPrivateFileExclusiveSync(workspaceRoot, [...tempComponents, 'materialization.json'], manifestContent);
    finalDir = renamePrivateDirectorySync(workspaceRoot, tempComponents, finalComponents);
    tempCreated = false;
  } catch (error) {
    if (tempCreated) {
      try {
        removePrivatePathSync(workspaceRoot, tempComponents, {
          recursive: true,
          force: true,
          kind: 'directory',
        });
      } catch { /* preserve unsafe or incomplete staging for lifecycle inspection */ }
    }
    if (error instanceof ResultChangeSetError) throw error;
    if (error instanceof ResultStudioPrivatePathError) throw resultChangeSetPrivatePathError(error);
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

function resultOf(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function cloneJsonObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResultChangeSetError(code, 'Persisted execution parameters must be an object.');
  }
  try { return JSON.parse(JSON.stringify(value)); } catch {
    throw new ResultChangeSetError(code, 'Persisted execution parameters are not safely serializable.');
  }
}

function resolveCandidateDescriptor({ dependencies, toolId }) {
  if (typeof dependencies.getResultStudioDescriptor === 'function') {
    const descriptor = dependencies.getResultStudioDescriptor(toolId);
    if (descriptor) return descriptor.resultStudio || descriptor;
  }
  return null;
}

function validateCandidateJob({ dependencies, toolId, job, workspaceRoot, expectedScriptSha256, rawParams }) {
  const validation = validateResultStudioCandidate({
    descriptor: resolveCandidateDescriptor({ dependencies, toolId }),
    job,
    workspaceRoot,
    expectedScriptSha256,
    rawParams,
  });
  if (!validation.ok) {
    throw new ResultChangeSetError(
      'candidate_plugin_validation_failed',
      `Candidate Job failed the admitted ${toolId} Result Studio validator.`,
      { toolId, validatorId: validation.validatorId, diagnostics: validation.diagnostics }
    );
  }
  return validation;
}

function sourceJobParameters(sourceJob) {
  if (sourceJob?.params && typeof sourceJob.params === 'object' && !Array.isArray(sourceJob.params)) {
    return cloneJsonObject(sourceJob.params, 'source_parameters_unavailable');
  }
  try {
    return cloneJsonObject(JSON.parse(sourceJob?.params_json || '{}'), 'source_parameters_unavailable');
  } catch (error) {
    if (error instanceof ResultChangeSetError) throw error;
    throw new ResultChangeSetError('source_parameters_unavailable', 'Source Job parameters are unavailable.');
  }
}

/**
 * Rebuild executable parameters from the immutable normalized parameters in
 * the Revision commit. The mutable Job row contributes only verified physical
 * file locations; every scientific/display scalar comes from Git.
 */
function buildTrustedExecutionParams({ sourceJob, sourceProjection, workspaceRoot, parameterPatch = {} }) {
  const normalized = cloneJsonObject(
    sourceProjection?.parameters?.rawValues || sourceProjection?.parameters?.values,
    'source_parameters_unavailable'
  );
  const raw = sourceJobParameters(sourceJob);
  const runtime = cloneJsonObject(normalized, 'source_parameters_unavailable');
  const sourceResult = resultOf(sourceJob);
  const sourceProvenance = sourceResult.executionProvenance || null;
  const provenanceInputs = Array.isArray(sourceProvenance?.inputs)
    ? sourceProvenance.inputs
    : [];
  const seen = new Set();
  let realWorkspace;
  try { realWorkspace = fs.realpathSync(workspaceRoot); } catch {
    throw new ResultChangeSetError('source_workspace_unavailable', 'Project workspace is unavailable.');
  }
  for (const input of provenanceInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    if (seen.has(inputId)) {
      throw new ResultChangeSetError('source_input_identity_ambiguous', 'Source input identity is duplicated.');
    }
    seen.add(inputId);
    const committed = normalized[inputId];
    if (!committed || typeof committed !== 'object' || Array.isArray(committed)
        || committed.inputRef !== input.relativePath || committed.sha256 !== input.sha256) {
      throw new ResultChangeSetError('source_input_binding_mismatch', 'Source input no longer matches the immutable Revision parameters.');
    }
    const resolved = resolveExecutionInputPath({
      workspaceRoot: realWorkspace,
      input,
      sourceParams: raw,
      provenance: sourceProvenance,
    });
    const physical = resolved.path;
    if (!physical) {
      throw new ResultChangeSetError('source_input_drift', 'A source input is missing.');
    }
    if (hashFile(physical) !== input.sha256) {
      throw new ResultChangeSetError('source_input_drift', 'A source input changed or escaped the project.');
    }
    runtime[inputId] = physical;
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.inputRef && !seen.has(key)) {
      throw new ResultChangeSetError('source_input_provenance_missing', 'An immutable file input lacks execution provenance.');
    }
  }
  return { normalized, runtime: { ...runtime, ...parameterPatch } };
}

function exactProvenanceArtifact(result, artifactId) {
  const matches = (Array.isArray(result?.executionProvenance?.artifacts) ? result.executionProvenance.artifacts : [])
    .filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function inheritServerIssuedInputLineage(sourceResult) {
  const provenance = sourceResult?.executionProvenance || null;
  const inputs = Array.isArray(provenance?.inputs) ? provenance.inputs : [];
  const lineageInputs = inputs.filter((input) => input?.lineage != null);
  if (lineageInputs.length === 0) {
    return { inputLineage: null, expectations: [] };
  }
  if (!verifyExecutionProvenance(provenance).ok) {
    throw new ResultChangeSetError(
      'source_input_lineage_untrusted',
      'Source input lineage is not backed by intact server-issued execution provenance.'
    );
  }
  const inputLineage = {};
  const expectations = [];
  for (const input of lineageInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    if (Object.prototype.hasOwnProperty.call(inputLineage, inputId)) {
      throw new ResultChangeSetError('source_input_identity_ambiguous', 'Source input identity is duplicated.');
    }
    const lineage = cloneJsonObject(input.lineage, 'source_input_lineage_invalid');
    inputLineage[inputId] = cloneJsonObject(lineage, 'source_input_lineage_invalid');
    expectations.push({ inputId, sha256: input.sha256 || null, lineage });
  }
  return { inputLineage, expectations };
}

function assertInheritedCandidateInputLineage(candidateResult, inherited) {
  const inputs = Array.isArray(candidateResult?.executionProvenance?.inputs)
    ? candidateResult.executionProvenance.inputs
    : [];
  const expectations = inherited?.expectations || [];
  const expectedIds = new Set(expectations.map((entry) => entry.inputId));
  const lineageInputs = inputs.filter((input) => input?.lineage != null);
  if (lineageInputs.length !== expectations.length
      || lineageInputs.some((input) => !expectedIds.has(String(input?.id || '')))) {
    throw new ResultChangeSetError(
      'candidate_input_lineage_drift',
      'Candidate Job input lineage differs from the server-issued source lineage.'
    );
  }
  for (const expected of expectations) {
    const matches = inputs.filter((input) => input && input.id === expected.inputId);
    if (matches.length !== 1 || matches[0].sha256 !== expected.sha256
        || stableStringify(matches[0].lineage) !== stableStringify(expected.lineage)) {
      throw new ResultChangeSetError(
        'candidate_input_lineage_drift',
        'Candidate Job input hash or lineage differs from the server-issued source lineage.',
        { inputId: expected.inputId }
      );
    }
  }
}

function resolveLineageAncestorJobs({ inherited, getToolJob }) {
  if (typeof getToolJob !== 'function') return [];
  const queue = (inherited?.expectations || [])
    .map((entry) => String(entry.lineage?.sourceToolJobId || '').trim())
    .filter(Boolean);
  const visited = new Set();
  const jobs = [];
  while (queue.length > 0) {
    const toolJobId = queue.shift();
    if (visited.has(toolJobId)) continue;
    visited.add(toolJobId);
    let job = null;
    try { job = getToolJob(toolJobId); } catch { job = null; }
    if (!job || String(job.id || '').trim() !== toolJobId) continue;
    jobs.push(job);
    const inputs = resultOf(job).executionProvenance?.inputs;
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const parentJobId = String(input?.lineage?.sourceToolJobId || '').trim();
      if (parentJobId && !visited.has(parentJobId)) queue.push(parentJobId);
    }
  }
  return jobs;
}

/**
 * Normalize the bounded affected subgraph P6 can replay today.  The caller
 * cannot submit a plan: the context-bound agent tool rebuilds it from the
 * durable graph and passes this server-private projection.  This service
 * nevertheless rechecks every revision/job/hash before executing it.
 *
 * The deliberately narrow contract is one current DEG table feeding at most
 * one direct current Job for each admitted child tool via exact artifact
 * edges. Selection/transformed bytes, duplicate tools, multi-parent branches
 * and arbitrary descendants stay unavailable rather than receiving a guessed
 * rerun.
 */
function resolveAuthoritativeDownstreamPlan({ input, dependencies, projectId, workspaceRoot, sourceRevision, sourceOutputHash }) {
  const subgraph = input.authoritativeSubgraph;
  if (!subgraph) return [];
  if (dependencies.authoritativeSubgraphTrusted !== true) {
    throw new ResultChangeSetError('authoritative_subgraph_untrusted', 'Affected-subgraph execution requires a context-bound server projection.');
  }
  if (!subgraph || subgraph.authority !== 'sqlite_job_artifact_truth'
      || subgraph.graphId !== input.intent?.workflowGraph?.graphId
      || subgraph.sourceDigest !== input.intent?.workflowGraph?.sourceDigest
      || subgraph.rootNodeId !== `job:${sourceRevision.toolJobId}`
      || subgraph.rootToolJobId !== sourceRevision.toolJobId
      || subgraph.rootRevisionId !== sourceRevision.revisionId
      || !Array.isArray(subgraph.children)) {
    throw new ResultChangeSetError('authoritative_subgraph_invalid', 'Affected-subgraph projection no longer matches the trusted intent.');
  }
  if (subgraph.children.length === 0) return [];
  if (sourceRevision.artifactId !== 'deg_table') {
    throw new ResultChangeSetError('downstream_root_unsupported', 'Only a verified DEG table can currently drive an affected direct-child rerun.');
  }
  const maximumChildren = Object.keys(DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS).length;
  if (subgraph.children.length > maximumChildren) {
    throw new ResultChangeSetError('downstream_subgraph_unsupported', 'The affected subgraph exceeds the admitted direct DEG child set.');
  }
  const repository = dependencies.repository;
  const getToolJob = dependencies.getToolJob;
  if (!repository || typeof repository.getRevision !== 'function'
      || typeof repository.getCurrentRevision !== 'function' || typeof getToolJob !== 'function') {
    throw new ResultChangeSetError('downstream_dependencies_missing', 'Downstream replay cannot resolve durable Job and Revision truth.');
  }
  const seenNodeIds = new Set();
  const seenToolIds = new Set();
  const seenToolJobIds = new Set();
  const seenRevisionIds = new Set();
  const children = [...subgraph.children].sort((left, right) => (
    String(left?.nodeId || '').localeCompare(String(right?.nodeId || ''))
  ));
  return children.map((childRef) => {
    const expectedArtifactId = DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS[childRef?.toolId];
    if (!childRef || !expectedArtifactId || childRef.inputId !== 'deg_table'
        || childRef.edgeKind !== 'artifact' || childRef.sourceToolJobId !== sourceRevision.toolJobId
        || childRef.sourceRevisionId !== sourceRevision.revisionId
        || childRef.sourceArtifactId !== sourceRevision.artifactId
        || childRef.sourceOutputHash !== sourceOutputHash
        || typeof childRef.nodeId !== 'string' || typeof childRef.childToolJobId !== 'string'
        || childRef.nodeId !== `job:${childRef.childToolJobId}`
        || typeof childRef.childRevisionId !== 'string') {
      throw new ResultChangeSetError('downstream_lineage_unsupported', 'Downstream lineage is not an admitted exact direct DEG artifact hand-off.');
    }
    if (seenNodeIds.has(childRef.nodeId) || seenToolIds.has(childRef.toolId)
        || seenToolJobIds.has(childRef.childToolJobId) || seenRevisionIds.has(childRef.childRevisionId)) {
      throw new ResultChangeSetError('downstream_subgraph_unsupported', 'The affected subgraph contains a duplicate direct child identity.');
    }
    seenNodeIds.add(childRef.nodeId);
    seenToolIds.add(childRef.toolId);
    seenToolJobIds.add(childRef.childToolJobId);
    seenRevisionIds.add(childRef.childRevisionId);

    const sourceRevisionForChild = repository.getRevision(childRef.childRevisionId);
    const sourceJob = getToolJob(childRef.childToolJobId);
    const currentRevision = sourceRevisionForChild
      ? repository.getCurrentRevision(sourceRevisionForChild.artifactFamilyId, projectId)
      : null;
    if (!sourceRevisionForChild || sourceRevisionForChild.projectId !== projectId
        || sourceRevisionForChild.toolJobId !== childRef.childToolJobId
        || sourceRevisionForChild.artifactId !== expectedArtifactId
        || !currentRevision || currentRevision.revisionId !== sourceRevisionForChild.revisionId
        || !sourceJob || sourceJob.status !== 'completed'
        || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
        || (sourceJob.tool_id || sourceJob.toolId) !== childRef.toolId) {
      throw new ResultChangeSetError('downstream_revision_missing', 'A direct descendant lacks its exact current durable source Revision.');
    }
    const sourceResult = resultOf(sourceJob);
    const sourceArtifact = exactArtifact(sourceResult, sourceRevisionForChild.artifactId);
    const sourceProvenanceArtifact = exactProvenanceArtifact(sourceResult, sourceRevisionForChild.artifactId);
    if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true
        || !sourceArtifact || !sourceProvenanceArtifact) {
      throw new ResultChangeSetError('downstream_artifact_truth_invalid', 'A direct descendant no longer has valid Artifact Truth.');
    }
    const sourceOutputPath = resolveExistingProjectFile(workspaceRoot, sourceRevisionForChild.outputPath, 'downstream_artifact_hash_mismatch');
    if (!sourceRevisionForChild.outputHash || hashFile(sourceOutputPath) !== sourceRevisionForChild.outputHash
        || sourceProvenanceArtifact.sha256 !== sourceRevisionForChild.outputHash) {
      throw new ResultChangeSetError('downstream_artifact_hash_mismatch', 'A direct descendant source Artifact changed before rerun.');
    }
    let sourceProjection;
    try {
      sourceProjection = verifyRevisionSourceMaterial({ projectId, revision: sourceRevisionForChild }, {
        repository,
        adapter: dependencies.adapter,
        gitPathPrefix: dependencies.gitPathPrefix,
        workspaceRoot,
        getToolJob,
      });
    } catch (error) {
      if (error && error.code) throw new ResultChangeSetError(error.code, error.message, error.detail);
      throw error;
    }
    const normalizedParams = cloneJsonObject(sourceProjection.parameters?.values, 'downstream_parameters_unavailable');
    const rawParams = cloneJsonObject(normalizedParams, 'downstream_parameters_unavailable');
    const originalInput = normalizedParams.deg_table;
    if (!originalInput || typeof originalInput !== 'object' || Array.isArray(originalInput)
        || typeof originalInput.inputRef !== 'string'
        || originalInput.sha256 !== sourceOutputHash) {
      throw new ResultChangeSetError('downstream_parameters_unavailable', 'A direct descendant source does not preserve the exact DEG input binding.');
    }
    return {
      ...childRef,
      sourceRevision: sourceRevisionForChild,
      sourceJob,
      sourceOutputPath,
      sourceOutputHash: sourceRevisionForChild.outputHash,
      sourceScriptContent: sourceProjection.content,
      sourceScriptSha256: sourceProjection.sha256,
      normalizedSourceParams: normalizedParams,
      rawSourceParams: rawParams,
      language: sourceRevisionForChild.sourceScriptRef.language,
    };
  });
}

function isBaselineIntentRef(value) {
  const intentRef = String(value || '');
  return intentRef.startsWith('baseline:') || intentRef.startsWith('baseline-cohort:');
}

function sameIdentifierSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function descriptorFormalArtifactTruth(descriptor, sourceJob) {
  const descriptors = Array.isArray(descriptor?.artifacts) ? descriptor.artifacts : [];
  const artifactIds = descriptors.map((artifact) => String(artifact?.id || artifact?.artifactId || '').trim());
  if (artifactIds.length === 0 || artifactIds.some((artifactId) => !artifactId)
      || new Set(artifactIds).size !== artifactIds.length) {
    return null;
  }
  const result = resultOf(sourceJob);
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const provenanceArtifacts = Array.isArray(result.executionProvenance?.artifacts)
    ? result.executionProvenance.artifacts
    : [];
  const formalArtifacts = [];
  for (const artifactId of artifactIds) {
    const matches = artifacts.filter((artifact) => artifact?.id === artifactId);
    const provenanceMatches = provenanceArtifacts.filter((artifact) => artifact?.id === artifactId);
    const outputHash = String(provenanceMatches[0]?.sha256 || '').trim();
    if (matches.length !== 1 || provenanceMatches.length !== 1 || !/^[a-f0-9]{64}$/.test(outputHash)) {
      return null;
    }
    formalArtifacts.push({ artifactId, sha256: outputHash });
  }
  return formalArtifacts;
}

function resolveExactFormalSourceRevision({
  repository,
  projectId,
  selectedRevision,
  sourceToolJobId,
  artifactId,
} = {}) {
  const sourceChangeSet = selectedRevision?.changeSetId
    ? repository?.getChangeSet(selectedRevision.changeSetId)
    : null;
  const cohort = sourceChangeSet
    ? repository.listRevisionsByChangeSet(sourceChangeSet.changeSetId)
    : [];
  const cohortRevisionIds = cohort.map((revision) => revision.revisionId);
  const cohortJobIds = [...new Set(cohort.map((revision) => revision.toolJobId))];
  if (!sourceChangeSet || sourceChangeSet.projectId !== projectId
      || !['preview_ready', 'adopted', 'reverted'].includes(sourceChangeSet.status)
      || !sameIdentifierSet(cohortRevisionIds, sourceChangeSet.candidateArtifactRefs)
      || !sameIdentifierSet(cohortJobIds, sourceChangeSet.jobRefs)
      || !cohort.some((revision) => revision.revisionId === selectedRevision.revisionId)
      || selectedRevision.projectId !== projectId
      || selectedRevision.toolJobId !== sourceToolJobId) {
    throw new ResultChangeSetError(
      'candidate_formal_source_cohort_incomplete',
      'Formal source outputs must resolve from the selected Revision\'s exact ChangeSet cohort.'
    );
  }
  const matches = cohort.filter((revision) => revision.projectId === projectId
    && revision.toolJobId === sourceToolJobId
    && revision.artifactId === artifactId);
  if (matches.length !== 1
      || (artifactId === selectedRevision.artifactId
        && matches[0].revisionId !== selectedRevision.revisionId)) {
    throw new ResultChangeSetError(
      'candidate_formal_source_revision_missing',
      'Every produced formal output requires one exact source Revision from the selected ChangeSet cohort.',
      { toolJobId: sourceToolJobId, artifactId }
    );
  }
  return matches[0];
}

function resolveCompleteBaselineCohort({
  repository,
  changeSetId,
  projectId,
  sourceJobId,
  formalArtifacts,
  validatorId,
  allowedStatuses = ['adopted'],
}) {
  if (!changeSetId) return null;
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet || changeSet.projectId !== projectId
      || !allowedStatuses.includes(changeSet.status)
      || !isBaselineIntentRef(changeSet.intentRef)
      || (changeSet.status === 'adopted' && !changeSet.adoptedAt)) {
    return null;
  }
  const revisions = repository.listRevisionsByChangeSet(changeSetId);
  const revisionIds = revisions.map((revision) => revision.revisionId);
  if (!sameIdentifierSet(revisionIds, changeSet.candidateArtifactRefs)
      || revisions.length !== formalArtifacts.length) {
    return null;
  }
  const byArtifactId = new Map();
  for (const revision of revisions) {
    if (byArtifactId.has(revision.artifactId)) return null;
    byArtifactId.set(revision.artifactId, revision);
  }
  const ordered = [];
  for (const artifact of formalArtifacts) {
    const revision = byArtifactId.get(artifact.artifactId);
    if (!revision || revision.projectId !== projectId
        || revision.changeSetId !== changeSetId
        || revision.toolJobId !== sourceJobId
        || revision.outputHash !== artifact.sha256
        || revision.validationStatus === 'blocked'
        || !revision.sourceCommit
        || revision.sourceCommit !== changeSet.candidateCommit) {
      return null;
    }
    ordered.push(revision);
  }
  const validationSummary = changeSet.validationSummary || {};
  if (validationSummary.formalArtifactCount !== formalArtifacts.length
      || !sameIdentifierSet(validationSummary.validatorIds, [validatorId])) {
    return null;
  }
  const graphRef = validationSummary.workflowGraph || null;
  if (!graphRef?.graphId || !/^[a-f0-9]{64}$/.test(String(graphRef.sourceDigest || ''))) return null;
  let workflowGraph = null;
  try { workflowGraph = repository.getWorkflowGraph(graphRef.graphId); } catch { return null; }
  const graphIntegrity = workflowGraph
    ? verifyWorkflowGraphIntegrity(workflowGraph)
    : { ok: false };
  const sourceNode = workflowGraph?.nodes?.find((node) => node.toolJobId === sourceJobId) || null;
  if (!workflowGraph || !graphIntegrity.ok || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest
      || workflowGraph.validationStatus !== 'valid'
      || !sourceNode
      || !formalArtifacts.every((artifact) => sourceNode.artifactIds.includes(artifact.artifactId))) {
    return null;
  }
  return { changeSet, revisions: ordered };
}

/**
 * Read-only qualification used by the real interaction route before it reuses
 * an existing Job Revision.  Presence alone is insufficient: every formal
 * output must belong to the same adopted baseline ChangeSet and that exact
 * cohort must carry the descriptor's current validator/count proof.
 */
function inspectBaselineArtifactCohort(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const projectId = String(input.projectId || '').trim();
  const sourceJob = input.sourceJob;
  const requested = String(input.artifactId || '').trim();
  const descriptor = input.pluginDescriptor?.resultStudio
    || input.pluginDescriptor
    || resolveCandidateDescriptor({
      dependencies,
      toolId: input.pluginId || sourceJob?.tool_id || sourceJob?.toolId,
    });
  const fail = (reason) => ({
    qualified: false,
    reason,
    revision: null,
    cohortRevisions: [],
  });
  if (!repository || typeof repository.findRevisionByJobArtifact !== 'function'
      || typeof repository.getChangeSet !== 'function'
      || typeof repository.listRevisionsByChangeSet !== 'function') {
    return fail('repository_unavailable');
  }
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    return fail('source_job_invalid');
  }
  if (!descriptor) return fail('descriptor_unavailable');
  const validatorId = String(descriptor.validator?.id || '').trim();
  if (!validatorId) return fail('validator_unavailable');
  const sourceResult = resultOf(sourceJob);
  if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true) {
    return fail('source_artifact_truth_invalid');
  }
  const formalArtifacts = descriptorFormalArtifactTruth(descriptor, sourceJob);
  if (!formalArtifacts || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    return fail('formal_artifact_truth_invalid');
  }
  const revisions = formalArtifacts.map((artifact) => repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJob.id,
    artifactId: artifact.artifactId,
  }));
  if (revisions.some((revision) => !revision)) return fail('formal_revision_missing');
  const changeSetIds = [...new Set(revisions.map((revision) => revision.changeSetId).filter(Boolean))];
  if (changeSetIds.length !== 1) return fail('baseline_cohort_split');
  const complete = resolveCompleteBaselineCohort({
    repository,
    changeSetId: changeSetIds[0],
    projectId,
    sourceJobId: sourceJob.id,
    formalArtifacts,
    validatorId,
  });
  if (!complete
      || !sameIdentifierSet(
        revisions.map((revision) => revision.revisionId),
        complete.revisions.map((revision) => revision.revisionId)
      )) {
    return fail('baseline_cohort_unqualified');
  }
  const revision = complete.revisions.find((candidate) => candidate.artifactId === requested) || null;
  if (!revision) return fail('requested_revision_missing');
  return {
    qualified: true,
    reason: null,
    revision,
    cohortRevisions: complete.revisions,
    changeSet: complete.changeSet,
  };
}

/**
 * Qualify a formal Job Artifact that already belongs to a normal persisted
 * candidate/restore cohort. Re-registering it as a baseline would fork the
 * artifact family when an adopted Job is reopened through its own coordinate.
 */
function inspectPersistedArtifactCohort(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  const projectId = String(input.projectId || '').trim();
  const sourceJob = input.sourceJob;
  const sourceJobId = String(sourceJob?.id || '').trim();
  const requested = String(input.artifactId || '').trim();
  const descriptor = input.pluginDescriptor?.resultStudio
    || input.pluginDescriptor
    || resolveCandidateDescriptor({
      dependencies,
      toolId: input.pluginId || sourceJob?.tool_id || sourceJob?.toolId,
    });
  const fail = (reason) => ({
    qualified: false,
    reason,
    revision: null,
    cohortRevisions: [],
  });
  if (!repository || typeof repository.findRevisionByJobArtifact !== 'function'
      || typeof repository.getChangeSet !== 'function'
      || typeof repository.listRevisionsByChangeSet !== 'function'
      || typeof repository.getWorkflowGraph !== 'function') {
    return fail('repository_unavailable');
  }
  if (!projectId || !sourceJobId
      || String(sourceJob?.project_id || sourceJob?.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    return fail('source_job_invalid');
  }
  if (!descriptor) return fail('descriptor_unavailable');
  const validatorId = String(descriptor.validator?.id || '').trim();
  if (!validatorId) return fail('validator_unavailable');
  const sourceResult = resultOf(sourceJob);
  if (sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true) {
    return fail('source_artifact_truth_invalid');
  }
  const formalArtifacts = descriptorFormalArtifactTruth(descriptor, sourceJob);
  if (!formalArtifacts || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    return fail('formal_artifact_truth_invalid');
  }
  const formalRevisions = formalArtifacts.map((artifact) => repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJobId,
    artifactId: artifact.artifactId,
  }));
  if (formalRevisions.some((revision) => !revision)) return fail('formal_revision_missing');
  const changeSetIds = [...new Set(formalRevisions.map((revision) => revision.changeSetId).filter(Boolean))];
  if (changeSetIds.length !== 1) return fail('persisted_cohort_split');
  const changeSet = repository.getChangeSet(changeSetIds[0]);
  if (!changeSet || changeSet.projectId !== projectId || isBaselineIntentRef(changeSet.intentRef)
      || !['preview_ready', 'adopted', 'reverted'].includes(changeSet.status)
      || (changeSet.status === 'adopted' && !changeSet.adoptedAt)
      || !changeSet.candidateCommit) {
    return fail('persisted_change_set_unqualified');
  }
  const cohortRevisions = repository.listRevisionsByChangeSet(changeSet.changeSetId);
  const cohortIds = cohortRevisions.map((revision) => revision.revisionId);
  if (!sameIdentifierSet(cohortIds, changeSet.candidateArtifactRefs) || cohortRevisions.length === 0) {
    return fail('persisted_cohort_incomplete');
  }
  const cohortJobIds = [...new Set(cohortRevisions.map((revision) => revision.toolJobId).filter(Boolean))];
  if (!sameIdentifierSet(cohortJobIds, changeSet.jobRefs)
      || cohortRevisions.some((revision) => revision.projectId !== projectId
        || revision.changeSetId !== changeSet.changeSetId
        || revision.sourceCommit !== changeSet.candidateCommit
        || revision.validationStatus === 'blocked')) {
    return fail('persisted_revision_unqualified');
  }
  const validationSummary = changeSet.validationSummary || {};
  const validatorIds = validationSummary.validatorIds;
  if (validationSummary.artifactTruthStatus !== 'valid'
      || validationSummary.formalArtifactCount !== cohortRevisions.length
      || !Array.isArray(validatorIds) || validatorIds.length === 0
      || new Set(validatorIds).size !== validatorIds.length
      || validatorIds.some((value) => !String(value || '').trim())
      || !validatorIds.includes(validatorId)) {
    return fail('persisted_validation_unqualified');
  }
  const graphRef = validationSummary.workflowGraph || null;
  if (!graphRef?.graphId || !/^[a-f0-9]{64}$/.test(String(graphRef.sourceDigest || ''))) {
    return fail('persisted_graph_unavailable');
  }
  let workflowGraph = null;
  try { workflowGraph = repository.getWorkflowGraph(graphRef.graphId); } catch { return fail('persisted_graph_unavailable'); }
  const verifyGraph = dependencies.verifyWorkflowGraphIntegrity || verifyWorkflowGraphIntegrity;
  const graphIntegrity = workflowGraph ? verifyGraph(workflowGraph) : { ok: false };
  if (!workflowGraph || !graphIntegrity.ok || workflowGraph.projectId !== projectId
      || workflowGraph.sourceDigest !== graphRef.sourceDigest
      || workflowGraph.validationStatus !== 'valid'
      || cohortRevisions.some((revision) => {
        const node = workflowGraph.nodes?.find((candidate) => candidate.toolJobId === revision.toolJobId);
        return !node || !node.artifactIds?.includes(revision.artifactId);
      })) {
    return fail('persisted_graph_unqualified');
  }
  for (let index = 0; index < formalArtifacts.length; index += 1) {
    const artifact = formalArtifacts[index];
    const revision = formalRevisions[index];
    if (revision.toolJobId !== sourceJobId || revision.artifactId !== artifact.artifactId
        || revision.outputHash !== artifact.sha256 || revision.changeSetId !== changeSet.changeSetId) {
      return fail('persisted_formal_artifact_mismatch');
    }
  }
  const revision = formalRevisions.find((candidate) => candidate.artifactId === requested) || null;
  if (!revision) return fail('requested_revision_missing');
  return {
    qualified: true,
    reason: null,
    revision,
    cohortRevisions,
    changeSet,
  };
}

function adoptBaselineChangeSet({
  repository,
  adapter,
  changeSetId,
  candidateCommit,
  afterRefsApplied = null,
}) {
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) {
    throw new ResultChangeSetError('baseline_change_set_missing', 'Baseline ChangeSet is unavailable for adoption.');
  }
  if (changeSet.status === 'adopted') {
    return repository.adoptChangeSet({ changeSetId, candidateCommit });
  }
  const revisions = repository.listRevisionsByChangeSet(changeSetId);
  const expectedCommits = new Map(revisions.map((revision) => [
    revision.revisionId,
    repository.getCurrentRevision(revision.artifactFamilyId, revision.projectId)?.sourceCommit || null,
  ]));
  const refUpdates = revisions.map((revision) => {
    if (!revision.sourceCommit || revision.sourceCommit !== candidateCommit) {
      throw new ResultChangeSetError(
        'baseline_candidate_commit_mismatch',
        'Baseline Revision source commit does not match its candidate commit.',
      );
    }
    const ref = `refs/heads/biof3/current/${revision.artifactFamilyId}`;
    const existing = adapter.revParse(ref);
    const expected = expectedCommits.get(revision.revisionId) || null;
    if ((existing && existing !== expected) || (!expected && existing)) {
      throw new ResultChangeSetError(
        'baseline_current_git_ref_stale',
        'Baseline current Git ref does not match the persisted Revision.',
        { artifactFamilyId: revision.artifactFamilyId },
      );
    }
    return { ref, expectedOld: existing || ZERO_OID, newOid: candidateCommit };
  });
  const affectedFamilies = new Set(revisions.map((revision) => revision.artifactFamilyId));
  const targetCurrentRevisionIds = [
    ...repository.listCurrentRevisions(changeSet.projectId)
      .filter((revision) => !affectedFamilies.has(revision.artifactFamilyId))
      .map((revision) => revision.revisionId),
    ...revisions.map((revision) => revision.revisionId),
  ].sort();
  executeDurableRefTransaction({
    operationId: id('rft'),
    projectId: changeSet.projectId,
    changeSetId,
    operationKind: 'baseline_adopt',
    sourceStatus: changeSet.status,
    targetStatus: 'adopted',
    refUpdates,
    targetRevisionIds: revisions.map((revision) => revision.revisionId),
    checkpoint: buildResultEditCheckpoint({
      repository,
      projectId: changeSet.projectId,
      conversationId: changeSet.conversationId,
      changeSet,
      candidateCommit,
      changeSetStatus: 'adopted',
      currentRevisionIds: targetCurrentRevisionIds,
      stage: 'adopted',
    }),
  }, { repository, adapter, afterRefsApplied });
  return {
    changeSet: repository.getChangeSet(changeSetId),
    adoptedRevisionIds: revisions.map((revision) => revision.revisionId),
    idempotent: false,
  }
}

/**
 * Register all descriptor-declared formal outputs from one completed Job in a
 * single baseline cohort.  The legacy single-artifact path remains available
 * for plugins without a trusted Result Studio descriptor, but admitted P5
 * plugins must never make a partial cohort look like a complete source.
 */
function ensureBaselineArtifactCohort(input = {}, dependencies = {}) {
  const descriptor = resolveCandidateDescriptor({
    dependencies,
    toolId: input.pluginId || input.sourceJob?.tool_id || input.sourceJob?.toolId,
  });
  if (!descriptor) return ensureBaselineArtifactRevision(input, dependencies);
  const repository = dependencies.repository;
  const adapter = dependencies.adapter;
  if (!repository || !adapter || typeof repository.appendRevisionBatch !== 'function') {
    throw new ResultChangeSetError('baseline_cohort_dependencies_missing', 'Baseline cohort registration requires the canonical Repository batch API.');
  }
  const projectId = String(input.projectId || '').trim();
  const workspaceRoot = path.resolve(input.workspaceRoot || '');
  const sourceJob = input.sourceJob;
  if (!projectId || !sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    throw new ResultChangeSetError('baseline_source_job_invalid', 'Baseline source must be a completed Job in the active project.');
  }
  const sourceResult = resultOf(sourceJob);
  const rawParams = sourceJob.params && typeof sourceJob.params === 'object' && !Array.isArray(sourceJob.params)
    ? sourceJob.params
    : (() => {
      try { return JSON.parse(sourceJob.params_json || '{}'); } catch { return {}; }
    })();
  const validation = validateResultStudioCandidate({
    descriptor,
    job: sourceJob,
    workspaceRoot,
    expectedScriptSha256: input.sourceScriptSha256,
    rawParams,
  });
  if (!validation.ok) {
    throw new ResultChangeSetError(
      'baseline_plugin_validation_failed',
      'The admitted source Job failed its Result Studio validator.',
      { validatorId: validation.validatorId, diagnostics: validation.diagnostics }
    );
  }
  const formalArtifacts = validation.formalArtifacts;
  const requested = String(input.artifactId || '').trim();
  if (!requested || !formalArtifacts.some((artifact) => artifact.artifactId === requested)) {
    throw new ResultChangeSetError('baseline_artifact_missing', 'Requested Artifact is not a descriptor-declared formal output.');
  }
  const cohortDigest = sha256(stableStringify(formalArtifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
  })).sort((left, right) => left.artifactId.localeCompare(right.artifactId))));
  const existingById = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    repository.findRevisionByJobArtifact({ projectId, toolJobId: sourceJob.id, artifactId: artifact.artifactId }),
  ]));
  const preferredChangeSetId = deterministicId('cs', 'baseline-cohort-v2', projectId, sourceJob.id, cohortDigest);
  const reusableChangeSetIds = [
    preferredChangeSetId,
    ...new Set([...existingById.values()].filter(Boolean).map((revision) => revision.changeSetId)),
  ];
  for (const existingChangeSetId of reusableChangeSetIds) {
    const reusable = resolveCompleteBaselineCohort({
      repository,
      changeSetId: existingChangeSetId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
    });
    if (reusable) {
      return {
        revision: reusable.revisions.find((revision) => revision.artifactId === requested),
        cohortRevisions: reusable.revisions,
        created: false,
        cohort: true,
      };
    }
  }

  const artifactFamilyIds = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    deterministicId('af', projectId, sourceJob.id, artifact.artifactId),
  ]));
  const currentById = new Map(formalArtifacts.map((artifact) => [
    artifact.artifactId,
    repository.getCurrentRevision(artifactFamilyIds.get(artifact.artifactId), projectId),
  ]));
  const conflictingCurrent = formalArtifacts.find((artifact) => {
    const current = currentById.get(artifact.artifactId);
    return current && (current.toolJobId !== sourceJob.id
      || current.artifactId !== artifact.artifactId
      || current.outputHash !== artifact.sha256);
  });
  if (conflictingCurrent) {
    const current = currentById.get(conflictingCurrent.artifactId);
    throw new ResultChangeSetError(
      'baseline_cohort_current_conflict',
      'A different current Revision already owns a formal baseline Artifact family.',
      { artifactId: conflictingCurrent.artifactId, currentRevisionId: current.revisionId }
    );
  }

  let changeSetId = null;
  let changeSet = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidateId = attempt === 0
      ? preferredChangeSetId
      : deterministicId('cs', `baseline-cohort-v2-repair-${attempt}`, projectId, sourceJob.id, cohortDigest);
    const candidate = repository.getChangeSet(candidateId);
    if (!candidate) {
      changeSetId = candidateId;
      break;
    }
    const preview = resolveCompleteBaselineCohort({
      repository,
      changeSetId: candidateId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
      allowedStatuses: ['preview_ready'],
    });
    if (preview) {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId: candidateId,
        candidateCommit: preview.changeSet.candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
      const adopted = resolveCompleteBaselineCohort({
        repository,
        changeSetId: candidateId,
        projectId,
        sourceJobId: sourceJob.id,
        formalArtifacts,
        validatorId: validation.validatorId,
      });
      if (!adopted) {
        throw new ResultChangeSetError('baseline_cohort_incoherent', 'Recovered baseline preview did not adopt as one complete cohort.');
      }
      return {
        revision: adopted.revisions.find((revision) => revision.artifactId === requested),
        cohortRevisions: adopted.revisions,
        created: false,
        cohort: true,
      };
    }
    if (['draft', 'running'].includes(candidate.status)
        && repository.listRevisionsByChangeSet(candidateId).length === 0) {
      changeSetId = candidateId;
      changeSet = candidate;
      break;
    }
  }
  if (!changeSetId) {
    throw new ResultChangeSetError(
      'baseline_cohort_registration_exhausted',
      'Unable to allocate a coherent baseline cohort after prior incomplete registrations.'
    );
  }
  const workingBranchRef = `refs/heads/biof3/baseline/${changeSetId}`;
  const baseCommit = resolveBaseCommit(adapter, projectId);
  let candidateCommit = adapter.revParse(workingBranchRef);
  const language = String(input.language || '').toLowerCase() === 'python' ? 'python' : 'r';
  const extension = language === 'python' ? 'py' : 'R';
  const sourceScriptContent = input.sourceScriptContent;
  if (typeof sourceScriptContent !== 'string' || sha256(sourceScriptContent) !== input.sourceScriptSha256) {
    throw new ResultChangeSetError('baseline_script_hash_mismatch', 'Baseline script snapshot is unavailable or changed.');
  }
  const inputArtifactRefs = (sourceResult.executionProvenance?.inputs || [])
    .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
    .map((entry) => ({ artifactId: entry.sourceArtifactRef || entry.id, hash: entry.sha256 || null, role: entry.role || null }));
  const parameters = sourceResult.executionProvenance?.params?.normalized;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ResultChangeSetError('baseline_parameters_unavailable', 'Normalized execution parameters are required for a reproducible baseline.');
  }
  const parametersContent = stableJson(parameters);
  const parametersHash = sha256(parametersContent);
  const gitPathPrefix = String(dependencies.gitPathPrefix || '').replace(/^\/+|\/+$/g, '');
  const repositoryPath = (relativePath) => (
    gitPathPrefix ? path.posix.join(gitPathPrefix, relativePath) : relativePath
  );
  const cohortRows = formalArtifacts.map((artifact) => {
    const artifactFamilyId = artifactFamilyIds.get(artifact.artifactId);
    const revisionId = deterministicId('rev', 'baseline-cohort-v2', changeSetId, artifact.artifactId, artifact.sha256);
    const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
    const scriptRelativePath = path.posix.join(managedBase, `${safeSegment(artifact.artifactId, 'artifact_id')}.${extension}`);
    const parametersRelativePath = path.posix.join(managedBase, 'parameters.json');
    const manifestRelativePath = path.posix.join(managedBase, 'materialization.json');
    const manifestContent = stableJson({
      resultStudioMaterializationVersion: 1,
      baseline: true,
      cohortDigest,
      changeSetId,
      revisionId,
      artifactFamilyId,
      artifactId: artifact.artifactId,
      pluginId: input.pluginId || sourceJob.tool_id,
      language,
      sourceToolJobId: sourceJob.id,
      scriptRelativePath,
      scriptSha256: input.sourceScriptSha256,
      parametersRelativePath,
      parametersSha256: parametersHash,
    });
    return {
      artifact,
      revisionId,
      artifactFamilyId,
      scriptRelativePath,
      parametersRelativePath,
      manifestRelativePath,
      parametersHash,
      manifestContent,
      revision: {
        revisionId,
        projectId,
        artifactFamilyId,
        artifactId: artifact.artifactId,
        parentRevisionIds: currentById.get(artifact.artifactId)
          ? [currentById.get(artifact.artifactId).revisionId]
          : [],
        sourceCommit: null,
        sourceScriptRef: {
          relativePath: scriptRelativePath,
          sha256: input.sourceScriptSha256,
          entryPoint: path.posix.basename(scriptRelativePath),
          artifactId: artifact.artifactId,
          rendererId: `${input.pluginId || sourceJob.tool_id}:${artifact.artifactId}`,
          language,
          origin: 'project_materialized',
        },
        inputArtifactRefs,
        parametersRef: parametersRelativePath,
        parametersHash,
        toolJobId: sourceJob.id,
        outputPath: projectRelativeOutput(workspaceRoot, artifact),
        outputHash: artifact.sha256,
        validationStatus: validation.validationStatus,
        reproducibilityStatus: 'available',
        changeSetId,
      },
    };
  });

  try {
    if (!changeSet) {
      const started = startResultEditChangeSet({ repository, stage: 'change_set', changeSet: {
        changeSetId,
        projectId,
        intentRef: `baseline:${sourceJob.id}:cohort`,
        baseCommit,
        workingBranchRef,
        createdBy: 'agent',
        parentArtifactRefs: [],
      } });
      changeSet = started.changeSet;
    } else if (changeSet.status === 'draft') {
      changeSet = transitionResultEditWithCheckpoint({
        repository, projectId, conversationId: null, changeSetId, to: 'running', stage: 'change_set',
      }).changeSet;
    }
    if (changeSet.status !== 'running') {
      throw new ResultChangeSetError('baseline_cohort_status_invalid', `Cannot complete baseline cohort from status ${changeSet.status}.`);
    }
    if (!candidateCommit) {
      const gitFiles = cohortRows.flatMap((row) => [
        { path: row.scriptRelativePath, content: sourceScriptContent },
        { path: row.parametersRelativePath, content: parametersContent },
        { path: row.manifestRelativePath, content: row.manifestContent },
      ]).map((file) => ({ ...file, path: repositoryPath(file.path) }));
      candidateCommit = adapter.commitVirtualFiles({
        parentCommit: baseCommit,
        ref: workingBranchRef,
        expectedOld: '0'.repeat(40),
        message: `BioF3 baseline cohort ${sourceJob.id}`,
        files: gitFiles,
      }).commit;
    }
    const revisionInputs = cohortRows.map((row) => ({ ...row.revision, sourceCommit: candidateCommit }));
    const graphBuilder = dependencies.buildCandidateWorkflowGraph || buildAuthoritativeWorkflowGraph;
    const resolvedWorkflowJobs = typeof dependencies.resolveWorkflowJobs === 'function'
      ? dependencies.resolveWorkflowJobs({ projectId, sourceJob })
      : [sourceJob];
    const workflowJobsById = new Map((Array.isArray(resolvedWorkflowJobs) ? resolvedWorkflowJobs : [])
      .filter((job) => job && typeof job === 'object')
      .map((job) => [String(job.id || '').trim(), job])
      .filter(([jobId]) => jobId));
    // The source Job was reloaded from canonical Job truth by the caller.  It
    // wins over any duplicate returned while resolving its immutable parents.
    workflowJobsById.set(sourceJob.id, sourceJob);
    const baselineGraphResult = graphBuilder({
      projectId,
      sourceToolJobId: sourceJob.id,
      jobs: [...workflowJobsById.values()],
      repository,
      requiredToolJobIds: [sourceJob.id],
      stagedRevisions: revisionInputs,
    });
    if (!baselineGraphResult || baselineGraphResult.ok !== true || !baselineGraphResult.graph) {
      throw new ResultChangeSetError(
        'baseline_workflow_graph_invalid',
        'Baseline Job could not be projected into one complete authoritative workflow graph.',
        { diagnostics: baselineGraphResult?.diagnostics || [] }
      );
    }
    const baselineWorkflowGraph = baselineGraphResult.graph;
    repository.appendRevisionBatch({
      revisions: revisionInputs,
      workflowGraph: baselineWorkflowGraph,
      transition: {
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        changedPaths: cohortRows.flatMap((row) => [
          { relativePath: row.scriptRelativePath, changeType: 'added', beforeHash: null, afterHash: input.sourceScriptSha256 },
          { relativePath: row.parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: row.parametersHash },
          { relativePath: row.manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(row.manifestContent) },
        ]),
        jobRefs: [sourceJob.id],
        candidateArtifactRefs: revisionInputs.map((row) => row.revisionId),
        validationSummary: {
          baseline: true,
          cohort: true,
          cohortDigest,
          formalArtifactIds: formalArtifacts.map((artifact) => artifact.artifactId),
          formalArtifactCount: formalArtifacts.length,
          formalArtifactCohort: revisionInputs.map((revision) => ({
            toolJobId: revision.toolJobId,
            artifactId: revision.artifactId,
            outputHash: revision.outputHash,
          })),
          validatorId: validation.validatorId,
          validatorIds: [validation.validatorId],
          artifactTruthStatus: 'valid',
          workflowGraph: {
            graphId: baselineWorkflowGraph.graphId,
            sourceDigest: baselineWorkflowGraph.sourceDigest,
          },
        },
      },
      beforeCommit: () => {
        saveResultEditCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          candidateCommit,
          stage: 'preview_ready',
          recovery: 'awaiting_user_decision',
        });
      },
    });
    if (repository.getChangeSet(changeSetId)?.status === 'preview_ready') {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId,
        candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
    }
    const complete = resolveCompleteBaselineCohort({
      repository,
      changeSetId,
      projectId,
      sourceJobId: sourceJob.id,
      formalArtifacts,
      validatorId: validation.validatorId,
    });
    if (!complete) {
      throw new ResultChangeSetError('baseline_cohort_incoherent', 'Baseline registration did not produce one complete adopted cohort.');
    }
    return {
      revision: complete.revisions.find((revision) => revision.artifactId === requested),
      cohortRevisions: complete.revisions,
      created: true,
      cohort: true,
    };
  } catch (error) {
    const current = repository.getChangeSet(changeSetId);
    if (current?.status === 'running') {
      try {
        transitionResultEditWithCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          to: 'validation_failed',
          stage: 'failed',
          recovery: error.code || 'baseline_cohort_failed',
          transition: {
            reason: error.code || 'baseline_cohort_failed',
            validationSummary: { error: error.code || 'baseline_cohort_failed' },
          },
        });
      } catch { /* recovery scan */ }
    }
    throw error;
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

function buildResultEditCheckpoint({
  repository,
  projectId,
  conversationId,
  changeSet,
  candidateCommit = null,
  changeSetStatus = null,
  currentRevisionIds: currentRevisionIdsOverride = null,
  stage,
  recovery = null,
}) {
  const revisionIds = repository.listRevisionsByChangeSet(changeSet.changeSetId).map((revision) => revision.revisionId);
  const currentRevisionIds = Array.isArray(currentRevisionIdsOverride)
    ? [...currentRevisionIdsOverride]
    : repository.listCurrentRevisions(projectId).map((revision) => revision.revisionId);
  return {
    checkpointId: deterministicId('rscp', projectId, conversationId || '', changeSet.changeSetId),
    projectId,
    conversationId: conversationId || null,
    baseCommit: changeSet.baseCommit,
    candidateCommit: candidateCommit || changeSet.candidateCommit || null,
    changeSetId: changeSet.changeSetId,
    changeSetStatus: changeSetStatus || changeSet.status,
    currentRevisionIds,
    pendingPreview: {
      stage,
      revisionIds,
      recovery,
      runtimeLease: getResultStudioRuntimeLease(),
    },
    jobRefs: changeSet.jobRefs,
  };
}

function startResultEditChangeSet({ repository, changeSet, stage, maxConcurrentPreviews = null }) {
  if (!repository || typeof repository.startChangeSetWithCheckpoint !== 'function') {
    throw new ResultChangeSetError('checkpoint_start_unavailable', 'Atomic ChangeSet start is unavailable.');
  }
  const checkpoint = buildResultEditCheckpoint({
    repository,
    projectId: changeSet.projectId,
    conversationId: changeSet.conversationId,
    changeSet: { ...changeSet, status: 'draft', candidateCommit: null, jobRefs: [] },
    changeSetStatus: 'running',
    stage,
  });
  return repository.startChangeSetWithCheckpoint({
    changeSet,
    checkpoint,
    previewSlot: Number.isInteger(maxConcurrentPreviews) && maxConcurrentPreviews > 0
      ? { projectId: changeSet.projectId, maxConcurrentPreviews }
      : null,
  });
}

function transitionResultEditWithCheckpoint({
  repository,
  projectId,
  conversationId,
  changeSetId,
  to,
  candidateCommit = null,
  stage,
  recovery = null,
  transition = {},
}) {
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) return null;
  const targetCandidateCommit = candidateCommit || changeSet.candidateCommit || null;
  const checkpoint = buildResultEditCheckpoint({
    repository,
    projectId,
    conversationId,
    changeSet,
    candidateCommit: targetCandidateCommit,
    changeSetStatus: to,
    stage,
    recovery,
  });
  return repository.transitionChangeSetWithCheckpoint({
    transition: {
      ...transition,
      changeSetId,
      to,
      candidateCommit: targetCandidateCommit || undefined,
    },
    checkpoint,
  });
}

function saveResultEditCheckpoint({ repository, projectId, conversationId, changeSetId, candidateCommit = null, stage, recovery = null }) {
  if (!repository || typeof repository.saveCheckpoint !== 'function') return null;
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) return null;
  return repository.saveCheckpoint(buildResultEditCheckpoint({
    repository,
    projectId,
    conversationId,
    changeSet,
    candidateCommit,
    stage,
    recovery,
  }));
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
      const started = startResultEditChangeSet({ repository, stage: 'change_set', changeSet: {
        changeSetId,
        projectId,
        intentRef: `baseline:${sourceJob.id}:${artifactId}`,
        baseCommit,
        workingBranchRef,
        createdBy: 'agent',
        parentArtifactRefs: [],
      } });
      changeSet = started.changeSet;
    } else if (changeSet.status === 'draft') {
      changeSet = transitionResultEditWithCheckpoint({
        repository, projectId, conversationId: null, changeSetId, to: 'running', stage: 'change_set',
      }).changeSet;
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
    const inputArtifactRefs = (result.executionProvenance?.inputs || [])
      .filter((entry) => entry && (entry.sourceArtifactRef || entry.id))
      .map((entry) => ({
        artifactId: entry.sourceArtifactRef || entry.id,
        hash: entry.sha256 || null,
        role: entry.role || null,
      }));
    const revisionInput = {
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
    };
    const changedPaths = [
      { relativePath: scriptRelativePath, changeType: 'added', beforeHash: null, afterHash: sourceScriptSha256 },
      { relativePath: parametersRelativePath, changeType: 'added', beforeHash: null, afterHash: parametersHash },
      { relativePath: manifestRelativePath, changeType: 'added', beforeHash: null, afterHash: sha256(manifestContent) },
    ];
    const validationSummary = {
      artifactTruthStatus: 'valid',
      baseline: true,
      outputSha256: outputHash,
      formalArtifactCount: 1,
      formalArtifactCohort: [{ toolJobId: sourceJob.id, artifactId, outputHash }],
    };
    let revision = repository.getRevision(revisionId);
    changeSet = repository.getChangeSet(changeSetId);
    if (!revision) {
      const batch = repository.appendRevisionBatch({
        revisions: [revisionInput],
        transition: {
          changeSetId,
          to: 'preview_ready',
          candidateCommit,
          changedPaths,
          jobRefs: [sourceJob.id],
          candidateArtifactRefs: [revisionId],
          validationSummary,
        },
        beforeCommit: () => {
          saveResultEditCheckpoint({
            repository,
            projectId,
            conversationId: null,
            changeSetId,
            candidateCommit,
            stage: 'preview_ready',
            recovery: 'awaiting_user_decision',
          });
        },
      });
      revision = batch.revisions[0];
      changeSet = batch.changeSet;
    } else if (changeSet.status === 'running') {
      changeSet = transitionResultEditWithCheckpoint({
        repository,
        projectId,
        conversationId: null,
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        stage: 'preview_ready',
        recovery: 'awaiting_user_decision',
        transition: {
          changedPaths,
          jobRefs: [sourceJob.id],
          candidateArtifactRefs: [revisionId],
          validationSummary,
        },
      }).changeSet;
    }
    if (changeSet.status === 'preview_ready') {
      adoptBaselineChangeSet({
        repository,
        adapter,
        changeSetId,
        candidateCommit,
        afterRefsApplied: dependencies.afterRefsApplied,
      });
    }
    return { revision: repository.getRevision(revisionId), created: true };
  } catch (error) {
    const current = repository.getChangeSet(changeSetId);
    if (current && current.status === 'running') {
      try {
        transitionResultEditWithCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          to: 'validation_failed',
          stage: 'failed',
          recovery: error.code || 'baseline_registration_failed',
          transition: {
            reason: error.code || 'baseline_registration_failed',
            validationSummary: { error: error.code || 'baseline_registration_failed' },
          },
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
    const outputPath = projectRelativeOutput(workspaceRoot, artifact);
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

function inspectResultEditRecovery({ repository, adapter, workspaceRoot, projectId } = {}) {
  if (!repository || !adapter || !workspaceRoot || !projectId) {
    throw new ResultChangeSetError('recovery_dependencies_missing', 'Recovery inspection requires repository, adapter, workspaceRoot and projectId.');
  }
  return repository.findInterruptedChangeSets(projectId).map((entry) => {
    const changeSet = entry.changeSet;
    const candidateCommit = adapter.revParse(changeSet.workingBranchRef);
    let materializationPresent = false;
    try {
      const components = ['.biof3', 'revision', changeSet.changeSetId];
      if (inspectPrivateDirectory(workspaceRoot, components, { allowMissing: true })) {
        materializationPresent = inspectPrivateEntry(
          workspaceRoot,
          [...components, 'materialization.json'],
          { allowMissing: true, kind: 'file' },
        ) !== null;
      }
    } catch (error) {
      throw resultChangeSetPrivatePathError(error);
    }
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
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
  ensureBaselineArtifactCohort,
  ensureBaselineArtifactRevision,
  buildResultEditCheckpoint,
  createResultChangeSet,
  saveResultEditCheckpoint,
  inspectResultEditRecovery,
  _test: { resolveExactFormalSourceRevision },
};
