'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { redactSensitiveValue } = require('./redaction');
const {
  stableStringify,
  validateContextCheckpoint,
} = require('./scientific-task-spec');
const { buildDriftReport } = require('./g0-reproducibility-lab');
const { createDeliveryManifest } = require('./delivery-manifest');

// The v1 manifest already carries these fields. Its verifier now binds every
// field (apart from its own digest) and the exact on-disk inventory, so an
// edited manifest cannot silently redefine the package it describes.
const REPLAY_PACKAGE_VERSION = 1;
const REPLAY_DRIFT_KINDS = Object.freeze([
  'input_drift',
  'environment_drift',
  'plugin_drift',
  'parameter_drift',
  'execution_failure',
  'artifact_drift',
]);
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key)/i;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PACKAGE_MANIFEST_FIELDS = Object.freeze([
  'replayPackageVersion',
  'status',
  'packageDigest',
  'sourceDigest',
  'privacyMode',
  'requiredFiles',
  'files',
  'generatedAt',
]);
const REQUIRED_PACKAGE_FILES = Object.freeze([
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
]);
const PACKAGE_PRIVACY_MODES = new Set([
  'references_only',
  'repository_demo_data_only',
  'project_bound_private',
]);
const PACKAGE_STATUSES = new Set(['complete', 'partial_history']);

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return sha256Buffer(fs.readFileSync(filePath));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function relativeInside(root, target) {
  if (!root || !target) return null;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) return null;
  return path.relative(resolvedRoot, resolvedTarget).split(path.sep).join('/');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafePackageRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return path.posix.normalize(value) === value;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function packageManifestDigestPayload(manifest) {
  return {
    replayPackageVersion: manifest.replayPackageVersion,
    status: manifest.status,
    sourceDigest: manifest.sourceDigest,
    privacyMode: manifest.privacyMode,
    requiredFiles: manifest.requiredFiles,
    files: manifest.files,
    generatedAt: manifest.generatedAt,
  };
}

function packageManifestDigest(manifest) {
  return sha256Buffer(Buffer.from(stableStringify(packageManifestDigestPayload(manifest))));
}

function collectPackageTree(packageDir, excluded = new Set()) {
  const files = [];
  const unsupported = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const relativePath = relativeInside(packageDir, absolute);
      if (!relativePath) {
        unsupported.push({ relativePath: null, kind: 'path_outside_package' });
      } else if (entry.isSymbolicLink()) {
        unsupported.push({ relativePath, kind: 'symlink' });
      } else if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        if (!excluded.has(relativePath)) {
          files.push({ relativePath, sha256: hashFile(absolute), sizeBytes: fs.statSync(absolute).size });
        }
      } else {
        unsupported.push({ relativePath, kind: 'non_regular' });
      }
    }
  };
  walk(packageDir);
  return { files, unsupported };
}

function inspectPackagedRegularFile(packageDir, relativePath) {
  if (!isSafePackageRelativePath(relativePath)) return { ok: false, code: 'package_path_invalid' };
  const target = path.resolve(packageDir, relativePath);
  if (relativeInside(packageDir, target) == null) return { ok: false, code: 'package_path_escape' };
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, code: 'package_file_not_regular' };
    const realTarget = fs.realpathSync(target);
    if (relativeInside(packageDir, realTarget) == null) return { ok: false, code: 'package_path_escape' };
    return { ok: true, target, stat };
  } catch {
    return { ok: false, code: 'package_file_missing' };
  }
}

