#!/usr/bin/env node

/**
 * G0-RS-P6 / UI-110 real Electron scientific-editing observation.
 *
 * One parent owns the entire disposable chain:
 *
 *   no-seed P5 runtime + local deterministic OpenAI-compatible adapter
 *   -> real baseline jobs -> Vite -> Electron BrowserWindow interactions
 *   -> SQLite/Job/Artifact/Git/validator cross-check -> source-bound evidence
 *
 * The adapter proves the product's Agent tool protocol and UI flow without
 * claiming a real Provider. Packaged Electron and provider qualification stay
 * explicitly in P7.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  constants as fsConstants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  P5_SOURCE_FILES,
  createP5LiveScientificRuntime,
  findBioPackRoot,
  prepareP5LiveScientificBaselines,
} from './g0-rs-p5-acceptance.mjs';
import { locatePackPluginDir } from './g0-rs-p4r-pack.mjs';
import {
  P6_UI110_GATEWAY_CLASSIFICATION,
  startP6Ui110LocalGateway,
} from './g0-rs-p6-ui110-local-gateway.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  resolveExecutionInputPath,
  verifyExecutionProvenance,
} = require(path.join(ROOT, 'core/shared-backend/execution-provenance.js'));
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json');
const SCREENSHOT_DIR = path.join(ROOT, 'acceptance/g0-result-studio/rs-p6-ui110-electron');
const DRIVER_PATH = path.join(ROOT, 'scripts/g0-rs-p6-ui110-driver.cjs');
const VITE_PATH = path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js');
const ELECTRON_PATH = path.join(ROOT, 'node_modules/.bin/electron');
const LOCAL_RUNTIMES_ENV = 'BIOF3_P6_LOCAL_RUNTIMES_DIR';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Descriptors live inside the domain pack. The old `resources/built-in-plugins/`
// paths died with BLOCK-83 (pack migration), and BLOCK-86 sealed 14 of the 15
// plugins into the pack's plugins.dormant/ — so resolution must go through the
// pack layer's dormant-aware locatePackPluginDir().
const ADMITTED_DESCRIPTOR_TOOLS = Object.freeze([
  'deseq2',
  'go-kegg',
  'volcano-plot',
  'gene-correlation',
]);

function admittedDescriptorFile(toolId) {
  if (!ADMITTED_DESCRIPTOR_TOOLS.includes(toolId)) return null;
  const packRoot = findBioPackRoot();
  if (!packRoot) return null;
  try {
    return path.join(locatePackPluginDir(packRoot, toolId), 'tool-definition.json');
  } catch {
    return null;
  }
}

export const P6_UI110_REQUIRED_CAPABILITY = Object.freeze({
  capabilityId: 'r-enrichment',
  version: '1.0.0',
  sha256: 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820',
  platform: 'macos-arm64',
});

export const P6_UI110_SOURCE_SENTINELS = Object.freeze({
  p6Observation: 'scripts/g0-rs-p6-ui110-observation.mjs',
  p6Driver: 'scripts/g0-rs-p6-ui110-driver.cjs',
  p6Gateway: 'scripts/g0-rs-p6-ui110-local-gateway.mjs',
  p6ObservationTest: 'test/g0-rs-p6-ui110-observation.test.mjs',
  p6GatewayTest: 'test/g0-rs-p6-ui110-local-gateway.test.mjs',
  baselineRouteTest: 'test/result-studio-route-baseline.test.mjs',
  electronPreload: 'src/preload.js',
  aiSettings: 'core/biof3-server/helpers/ai-settings.js',
  modelProfile: 'core/shared-backend/llm-providers/model-profile.js',
  providerTransport: 'core/shared-backend/llm-providers/deepseek.js',
  modelGateway: 'core/biof3-server/helpers/model-gateway.js',
  agentRoute: 'core/biof3-server/routes/ai-agent.js',
  agentRunner: 'core/biof3-server/agent-runner.js',
  redaction: 'core/shared-backend/redaction.js',
  diagnosticRedactionTest: 'test/diagnostic-redaction.test.mjs',
  capabilityProvisioning: 'core/shared-backend/capability-provisioning.js',
  capabilityBundles: 'core/shared-backend/capability-bundles.js',
  rLibraryResolver: 'core/shared-backend/r-libs-resolver.js',
  projectWorkspace: 'frontend/src/pages/project-workspace.tsx',
  centerPanel: 'frontend/src/components/workspace-panels/CenterPanel.tsx',
  rightPanel: 'frontend/src/components/workspace-panels/RightPanel.tsx',
  agentComposer: 'frontend/src/components/result-studio/ResultAgentComposer.tsx',
  agentComposerTest: 'frontend/src/components/result-studio/ResultAgentComposer.test.tsx',
  advancedEditPanel: 'frontend/src/components/result-studio/ResultEditPanel.tsx',
  advancedEditPanelTest: 'frontend/src/components/result-studio/ResultEditPanel.test.tsx',
  resultSurface: 'frontend/src/components/result-studio/ResultStudioSurface.tsx',
  activeArtifactProjection: 'frontend/src/components/result-studio/activeArtifactProjection.ts',
  activeArtifactProjectionTest: 'frontend/src/components/result-studio/activeArtifactProjection.test.ts',
  scientificViewer: 'frontend/src/components/result-studio/ScientificInteractionViewer.tsx',
  scientificViewerTest: 'frontend/src/components/result-studio/ScientificInteractionViewer.test.tsx',
  agentEditBridge: 'frontend/src/lib/result-edit-agent-bridge.ts',
  copilotClient: 'frontend/src/components/copilot/copilotClient.ts',
  copilotClientTest: 'frontend/src/components/copilot/copilotClient.test.ts',
  conversationRunStore: 'frontend/src/components/copilot/conversationRunStore.ts',
  conversationRunStoreTest: 'frontend/src/components/copilot/conversationRunStore.test.ts',
  simpleChat: 'frontend/src/components/copilot/SimpleChat.tsx',
});

export const P6_UI110_SOURCE_FILES = Object.freeze({
  ...P5_SOURCE_FILES,
  ...P6_UI110_SOURCE_SENTINELS,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function assert(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function checkedSource(relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  const target = path.resolve(ROOT, normalized);
  assert(normalized && !path.isAbsolute(normalized) && !normalized.split('/').includes('..')
    && target.startsWith(ROOT + path.sep), 'p6_ui110_source_path_unsafe');
  assert(existsSync(target), 'p6_ui110_source_missing', { relative: normalized });
  return { relative: normalized, target };
}

export function getP6Ui110SourceBinding() {
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'p6_ui110_source_commit_unavailable');
  const sources = Object.fromEntries(Object.entries(P6_UI110_SOURCE_FILES).map(([key, file]) => [key, checkedSource(file)]));
  const sourceHashes = Object.fromEntries(Object.entries(sources).map(([key, source]) => [
    key,
    sha256(readFileSync(source.target)),
  ]));
  const sourcePaths = Object.values(sources).map((source) => source.relative);
  const trackedResult = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert(trackedResult.status === 0, 'p6_ui110_source_tree_unavailable');
  const changedResult = spawnSync(
    'git',
    ['diff', '--no-ext-diff', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert(changedResult.status === 0, 'p6_ui110_source_diff_unavailable');
  const trackedPaths = new Set(trackedResult.stdout.split('\0').filter(Boolean));
  const changedPaths = new Set(changedResult.stdout.split('\0').filter(Boolean));
  const sourceMismatches = sourcePaths.filter((relative) =>
    !trackedPaths.has(relative) || changedPaths.has(relative));
  const bindingDigest = stableHash({
    sourceCommit,
    sourceFiles: P6_UI110_SOURCE_FILES,
    sourceHashes,
  });
  return {
    sourceCommit,
    sourceFiles: P6_UI110_SOURCE_FILES,
    sourceHashes,
    bindingDigest,
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

const secretKey = /(?:authorization|cookie|token|password|secret|api[_-]?key|credential|private[_-]?key|access[_-]?key|session)/i;
const internalId = /(?:^|[^A-Za-z0-9])(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]+/;

export function assertSanitizedP6Ui110Evidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP6Ui110Evidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (secretKey.test(key) && key !== 'qualificationEligible') {
        throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      }
      assertSanitizedP6Ui110Evidence(child, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error(`URI leaked at ${pointer}`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^(?:~[\\/]|\\\\)/.test(value)) {
    throw new Error(`absolute path leaked at ${pointer}`);
  }
  if (value.includes('..')) throw new Error(`parent path leaked at ${pointer}`);
  if (internalId.test(value)) throw new Error(`internal id leaked at ${pointer}`);
  return true;
}

export function assertP6Ui110EvidenceWritable(evidence) {
  if (evidence?.sourceCommitMatchesSourceHashes !== true) {
    const error = new Error('refusing_to_write_unbound_p6_ui110_evidence');
    error.code = 'p6_ui110_source_binding_not_current';
    throw error;
  }
  if (evidence?.sourceBindingStableDuringObservation !== true) {
    const error = new Error('refusing_to_write_source_changed_during_p6_ui110_observation');
    error.code = 'p6_ui110_source_binding_changed_during_observation';
    throw error;
  }
  if (evidence?.passed !== true) {
    const detail = {
      rendererPassed: evidence?.renderer?.passed === true,
      publicProjectionAudit: evidence?.renderer?.publicProjectionAudit || null,
      publicProjectionDiagnostics: evidence?.renderer?.publicProjectionDiagnostics || null,
      truth: evidence?.truth ? {
        allCandidateCohortsComplete: evidence.truth.allCandidateCohortsComplete === true,
        allCandidateRevisionsValid: evidence.truth.allCandidateRevisionsValid === true,
        allCandidateJobsArtifactValid: evidence.truth.allCandidateJobsArtifactValid === true,
        allCandidateValidatorProofsPresent: evidence.truth.allCandidateValidatorProofsPresent === true,
        allCandidatePhysicalBytesExact: evidence.truth.allCandidatePhysicalBytesExact === true,
        allStageCorrelationsExact: evidence.truth.allStageCorrelationsExact === true,
        volcanoRenderExact: evidence.truth.volcanoRenderProof?.exact === true,
        heatmapPresentationExact: evidence.truth.heatmapPresentationProof?.exact === true,
        heatmapScientificExact: evidence.truth.heatmapScientificProof?.exact === true,
        thresholdSemanticExact: evidence.truth.thresholdSemanticProof?.exact === true,
        enrichmentExact: evidence.truth.enrichmentProof?.exact === true,
      } : null,
    };
    const error = new Error(`refusing_to_write_failed_p6_ui110_evidence ${JSON.stringify(detail)}`);
    error.code = 'p6_ui110_evidence_not_passed';
    error.detail = detail;
    throw error;
  }
  assertSanitizedP6Ui110Evidence(evidence);
  return true;
}

export function writeP6Ui110Evidence(evidence, {
  makeDirectory = mkdirSync,
  write = writeFileSync,
} = {}) {
  assertP6Ui110EvidenceWritable(evidence);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  makeDirectory(path.dirname(EVIDENCE_PATH), { recursive: true });
  write(EVIDENCE_PATH, serialized);
  return { bytes: Buffer.byteLength(serialized), digest: sha256(serialized) };
}

async function findFreeLoopbackPort(excluded = new Set()) {
  let attempts = 0;
  while (attempts < 10) {
    attempts += 1;
    // The listener is released immediately before the child process starts.
    // `--strictPort` below remains the authoritative race detector.
    // This allocation merely keeps an existing desktop development session out
    // of the disposable P6 trace.
     
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const selected = typeof address === 'object' && address ? address.port : null;
        probe.close(() => resolve(selected));
      });
    });
    if (Number.isInteger(port) && port > 0 && !excluded.has(port)) return port;
  }
  throw new Error('could not allocate distinct disposable loopback ports');
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`required local port ${port} is already in use`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`renderer process exited before ready (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`renderer did not become ready: ${last}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runElectron(configPath, resultPath, { onSpawn, environment = {} } = {}) {
  const stderr = [];
  const child = spawn(ELECTRON_PATH, [DRIVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...environment,
      BIOF3_P6_UI110_DRIVER_CONFIG: configPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  onSpawn?.(child);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    if (stderr.join('').length > 12_000) stderr.splice(0, stderr.length - 4);
  });
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });
  if (exit.code !== 0) {
    const persisted = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
    throw new Error(`Electron UI-110 observation failed (${JSON.stringify(exit)}): ${persisted?.error || stderr.join('').slice(-4_000)}`);
  }
  assert(existsSync(resultPath), 'p6_ui110_driver_result_missing');
  return JSON.parse(readFileSync(resultPath, 'utf8'));
}

function writeDisposableAiSettings(env, gatewayBaseUrl) {
  const profileId = 'p6-ui110-scripted';
  const profile = {
    id: profileId,
    label: 'P6 UI-110 scripted local adapter',
    provider: 'openai-compatible',
    protocol: 'openai-compatible',
    model: 'p6-ui110-scripted',
    baseUrl: gatewayBaseUrl,
    credentialRef: 'provider:openai-compatible',
    capabilities: ['chat', 'streaming', 'tools'],
    roles: ['chat', 'agent', 'planner', 'summary', 'report', 'explanation'],
    parameters: {},
  };
  const settings = {
    chat_model_presets: [{
      id: profileId,
      label: profile.label,
      provider: profile.provider,
      model: profile.model,
      baseUrl: gatewayBaseUrl,
    }],
    active_chat_model_id: profileId,
    llm_provider: 'openai-compatible',
    model_profiles: [profile],
    model_role_bindings: {
      chat: profileId,
      agent: profileId,
      planner: profileId,
      summary: profileId,
      report: profileId,
      explanation: profileId,
    },
    model_fallback_enabled: false,
  };
  const settingsPath = path.join(env.BIOF3_LOCAL_DATA_DIR, 'ai-settings.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function normalizeCapabilitySha256(value) {
  return String(value || '').replace(/^sha256:/i, '').trim().toLowerCase();
}

/**
 * P6 is a product-flow trace, not a capability-download test. The required
 * GO/KEGG library must already be locally provisioned and must match the
 * shipped registry descriptor before its files are cloned into the disposable
 * runtime. This preserves a no-network scientific-editing trace while keeping
 * capability installation as a separate product concern.
 */
