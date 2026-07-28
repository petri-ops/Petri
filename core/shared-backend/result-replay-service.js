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
const { stableStringify } = require('./scientific-task-spec');
const { isPathContained } = require('./project-run-layout');
const { createResultChangeSet, sha256 } = require('./result-changeset-service');
const {
  ResultRevisionSourceError,
  verifyRevisionSourceMaterial,
} = require('./result-revision-source');

const CONTROLLED_REPLAY_VERSION = 1;
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REQUEST_FIELDS = new Set([
  'phase',
  'projectId',
  'revisionId',
  'conversationId',
  'contextToken',
  'confirmationToken',
  'expectedSourceSha256',
  'expectedParametersHash',
  'expectedInputHashes',
]);

class ResultReplayError extends Error {
  constructor(code, message, status = 409, detail = null) {
    super(message);
    this.name = 'ResultReplayError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function fail(code, message, status = 409, detail = null) {
  throw new ResultReplayError(code, message, status, detail);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
  return sha256(stableStringify(value));
}

function assertAllowedReplayRequest(body) {
  if (!object(body)) fail('replay_request_invalid', 'Replay request must be an object.', 400);
  const rejected = Object.keys(body).filter((field) => !REQUEST_FIELDS.has(field)).sort();
  if (rejected.length > 0) {
    fail(
      'replay_request_field_not_allowed',
      'Replay execution does not accept caller-supplied plans, parameters, scripts or commands.',
      400,
      { rejectedFields: rejected }
    );
  }
  return body;
}

function safeIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) fail(`${field}_invalid`, `${field} is invalid.`, 400);
  return normalized;
}

function expectedInputMap(value) {
  if (value == null) return null;
  if (!object(value)) fail('expected_input_hashes_invalid', 'expectedInputHashes must be an object.', 400);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([id, digest]) => !SAFE_ID.test(id) || !SHA256.test(String(digest || '')))) {
    fail('expected_input_hashes_invalid', 'expectedInputHashes must map safe input ids to sha256 digests.', 400);
  }
  return Object.fromEntries(entries);
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function resolveIntactInput(workspaceRoot, input, sourceParams = {}) {
  const relativePath = String(input && input.relativePath || '').trim();
  const expectedHash = String(input && input.sha256 || '').trim();
  if (!relativePath || path.isAbsolute(relativePath) || !SHA256.test(expectedHash)) {
    fail('replay_input_ref_invalid', 'Replay input reference is incomplete.');
  }
  let root;
  let target;
  try {
    root = fs.realpathSync(workspaceRoot);
    const sourceParam = input?.id && typeof sourceParams?.[input.id] === 'string'
      ? sourceParams[input.id]
      : null;
    target = fs.realpathSync(sourceParam || path.join(root, relativePath));
  } catch {
    fail('source_input_drift', 'A replay input is missing.', 409, { inputId: input.id || null });
  }
  if (!isPathContained(root, target) || !fs.statSync(target).isFile()) {
    fail('source_input_drift', 'A replay input escaped the project or is not a file.', 409, { inputId: input.id || null });
  }
  if (hashFile(target) !== expectedHash) {
    fail('source_input_drift', 'A replay input hash changed.', 409, { inputId: input.id || null });
  }
  return target;
}

function projectSourceJobParams(sourceJob) {
  const params = object(sourceJob && sourceJob.params);
  if (params) return cloneJson(params);
  const raw = sourceJob && sourceJob.params_json;
  if (typeof raw !== 'string') fail('replay_source_params_missing', 'Source Job parameters are unavailable.');
  try {
    const parsed = JSON.parse(raw);
    if (!object(parsed)) throw new Error('not_object');
    return parsed;
  } catch {
    fail('replay_source_params_invalid', 'Source Job parameters are invalid.');
  }
}

/**
 * Rehydrate executable params without trusting an old absolute path.
 *
 * Provenance normalized every file input into {inputRef, sha256}. We derive a
 * fresh contained absolute path for execution, then normalize it back and
 * require byte-for-byte semantic equality with the parameters committed for
 * the selected Revision. This proves that no input or non-file parameter was
 * silently rebound.
 */
function buildReplayExecutionParams({ sourceJob, sourceProjection, workspaceRoot } = {}) {
  const rawValues = sourceProjection?.parameters?.rawValues;
  if (!object(rawValues)) fail('replay_parameters_missing', 'Exact persisted Revision parameters are required.');
  const runtimeParams = projectSourceJobParams(sourceJob);
  const normalized = cloneJson(runtimeParams);
  const provenanceInputs = Array.isArray(sourceJob?.result?.executionProvenance?.inputs)
    ? sourceJob.result.executionProvenance.inputs
    : [];
  const seenIds = new Set();
  for (const input of provenanceInputs) {
    const inputId = safeIdentifier(input && input.id, 'replay_input_id');
    if (seenIds.has(inputId)) fail('replay_input_identity_ambiguous', 'Replay input identity is duplicated.');
    seenIds.add(inputId);
    const target = resolveIntactInput(workspaceRoot, input, runtimeParams);
    runtimeParams[inputId] = target;
    normalized[inputId] = { inputRef: input.relativePath, sha256: input.sha256 };
  }
  if (stableStringify(normalized) !== stableStringify(rawValues)) {
    fail('replay_parameters_drift', 'Source Job parameters no longer match the selected Revision.');
  }
  return runtimeParams;
}