function validatePackageManifestSchema(manifest) {
  const issues = [];
  if (!isPlainObject(manifest)) return { issues: [{ code: 'package_manifest_schema_invalid' }] };
  const keys = Object.keys(manifest);
  for (const field of keys) {
    if (!PACKAGE_MANIFEST_FIELDS.includes(field)) issues.push({ code: 'package_manifest_unknown_field', field });
  }
  for (const field of PACKAGE_MANIFEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) issues.push({ code: 'package_manifest_field_missing', field });
  }
  if (manifest.replayPackageVersion !== REPLAY_PACKAGE_VERSION) {
    issues.push({ code: 'package_manifest_version_invalid', actual: manifest.replayPackageVersion || null });
  }
  if (!PACKAGE_STATUSES.has(manifest.status)) issues.push({ code: 'package_manifest_status_invalid' });
  if (!SHA256_HEX.test(String(manifest.packageDigest || ''))) issues.push({ code: 'package_manifest_digest_invalid' });
  if (!SHA256_HEX.test(String(manifest.sourceDigest || ''))) issues.push({ code: 'package_manifest_source_digest_invalid' });
  if (!PACKAGE_PRIVACY_MODES.has(manifest.privacyMode)) issues.push({ code: 'package_manifest_privacy_mode_invalid' });
  if (typeof manifest.generatedAt !== 'string' || !manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    issues.push({ code: 'package_manifest_generated_at_invalid' });
  }

  if (!Array.isArray(manifest.requiredFiles)
      || !sameOrderedStrings(manifest.requiredFiles, REQUIRED_PACKAGE_FILES)) {
    issues.push({ code: 'package_manifest_required_files_invalid' });
  }
  if (!Array.isArray(manifest.files)) {
    issues.push({ code: 'package_manifest_files_invalid' });
  } else {
    const seenPaths = new Set();
    for (const item of manifest.files) {
      if (!isPlainObject(item)) {
        issues.push({ code: 'package_manifest_file_entry_invalid' });
        continue;
      }
      const itemKeys = Object.keys(item);
      if (itemKeys.length !== 3 || itemKeys.some((key) => !['relativePath', 'sha256', 'sizeBytes'].includes(key))) {
        issues.push({ code: 'package_manifest_file_entry_schema_invalid', path: item.relativePath || null });
      }
      if (!isSafePackageRelativePath(item.relativePath) || item.relativePath === 'package-manifest.json') {
        issues.push({ code: 'package_manifest_file_path_invalid', path: item.relativePath || null });
      } else if (seenPaths.has(item.relativePath)) {
        issues.push({ code: 'package_manifest_file_duplicate', path: item.relativePath });
      } else {
        seenPaths.add(item.relativePath);
      }
      if (!SHA256_HEX.test(String(item.sha256 || ''))) {
        issues.push({ code: 'package_manifest_file_hash_invalid', path: item.relativePath || null });
      }
      if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0) {
        issues.push({ code: 'package_manifest_file_size_invalid', path: item.relativePath || null });
      }
    }
  }
  return { issues };
}

function safeSegment(value, fallback = 'item') {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function stripSensitiveKeys(value) {
  const redacted = redactSensitiveValue(value);
  if (Array.isArray(redacted)) return redacted.map(stripSensitiveKeys);
  if (!redacted || typeof redacted !== 'object') return redacted;
  const output = {};
  for (const [key, child] of Object.entries(redacted)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = stripSensitiveKeys(child);
  }
  return output;
}

function sanitizeParams(params, inputs, includeFixtureInputs) {
  const byRole = new Map((inputs || []).map((item) => [String(item.role || ''), item]));
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.map((item) => visit(item, key));
    if (value && typeof value === 'object') {
      const output = {};
      for (const [childKey, child] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(childKey)) continue;
        output[childKey] = visit(child, childKey);
      }
      return output;
    }
    if (typeof value !== 'string') return value;
    const input = byRole.get(key);
    if (input) return includeFixtureInputs ? `inputs/${input.relativePath}` : `input://${input.role}`;
    if (path.isAbsolute(value)) return `external://${path.basename(value)}`;
    return value;
  };
  return visit(stripSensitiveKeys(params || {}));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function projectJobResult(job) {
  if (job?.result && typeof job.result === 'object') return job.result;
  return parseJson(job?.result_json, {});
}

function projectJobParams(job) {
  if (job?.params && typeof job.params === 'object' && !Array.isArray(job.params)) return job.params;
  return parseJson(job?.params_json, {});
}

function resolveRevisionInputSource({ projectRoot, input, params }) {
  const realProjectRoot = fs.realpathSync(projectRoot);
  const relativePath = String(input?.relativePath || '').trim();
  const expectedHash = String(input?.sha256 || '').trim();
  const candidates = [
    relativePath ? path.join(realProjectRoot, relativePath) : null,
    input?.id && typeof params?.[input.id] === 'string' ? params[input.id] : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const target = fs.realpathSync(candidate);
      if (relativeInside(realProjectRoot, target) == null || !fs.statSync(target).isFile()) continue;
      if (hashFile(target) === expectedHash) return target;
    } catch { /* Try the next authoritative project-contained location. */ }
  }
  throw new Error(`result_revision_replay_input_unavailable:${input?.id || 'unknown'}`);
}

/**
 * Adapt one adopted Result Studio ArtifactRevision to the existing canonical
 * ReplayPackage contract. The package carries exact project-contained inputs,
 * the immutable materialized script, normalized parameters, the authoritative
 * workflow projection and hashes for every formal output from the source Job.
 * Once built it can be validated without SQLite or the original workspace.
 */
