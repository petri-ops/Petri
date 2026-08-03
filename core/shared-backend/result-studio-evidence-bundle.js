'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BUNDLE_SCHEMA_VERSION = 1;
const FACT_PACKAGE_SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

const REQUIRED_FACT_ROLES = Object.freeze([
  'conversation.record',
  'ui.open_artifact',
  'ui.selection_or_manual_edit',
  'environment.repository',
  'agent.context_envelope',
  'provider.result_tool_roundtrip',
  'sqlite.intent',
  'sqlite.changeset',
  'git.changeset',
  'sqlite.job',
  'artifact.formal_output_cohort',
  'validator.cohort',
  'sqlite.candidate_revision_cohort',
  'git.candidate_revision_cohort',
  'ui.compare',
  'sqlite.lifecycle',
  'git.lifecycle',
  'restart.reopen',
  'replay.exact',
]);
const DERIVED_INVARIANTS = Object.freeze([
  'source_data_preserved',
  'artifact_history_preserved',
  'unrelated_git_wip_preserved',
  'no_false_success',
  'no_partial_adopt',
  'no_silent_loss',
  'independent_replayable_scripts',
]);

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(stable(value))));
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value || {}).filter(([name]) => name !== key));
}

function sortedUniqueStrings(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) return null;
  const result = [...new Set(value)].sort();
  return result.length === value.length ? result : null;
}