export function inspectP6Ui110LocalCapability(runtimesDir) {
  const rawRoot = String(runtimesDir || '').trim();
  assert(rawRoot && path.isAbsolute(rawRoot), 'p6_ui110_local_capability_root_missing');
  const root = path.resolve(rawRoot);
  assert(existsSync(root), 'p6_ui110_local_capability_root_missing');
  const ledgerPath = path.join(root, 'harness-provisioning.json');
  assert(existsSync(ledgerPath), 'p6_ui110_local_capability_ledger_missing');
  const ledger = parseJson(readFileSync(ledgerPath, 'utf8'), null);
  const entry = ledger?.capabilities?.[P6_UI110_REQUIRED_CAPABILITY.capabilityId];
  assert(entry?.version === P6_UI110_REQUIRED_CAPABILITY.version,
    'p6_ui110_local_capability_version_mismatch');
  assert(normalizeCapabilitySha256(entry.sha256) === P6_UI110_REQUIRED_CAPABILITY.sha256,
    'p6_ui110_local_capability_sha256_mismatch');
  const installDir = path.join(
    root,
    'capabilities',
    P6_UI110_REQUIRED_CAPABILITY.capabilityId,
    P6_UI110_REQUIRED_CAPABILITY.version,
  );
  const manifestPath = path.join(installDir, 'bundle-manifest.json');
  assert(existsSync(installDir) && existsSync(manifestPath), 'p6_ui110_local_capability_install_missing');
  const manifest = parseJson(readFileSync(manifestPath, 'utf8'), null);
  assert(manifest?.bundleId === P6_UI110_REQUIRED_CAPABILITY.capabilityId
    && manifest?.bundleVersion === P6_UI110_REQUIRED_CAPABILITY.version
    && manifest?.platform === P6_UI110_REQUIRED_CAPABILITY.platform,
  'p6_ui110_local_capability_manifest_mismatch');
  return {
    ready: true,
    capabilityId: P6_UI110_REQUIRED_CAPABILITY.capabilityId,
    version: P6_UI110_REQUIRED_CAPABILITY.version,
    sha256: P6_UI110_REQUIRED_CAPABILITY.sha256,
    packageCount: Number.isInteger(manifest.packageCount) ? manifest.packageCount : null,
    manifestSha256: sha256(readFileSync(manifestPath)),
    installDir,
  };
}