function buildResultRevisionReplayPackage({
  revision,
  changeSet,
  job,
  projectRoot,
  packageDir,
  contextCheckpoint = null,
  workflowGraph = null,
  formalArtifactIds = null,
} = {}) {
  if (!revision || !changeSet || !job || !projectRoot || !packageDir) {
    throw new Error('result_revision_replay_fields_required');
  }
  if (revision.projectId !== changeSet.projectId
      || String(job.project_id || job.projectId || '') !== revision.projectId
      || revision.changeSetId !== changeSet.changeSetId
      || revision.toolJobId !== job.id) {
    throw new Error('result_revision_replay_scope_mismatch');
  }
  if (changeSet.status !== 'adopted') throw new Error('result_revision_replay_requires_adopted_changeset');

  const result = projectJobResult(job);
  const provenance = result.executionProvenance;
  if (job.status !== 'completed' || result.artifactTruth?.status !== 'valid'
      || result.artifactTruth?.blocking === true || !provenance?.provenanceHash) {
    throw new Error('result_revision_replay_requires_valid_job_truth');
  }
  const params = projectJobParams(job);
  const provenanceInputs = Array.isArray(provenance.inputs) ? provenance.inputs : [];
  const inputSources = {};
  const inputs = provenanceInputs.map((input) => {
    const role = String(input?.id || '').trim();
    if (!role || !input?.relativePath || !input?.sha256) {
      throw new Error('result_revision_replay_input_identity_invalid');
    }
    const source = resolveRevisionInputSource({ projectRoot, input, params });
    inputSources[role] = source;
    return {
      role,
      sourceRole: input.role || null,
      relativePath: input.relativePath,
      sha256: input.sha256,
      sizeBytes: fs.statSync(source).size,
      sourceArtifactRef: input.sourceArtifactRef || null,
    };
  });
  const allArtifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const formalIds = Array.isArray(formalArtifactIds) && formalArtifactIds.length > 0
    ? [...new Set(formalArtifactIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : null;
  const artifacts = formalIds
    ? allArtifacts.filter((artifact) => formalIds.includes(String(artifact?.id || '').trim()))
    : allArtifacts;
  if (formalIds && (artifacts.length !== formalIds.length
      || new Set(artifacts.map((artifact) => String(artifact?.id || '').trim())).size !== formalIds.length)) {
    throw new Error('result_revision_replay_formal_output_cohort_incomplete');
  }
  const taskSpec = {
    taskSpecVersion: 1,
    taskId: `result-revision-${revision.revisionId}`,
    projectId: revision.projectId,
    conversationId: changeSet.conversationId || null,
    method: {
      toolId: job.tool_id || job.toolId,
      pluginVersion: provenance.plugin?.version || null,
      sourceCommit: revision.sourceCommit,
    },
    inputs,
    requestedDeliverables: artifacts.map((artifact) => artifact.id).filter(Boolean),
    resultRevision: {
      revisionId: revision.revisionId,
      artifactFamilyId: revision.artifactFamilyId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
      changeSetId: revision.changeSetId,
    },
  };
  const taskRecord = {
    task_id: taskSpec.taskId,
    version: 1,
    project_id: revision.projectId,
    conversation_id: changeSet.conversationId || 'result-studio',
    spec_hash: sha256Buffer(Buffer.from(stableStringify(taskSpec))),
    spec: taskSpec,
  };
  const deliveryManifest = createDeliveryManifest({ taskRecord, job, projectRoot });
  if (deliveryManifest.status === 'blocked') throw new Error('result_revision_replay_delivery_blocked');
  const packageJob = {
    ...job,
    result: { ...result, deliveryManifest },
    result_json: null,
  };
  const authoritativeWorkflow = workflowGraph
    ? {
        workflowTruthVersion: workflowGraph.contractVersion || 1,
        authority: 'sqlite_job_artifact_truth',
        graphId: workflowGraph.graphId,
        sourceDigest: workflowGraph.sourceDigest,
        rootToolJobId: workflowGraph.rootToolJobId,
        nodes: workflowGraph.nodes,
        edges: workflowGraph.edges,
      }
    : null;
  const built = buildScientificReplayPackage({
    taskRecord,
    job: packageJob,
    projectRoot,
    packageDir,
    contextCheckpoint,
    workflowPlan: authoritativeWorkflow,
    includeFixtureInputs: true,
    inputSources,
    privacyMode: 'project_bound_private',
    formalArtifactIds: formalIds,
  });
  return {
    ...built,
    revision: {
      revisionId: revision.revisionId,
      artifactFamilyId: revision.artifactFamilyId,
      artifactId: revision.artifactId,
      outputHash: revision.outputHash,
    },
    outputCohort: built.replay.artifacts.map((artifact) => ({
      artifactId: artifact.sourceArtifactId || artifact.artifactId,
      expectedHash: artifact.expected?.sha256 || null,
    })),
  };
}

/**
 * Context checkpoints and durable Loop iteration checkpoints intentionally
 * share one append-only persistence table. Replay packages may only embed the
 * former contract, so callers must select the newest compatible record instead
 * of assuming that the newest row is a ContextCheckpoint.
 */
function selectReplayContextCheckpoint(candidates = []) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const validated = validateContextCheckpoint(candidate);
    if (validated.ok) return validated.checkpoint;
  }
  return null;
}

function collectPackageFiles(packageDir, excluded = new Set()) {
  return collectPackageTree(packageDir, excluded).files;
}