function sameStringSet(left, right) {
  const a = sortedUniqueStrings(left);
  const b = sortedUniqueStrings(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function addIssue(issues, condition, code) {
  if (!condition) issues.push(code);
}

function inspectPrivateProjection(value, issues, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPrivateProjection(item, issues, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:api_?key|authorization|credential|bearer|raw_?request|raw_?response|endpoint_?url)$/i.test(key)) {
        issues.push(`private_projection_forbidden_key:${location}.${key}`);
      }
      inspectPrivateProjection(item, issues, `${location}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (/https?:\/\//i.test(value) || /Bearer\s+/i.test(value) || /sk-[A-Za-z0-9]{12,}/.test(value)
      || /\/Users\/[^/]+\//.test(value) || /\/home\/[^/]+\//.test(value)) {
    issues.push(`private_projection_forbidden_value:${location}`);
  }
}

function isSafeRelativePath(value) {
  const text = String(value || '');
  if (!text || text.length > 512 || text.includes('\0') || text.includes('\\')) return false;
  if (path.posix.isAbsolute(text) || /^[A-Za-z]:\//.test(text)) return false;
  const normalized = path.posix.normalize(text);
  return normalized === text && normalized !== '..' && !normalized.startsWith('../');
}

function walkFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`p7_evidence_symlink_forbidden:${child}`);
    if (entry.isDirectory()) files.push(...walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`p7_evidence_special_file_forbidden:${child}`);
  }
  return files;
}

function buildBundleManifest(root, { exclude = ['manifest.json'] } = {}) {
  const excluded = new Set(exclude);
  const files = walkFiles(root).filter((relative) => !excluded.has(relative)).map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return { path: relative, sha256: sha256Bytes(bytes), bytes: bytes.length };
  });
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    files,
    bundleDigest: stableHash(files),
  };
}

function verifyBundleManifest(root, manifest) {
  const issues = [];
  if (!manifest || manifest.schemaVersion !== BUNDLE_SCHEMA_VERSION) issues.push('bundle_schema_version_invalid');
  const declared = Array.isArray(manifest?.files) ? manifest.files : [];
  const paths = declared.map((entry) => entry?.path).filter(Boolean);
  if (paths.length !== declared.length || paths.length !== new Set(paths).size) issues.push('bundle_paths_invalid_or_duplicate');
  for (const entry of declared) {
    if (!isSafeRelativePath(entry?.path)) {
      issues.push(`bundle_path_unsafe:${entry?.path || ''}`);
      continue;
    }
    const absolute = path.join(root, entry.path);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { issues.push(`bundle_file_missing:${entry.path}`); continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`bundle_file_not_regular:${entry.path}`);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (!SHA256.test(String(entry.sha256 || '')) || sha256Bytes(bytes) !== entry.sha256) {
      issues.push(`bundle_file_hash_mismatch:${entry.path}`);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes !== bytes.length) issues.push(`bundle_file_size_mismatch:${entry.path}`);
  }
  let actual = [];
  try { actual = walkFiles(root).filter((relative) => relative !== 'manifest.json'); } catch (error) {
    issues.push(error.message);
  }
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(actual.sort())) issues.push('bundle_file_set_mismatch');
  if (!SHA256.test(String(manifest?.bundleDigest || '')) || stableHash(declared) !== manifest.bundleDigest) {
    issues.push('bundle_digest_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

function decodePointerToken(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveJsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error('p7_evidence_json_pointer_invalid');
  let current = value;
  for (const raw of pointer.slice(1).split('/')) {
    const token = decodePointerToken(raw);
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error('p7_evidence_json_pointer_missing');
    }
    current = current[token];
  }
  return current;
}

function resolveEvidenceRef(root, sourceRef) {
  const raw = String(sourceRef || '');
  const separator = raw.indexOf('#');
  const relative = separator === -1 ? raw : raw.slice(0, separator);
  const pointer = separator === -1 ? null : raw.slice(separator + 1);
  if (!isSafeRelativePath(relative)) throw new Error('p7_evidence_ref_unsafe');
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('p7_evidence_ref_not_regular');
  const bytes = fs.readFileSync(absolute);
  if (pointer == null) return { relative, bytes, value: null, digest: sha256Bytes(bytes) };
  if (path.extname(relative).toLowerCase() !== '.json') throw new Error('p7_evidence_pointer_requires_json');
  const value = resolveJsonPointer(JSON.parse(bytes.toString('utf8')), pointer);
  return { relative, bytes, value, digest: stableHash(value) };
}

function parsePngSize(bytes) {
  const buffer = Buffer.from(bytes || []);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('p7_evidence_png_invalid');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) throw new Error('p7_evidence_png_dimensions_invalid');
  return { width, height };
}

function validateFactPackage(value) {
  const issues = [];
  const factPackage = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  addIssue(issues, factPackage.schemaVersion === FACT_PACKAGE_SCHEMA_VERSION, 'fact_package_schema_version_invalid');
  addIssue(issues, typeof factPackage.packageId === 'string' && factPackage.packageId.length >= 8,
    'fact_package_id_invalid');
  addIssue(issues, typeof factPackage.journeyId === 'string' && factPackage.journeyId.length >= 8,
    'fact_package_journey_id_invalid');
  addIssue(issues, typeof factPackage.taskId === 'string' && factPackage.taskId.length >= 8,
    'fact_package_task_id_invalid');
  addIssue(issues, SHA256.test(String(factPackage.projectRefHash || '')), 'fact_package_project_ref_invalid');
  addIssue(issues, SHA256.test(String(factPackage.conversationRefHash || '')), 'fact_package_conversation_ref_invalid');
  addIssue(issues, SHA256.test(String(factPackage.primaryOperationDigest || '')),
    'fact_package_primary_operation_invalid');
  const startedAt = Date.parse(factPackage.startedAt || '');
  const completedAt = Date.parse(factPackage.completedAt || '');
  addIssue(issues, Number.isFinite(startedAt), 'fact_package_started_at_invalid');
  addIssue(issues, Number.isFinite(completedAt) && completedAt >= startedAt, 'fact_package_completed_at_invalid');

  const facts = factPackage.facts && typeof factPackage.facts === 'object' && !Array.isArray(factPackage.facts)
    ? factPackage.facts : {};
  const roles = new Map();
  for (const [id, fact] of Object.entries(facts)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
      issues.push(`fact_not_object:${id}`);
      continue;
    }
    addIssue(issues, fact.id === id, `fact_id_mismatch:${id}`);
    addIssue(issues, typeof fact.kind === 'string' && fact.kind.length > 0, `fact_kind_invalid:${id}`);
    addIssue(issues, typeof fact.role === 'string' && fact.role.length > 0, `fact_role_invalid:${id}`);
    addIssue(issues, fact.taskId === factPackage.taskId, `fact_task_scope_mismatch:${id}`);
    addIssue(issues, fact.journeyId === factPackage.journeyId, `fact_journey_scope_mismatch:${id}`);
    addIssue(issues, fact.scopeDigest === factPackage.primaryOperationDigest, `fact_operation_scope_mismatch:${id}`);
    const observedAt = Date.parse(fact.observedAt || '');
    addIssue(issues, Number.isFinite(observedAt) && observedAt >= startedAt && observedAt <= completedAt,
      `fact_observed_at_outside_package:${id}`);
    addIssue(issues, fact.payload && typeof fact.payload === 'object' && !Array.isArray(fact.payload),
      `fact_payload_invalid:${id}`);
    if (typeof fact.role === 'string') {
      if (roles.has(fact.role)) issues.push(`fact_role_duplicate:${fact.role}`);
      else roles.set(fact.role, fact);
    }
  }
  for (const role of REQUIRED_FACT_ROLES) if (!roles.has(role)) issues.push(`fact_role_missing:${role}`);

  const context = roles.get('agent.context_envelope')?.payload || {};
  const repository = roles.get('environment.repository')?.payload || {};
  const provider = roles.get('provider.result_tool_roundtrip')?.payload || {};
  const intent = roles.get('sqlite.intent')?.payload || {};
  const changeSet = roles.get('sqlite.changeset')?.payload || {};
  const gitChangeSet = roles.get('git.changeset')?.payload || {};
  const job = roles.get('sqlite.job')?.payload || {};
  const artifact = roles.get('artifact.formal_output_cohort')?.payload || {};
  const validator = roles.get('validator.cohort')?.payload || {};
  const revisions = roles.get('sqlite.candidate_revision_cohort')?.payload || {};
  const gitRevisions = roles.get('git.candidate_revision_cohort')?.payload || {};
  const compare = roles.get('ui.compare')?.payload || {};
  const lifecycle = roles.get('sqlite.lifecycle')?.payload || {};
  const gitLifecycle = roles.get('git.lifecycle')?.payload || {};
  const restart = roles.get('restart.reopen')?.payload || {};
  const replay = roles.get('replay.exact')?.payload || {};

  addIssue(issues, ['managed', 'existing'].includes(repository.mode)
    && ['non_git', 'clean', 'dirty'].includes(repository.initialState)
    && (repository.mode !== 'existing' || repository.consentObserved === true)
    && SHA256.test(String(repository.snapshotBefore || ''))
    && repository.snapshotAfter === repository.snapshotBefore,
  'fact_repository_environment_invalid');
  addIssue(issues, SHA256.test(String(context.contextRef || ''))
    && SHA256.test(String(context.selectionRef || ''))
    && SHA256.test(String(context.sourceRevisionRef || '')), 'fact_context_binding_invalid');
  addIssue(issues, provider.transport === 'real_network' && provider.toolCallObserved === true
    && provider.toolResultObserved === true && provider.expectedJsonEmbeddedInPrompt === false
    && typeof provider.toolName === 'string' && provider.toolName.startsWith('result_'),
  'fact_provider_roundtrip_invalid');
  addIssue(issues, intent.contextRef === context.contextRef && intent.selectionRef === context.selectionRef
    && intent.sourceRevisionRef === context.sourceRevisionRef && SHA256.test(String(intent.intentRef || '')),
  'fact_intent_context_join_invalid');
  addIssue(issues, changeSet.intentRef === intent.intentRef && SHA256.test(String(changeSet.changeSetRef || '')),
    'fact_changeset_intent_join_invalid');
  addIssue(issues, gitChangeSet.changeSetRef === changeSet.changeSetRef && COMMIT.test(String(gitChangeSet.commit || '')),
    'fact_changeset_git_join_invalid');
  addIssue(issues, job.changeSetRef === changeSet.changeSetRef && SHA256.test(String(job.jobRef || ''))
    && job.status === 'completed' && job.falseSuccessAbsent === true,
    'fact_job_changeset_join_invalid');
  addIssue(issues, sameStringSet(changeSet.jobRefs, [job.jobRef]), 'fact_changeset_job_set_mismatch');
  addIssue(issues, artifact.jobRef === job.jobRef && artifact.changeSetRef === changeSet.changeSetRef,
    'fact_artifact_job_join_invalid');
  addIssue(issues, sameStringSet(job.formalArtifactRefs, artifact.artifactRefs), 'fact_formal_artifact_set_mismatch');
  addIssue(issues, sameStringSet(job.outputRevisionRefs, revisions.revisionRefs), 'fact_job_revision_set_mismatch');
  addIssue(issues, sameStringSet(changeSet.candidateRevisionRefs, revisions.revisionRefs),
    'fact_changeset_revision_set_mismatch');
  addIssue(issues, revisions.changeSetRef === changeSet.changeSetRef
    && sameStringSet(revisions.artifactRefs, artifact.artifactRefs), 'fact_revision_artifact_join_invalid');
  addIssue(issues, validator.valid === true && sameStringSet(validator.revisionRefs, revisions.revisionRefs),
    'fact_validator_cohort_mismatch');
  addIssue(issues, sameStringSet(artifact.revisionRefs, revisions.revisionRefs)
    && sameStringSet(Object.keys(artifact.declaredHashes || {}), artifact.artifactRefs)
    && sameStringSet(Object.keys(artifact.scriptHashes || {}), artifact.artifactRefs)
    && Object.values(artifact.scriptHashes || {}).every((digest) => SHA256.test(String(digest || '')))
    && JSON.stringify(stable(artifact.declaredHashes || {})) === JSON.stringify(stable(artifact.provenanceHashes || {}))
    && JSON.stringify(stable(artifact.declaredHashes || {})) === JSON.stringify(stable(artifact.physicalHashes || {})),
  'fact_artifact_hash_truth_mismatch');
  addIssue(issues, gitRevisions.changeSetRef === changeSet.changeSetRef
    && gitRevisions.commit === gitChangeSet.commit
    && sameStringSet(gitRevisions.revisionRefs, revisions.revisionRefs), 'fact_revision_git_join_invalid');
  addIssue(issues, sameStringSet(compare.sourceRevisionRefs, changeSet.sourceRevisionRefs)
    && sameStringSet(compare.candidateRevisionRefs, revisions.revisionRefs)
    && compare.postconditionObserved === true, 'fact_compare_binding_invalid');
  addIssue(issues, lifecycle.changeSetRef === changeSet.changeSetRef
    && sameStringSet(lifecycle.revisionRefs, revisions.revisionRefs)
    && ['adopt', 'revert'].includes(lifecycle.operation) && lifecycle.completeCohort === true,
  'fact_lifecycle_cohort_invalid');
  addIssue(issues, gitLifecycle.changeSetRef === changeSet.changeSetRef
    && gitLifecycle.commit === gitChangeSet.commit
    && sameStringSet(gitLifecycle.revisionRefs, revisions.revisionRefs), 'fact_lifecycle_git_join_invalid');
  addIssue(issues, restart.oldProcessExited === true && restart.packagedAppReopened === true
    && restart.activeTaskInterrupted === true && restart.literalOsRebootObserved === true
    && restart.bootSessionChanged === true
    && restart.historyDigestBefore === restart.historyDigestAfter
    && restart.sourceDataDigestBefore === restart.sourceDataDigestAfter
    && restart.artifactSetDigestBefore === restart.artifactSetDigestAfter,
  'fact_restart_readback_invalid');
  addIssue(issues, sameStringSet(replay.sourceRevisionRefs, revisions.revisionRefs)
    && replay.exactMatch === true && replay.graphExact === true
    && SHA256.test(String(replay.packageDigest || '')) && SHA256.test(String(replay.outputCohortHash || '')),
  'fact_replay_task_binding_invalid');

  const expectedDigest = stableHash(withoutKey(factPackage, 'packageDigest'));
  addIssue(issues, factPackage.packageDigest === expectedDigest, 'fact_package_digest_mismatch');
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze([...new Set(issues)]),
    expectedDigest,
    roles,
  });
}

function deriveFactPackageInvariants(factPackage, roles) {
  const repository = roles.get('environment.repository')?.payload || {};
  const job = roles.get('sqlite.job')?.payload || {};
  const artifact = roles.get('artifact.formal_output_cohort')?.payload || {};
  const lifecycle = roles.get('sqlite.lifecycle')?.payload || {};
  const restart = roles.get('restart.reopen')?.payload || {};
  const replay = roles.get('replay.exact')?.payload || {};
  const checks = {
    source_data_preserved: SHA256.test(String(restart.sourceDataDigestBefore || ''))
      && restart.sourceDataDigestBefore === restart.sourceDataDigestAfter,
    artifact_history_preserved: SHA256.test(String(restart.historyDigestBefore || ''))
      && restart.historyDigestBefore === restart.historyDigestAfter,
    unrelated_git_wip_preserved: SHA256.test(String(repository.snapshotBefore || ''))
      && repository.snapshotBefore === repository.snapshotAfter,
    no_false_success: job.status === 'completed' && job.falseSuccessAbsent === true,
    no_partial_adopt: lifecycle.completeCohort === true,
    no_silent_loss: SHA256.test(String(restart.artifactSetDigestBefore || ''))
      && restart.artifactSetDigestBefore === restart.artifactSetDigestAfter,
    independent_replayable_scripts: sameStringSet(Object.keys(artifact.scriptHashes || {}), artifact.artifactRefs)
      && Object.values(artifact.scriptHashes || {}).every((digest) => SHA256.test(String(digest || '')))
      && replay.exactMatch === true && replay.graphExact === true,
  };
  return Object.freeze({
    valid: DERIVED_INVARIANTS.every((id) => checks[id] === true),
    checks: Object.freeze(checks),
    taskId: factPackage.taskId,
  });
}

function verifyQualificationEvidence(root, report, manifest) {
  const issues = [];
  const manifestVerdict = verifyBundleManifest(root, manifest);
  issues.push(...manifestVerdict.issues);
  const packages = new Map();
  const primaryOperations = new Set();
  const replaySources = new Set();
  const screenshotDigests = new Set();
  const environmentTags = new Set();
  const providerClasses = new Set();
  const invariantChecks = {};
  const traces = Array.isArray(report?.productTraces) ? report.productTraces : [];

  for (const entry of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (path.extname(entry?.path || '').toLowerCase() !== '.json') continue;
    try {
      inspectPrivateProjection(JSON.parse(fs.readFileSync(path.join(root, entry.path), 'utf8')), issues,
        `bundle:${entry.path}`);
    } catch {
      issues.push(`bundle_json_invalid:${entry?.path || 'unknown'}`);
    }
  }

  for (const trace of traces) {
    const traceId = trace?.traceId || 'unknown';
    let resolvedPackage;
    try { resolvedPackage = resolveEvidenceRef(root, trace?.factPackageRef); } catch (error) {
      issues.push(`trace_fact_package_unresolvable:${traceId}:${error.message}`);
      continue;
    }
    if (!resolvedPackage.value || typeof resolvedPackage.value !== 'object') {
      issues.push(`trace_fact_package_not_json_pointer:${traceId}`);
      continue;
    }
    const verdict = validateFactPackage(resolvedPackage.value);
    issues.push(...verdict.issues.map((issue) => `trace_fact_package_invalid:${traceId}:${issue}`));
    const factPackage = resolvedPackage.value;
    const derivedInvariants = deriveFactPackageInvariants(factPackage, verdict.roles);
    invariantChecks[traceId] = derivedInvariants.checks;
    for (const id of DERIVED_INVARIANTS) {
      if (derivedInvariants.checks[id] !== true) issues.push(`trace_invariant_failed:${traceId}:${id}`);
    }
    addIssue(issues, trace.taskId === factPackage.taskId, `trace_fact_package_task_mismatch:${traceId}`);
    addIssue(issues, trace.projectRefHash === factPackage.projectRefHash, `trace_fact_package_project_mismatch:${traceId}`);
    addIssue(issues, trace.conversationRefHash === factPackage.conversationRefHash,
      `trace_fact_package_conversation_mismatch:${traceId}`);
    addIssue(issues, trace.primaryOperationDigest === factPackage.primaryOperationDigest,
      `trace_primary_operation_mismatch:${traceId}`);
    if (primaryOperations.has(factPackage.primaryOperationDigest)) issues.push(`trace_primary_operation_reused:${traceId}`);
    primaryOperations.add(factPackage.primaryOperationDigest);
    const replay = verdict.roles.get('replay.exact')?.payload || {};
    const replayKey = stableHash(replay.sourceRevisionRefs || []);
    if (replaySources.has(replayKey)) issues.push(`trace_replay_source_reused:${traceId}`);
    replaySources.add(replayKey);
    packages.set(traceId, factPackage);
    const provider = verdict.roles.get('provider.result_tool_roundtrip')?.payload || {};
    if (provider.providerClass !== trace.providerClass) issues.push(`trace_provider_class_mismatch:${traceId}`);
    else if (typeof provider.providerClass === 'string') providerClasses.add(provider.providerClass);
    const repository = verdict.roles.get('environment.repository')?.payload || {};
    if (repository.mode === 'managed' && repository.initialState === 'non_git') environmentTags.add('managed_non_git');
    if (repository.mode === 'existing' && repository.initialState === 'clean' && repository.consentObserved === true) {
      environmentTags.add('existing_clean_git');
    }
    if (repository.mode === 'existing' && repository.initialState === 'dirty' && repository.consentObserved === true) {
      environmentTags.add('existing_dirty_git');
    }
    const restart = verdict.roles.get('restart.reopen')?.payload || {};
    if (restart.activeTaskInterrupted === true && restart.literalOsRebootObserved === true
        && restart.bootSessionChanged === true && restart.packagedAppReopened === true) {
      environmentTags.add('restart_and_interruption');
      environmentTags.add('literal_os_reboot');
    }
    const imported = verdict.roles.get('environment.imported_user_data')?.payload || {};
    if (imported.userUploadObserved === true && SHA256.test(String(imported.uploadSha256 || ''))
        && imported.executionInputSha256 === imported.uploadSha256) environmentTags.add('imported_user_data');
    const providerRecovery = verdict.roles.get('recovery.provider_transport')?.payload || {};
    const executionRecovery = verdict.roles.get('recovery.execution')?.payload || {};
    if (providerRecovery.controlledFailureObserved === true && providerRecovery.realProviderRecoveryObserved === true
        && providerRecovery.falseSuccessAbsent === true && executionRecovery.failedTerminalObserved === true
        && executionRecovery.recoveryCompleted === true && executionRecovery.falseSuccessAbsent === true) {
      environmentTags.add('provider_and_execution_failure');
    }

    for (const item of Array.isArray(trace.evidence) ? trace.evidence : []) {
      let resolved;
      try { resolved = resolveEvidenceRef(root, item.sourceRef); } catch (error) {
        issues.push(`trace_evidence_unresolvable:${traceId}:${item.id || 'unknown'}:${error.message}`);
        continue;
      }
      if (resolved.digest !== item.digest) issues.push(`trace_evidence_digest_mismatch:${traceId}:${item.id || 'unknown'}`);
      if (resolved.value && resolved.value.taskId !== undefined && resolved.value.taskId !== trace.taskId) {
        issues.push(`trace_evidence_task_mismatch:${traceId}:${item.id || 'unknown'}`);
      }
    }

  }

  const reportEvidence = Array.isArray(report?.evidence) ? report.evidence : [];
  const reportEvidenceById = new Map(reportEvidence.map((item) => [item?.id, item]));
  for (const item of reportEvidence) {
    if (!item?.id || reportEvidenceById.get(item.id) !== item) issues.push('qualification_evidence_id_invalid_or_duplicate');
    try {
      const resolved = resolveEvidenceRef(root, item?.sourceRef);
      if (resolved.digest !== item?.digest) issues.push(`qualification_evidence_digest_mismatch:${item?.id || 'unknown'}`);
    } catch (error) {
      issues.push(`qualification_evidence_unresolvable:${item?.id || 'unknown'}:${error.message}`);
    }
  }
  const matrix = Array.isArray(report?.responsiveMatrix) ? report.responsiveMatrix : [];
  const validCells = new Set();
  for (const cell of matrix) {
      const cellKey = `${cell?.theme}:${cell?.width}`;
      const evidence = reportEvidenceById.get(cell?.screenshotEvidenceId);
      if (!evidence || evidence.kind !== 'screenshot') {
        issues.push(`qualification_responsive_screenshot_missing:${cellKey}`);
        continue;
      }
      let screenshot;
      try { screenshot = resolveEvidenceRef(root, evidence.sourceRef); } catch (error) {
        issues.push(`qualification_responsive_screenshot_unresolvable:${cellKey}:${error.message}`);
        continue;
      }
      if (screenshot.value !== null || screenshot.digest !== evidence.digest) {
        issues.push(`qualification_responsive_screenshot_digest_mismatch:${evidence.id}`);
        continue;
      }
      try {
        const size = parsePngSize(screenshot.bytes);
        if (size.width !== evidence.width || size.height !== evidence.height) {
          issues.push(`qualification_responsive_screenshot_dimensions_mismatch:${evidence.id}`);
        }
      } catch (error) {
        issues.push(`qualification_responsive_screenshot_invalid:${evidence.id}:${error.message}`);
      }
      if (evidence.theme !== cell.theme || evidence.viewportWidth !== cell.width) {
        issues.push(`qualification_responsive_screenshot_cell_mismatch:${evidence.id}`);
      }
      if (screenshotDigests.has(evidence.digest)) issues.push(`qualification_responsive_screenshot_reused:${evidence.id}`);
      screenshotDigests.add(evidence.digest);
      if (cell?.canvasVisible === true && cell?.operationCompleted === true
          && cell?.operationPostconditionObserved === true && cell?.horizontalOverflow === false
          && Number.isFinite(cell?.firstCanvasMs) && cell.firstCanvasMs >= 0 && cell.firstCanvasMs <= 1000) {
        validCells.add(cellKey);
      }
  }
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 1024, 820]) {
      const key = `${theme}:${width}`;
      if (!validCells.has(key)) issues.push(`qualification_responsive_cell_missing:${key}`);
      else {
        environmentTags.add(`${theme}_theme`);
        environmentTags.add(width === 1440 ? 'viewport_wide' : `viewport_${width}`);
      }
    }
  }

  return Object.freeze({
    valid: issues.length === 0 && packages.size === traces.length,
    issues: Object.freeze([...new Set(issues)]),
    packageCount: packages.size,
    primaryOperationCount: primaryOperations.size,
    screenshotCount: screenshotDigests.size,
    environmentTags: Object.freeze([...environmentTags].sort()),
    providerClasses: Object.freeze([...providerClasses].sort()),
    privacyClean: !issues.some((issue) => issue.startsWith('private_projection_')),
    invariantChecks: Object.freeze(invariantChecks),
  });
}

module.exports = {
  BUNDLE_SCHEMA_VERSION,
  FACT_PACKAGE_SCHEMA_VERSION,
  REQUIRED_FACT_ROLES,
  DERIVED_INVARIANTS,
  sha256Bytes,
  stableHash,
  isSafeRelativePath,
  buildBundleManifest,
  verifyBundleManifest,
  resolveEvidenceRef,
  parsePngSize,
  validateFactPackage,
  deriveFactPackageInvariants,
  verifyQualificationEvidence,
};