export function stageP6Ui110LocalCapability(env, sourceRuntimesDir = process.env[LOCAL_RUNTIMES_ENV]) {
  const source = inspectP6Ui110LocalCapability(sourceRuntimesDir);
  const targetRuntimesDir = path.join(env.BIOF3_LOCAL_DATA_DIR, 'runtimes');
  const targetInstallDir = path.join(
    targetRuntimesDir,
    'capabilities',
    P6_UI110_REQUIRED_CAPABILITY.capabilityId,
    P6_UI110_REQUIRED_CAPABILITY.version,
  );
  cpSync(source.installDir, targetInstallDir, {
    recursive: true,
    force: true,
    dereference: true,
    mode: fsConstants.COPYFILE_FICLONE,
  });
  const stagedLedger = {
    schemaVersion: 1,
    capabilities: {
      [P6_UI110_REQUIRED_CAPABILITY.capabilityId]: {
        capabilityId: P6_UI110_REQUIRED_CAPABILITY.capabilityId,
        kind: 'bundle',
        version: P6_UI110_REQUIRED_CAPABILITY.version,
        sha256: P6_UI110_REQUIRED_CAPABILITY.sha256,
        installDir: targetInstallDir,
        provenance: 'p6_verified_preprovisioned_local_dependency',
      },
    },
  };
  mkdirSync(targetRuntimesDir, { recursive: true });
  writeFileSync(path.join(targetRuntimesDir, 'harness-provisioning.json'), `${JSON.stringify(stagedLedger, null, 2)}\n`, { mode: 0o600 });
  return {
    ready: true,
    capabilityId: source.capabilityId,
    version: source.version,
    sha256: source.sha256,
    packageCount: source.packageCount,
    manifestSha256: source.manifestSha256,
    source: 'verified_preprovisioned_local_dependency',
    networkAccessDuringTrace: 'none',
  };
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function sameSet(left, right) {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function canonicalIds(values) {
  const list = values == null ? [] : Array.isArray(values) ? values : [values];
  return [...new Set(list
    .map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function changeSetCandidateRefs(changeSet) {
  return canonicalIds(changeSet?.candidateArtifactRefs
    || parseJson(changeSet?.candidate_artifact_refs_json, []));
}

function changeSetJobRefs(changeSet) {
  return canonicalIds(changeSet?.jobRefs || parseJson(changeSet?.job_refs_json, []));
}

function revisionValue(revision, camel, snake) {
  return revision?.[camel] ?? revision?.[snake] ?? null;
}

/**
 * Public stage correlation. Raw product identifiers stay inside the disposable
 * runtime; canonical evidence stores only this content-addressed projection.
 */
export function buildP6Ui110ObjectBinding(changeSet, revisions = []) {
  const changeSetId = String(changeSet?.changeSetId || changeSet?.change_set_id || '').trim();
  const revisionIds = changeSetCandidateRefs(changeSet).length > 0
    ? changeSetCandidateRefs(changeSet)
    : canonicalIds(revisions.map((revision) => revisionValue(revision, 'revisionId', 'revision_id')));
  const jobIds = changeSetJobRefs(changeSet).length > 0
    ? changeSetJobRefs(changeSet)
    : canonicalIds(revisions.map((revision) => revisionValue(revision, 'toolJobId', 'tool_job_id')));
  assert(changeSetId && revisionIds.length > 0 && jobIds.length > 0,
    'p6_ui110_stage_binding_incomplete');
  const identity = { changeSetId, revisionIds, jobIds };
  return {
    objectDigest: stableHash(identity),
    changeSetDigest: stableHash(changeSetId),
    revisionSetDigest: stableHash(revisionIds),
    jobSetDigest: stableHash(jobIds),
    revisionCount: revisionIds.length,
    jobCount: jobIds.length,
    status: String(changeSet?.status || ''),
  };
}

function jobObjectBinding(job) {
  const result = parseJson(job?.result_json, job?.result || {});
  const artifactIds = canonicalIds((result?.artifacts || []).map((artifact) => artifact?.id));
  const jobId = String(job?.id || '').trim();
  assert(jobId && artifactIds.length > 0, 'p6_ui110_job_binding_incomplete');
  return {
    objectDigest: stableHash({ jobId, artifactIds }),
    jobDigest: stableHash(jobId),
    artifactSetDigest: stableHash(artifactIds),
    artifactCount: artifactIds.length,
    status: String(job?.status || ''),
  };
}

function selectionObjectBinding(selection) {
  const selectionId = String(selection?.selection_id || '').trim();
  const revisionId = String(selection?.revision_id || '').trim();
  const artifactId = String(selection?.artifact_id || '').trim();
  const entityIdsHash = String(selection?.entity_ids_hash || '').trim();
  const entityIdCount = Number(selection?.entity_id_count);
  const entityIds = canonicalIds(parseJson(selection?.entity_ids_json, []));
  const identity = { selectionId, revisionId, artifactId, entityIdsHash, entityIdCount };
  const exact = Boolean(selectionId && revisionId && artifactId
    && selection?.entity_type === 'gene' && selection?.entity_ids_truncated === 0
    && Number.isInteger(entityIdCount) && entityIdCount > 0 && entityIds.length === entityIdCount
    && entityIdsHash === stableHash(entityIds));
  return {
    objectDigest: stableHash(identity),
    selectionDigest: stableHash(selectionId),
    revisionDigest: stableHash(revisionId),
    artifactDigest: stableHash(artifactId),
    entityIdsHash,
    entitySetDigest: stableHash(entityIds),
    entityCount: entityIdCount,
    exact,
  };
}

function containedPath(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** Verify one immutable Revision against both physical bytes and Job provenance. */
export function verifyP6Ui110ArtifactBytes({ workspaceRoot, revision, job }) {
  const root = realpathSync(workspaceRoot);
  const outputPath = String(revisionValue(revision, 'outputPath', 'output_path') || '');
  assert(outputPath && !path.isAbsolute(outputPath) && !outputPath.split(/[\\/]/).includes('..'),
    'p6_ui110_revision_output_path_unsafe');
  const physicalPath = realpathSync(path.resolve(root, outputPath));
  assert(containedPath(root, physicalPath) && statSync(physicalPath).isFile(),
    'p6_ui110_revision_output_missing');
  const physicalSha256 = sha256(readFileSync(physicalPath));
  const expectedSha256 = String(revisionValue(revision, 'outputHash', 'output_hash') || '');
  const artifactId = String(revisionValue(revision, 'artifactId', 'artifact_id') || '');
  const result = parseJson(job?.result_json, job?.result || {});
  const provenance = result?.executionProvenance || null;
  const resultArtifacts = (result?.artifacts || []).filter((artifact) => artifact?.id === artifactId);
  const provenanceArtifacts = (provenance?.artifacts || [])
    .filter((artifact) => artifact?.id === artifactId);
  let resultArtifactPath = null;
  try { resultArtifactPath = realpathSync(resultArtifacts[0]?.path); } catch {}
  const exact = SHA256_PATTERN.test(expectedSha256)
    && physicalSha256 === expectedSha256
    && resultArtifacts.length === 1
    && provenanceArtifacts.length === 1
    && resultArtifactPath === physicalPath
    && (!resultArtifacts[0]?.sha256 || resultArtifacts[0].sha256 === physicalSha256)
    && provenanceArtifacts[0]?.sha256 === physicalSha256
    && verifyExecutionProvenance(provenance).ok
    && provenance.toolJobId === job?.id
    && provenance.projectId === revisionValue(revision, 'projectId', 'project_id')
    && result?.artifactTruth?.status === 'valid'
    && result.artifactTruth.blocking !== true;
  return {
    exact,
    artifactId,
    physicalSha256,
    recordedSha256: expectedSha256,
    resultArtifactCount: resultArtifacts.length,
    provenanceArtifactCount: provenanceArtifacts.length,
  };
}

function admittedFormalArtifactIds(job) {
  const toolId = String(job?.tool_id || job?.toolId || '').trim();
  const descriptorFile = admittedDescriptorFile(toolId);
  if (!descriptorFile) return null;
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8'));
  const result = parseJson(job?.result_json, job?.result || {});
  const actualIds = new Set((result?.artifacts || []).map((artifact) => artifact?.id).filter(Boolean));
  const declared = descriptor?.resultStudio?.artifacts;
  if (!Array.isArray(declared) || declared.length === 0) return null;
  return declared
    .filter((artifact) => artifact?.required !== false || actualIds.has(artifact.id))
    .map((artifact) => artifact.id)
    .sort();
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else current += char;
  }
  values.push(current);
  return values;
}

function readSquareMatrix(filePath, expectedSize) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const header = lines.length > 0 ? splitCsvLine(lines[0]) : [];
  const rows = lines.slice(1).map(splitCsvLine);
  const columnIds = header.slice(1).map((value) => String(value || '').trim());
  const rowIds = rows.map((values) => String(values[0] || '').trim());
  const exact = Number.isInteger(expectedSize) && expectedSize > 0
    && rows.length === expectedSize && columnIds.length === expectedSize
    && rowIds.length === expectedSize && rows.every((values) => values.length === expectedSize + 1)
    && rowIds.every(Boolean) && columnIds.every(Boolean)
    && new Set(rowIds).size === expectedSize && new Set(columnIds).size === expectedSize
    && sameSet([...rowIds].sort(), [...columnIds].sort());
  return {
    exact,
    rowCount: rows.length,
    columnCount: columnIds.length,
    rowSetDigest: stableHash([...rowIds].sort()),
    columnSetDigest: stableHash([...columnIds].sort()),
    valueDigest: stableHash(rows.map((row) => row.slice(1))),
  };
}

function isPng(bytes) {
  return bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !isPng(bytes) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function pngText(bytes, keyword) {
  if (!isPng(bytes)) return null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === 'tEXt') {
      const data = bytes.subarray(start, end);
      const separator = data.indexOf(0);
      if (separator > 0 && data.subarray(0, separator).toString('latin1') === keyword) {
        return data.subarray(separator + 1).toString('latin1');
      }
    }
    offset = end + 4;
  }
  return null;
}

function renderContractFromPng(filePath) {
  const bytes = readFileSync(filePath);
  const raw = pngText(bytes, 'BioF3RenderContract');
  if (!raw) return { contract: null, dimensions: pngDimensions(bytes) };
  try { return { contract: JSON.parse(raw), dimensions: pngDimensions(bytes) }; }
  catch { return { contract: null, dimensions: pngDimensions(bytes) }; }
}

function renderContractFromSvg(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/<metadata\s+id="biof3-render-contract"\s+data-json-hex="([a-f0-9]+)"\s*\/>/i);
  if (!match || match[1].length % 2 !== 0) return null;
  try { return JSON.parse(Buffer.from(match[1], 'hex').toString('utf8')); } catch { return null; }
}

function openReadonlyDatabase(dbPath) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(ROOT, 'core/biof3-server'), ROOT],
  }));
  return new Database(dbPath, { readonly: true });
}