function replayWrapperSource() {
  return `#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const expectedVersion = ${REPLAY_PACKAGE_VERSION};
const expectedRequiredFiles = ${JSON.stringify(REQUIRED_PACKAGE_FILES)};
const expectedManifestFields = new Set(['replayPackageVersion', 'status', 'packageDigest', 'sourceDigest', 'privacyMode', 'requiredFiles', 'files', 'generatedAt']);
const allowedPrivacyModes = new Set(${JSON.stringify([...PACKAGE_PRIVACY_MODES])});
const allowedStatuses = new Set(${JSON.stringify([...PACKAGE_STATUSES])});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
};
const isSafeRelativePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\0') || value.includes('\\\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => !segment || segment === '.' || segment === '..') && path.posix.normalize(value) === value;
};
const isContained = (target) => target !== root && target.startsWith(root + path.sep);
const inspectFile = (relativePath) => {
  if (!isSafeRelativePath(relativePath)) return { ok: false, code: 'path_invalid' };
  const target = path.resolve(root, relativePath);
  if (!isContained(target)) return { ok: false, code: 'path_escape' };
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, code: 'file_not_regular' };
    if (!isContained(fs.realpathSync(target))) return { ok: false, code: 'path_escape' };
    return { ok: true, target, sizeBytes: stat.size };
  } catch {
    return { ok: false, code: 'file_missing' };
  }
};
const collectInventory = () => {
  const files = [];
  const unsupported = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      if (!relativePath || relativePath.startsWith('../')) unsupported.push({ relativePath: null, kind: 'path_outside_package' });
      else if (entry.isSymbolicLink()) unsupported.push({ relativePath, kind: 'symlink' });
      else if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && relativePath !== 'package-manifest.json') {
        files.push({ relativePath, sha256: sha256(fs.readFileSync(absolute)), sizeBytes: fs.statSync(absolute).size });
      } else if (!entry.isFile()) unsupported.push({ relativePath, kind: 'non_regular' });
    }
  };
  walk(root);
  return { files, unsupported };
};
const requestedIndex = process.argv.indexOf('--artifact');
const requested = requestedIndex >= 0 ? process.argv[requestedIndex + 1] : null;
const failures = [];
let manifest = null;
try {
  const manifestPath = path.join(root, 'package-manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('manifest_not_regular');
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch {
  failures.push({ code: 'package_manifest_invalid' });
}
if (!isPlainObject(manifest)) {
  failures.push({ code: 'package_manifest_schema_invalid' });
} else {
    for (const field of Object.keys(manifest)) {
      if (!expectedManifestFields.has(field)) failures.push({ code: 'package_manifest_unknown_field', field });
    }
    for (const field of expectedManifestFields) {
      if (!Object.prototype.hasOwnProperty.call(manifest, field)) failures.push({ code: 'package_manifest_field_missing', field });
    }
    if (manifest.replayPackageVersion !== expectedVersion) failures.push({ code: 'package_manifest_version_invalid' });
    if (!allowedStatuses.has(manifest.status)) failures.push({ code: 'package_manifest_status_invalid' });
    if (!isSha256(manifest.packageDigest) || !isSha256(manifest.sourceDigest)) failures.push({ code: 'package_manifest_digest_invalid' });
    if (!allowedPrivacyModes.has(manifest.privacyMode)) failures.push({ code: 'package_manifest_privacy_mode_invalid' });
    if (!Array.isArray(manifest.requiredFiles) || stableStringify(manifest.requiredFiles) !== stableStringify(expectedRequiredFiles)) {
      failures.push({ code: 'package_manifest_required_files_invalid' });
    }
    const manifestFiles = Array.isArray(manifest.files) ? manifest.files : null;
    if (!manifestFiles) failures.push({ code: 'package_manifest_files_invalid' });
    else {
      const seenPaths = new Set();
      for (const item of manifestFiles) {
        if (!isPlainObject(item) || Object.keys(item).length !== 3 || Object.keys(item).some((key) => !['relativePath', 'sha256', 'sizeBytes'].includes(key))
            || !isSafeRelativePath(item.relativePath) || item.relativePath === 'package-manifest.json'
            || seenPaths.has(item.relativePath) || !isSha256(item.sha256)
            || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0) {
          failures.push({ code: 'package_manifest_file_entry_invalid', path: item && item.relativePath || null });
          continue;
        }
        seenPaths.add(item.relativePath);
        const inspected = inspectFile(item.relativePath);
        if (!inspected.ok) failures.push({ code: inspected.code, path: item.relativePath });
      }
      const inventory = collectInventory();
      for (const item of inventory.unsupported) failures.push({ code: 'package_inventory_unsupported_entry', path: item.relativePath, kind: item.kind });
      if (stableStringify(inventory.files) !== stableStringify(manifestFiles)) failures.push({ code: 'package_file_inventory_mismatch' });
    }
    for (const requiredFile of Array.isArray(manifest.requiredFiles) ? manifest.requiredFiles : []) {
      const inspected = inspectFile(requiredFile);
      if (!inspected.ok) failures.push({ code: 'required_file_' + inspected.code, path: requiredFile });
    }
    const digestPayload = {
      replayPackageVersion: manifest.replayPackageVersion,
      status: manifest.status,
      sourceDigest: manifest.sourceDigest,
      privacyMode: manifest.privacyMode,
      requiredFiles: manifest.requiredFiles,
      files: manifest.files,
      generatedAt: manifest.generatedAt,
    };
    if (!isSha256(manifest.packageDigest) || sha256(stableStringify(digestPayload)) !== manifest.packageDigest) {
      failures.push({ code: 'package_digest_mismatch' });
    }
}
let replay = {};
try { replay = JSON.parse(fs.readFileSync(path.join(root, 'replay.json'), 'utf8')); }
catch { failures.push({ code: 'replay_manifest_invalid' }); }
const artifact = requested ? (replay.artifacts || []).find((item) => item.artifactId === requested) : null;
if (requested && !artifact) failures.push({ code: 'artifact_unknown', artifactId: requested });
const response = {
  ok: failures.length === 0,
  packageDigest: manifest && manifest.packageDigest || null,
  artifact: artifact || null,
  failures,
  nextAction: failures.length ? 'repair_package' : 'submit_to_petri_controlled_replay',
  requiresConfirmation: true,
};
process.stdout.write(JSON.stringify(response, null, 2) + '\\n');
process.exitCode = failures.length ? 1 : 0;
`;
}