function assertExpectedHashes({ sourceProjection, sourceJob, expectedSourceSha256, expectedParametersHash, expectedInputHashes }) {
  if (expectedSourceSha256 != null) {
    if (!SHA256.test(String(expectedSourceSha256)) || expectedSourceSha256 !== sourceProjection.sha256) {
      fail('replay_source_expectation_stale', 'Expected source hash does not match the selected Revision.');
    }
  }
  const actualParametersHash = sourceProjection.parameters?.sha256 || null;
  if (expectedParametersHash != null) {
    if (!SHA256.test(String(expectedParametersHash)) || expectedParametersHash !== actualParametersHash) {
      fail('replay_parameters_expectation_stale', 'Expected parameters hash does not match the selected Revision.');
    }
  }
  const expected = expectedInputMap(expectedInputHashes);
  if (expected) {
    const actual = Object.fromEntries(
      (sourceJob?.result?.executionProvenance?.inputs || [])
        .filter((input) => input?.id)
        .map((input) => [input.id, input.sha256])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    );
    if (stableStringify(expected) !== stableStringify(actual)) {
      fail('replay_inputs_expectation_stale', 'Expected input hashes do not match the selected Revision.');
    }
  }
}

function assertRevisionOutput({ revision, workspaceRoot }) {
  if (!revision?.outputPath || !SHA256.test(String(revision.outputHash || ''))) {
    fail('replay_artifact_ref_invalid', 'Revision Artifact reference is incomplete.');
  }
  let root;
  let target;
  try {
    root = fs.realpathSync(workspaceRoot);
    target = fs.realpathSync(path.join(root, revision.outputPath));
  } catch {
    fail('replay_artifact_missing', 'Revision Artifact is missing.');
  }
  if (!isPathContained(root, target) || !fs.statSync(target).isFile()) {
    fail('replay_artifact_outside_project', 'Revision Artifact escaped the project.');
  }
  if (hashFile(target) !== revision.outputHash) {
    fail('replay_artifact_hash_drift', 'Revision Artifact hash changed.');
  }
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
  const provenanceInputs = Array.isArray(sourceJob?.result?.executionProvenance?.inputs)
    ? sourceJob.result.executionProvenance.inputs
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

function createReplayIntent({ token, revision }) {
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
    affectedNodeIds: [],
    affectedScope: 'current_result_only',
    requiresJob: true,
    requiresScientificConfirmation: true,
    classificationReason: 'controlled_revision_replay',
  };
}

function wrapSourceError(error) {
  if (error instanceof ResultReplayError) throw error;
  if (error instanceof ResultRevisionSourceError) {
    throw new ResultReplayError(error.code, error.message, error.status, error.detail);
  }
  throw error;
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
        (sourceJob.result?.executionProvenance?.inputs || [])
          .filter((item) => item?.id)
          .map((item) => [item.id, item.sha256])
      ),
    };
  }

  function prepare(input = {}, dependencies = {}) {
    assertAllowedReplayRequest(input.request || input);
    const material = inspect(input, dependencies);
    const confirmationToken = makeToken();
    const createdAt = now();
    const record = {
      confirmationToken,
      projectId: material.projectId,
      revisionId: material.revisionId,
      conversationId: input.conversationId || null,
      contextToken: input.contextToken || null,
      fingerprint: material.fingerprint,
      createdAt,
      expiresAt: createdAt + ttlMs,
      state: 'ready',
      sourceJobId: material.sourceJob.id,
      toolId: material.toolId,
      language: material.language,
      sourceSha256: material.sourceProjection.sha256,
      parametersHash: material.sourceProjection.parameters.sha256,
      inputHashes: material.inputHashes,
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
      fingerprint: material.fingerprint,
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
        if (refreshed.fingerprint !== record.fingerprint) {
          fail('replay_material_stale', 'Replay material changed after preflight.');
        }
        const revision = refreshed.revision;
        const sourceJob = refreshed.sourceJob;
        if (!revision || !sourceJob || revision.projectId !== projectId
          || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId) {
          fail('replay_source_stale', 'Replay source is no longer available in this project.');
        }
        const changeSetResult = await runChangeSet({
          projectId,
          conversationId: record.conversationId,
          workspaceRoot: dependencies.workspaceRoot,
          intent: createReplayIntent({ token: confirmationToken, revision }),
          sourceRevision: revision,
          // Use only the execution params reconstructed from intact,
          // project-contained provenance inputs. The persisted source Job row
          // remains the identity and provenance authority.
          sourceJob: { ...sourceJob, params: cloneJson(refreshed.executionParams) },
          sourceScriptSha256: record.sourceSha256,
          normalizedSourceParams: refreshed.normalizedSourceParams,
          pluginId: record.toolId,
          language: record.language,
          scriptPatch: [],
          scientificConfirmed: true,
          createdBy: 'user',
        }, {
          repository,
          adapter: dependencies.adapter,
          gitPathPrefix: dependencies.gitPathPrefix,
          getToolJob,
          executeJob,
          activePreviewJobs: dependencies.activePreviewJobs || 0,
          onProgress: dependencies.onProgress,
          shouldCancel: dependencies.shouldCancel,
        });
        if (!changeSetResult || changeSetResult.ok !== true || changeSetResult.adopted !== false
          || changeSetResult.revision?.parentRevisionIds?.[0] !== revisionId) {
          fail('replay_candidate_invalid', 'Controlled replay did not create the expected isolated candidate.');
        }
        const response = {
          ok: true,
          controlledReplayVersion: CONTROLLED_REPLAY_VERSION,
          status: 'preview_ready',
          replayFingerprint: record.fingerprint,
          changeSetId: changeSetResult.changeSet.changeSetId,
          toolJobId: changeSetResult.toolJobId,
          revisionId: changeSetResult.revision.revisionId,
          parentRevisionId: revisionId,
          adopted: false,
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
  createControlledReplayService,
};
