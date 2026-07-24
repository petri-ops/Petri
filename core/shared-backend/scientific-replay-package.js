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
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const relativePath = relativeInside(packageDir, absolute);
        if (relativePath && !excluded.has(relativePath)) {
          files.push({ relativePath, sha256: hashFile(absolute), sizeBytes: fs.statSync(absolute).size });
        }
      }
    }
  };
  walk(packageDir);
  return files;
}

function replayWrapperSource() {
  return `#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package-manifest.json'), 'utf8'));
const requestedIndex = process.argv.indexOf('--artifact');
const requested = requestedIndex >= 0 ? process.argv[requestedIndex + 1] : null;
const failures = [];
for (const item of manifest.files || []) {
  const target = path.resolve(root, item.relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) failures.push({ code: 'path_escape', path: item.relativePath });
  else if (!fs.existsSync(target)) failures.push({ code: 'file_missing', path: item.relativePath });
  else {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (actual !== item.sha256) failures.push({ code: 'hash_mismatch', path: item.relativePath });
  }
}
const replay = JSON.parse(fs.readFileSync(path.join(root, 'replay.json'), 'utf8'));
const artifact = requested ? (replay.artifacts || []).find((item) => item.artifactId === requested) : null;
if (requested && !artifact) failures.push({ code: 'artifact_unknown', artifactId: requested });
const response = {
  ok: failures.length === 0,
  packageDigest: manifest.packageDigest,
  artifact: artifact || null,
  failures,
  nextAction: failures.length ? 'repair_package' : 'submit_to_biof3_controlled_replay',
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
  if (includeFixtureInputs && privacyMode !== 'repository_demo_data_only') throw new Error('replay_package_fixture_input_policy_denied');

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
  const artifacts = (delivery.artifacts || []).map((artifact) => {
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
    return { artifactId, entrypoint: `repro/artifacts/${artifactId}.json`, expected: entry.expected };
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
    artifacts: (delivery.artifacts || []).map((artifact) => ({
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
      realTaskRequiresConfirmation: true,
      createsToolJob: true,
      directShellExecutionAllowed: false,
    },
    driftKinds: REPLAY_DRIFT_KINDS,
  };
  writeJson(path.join(packageDir, 'replay.json'), replay);
  writeText(path.join(packageDir, 'repro', 'reproduce.mjs'), replayWrapperSource());
  writeText(path.join(packageDir, 'HANDOFF.md'), `# BioF3 scientific task handoff\n\n- Task: ${taskRecord.task_id} v${taskRecord.version}\n- Job: ${job.id}\n- Tool: ${job.tool_id}\n- Source digest: ${sourceDigest}\n- History checkpoint: ${checkpoint ? 'included' : 'unavailable; see context-checkpoint.json'}\n- Verify: \`node repro/reproduce.mjs\`\n- Prepare one artifact: \`node repro/reproduce.mjs --artifact <artifactId>\`\n\nThe wrapper verifies package integrity and prepares a controlled replay request. It never runs scientific code directly. Real replay must be confirmed and recorded as a BioF3 replay Job.\n`);

  const files = collectPackageFiles(packageDir, new Set(['package-manifest.json']));
  const packageDigest = sha256Buffer(Buffer.from(stableStringify({ sourceDigest, files })));
  const packageManifest = {
    replayPackageVersion: REPLAY_PACKAGE_VERSION,
    status: checkpoint ? 'complete' : 'partial_history',
    packageDigest,
    sourceDigest,
    privacyMode,
    requiredFiles: ['task-spec.json', 'context-checkpoint.json', 'workflow-plan.json', 'job-manifest.json', 'artifact-manifest.json', 'delivery-manifest.json', 'provenance.json', 'replay.json', 'HANDOFF.md', 'repro/reproduce.mjs'],
    files,
    generatedAt: new Date().toISOString(),
  };
  writeJson(path.join(packageDir, 'package-manifest.json'), packageManifest);
  const validation = validateScientificReplayPackage(packageDir);
  if (!validation.ok) throw new Error(`replay_package_validation_failed:${validation.issues.map((item) => item.code).join(',')}`);
  return { packageDir: path.resolve(packageDir), packageManifest, replay, validation };
}

function validateScientificReplayPackage(packageDir) {
  const issues = [];
  const manifestPath = path.join(packageDir, 'package-manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, issues: [{ code: 'package_manifest_missing' }] };
  const manifest = parseJson(fs.readFileSync(manifestPath, 'utf8'), {});
  for (const required of manifest.requiredFiles || []) {
    if (!fs.existsSync(path.join(packageDir, required))) issues.push({ code: 'required_file_missing', path: required });
  }
  for (const item of manifest.files || []) {
    const target = path.resolve(packageDir, item.relativePath);
    if (relativeInside(packageDir, target) == null) issues.push({ code: 'package_path_escape', path: item.relativePath });
    else if (!fs.existsSync(target)) issues.push({ code: 'package_file_missing', path: item.relativePath });
    else if (hashFile(target) !== item.sha256) issues.push({ code: 'package_file_hash_mismatch', path: item.relativePath });
  }
  for (const item of collectPackageFiles(packageDir)) {
    if (!/\.(?:json|md|mjs|r|py|txt|csv|tsv)$/i.test(item.relativePath)) continue;
    const text = fs.readFileSync(path.join(packageDir, item.relativePath), 'utf8');
    if (SECRET_VALUE.test(text)) issues.push({ code: 'secret_value_detected', path: item.relativePath });
    if (/\b(?:Authorization|api[_-]?key|access[_-]?token)\b/i.test(text)) issues.push({ code: 'sensitive_field_detected', path: item.relativePath });
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
  buildScientificReplayPackage,
  validateScientificReplayPackage,
  assessReplayReadiness,
};