function buildScientificReplayPackage({
  taskRecord,
  job,
  projectRoot,
  packageDir,
  contextCheckpoint = null,
  workflowPlan = null,
  includeFixtureInputs = false,
  inputSources = {},
  privacyMode = 'references_only',
  formalArtifactIds = null,
} = {}) {
  if (!taskRecord?.spec || !job || !projectRoot || !packageDir) throw new Error('replay_package_fields_required');
  if (relativeInside(projectRoot, packageDir) == null) throw new Error('replay_package_path_outside_project');
  const result = parseJson(job.result_json || job.result, {});
  if (job.status !== 'completed' || result.artifactTruth?.status !== 'valid') throw new Error('replay_package_requires_valid_artifact_truth');
  const provenance = result.executionProvenance;
  const delivery = result.deliveryManifest;
  if (!provenance?.provenanceHash || !delivery?.manifestHash) throw new Error('replay_package_delivery_provenance_required');
  if (!provenance.script?.snapshotPath || !fs.existsSync(provenance.script.snapshotPath)) throw new Error('replay_package_script_snapshot_missing');
  if (hashFile(provenance.script.snapshotPath) !== provenance.script.sha256) throw new Error('replay_package_script_snapshot_drift');
  if (!PACKAGE_PRIVACY_MODES.has(privacyMode)) throw new Error('replay_package_privacy_mode_invalid');
  if (includeFixtureInputs && !['repository_demo_data_only', 'project_bound_private'].includes(privacyMode)) {
    throw new Error('replay_package_fixture_input_policy_denied');
  }
  const requestedArtifactIds = Array.isArray(formalArtifactIds) && formalArtifactIds.length > 0
    ? [...new Set(formalArtifactIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : null;
  const deliveryArtifacts = Array.isArray(delivery.artifacts) ? delivery.artifacts : [];
  const replayArtifacts = requestedArtifactIds
    ? deliveryArtifacts.filter((artifact) => requestedArtifactIds.includes(String(artifact?.id || '').trim()))
    : deliveryArtifacts;
  if (requestedArtifactIds && (replayArtifacts.length !== requestedArtifactIds.length
      || new Set(replayArtifacts.map((artifact) => String(artifact?.id || '').trim())).size !== requestedArtifactIds.length)) {
    throw new Error('replay_package_formal_output_cohort_incomplete');
  }

  let checkpoint = null;
  if (contextCheckpoint) {
    const validated = validateContextCheckpoint(contextCheckpoint);
    if (!validated.ok) throw new Error('replay_package_context_checkpoint_invalid');
    if (validated.checkpoint.projectId !== taskRecord.project_id || validated.checkpoint.conversationId !== taskRecord.conversation_id) throw new Error('replay_package_context_checkpoint_scope_mismatch');
    checkpoint = validated.checkpoint;
  }

  fs.mkdirSync(packageDir, { recursive: true });
  const inputs = (taskRecord.spec.inputs || []).map((input) => ({
    role: input.role,
    relativePath: input.relativePath,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    sourceArtifactRef: input.sourceArtifactRef || null,
    packagedPath: includeFixtureInputs ? `inputs/${input.relativePath}` : null,
  }));
  if (includeFixtureInputs) {
    for (const input of inputs) {
      const source = inputSources[input.role];
      if (!source || !fs.existsSync(source)) throw new Error(`replay_package_fixture_input_missing:${input.role}`);
      if (hashFile(source) !== input.sha256) throw new Error(`replay_package_fixture_input_drift:${input.role}`);
      const target = path.join(packageDir, input.packagedPath);
      if (relativeInside(packageDir, target) == null) throw new Error('replay_package_fixture_path_escape');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }

  const scriptExtension = path.extname(provenance.script.snapshotPath) || '.txt';
  const packagedScriptPath = `repro/scripts/run-script${scriptExtension}`;
  fs.mkdirSync(path.dirname(path.join(packageDir, packagedScriptPath)), { recursive: true });
  fs.copyFileSync(provenance.script.snapshotPath, path.join(packageDir, packagedScriptPath));

  const params = sanitizeParams(provenance.params?.normalized || parseJson(job.params_json, {}), inputs, includeFixtureInputs);
  const paramsHash = sha256Buffer(Buffer.from(stableStringify(params)));
  const artifacts = replayArtifacts.map((artifact) => {
    const artifactId = safeSegment(artifact.id || artifact.label || artifact.relativePath, 'artifact');
    const provenanceArtifact = (provenance.artifacts || []).find((item) => item.id === artifact.id || item.filename === path.basename(artifact.relativePath || ''));
    const entry = {
      replayArtifactVersion: 1,
      artifactId,
      sourceArtifactId: artifact.id || null,
      type: artifact.type,
      label: artifact.label,
      expected: {
        relativePath: artifact.relativePath,
        sha256: artifact.sha256 || provenanceArtifact?.sha256 || null,
      },
      producer: { toolId: job.tool_id, toolJobId: job.id, pluginVersion: provenance.plugin?.version || null },
      scriptRef: packagedScriptPath,
      inputRefs: inputs,
      paramsRef: 'params.json',
      paramsHash,
      deterministic: provenance.runtime?.seed == null,
      seed: provenance.runtime?.seed ?? null,
      tolerance: provenance.runtime?.tolerance ?? null,
      comparisonMode: provenance.runtime?.tolerance
        ? 'tolerance_based'
        : ['markdown', 'text', 'report'].includes(String(artifact.type || '').toLowerCase())
          ? 'narrative'
          : 'deterministic',
      controlledReplay: { requiresConfirmation: true, target: artifact.id || artifactId },
    };
    writeJson(path.join(packageDir, 'repro', 'artifacts', `${artifactId}.json`), entry);
    return {
      artifactId,
      sourceArtifactId: artifact.id || null,
      entrypoint: `repro/artifacts/${artifactId}.json`,
      expected: entry.expected,
    };
  });

  const taskSpec = stripSensitiveKeys(taskRecord.spec);
  writeJson(path.join(packageDir, 'task-spec.json'), taskSpec);
  writeJson(path.join(packageDir, 'params.json'), params);
  writeJson(path.join(packageDir, 'context-checkpoint.json'), checkpoint || {
    status: 'unavailable',
    reason: 'no_persisted_context_checkpoint',
    projectId: taskRecord.project_id,
    conversationId: taskRecord.conversation_id,
  });
  const exportedWorkflowPlan = stripSensitiveKeys(workflowPlan || {
    workflowPlanVersion: 1,
    status: 'completed',
    steps: [{ id: 'step-1', toolId: job.tool_id, toolJobId: job.id, dependsOn: [], artifactIds: artifacts.map((item) => item.artifactId) }],
  });
  writeJson(path.join(packageDir, 'workflow-plan.json'), exportedWorkflowPlan);
  writeJson(path.join(packageDir, 'job-manifest.json'), stripSensitiveKeys({
    id: job.id,
    toolId: job.tool_id,
    status: job.status,
    projectId: job.project_id,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    artifactTruth: result.artifactTruth,
    artifactDiagnostics: result.artifactDiagnostics || [],
  }));
  writeJson(path.join(packageDir, 'artifact-manifest.json'), stripSensitiveKeys({
    artifactSchemaVersion: result.artifactSchemaVersion || 1,
    artifacts: replayArtifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      label: artifact.label,
      relativePath: artifact.relativePath,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      reproducibility: artifact.reproducibility,
    })),
  }));
  writeJson(path.join(packageDir, 'delivery-manifest.json'), stripSensitiveKeys(delivery));
  writeJson(path.join(packageDir, 'provenance.json'), stripSensitiveKeys({
    ...provenance,
    params: { normalized: params, sha256: paramsHash },
    inputs,
    runtime: {
      ...provenance.runtime,
      command: provenance.runtime?.command ? path.basename(provenance.runtime.command) : null,
    },
    script: { ...provenance.script, snapshotPath: packagedScriptPath },
    command: provenance.command ? {
      ...provenance.command,
      executable: provenance.command.executable ? path.basename(provenance.command.executable) : null,
      args: (provenance.command.args || []).map((arg) => typeof arg === 'string' && path.isAbsolute(arg) ? path.basename(arg) : arg),
      cwd: 'replay-workdir',
    } : null,
  }));
  const sourceDigest = sha256Buffer(Buffer.from(stableStringify({
    taskSpecHash: taskRecord.spec_hash,
    contextSourceDigest: checkpoint?.sourceDigest || null,
    provenanceHash: provenance.provenanceHash,
    deliveryManifestHash: delivery.manifestHash,
  })));
  const replay = {
    replayManifestVersion: 1,
    privacyMode,
    task: { taskId: taskRecord.task_id, version: taskRecord.version, taskSpecHash: taskRecord.spec_hash },
    sourceDigest,
    inputs,
    params: { relativePath: 'params.json', sha256: paramsHash },
    runtime: stripSensitiveKeys(provenance.runtime || {}),
    plugin: stripSensitiveKeys(provenance.plugin || {}),
    script: { relativePath: packagedScriptPath, sha256: provenance.script.sha256 },
    artifacts,
    replayPolicy: {
      fixtureOfflineAllowed: includeFixtureInputs && privacyMode === 'repository_demo_data_only',
      packagedProjectInputs: includeFixtureInputs && privacyMode === 'project_bound_private',
      realTaskRequiresConfirmation: true,
      createsToolJob: true,
      directShellExecutionAllowed: false,
    },
    driftKinds: REPLAY_DRIFT_KINDS,
  };
  writeJson(path.join(packageDir, 'replay.json'), replay);
  writeText(path.join(packageDir, 'repro', 'reproduce.mjs'), replayWrapperSource());
  writeText(path.join(packageDir, 'HANDOFF.md'), `# Petri scientific task handoff\n\n- Task: ${taskRecord.task_id} v${taskRecord.version}\n- Job: ${job.id}\n- Tool: ${job.tool_id}\n- Source digest: ${sourceDigest}\n- History checkpoint: ${checkpoint ? 'included' : 'unavailable; see context-checkpoint.json'}\n- Verify: \`node repro/reproduce.mjs\`\n- Prepare one artifact: \`node repro/reproduce.mjs --artifact <artifactId>\`\n\nThe wrapper verifies package integrity and prepares a controlled replay request. It never runs scientific code directly. Real replay must be confirmed and recorded as a Petri replay Job.\n`);

  const files = collectPackageFiles(packageDir, new Set(['package-manifest.json']));
  const packageManifest = {
    replayPackageVersion: REPLAY_PACKAGE_VERSION,
    status: checkpoint ? 'complete' : 'partial_history',
    packageDigest: null,
    sourceDigest,
    privacyMode,
    requiredFiles: [...REQUIRED_PACKAGE_FILES],
    files,
    generatedAt: new Date().toISOString(),
  };
  packageManifest.packageDigest = packageManifestDigest(packageManifest);
  writeJson(path.join(packageDir, 'package-manifest.json'), packageManifest);
  const validation = validateScientificReplayPackage(packageDir);
  if (!validation.ok) throw new Error(`replay_package_validation_failed:${validation.issues.map((item) => item.code).join(',')}`);
  return { packageDir: path.resolve(packageDir), packageManifest, replay, validation };
}