function projectTruthSnapshot(dbPath, projectId) {
  const sqlite = openReadonlyDatabase(dbPath);
  try {
    const jobs = sqlite.prepare(`SELECT id, tool_id, status, result_json FROM tool_jobs WHERE project_id=?`).all(projectId);
    const changeSets = sqlite.prepare(`SELECT * FROM scientific_change_sets WHERE project_id=?`).all(projectId);
    const revisions = sqlite.prepare(`SELECT * FROM artifact_revisions WHERE project_id=?`).all(projectId);
    return {
      jobIds: new Set(jobs.map((row) => row.id)),
      changeSetIds: new Set(changeSets.map((row) => row.change_set_id)),
      revisionIds: new Set(revisions.map((row) => row.revision_id)),
    };
  } finally {
    sqlite.close();
  }
}

function revisionPhysicalPath(workspaceRoot, revision) {
  const root = realpathSync(workspaceRoot);
  const relative = String(revisionValue(revision, 'outputPath', 'output_path') || '');
  assert(relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'),
    'p6_ui110_revision_output_path_unsafe');
  const resolved = realpathSync(path.resolve(root, relative));
  assert(containedPath(root, resolved) && statSync(resolved).isFile(),
    'p6_ui110_revision_output_missing');
  return resolved;
}

function normalizedJobParams(job) {
  const result = parseJson(job?.result_json, job?.result || {});
  const params = result?.executionProvenance?.params?.normalized;
  return params && typeof params === 'object' && !Array.isArray(params) ? params : {};
}

function effectiveDeclaredJobParams(job) {
  const params = { ...normalizedJobParams(job) };
  const definitionPath = admittedDescriptorFile(job?.tool_id);
  if (!definitionPath) return params;
  const definition = parseJson(readFileSync(definitionPath, 'utf8'), {});
  const declared = definition?.resultStudio?.parameters || {};
  for (const [name, schema] of Object.entries(declared)) {
    if (!Object.hasOwn(params, name) && schema && Object.hasOwn(schema, 'default')) {
      params[name] = schema.default;
    }
  }
  return params;
}

function exactCohortPhysicalProof({ workspaceRoot, revisions, jobs }) {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const artifactProofs = revisions.map((revision) => {
    const jobId = revisionValue(revision, 'toolJobId', 'tool_job_id');
    const job = jobById.get(jobId);
    if (!job) return { exact: false, artifactId: revisionValue(revision, 'artifactId', 'artifact_id') };
    return verifyP6Ui110ArtifactBytes({ workspaceRoot, revision, job });
  });
  const formalJobs = canonicalIds(revisions.map((revision) =>
    revisionValue(revision, 'toolJobId', 'tool_job_id'))).map((jobId) => {
    const job = jobById.get(jobId);
    const expected = admittedFormalArtifactIds(job);
    const actual = revisions
      .filter((revision) => revisionValue(revision, 'toolJobId', 'tool_job_id') === jobId)
      .map((revision) => revisionValue(revision, 'artifactId', 'artifact_id'))
      .sort();
    return {
      exact: Array.isArray(expected) && sameSet(expected, actual),
      artifactCount: actual.length,
      formalSetDigest: stableHash(actual),
    };
  });
  const exact = artifactProofs.length > 0 && artifactProofs.every((proof) => proof.exact)
    && formalJobs.length > 0 && formalJobs.every((proof) => proof.exact);
  return {
    exact,
    artifactCount: artifactProofs.length,
    jobCount: formalJobs.length,
    physicalDigest: stableHash(artifactProofs.map((proof) => ({
      artifactId: proof.artifactId,
      physicalSha256: proof.physicalSha256 || null,
      exact: proof.exact,
    })).sort((left, right) => String(left.artifactId).localeCompare(String(right.artifactId)))),
    formalDigest: stableHash(formalJobs),
  };
}

