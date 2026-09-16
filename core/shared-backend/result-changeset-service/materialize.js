'use strict';

const crypto = require('crypto');
const path = require('path');
const { stableStringify } = require('../canonical-json');
const {
  ResultStudioPrivatePathError,
  resolveWorkspaceAnchor,
  ensurePrivateDirectory,
  inspectPrivateDirectory,
  inspectPrivateEntry,
  createPrivateFileExclusiveSync,
  renamePrivateDirectorySync,
  removePrivatePathSync,
} = require('../result-studio-private-path');
const {
  MAX_SCRIPT_BYTES,
  MAX_PARAMETERS_BYTES,
  SENSITIVE_PARAMETER,
  ResultChangeSetError,
  resultChangeSetPrivatePathError,
  sha256,
  safeSegment,
  stableJson,
} = require('./internal');

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

module.exports = {
  assertSafeParameterPatch,
  applyExactScriptPatch,
  materializeResultEdit,
};