function validateScientificReplayPackage(packageDir) {
  const issues = [];
  let root;
  let manifest;
  try {
    root = fs.realpathSync(packageDir);
    if (!fs.statSync(root).isDirectory()) throw new Error('not_directory');
  } catch {
    return { ok: false, issues: [{ code: 'package_directory_missing' }] };
  }
  const manifestPath = path.join(root, 'package-manifest.json');
  try {
    const manifestStat = fs.lstatSync(manifestPath);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('not_regular');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, issues: [{ code: 'package_manifest_missing_or_invalid' }] };
  }

  const schema = validatePackageManifestSchema(manifest);
  issues.push(...schema.issues);
  if (!isPlainObject(manifest)) return { ok: false, manifest, issues };
  let inventory = { files: [], unsupported: [] };
  try {
    inventory = collectPackageTree(root, new Set(['package-manifest.json']));
  } catch {
    issues.push({ code: 'package_inventory_unreadable' });
  }
  for (const item of inventory.unsupported) {
    issues.push({ code: 'package_inventory_unsupported_entry', path: item.relativePath, kind: item.kind });
  }

  if (Array.isArray(manifest.requiredFiles)) {
    for (const required of manifest.requiredFiles) {
      const inspected = inspectPackagedRegularFile(root, required);
      if (!inspected.ok) issues.push({ code: `required_file_${inspected.code}`, path: required || null });
    }
  }
  if (Array.isArray(manifest.files)) {
    for (const item of manifest.files) {
      if (!isPlainObject(item) || !isSafePackageRelativePath(item.relativePath)
          || item.relativePath === 'package-manifest.json') continue;
      const inspected = inspectPackagedRegularFile(root, item.relativePath);
      if (!inspected.ok) {
        issues.push({ code: inspected.code, path: item.relativePath || null });
      } else {
        if (Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0 && inspected.stat.size !== item.sizeBytes) {
          issues.push({ code: 'package_file_size_mismatch', path: item.relativePath });
        }
        if (SHA256_HEX.test(String(item.sha256 || '')) && hashFile(inspected.target) !== item.sha256) {
          issues.push({ code: 'package_file_hash_mismatch', path: item.relativePath });
        }
      }
    }
    if (stableStringify(inventory.files) !== stableStringify(manifest.files)) {
      issues.push({
        code: 'package_file_inventory_mismatch',
        expectedCount: manifest.files.length,
        actualCount: inventory.files.length,
      });
    }
  }
  if (isPlainObject(manifest)
      && PACKAGE_MANIFEST_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(manifest, field))) {
    if (packageManifestDigest(manifest) !== manifest.packageDigest) {
      issues.push({ code: 'package_digest_mismatch' });
    }
  }
  for (const item of collectPackageFiles(root)) {
    if (!/\.(?:json|md|mjs|r|py|txt|csv|tsv)$/i.test(item.relativePath)) continue;
    try {
      const text = fs.readFileSync(path.join(root, item.relativePath), 'utf8');
      if (SECRET_VALUE.test(text)) issues.push({ code: 'secret_value_detected', path: item.relativePath });
      if (/\b(?:Authorization|api[_-]?key|access[_-]?token)\b/i.test(text)) issues.push({ code: 'sensitive_field_detected', path: item.relativePath });
    } catch {
      issues.push({ code: 'package_text_file_unreadable', path: item.relativePath });
    }
  }
  return { ok: issues.length === 0, manifest, issues };
}