function bindingMatches(left, right) {
  return Boolean(left?.objectDigest && right?.objectDigest && left.objectDigest === right.objectDigest
    && left.changeSetDigest === right.changeSetDigest
    && left.revisionSetDigest === right.revisionSetDigest
    && left.jobSetDigest === right.jobSetDigest
    && left.revisionCount === right.revisionCount
    && left.jobCount === right.jobCount);
}

function scientificSummaryMatchesCohort(summary, revisions, allRevisions) {
  if (!summary || !SHA256_PATTERN.test(summary.summaryDigest || '')
      || !Array.isArray(summary.artifacts) || summary.artifacts.length === 0) return false;
  const afterHashes = new Set(revisions.map((revision) => revision.output_hash).filter(Boolean));
  const revisionById = new Map(allRevisions.map((revision) => [revision.revision_id, revision]));
  const beforeHashes = new Set(revisions.flatMap((revision) =>
    parseJson(revision.parent_revision_ids_json, []).map((revisionId) => revisionById.get(revisionId)?.output_hash))
    .filter(Boolean));
  return summary.artifacts.every((artifact) =>
    SHA256_PATTERN.test(artifact.afterSha256 || '') && afterHashes.has(artifact.afterSha256)
      && (!artifact.beforeSha256 || beforeHashes.has(artifact.beforeSha256)));
}

function inspectP6Ui110Truth(dbPath, projectId, before, {
  workspaceRoot,
  renderer,
  changedLfc,
} = {}) {
  const sqlite = openReadonlyDatabase(dbPath);
  try {
    const allJobs = sqlite.prepare(`SELECT id, tool_id, status, result_json FROM tool_jobs WHERE project_id=?`).all(projectId);
    const allChangeSets = sqlite.prepare(`SELECT * FROM scientific_change_sets WHERE project_id=?`).all(projectId);
    const allRevisions = sqlite.prepare(`SELECT * FROM artifact_revisions WHERE project_id=?`).all(projectId);
    const allSelections = sqlite.prepare(`SELECT * FROM result_selection_contexts WHERE project_id=?`).all(projectId);
    const bindings = sqlite.prepare(`SELECT status, mode, git_dir FROM git_repository_bindings WHERE project_id=?`).all(projectId);
    const jobs = allJobs.filter((row) => !before.jobIds.has(row.id));
    const changeSets = allChangeSets.filter((row) => !before.changeSetIds.has(row.change_set_id));
    const revisions = allRevisions.filter((row) => !before.revisionIds.has(row.revision_id));
    const jobById = new Map(allJobs.map((row) => [row.id, row]));
    const revisionsByChangeSet = new Map();
    for (const revision of allRevisions) {
      const list = revisionsByChangeSet.get(revision.change_set_id) || [];
      list.push(revision);
      revisionsByChangeSet.set(revision.change_set_id, list);
    }
    const candidateChecks = changeSets.map((changeSet) => {
      const candidateRefs = parseJson(changeSet.candidate_artifact_refs_json, []);
      const jobRefs = parseJson(changeSet.job_refs_json, []);
      const summary = parseJson(changeSet.validation_summary_json, {});
      const cohort = revisionsByChangeSet.get(changeSet.change_set_id) || [];
      const candidateJobs = jobRefs.map((jobId) => jobById.get(jobId)).filter(Boolean);
      const validatorIds = Array.isArray(summary.validatorIds) ? summary.validatorIds : [];
      const validArtifactTruth = candidateJobs.every((job) => {
        const result = parseJson(job.result_json, {});
        return job.status === 'completed' && result?.artifactTruth?.status === 'valid' && result.artifactTruth.blocking !== true;
      });
      let physicalProof = { exact: false, artifactCount: 0, jobCount: 0, physicalDigest: null, formalDigest: null };
      try {
        physicalProof = exactCohortPhysicalProof({
          workspaceRoot,
          revisions: cohort,
          jobs: candidateJobs,
        });
      } catch {}
      return {
        changeSet,
        cohort,
        candidateJobs,
        validationSummary: summary,
        binding: buildP6Ui110ObjectBinding(changeSet, cohort),
        cohortComplete: candidateRefs.length > 0
          && sameSet(candidateRefs, cohort.map((revision) => revision.revision_id))
          && sameSet(jobRefs, [...new Set(cohort.map((revision) => revision.tool_job_id))]),
        revisionsValid: cohort.length > 0 && cohort.every((revision) => revision.validation_status === 'valid'
          && /^[a-f0-9]{64}$/.test(revision.output_hash || '')
          && /^[a-f0-9]{64}$/.test(revision.parameters_hash || '')),
        validatorProof: validatorIds.length > 0 && validatorIds.every((value) => typeof value === 'string' && value.length > 0),
        validArtifactTruth,
        physicalProof,
        candidateCommit: /^[a-f0-9]{40}$/.test(changeSet.candidate_commit || ''),
        impactLevel: typeof summary.impactLevel === 'string' ? summary.impactLevel : 'unknown',
        affectedScope: typeof summary.affectedScope === 'string' ? summary.affectedScope : 'unknown',
        affectedNodeCount: Number.isInteger(summary.affectedNodeCount) ? summary.affectedNodeCount : 0,
        executedNodeCount: Array.isArray(summary.executedNodeIds) ? summary.executedNodeIds.length : 0,
        status: changeSet.status,
        isRestore: String(changeSet.intent_ref || '').startsWith('restore:'),
      };
    });
    const gitDir = bindings.find((binding) => binding.status === 'ready')?.git_dir || null;
    const candidatePairs = changeSets
      .map((changeSet, index) => ({ changeSet, check: candidateChecks[index] }))
      .filter(({ check }) => check.candidateCommit);
    const candidateCommitsVerified = Boolean(gitDir) && candidatePairs.length > 0 && candidatePairs.every(({ changeSet }) => {
      try {
        execFileSync('git', [`--git-dir=${gitDir}`, 'cat-file', '-e', `${changeSet.candidate_commit}^{commit}`], { stdio: 'ignore' });
        return true;
      } catch { return false; }
    });
    const statusCounts = Object.fromEntries([...new Set(candidateChecks.map((check) => check.status))]
      .sort().map((status) => [status, candidateChecks.filter((check) => check.status === status).length]));
    const impactCounts = Object.fromEntries([...new Set(candidateChecks.map((check) => check.impactLevel))]
      .sort().map((impact) => [impact, candidateChecks.filter((check) => check.impactLevel === impact).length]));

    const exactStage = (driverBinding) => {
      const matches = candidateChecks.filter((check) => bindingMatches(check.binding, driverBinding));
      return matches.length === 1 ? matches[0] : null;
    };
    const volcanoStage = exactStage(renderer?.volcano?.lifecycleBinding?.candidate);
    const restoreStage = exactStage(renderer?.volcano?.lifecycleBinding?.restored);
    const heatmapPresentationStage = exactStage(renderer?.heatmap?.presentation?.lifecycleBinding?.candidate);
    const heatmapScientificStage = exactStage(renderer?.heatmap?.scientific?.lifecycleBinding?.candidate);
    const thresholdStage = exactStage(renderer?.threshold?.candidateBinding);
    const enrichmentCohortStage = exactStage(renderer?.enrichment?.cohortBinding);

    const volcanoRenderProof = (() => {
      if (!volcanoStage) return { exact: false };
      const job = volcanoStage.candidateJobs.find((entry) => entry.tool_id === 'volcano-plot');
      const pngRevision = volcanoStage.cohort.find((entry) => entry.artifact_id === 'volcano');
      const svgRevision = volcanoStage.cohort.find((entry) => entry.artifact_id === 'volcano_svg');
      if (!job || !pngRevision || !svgRevision) return { exact: false };
      try {
        const png = renderContractFromPng(revisionPhysicalPath(workspaceRoot, pngRevision));
        const svg = renderContractFromSvg(revisionPhysicalPath(workspaceRoot, svgRevision));
        const params = effectiveDeclaredJobParams(job);
        const requestedLabels = canonicalIds(String(params.label_genes || '').split(','));
        const selectedLabels = canonicalIds(png.contract?.selectedLabelGenes);
        const renderedLabels = canonicalIds(png.contract?.renderedLabelGenes);
        const selectionBinding = renderer?.volcano?.selectionBinding;
        const exact = volcanoStage.physicalProof.exact
          && png.contract && svg && stableHash(png.contract) === stableHash(svg)
          && selectionBinding?.exact === true
          && requestedLabels.length === renderer?.volcano?.selectedGenes
          && sameSet(requestedLabels, selectedLabels)
          && stableHash(selectedLabels) === selectionBinding.entitySetDigest
          && selectionBinding.entityIdsHash === selectionBinding.entitySetDigest
          && selectedLabels.every((gene) => renderedLabels.includes(gene))
          && png.contract.pointSize === params.point_size
          && png.contract.labelSize === params.label_size
          && png.contract.palette?.up === params.color_up
          && png.contract.palette?.down === params.color_down
          && png.dimensions?.width === Number(params.plot_width) * Number(params.export_dpi)
          && png.dimensions?.height === Number(params.plot_height) * Number(params.export_dpi);
        return {
          exact,
          selectedLabelCount: selectedLabels.length,
          renderedLabelCount: renderedLabels.length,
          labelSetDigest: stableHash(selectedLabels),
          renderContractDigest: stableHash(png.contract),
          width: png.dimensions?.width || null,
          height: png.dimensions?.height || null,
          dpi: png.contract?.dpi || null,
        };
      } catch { return { exact: false }; }
    })();

    const heatmapProof = (stage, kind) => {
      if (!stage) return { exact: false };
      const job = stage.candidateJobs.find((entry) => entry.tool_id === 'gene-correlation');
      const matrixRevision = stage.cohort.find((entry) => entry.artifact_id === 'corr_matrix');
      const imageRevision = stage.cohort.find((entry) => entry.artifact_id === 'heatmap');
      if (!job || !matrixRevision || !imageRevision) return { exact: false };
      try {
        const params = normalizedJobParams(job);
        const expectedSize = Number(params.top_n);
        const matrix = readSquareMatrix(revisionPhysicalPath(workspaceRoot, matrixRevision), expectedSize);
        const rendered = renderContractFromPng(revisionPhysicalPath(workspaceRoot, imageRevision));
        const parentIds = parseJson(matrixRevision.parent_revision_ids_json, []);
        const parent = parentIds.map((revisionId) => allRevisions.find((entry) => entry.revision_id === revisionId))
          .find((entry) => entry?.artifact_id === 'corr_matrix');
        const matrixChanged = Boolean(parent?.output_hash && parent.output_hash !== matrixRevision.output_hash);
        const presentationExact = kind === 'presentation'
          && !matrixChanged
          && params.show_correlation_values === true
          && rendered.contract?.showCorrelationValues === true
          && rendered.contract?.displayedCorrelationValueCount === matrix.rowCount * matrix.columnCount;
        const scientificExact = kind === 'scientific'
          && matrixChanged && params.method === 'spearman';
        return {
          exact: stage.physicalProof.exact && matrix.exact && Boolean(rendered.contract)
            && (presentationExact || scientificExact),
          kind,
          method: typeof params.method === 'string' ? params.method : null,
          rowCount: matrix.rowCount,
          columnCount: matrix.columnCount,
          rowSetDigest: matrix.rowSetDigest,
          columnSetDigest: matrix.columnSetDigest,
          matrixValueDigest: matrix.valueDigest,
          matrixChanged,
          renderContractDigest: rendered.contract ? stableHash(rendered.contract) : null,
          displayedCorrelationValueCount: rendered.contract?.displayedCorrelationValueCount ?? null,
        };
      } catch { return { exact: false, kind }; }
    };
    const heatmapPresentationProof = heatmapProof(heatmapPresentationStage, 'presentation');
    const heatmapScientificProof = heatmapProof(heatmapScientificStage, 'scientific');

    const thresholdSemanticProof = (() => {
      if (!thresholdStage) return { exact: false };
      const toolIds = thresholdStage.candidateJobs.map((job) => job.tool_id).sort();
      const degJob = thresholdStage.candidateJobs.find((job) => job.tool_id === 'deseq2');
      const params = normalizedJobParams(degJob);
      const summaryExact = scientificSummaryMatchesCohort(
        renderer?.threshold?.scientificSummary,
        thresholdStage.cohort,
        allRevisions,
      );
      const visible = renderer?.threshold?.visibleScientificSummary;
      const exact = thresholdStage.physicalProof.exact
        && toolIds.includes('deseq2') && toolIds.includes('go-kegg')
        && Number(params.lfc_cutoff) === Number(changedLfc)
        && summaryExact
        && visible?.sectionCount >= 2 && SHA256_PATTERN.test(visible.displayDigest || '');
      return {
        exact,
        toolCount: toolIds.length,
        toolSetDigest: stableHash(toolIds),
        lfcCutoff: Number.isFinite(Number(params.lfc_cutoff)) ? Number(params.lfc_cutoff) : null,
        scientificArtifactCount: renderer?.threshold?.scientificSummary?.artifactCount || 0,
        scientificSummaryDigest: renderer?.threshold?.scientificSummary?.summaryDigest || null,
        visibleScientificSectionCount: visible?.sectionCount || 0,
        visibleScientificDigest: visible?.displayDigest || null,
      };
    })();

    const enrichmentJobMatches = jobs.filter((job) => {
      try {
        const binding = jobObjectBinding(job);
        const driver = renderer?.enrichment?.jobBinding;
        return binding.objectDigest === driver?.objectDigest
          && binding.jobDigest === driver?.jobDigest
          && binding.artifactSetDigest === driver?.artifactSetDigest
          && binding.artifactCount === driver?.artifactCount;
      } catch { return false; }
    });
    const enrichmentJob = enrichmentJobMatches.length === 1 ? enrichmentJobMatches[0] : null;
    const enrichmentFormalIds = enrichmentJob ? admittedFormalArtifactIds(enrichmentJob) : [];
    const goFormal = enrichmentFormalIds?.includes('go_bp_results') === true;
    const keggFormal = enrichmentFormalIds?.includes('kegg_results') === true;
    const enrichmentSelectionProof = (() => {
      const driver = renderer?.enrichment?.selectionBinding;
      if (!enrichmentJob || !driver?.objectDigest || driver.exact !== true) return { exact: false };
      const selectionMatches = allSelections.map((selection) => ({
        selection,
        binding: selectionObjectBinding(selection),
      })).filter((entry) => entry.binding.objectDigest === driver.objectDigest);
      if (selectionMatches.length !== 1) return { exact: false };
      const { selection, binding } = selectionMatches[0];
      const result = parseJson(enrichmentJob.result_json, {});
      const provenance = result?.executionProvenance || null;
      const lineageInputs = (provenance?.inputs || []).filter((input) => input?.lineage?.kind === 'selection');
      if (lineageInputs.length !== 1) return { exact: false };
      const input = lineageInputs[0];
      const lineage = input.lineage;
      let physicalInputSha256 = null;
      try {
        const resolvedInput = resolveExecutionInputPath({
          workspaceRoot,
          input,
          sourceParams: normalizedJobParams(enrichmentJob),
          provenance,
        });
        if (resolvedInput.path) {
          physicalInputSha256 = sha256(readFileSync(resolvedInput.path));
        }
      } catch {}
      const exact = binding.exact
        && binding.objectDigest === driver.objectDigest
        && binding.selectionDigest === driver.selectionDigest
        && binding.revisionDigest === driver.revisionDigest
        && binding.artifactDigest === driver.artifactDigest
        && binding.entityIdsHash === driver.entityIdsHash
        && binding.entitySetDigest === driver.entitySetDigest
        && binding.entityCount === driver.count
        && lineage.selectionId === selection.selection_id
        && lineage.selectionHash === selection.entity_ids_hash
        && lineage.sourceRevisionId === selection.revision_id
        && lineage.sourceArtifactId === selection.artifact_id
        && lineage.materializationHash === input.sha256
        && physicalInputSha256 === input.sha256
        && verifyExecutionProvenance(provenance).ok;
      return {
        exact,
        entityCount: binding.entityCount,
        entitySetDigest: binding.entitySetDigest,
        materializationDigest: physicalInputSha256,
        lineageKind: lineage.kind,
      };
    })();
    const enrichmentProof = {
      exact: Boolean(enrichmentJob && enrichmentCohortStage
        && enrichmentJob.status === 'completed'
        && enrichmentCohortStage.status === 'adopted'
        && enrichmentCohortStage.physicalProof.exact
        && enrichmentSelectionProof.exact
        && goFormal && renderer?.enrichment?.goTableVisible === true
        && (!keggFormal || renderer?.enrichment?.keggTableVisible === true)
        && renderer?.enrichment?.keggFormalArtifactPresent === keggFormal),
      formalArtifactCount: enrichmentFormalIds?.length || 0,
      formalArtifactSetDigest: stableHash(enrichmentFormalIds || []),
      goFormal,
      keggFormal,
      goVisible: renderer?.enrichment?.goTableVisible === true,
      keggVisible: renderer?.enrichment?.keggTableVisible === true,
      selection: enrichmentSelectionProof,
    };

    const restoreSourceDigest = restoreStage?.validationSummary?.restoredFromRevisionId
      ? stableHash(restoreStage.validationSummary.restoredFromRevisionId) : null;
    const stageCorrelations = {
      volcanoPresentation: Boolean(volcanoStage
        && volcanoStage.status === 'adopted'
        && bindingMatches(volcanoStage.binding, renderer?.volcano?.lifecycleBinding?.adoptedState)),
      volcanoRestore: Boolean(restoreStage && restoreStage.status === 'adopted'
        && restoreStage.isRestore
        && restoreSourceDigest === renderer?.volcano?.lifecycleBinding?.sourceRevisionDigest
        && renderer?.volcano?.lifecycleBinding?.reopened?.exactContext === true),
      heatmapPresentation: Boolean(heatmapPresentationStage
        && heatmapPresentationStage.status === 'reverted'
        && bindingMatches(heatmapPresentationStage.binding,
          renderer?.heatmap?.presentation?.lifecycleBinding?.revertedState)),
      heatmapScientific: Boolean(heatmapScientificStage
        && heatmapScientificStage.status === 'reverted'
        && bindingMatches(heatmapScientificStage.binding,
          renderer?.heatmap?.scientific?.lifecycleBinding?.revertedState)),
      thresholdSubgraph: Boolean(thresholdStage && thresholdStage.status === 'preview_ready'),
      enrichment: enrichmentProof.exact,
    };
    const allStageCorrelationsExact = Object.values(stageCorrelations).every(Boolean);
    return {
      newJobCount: jobs.length,
      newEnrichmentJobCount: jobs.filter((job) => job.tool_id === 'go-kegg' && job.status === 'completed').length,
      newChangeSetCount: changeSets.length,
      newRevisionCount: revisions.length,
      allCandidateCohortsComplete: candidateChecks.length >= 4 && candidateChecks.every((check) => check.cohortComplete),
      allCandidateRevisionsValid: candidateChecks.length >= 4 && candidateChecks.every((check) => check.revisionsValid),
      allCandidateJobsArtifactValid: candidateChecks.length >= 4 && candidateChecks.every((check) => check.validArtifactTruth),
      allCandidateValidatorProofsPresent: candidateChecks.length >= 4 && candidateChecks.every((check) => check.validatorProof),
      allCandidatePhysicalBytesExact: candidateChecks.length >= 4
        && candidateChecks.every((check) => check.physicalProof.exact),
      physicalArtifactCount: candidateChecks.reduce((sum, check) => sum + check.physicalProof.artifactCount, 0),
      physicalProofDigest: stableHash(candidateChecks.map((check) => ({
        objectDigest: check.binding.objectDigest,
        physicalDigest: check.physicalProof.physicalDigest,
        formalDigest: check.physicalProof.formalDigest,
        exact: check.physicalProof.exact,
      })).sort((left, right) => left.objectDigest.localeCompare(right.objectDigest))),
      gitBindingReady: bindings.some((binding) => binding.status === 'ready'),
      candidateCommitsVerified,
      impactCounts,
      statusCounts,
      presentationCandidateCount: candidateChecks.filter((check) => check.impactLevel === 'presentation_rerender').length,
      scientificCandidateCount: candidateChecks.filter((check) => ['scientific_recompute', 'data_transform', 'workflow_replan'].includes(check.impactLevel)).length,
      workflowSubgraphCandidateCount: candidateChecks.filter((check) => check.affectedScope === 'workflow_subgraph'
        && check.affectedNodeCount >= 2 && check.executedNodeCount >= 2).length,
      restoreChangeSetCount: candidateChecks.filter((check) => check.isRestore).length,
      stageCorrelations,
      allStageCorrelationsExact,
      volcanoRenderProof,
      heatmapPresentationProof,
      heatmapScientificProof,
      thresholdSemanticProof,
      enrichmentProof,
      proofDigest: stableHash(candidateChecks.map((check) => ({
        cohortComplete: check.cohortComplete,
        revisionsValid: check.revisionsValid,
        validatorProof: check.validatorProof,
        validArtifactTruth: check.validArtifactTruth,
        impactLevel: check.impactLevel,
        affectedScope: check.affectedScope,
        affectedNodeCount: check.affectedNodeCount,
        executedNodeCount: check.executedNodeCount,
        status: check.status,
        isRestore: check.isRestore,
      }))),
    };
  } finally {
    sqlite.close();
  }
}