function assessReplayReadiness({
  packageDir,
  inputSources = {},
  currentPluginFingerprint = null,
  currentParams = null,
  currentRuntimeVersion = null,
  executionResult = null,
  artifactSources = {},
} = {}) {
  const validation = validateScientificReplayPackage(packageDir);
  if (!validation.ok) return { ok: false, status: 'blocked', drift: [{ kind: 'artifact_drift', details: validation.issues }] };
  const replay = parseJson(fs.readFileSync(path.join(packageDir, 'replay.json'), 'utf8'), {});
  const drift = [];
  for (const input of replay.inputs || []) {
    const source = inputSources[input.role] || (input.packagedPath ? path.join(packageDir, input.packagedPath) : null);
    if (!source || hashFile(source) !== input.sha256) drift.push({ kind: 'input_drift', role: input.role, expected: input.sha256, actual: hashFile(source) });
  }
  if (currentPluginFingerprint != null && replay.plugin?.manifestFingerprint !== currentPluginFingerprint) drift.push({ kind: 'plugin_drift', expected: replay.plugin?.manifestFingerprint || null, actual: currentPluginFingerprint });
  if (currentParams != null) {
    const actual = sha256Buffer(Buffer.from(stableStringify(currentParams)));
    if (actual !== replay.params?.sha256) drift.push({ kind: 'parameter_drift', expected: replay.params?.sha256, actual });
  }
  if (currentRuntimeVersion != null && replay.runtime?.version && replay.runtime.version !== currentRuntimeVersion) drift.push({ kind: 'environment_drift', expected: replay.runtime.version, actual: currentRuntimeVersion });
  if (executionResult && executionResult.exitCode !== 0) drift.push({ kind: 'execution_failure', exitCode: executionResult.exitCode, stderr: String(executionResult.stderr || '').slice(-1000) });
  if (executionResult && executionResult.exitCode === 0) {
    for (const artifact of replay.artifacts || []) {
      const source = artifactSources[artifact.artifactId];
      if (source && artifact.expected?.sha256 && hashFile(source) !== artifact.expected.sha256) drift.push({ kind: 'artifact_drift', artifactId: artifact.artifactId, expected: artifact.expected.sha256, actual: hashFile(source) });
    }
  }
  const driftReport = buildDriftReport({
    replayCaseId: replay.task?.taskId || null,
    sourceDigest: replay.sourceDigest || null,
    targetDigest: sha256Buffer(Buffer.from(stableStringify({
      plugin: currentPluginFingerprint,
      params: currentParams,
      runtime: currentRuntimeVersion,
    }))),
    contextDrifts: drift.map((item) => ({
      ...item,
      scientificallyMaterial: ['input_drift', 'parameter_drift'].includes(item.kind),
    })),
  });
  return {
    ok: drift.length === 0,
    status: drift.length ? 'blocked' : 'ready_for_confirmation',
    requiresConfirmation: true,
    drift,
    driftReport,
  };
}

module.exports = {
  REPLAY_PACKAGE_VERSION,
  REPLAY_DRIFT_KINDS,
  hashFile,
  relativeInside,
  sanitizeParams,
  selectReplayContextCheckpoint,
  buildResultRevisionReplayPackage,
  buildScientificReplayPackage,
  validateScientificReplayPackage,
  assessReplayReadiness,
};