function summarizeGatewayTrace(trace) {
  const byTool = Object.fromEntries([...new Set(trace.map((entry) => entry.toolName).filter(Boolean))]
    .sort().map((tool) => [tool, trace.filter((entry) => entry.toolName === tool).length]));
  const byKind = Object.fromEntries([...new Set(trace.map((entry) => entry.kind))]
    .sort().map((kind) => [kind, trace.filter((entry) => entry.kind === kind).length]));
  const byPhase = Object.fromEntries([...new Set(trace.map((entry) => entry.phase).filter(Boolean))]
    .sort().map((phase) => [phase, trace.filter((entry) => entry.phase === phase).length]));
  const byErrorCode = Object.fromEntries([...new Set(trace.map((entry) => entry.errorCode).filter(Boolean))]
    .sort().map((code) => [code, trace.filter((entry) => entry.errorCode === code).length]));
  return {
    requestCount: trace.length,
    toolCallCounts: byTool,
    requestKindCounts: byKind,
    requestPhaseCounts: byPhase,
    errorCodeCounts: byErrorCode,
    noRawMessagesPersisted: true,
  };
}

export async function observeP6Ui110({ writeEvidence = false, keep = false, show = false } = {}) {
  const sourceBindingAtStart = getP6Ui110SourceBinding();
  const backendPort = await findFreeLoopbackPort();
  const uiPort = await findFreeLoopbackPort(new Set([backendPort]));
  await assertPortFree(uiPort);
  await assertPortFree(backendPort);
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p6-ui110-'));
  const captureDir = path.join(root, 'ui-captures');
  const configPath = path.join(root, 'ui-driver-config.json');
  const resultPath = path.join(root, 'ui-driver-result.json');
  let runtime = null;
  let gateway = null;
  let vite = null;
  let electron = null;
  let localCapability = null;
  let cleaning = false;

  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    await stopChild(electron);
    await stopChild(vite);
    await gateway?.close();
    await runtime?.close({ removeRoot: true });
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    gateway = await startP6Ui110LocalGateway();
    runtime = await createP5LiveScientificRuntime({
      port: backendPort,
      beforeStart: ({ env }) => {
        const rendererOrigin = `http://127.0.0.1:${uiPort}`;
        env.BIOF3_RENDERER_DEV_URL = rendererOrigin;
        env.BIOF3_TRUSTED_DESKTOP_ORIGINS = rendererOrigin;
        localCapability = stageP6Ui110LocalCapability(env);
        writeDisposableAiSettings(env, gateway.baseUrl);
      },
    });
    const baselines = await prepareP5LiveScientificBaselines(runtime);
    const truthBefore = projectTruthSnapshot(runtime.env.BIOF3_DB_PATH, runtime.project.id);

    vite = spawn(process.execPath, [VITE_PATH, '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(`http://127.0.0.1:${uiPort}`, vite);

    mkdirSync(captureDir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({
      uiBaseUrl: `http://127.0.0.1:${uiPort}`,
      backendBaseUrl: `http://127.0.0.1:${backendPort}`,
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      outputDir: captureDir,
      resultPath,
      show,
      changedLfc: baselines.changedLfc,
      targets: {
        deg: {
          jobId: baselines.deg.jobId,
          artifact: baselines.deg.artifact,
          artifactFamilyId: baselines.deg.artifactFamilyId,
        },
        volcano: {
          jobId: baselines.volcano.jobId,
          artifact: baselines.volcano.artifact,
          artifactFamilyId: baselines.volcano.artifactFamilyId,
        },
        heatmap: {
          jobId: baselines.heatmap.jobId,
          artifact: baselines.heatmap.artifact,
          artifactFamilyId: baselines.heatmap.artifactFamilyId,
        },
      },
    })}\n`, { mode: 0o600 });

    let renderer;
    try {
      renderer = await runElectron(configPath, resultPath, {
        onSpawn: (child) => { electron = child; },
        environment: {
          BIOF3_DESKTOP: '1',
          R_SERVER_PORT: String(backendPort),
        },
      });
    } catch (error) {
      const summary = summarizeGatewayTrace(gateway.trace);
      throw new Error(`${error instanceof Error ? error.message : String(error)}; gatewayPhases=${JSON.stringify(summary.requestPhaseCounts)}; gatewayErrors=${JSON.stringify(summary.errorCodeCounts)}`);
    }
    const truth = inspectP6Ui110Truth(runtime.env.BIOF3_DB_PATH, runtime.project.id, truthBefore, {
      workspaceRoot: runtime.project.workspace_path,
      renderer,
      changedLfc: baselines.changedLfc,
    });
    const gatewayTrace = summarizeGatewayTrace(gateway.trace);
    const binding = getP6Ui110SourceBinding();
    const sourceBindingStableDuringObservation = sourceBindingAtStart.bindingDigest === binding.bindingDigest;
    const result = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P6 / P6-0 UI-110',
      qualificationEligible: false,
      classification: 'development_real_renderer_deterministic_local_adapter_non_provider_non_packaged',
      captureMode: 'single_parent_disposable_p5_runtime_vite_electron_agent_tool_protocol',
      adapter: {
        classification: P6_UI110_GATEWAY_CLASSIFICATION,
        networkAccess: 'none_for_model_adapter',
        realProviderClaim: false,
        packagedElectronClaim: false,
        trace: gatewayTrace,
      },
      executionCapability: localCapability,
      noSeedRuntime: {
        productLedgerStartedEmpty: runtime.noSeedPrecondition.seededTables.length === 0,
        localCapabilityWasPreprovisioned: localCapability?.ready === true,
        baselineArtifactFamilies: 4,
        stableSelectionFixtureCount: baselines.stableGeneIds.length,
      },
      ...binding,
      sourceBindingStableDuringObservation,
      sourceBindingObservation: {
        startDigest: sourceBindingAtStart.bindingDigest,
        endDigest: binding.bindingDigest,
      },
      renderer,
      truth,
    };
    result.passed = result.sourceCommitMatchesSourceHashes
      && sourceBindingStableDuringObservation
      && renderer.passed === true
      && localCapability?.ready === true
      && result.adapter.trace.toolCallCounts.result_studio_context >= 5
      && result.adapter.trace.toolCallCounts.result_edit_plan_in_context >= 4
      && result.adapter.trace.toolCallCounts.result_changeset_create_in_context >= 4
      && result.adapter.trace.toolCallCounts.result_enrichment_from_context >= 1
      && truth.newEnrichmentJobCount >= 1
      && truth.newChangeSetCount >= 5
      && truth.allCandidateCohortsComplete
      && truth.allCandidateRevisionsValid
      && truth.allCandidateJobsArtifactValid
      && truth.allCandidateValidatorProofsPresent
      && truth.allCandidatePhysicalBytesExact
      && truth.allStageCorrelationsExact
      && truth.volcanoRenderProof.exact
      && truth.heatmapPresentationProof.exact
      && truth.heatmapScientificProof.exact
      && truth.thresholdSemanticProof.exact
      && truth.enrichmentProof.exact
      && truth.gitBindingReady
      && truth.candidateCommitsVerified
      && truth.presentationCandidateCount >= 2
      && truth.scientificCandidateCount >= 2
      && truth.workflowSubgraphCandidateCount >= 1
      && truth.restoreChangeSetCount >= 1;
    assertSanitizedP6Ui110Evidence(result);

    if (writeEvidence) {
      assertP6Ui110EvidenceWritable(result);
      rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      cpSync(captureDir, SCREENSHOT_DIR, { recursive: true });
      writeP6Ui110Evidence(result);
    }
    return result;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (keep && runtime) {
      // Runtime owns its own root; keep is intentionally only diagnostic and
      // still does not expose that path in any evidence/result projection.
      await stopChild(electron);
      await stopChild(vite);
      await gateway?.close();
      await runtime.close({ removeRoot: false });
    } else {
      await cleanup();
    }
  }
}

async function main() {
  const writeEvidence = process.argv.includes('--write-evidence');
  const keep = process.argv.includes('--keep');
  const show = process.argv.includes('--show');
  const result = await observeP6Ui110({ writeEvidence, keep, show });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
