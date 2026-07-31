#!/usr/bin/env node

/**
 * G0-RS-P6 / P6-1a synthetic service integration fixture.
 *
 * This diagnostic exercises production service primitives against disposable
 * SQLite, managed Git, physical Artifacts and the background process. It is
 * deliberately non-qualifying: it is not the real P6 product acceptance, a
 * Provider run, packaged Electron evidence or an Electron renderer budget.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-result-studio/rs-p6-service-recovery-pressure-checkpoint.json');
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const {
  computeExecutionProvenanceHash,
  verifyExecutionProvenance,
} = require('../core/shared-backend/execution-provenance');
const {
  closeResultStudioBackground,
  runResultStudioBackground,
} = require('../core/shared-backend/result-studio-background');
const {
  evaluatePreviewResourceBudget,
  executeArtifactDeduplication,
  executeResultStudioGc,
  inspectResultStudioStorage,
  planArtifactDeduplication,
  planResultStudioGc,
  readTablePage,
} = require('../core/shared-backend/result-studio-lifecycle');

const ZERO_OID = '0'.repeat(40);
const PRESSURE_REVISION_COUNT = 200;
const LARGE_TABLE_ROWS = 100_000;
const SVG_ELEMENT_COUNT = 5_000;
const PNG_WIDTH = 1024;
const PNG_HEIGHT = 768;
const LONG_REPORT_MIN_BYTES = 1024 * 1024;
const PARAMETERS_RELATIVE_PATH = 'analysis/parameters/p6-pressure.json';
export const P6_SERVICE_FIXTURE_CLASSIFICATION = 'synthetic_service_integration_fixture_non_provider_non_packaged_non_qualifying';

export const P6_SERVICE_FIXTURE_BUDGETS = Object.freeze({
  backgroundRecoveryMs: 30_000,
  backgroundInspectionMs: 5_000,
  fullTableTraversalMs: 8_000,
  tablePageP95Ms: 100,
  storageInspectionMs: 2_000,
  serviceTraversalHeapGrowthBytes: 128 * 1024 * 1024,
});

export const P6_SERVICE_FIXTURE_SOURCE_FILES = Object.freeze({
  fixture: 'scripts/g0-rs-p6-recovery-acceptance.mjs',
  fixtureTest: 'test/g0-rs-p6-recovery-acceptance.test.mjs',
  lifecycle: 'core/shared-backend/result-studio-lifecycle.js',
  lifecycleTest: 'test/result-studio-lifecycle.test.mjs',
  background: 'core/shared-backend/result-studio-background.js',
  backgroundChild: 'core/shared-backend/result-studio-background-child.js',
  backgroundTest: 'test/result-studio-background.test.mjs',
  runtimeLease: 'core/shared-backend/result-studio-runtime-lease.js',
  changeSetService: 'core/shared-backend/result-changeset-service.js',
  changeSetServiceTest: 'test/result-changeset-service.test.mjs',
  repository: 'core/shared-backend/result-studio-repository.js',
  repositorySchema: 'core/shared-backend/result-studio-schema.js',
  contracts: 'core/shared-backend/result-studio-contracts.js',
  gitAdapter: 'core/shared-backend/git-adapter.js',
  gitBinding: 'core/shared-backend/git-repository-binding.js',
  resourceSnapshot: 'core/shared-backend/runtime-resource-snapshot.js',
  routes: 'core/r-server/routes/result-studio.js',
  routeBaselineTest: 'test/result-studio-route-baseline.test.mjs',
  resultClient: 'frontend/src/components/result-studio/resultStudioClient.ts',
  changeSetPanel: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
  changeSetPanelTest: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.test.tsx',
  packageScripts: 'package.json',
  impactMap: 'test/impact-map.json',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  return sha256(readFileSync(file));
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

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

export function getP6ServiceFixtureSourceBinding() {
  const sourceCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'p6_recovery_source_commit_unavailable');
  const sourceHashes = {};
  const sourcePaths = [];
  for (const [key, relative] of Object.entries(P6_SERVICE_FIXTURE_SOURCE_FILES)) {
    const target = path.resolve(ROOT, relative);
    assert(target.startsWith(ROOT + path.sep) && existsSync(target), 'p6_recovery_source_missing', { key });
    sourceHashes[key] = hashFile(target);
    sourcePaths.push(relative);
  }
  const tracked = git(['ls-tree', '-r', '--name-only', '-z', sourceCommit, '--', ...sourcePaths]);
  const changed = git(['diff', '--no-ext-diff', '--name-only', '-z', sourceCommit, '--', ...sourcePaths]);
  assert(tracked.status === 0 && changed.status === 0, 'p6_recovery_source_tree_unavailable');
  const trackedPaths = new Set(tracked.stdout.split('\0').filter(Boolean));
  const changedPaths = new Set(changed.stdout.split('\0').filter(Boolean));
  const sourceMismatches = sourcePaths.filter((relative) => !trackedPaths.has(relative) || changedPaths.has(relative));
  return {
    sourceCommit,
    sourceFiles: P6_SERVICE_FIXTURE_SOURCE_FILES,
    sourceHashes,
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
    bindingDigest: stableHash({ sourceCommit, sourceFiles: P6_SERVICE_FIXTURE_SOURCE_FILES, sourceHashes }),
  };
}

const unsafeKey = /(?:authorization|cookie|password|secret|api[_-]?key|credential|private[_-]?key|access[_-]?key|session)/i;
const internalId = /(?:^|[^A-Za-z0-9])(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]+/;

export function assertSanitizedP6ServiceFixtureEvidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP6ServiceFixtureEvidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (unsafeKey.test(key)) throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      assertSanitizedP6ServiceFixtureEvidence(child, `${pointer}.${key}`);
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function buildPressurePng(width = PNG_WIDTH, height = PNG_HEIGHT) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = x % 256;
      raw[offset + 1] = y % 256;
      raw[offset + 2] = (x + y) % 256;
      raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createLargeTable() {
  const lines = new Array(LARGE_TABLE_ROWS + 1);
  lines[0] = 'gene,value,group';
  for (let index = 0; index < LARGE_TABLE_ROWS; index += 1) {
    lines[index + 1] = `GENE${String(index + 1).padStart(6, '0')},${(index % 1000) / 10},${index % 2 ? 'B' : 'A'}`;
  }
  return `${lines.join('\n')}\n`;
}

function createComplexSvg() {
  const marks = [];
  for (let index = 0; index < SVG_ELEMENT_COUNT; index += 1) {
    marks.push(`<circle cx="${index % 1000}" cy="${Math.floor(index / 10) % 700}" r="2" data-index="${index}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><g>${marks.join('')}</g></svg>`;
}

function createLongReport() {
  const line = 'Observed recovery state, preserved content, automatic handling, and next action.\n';
  return `# P6 recovery report\n\n${line.repeat(Math.ceil(LONG_REPORT_MIN_BYTES / Buffer.byteLength(line)) + 1)}`;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] || 0;
}

function createDatabase(databasePath, workspaceRoot, projectId) {
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 10000');
  sqlite.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_path TEXT NOT NULL);
    CREATE TABLE tool_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      params_json TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      project_id TEXT
    );
  `);
  ensureResultStudioSchema(sqlite);
  sqlite.prepare('INSERT INTO projects(id, workspace_path) VALUES (?, ?)').run(projectId, workspaceRoot);
  return sqlite;
}

function insertCompletedJob(sqlite, {
  id, projectId, artifactId, file, digest, scriptFile, scriptHash, parameters,
}) {
  const executionProvenance = {
    executionProvenanceVersion: 1,
    toolJobId: id,
    projectId,
    script: { snapshotPath: scriptFile, sha256: scriptHash },
    artifacts: [{ id: artifactId, sha256: digest }],
    inputs: [],
    params: { normalized: parameters },
  };
  executionProvenance.provenanceHash = computeExecutionProvenanceHash(executionProvenance);
  const result = {
    artifactTruth: { status: 'valid', blocking: false },
    artifacts: [{ id: artifactId, path: file, sha256: digest }],
    executionProvenance,
  };
  sqlite.prepare(`INSERT INTO tool_jobs(id, user_id, tool_id, params_json, status, result_json, project_id)
      VALUES (?, 'local-user', 'p6-pressure-fixture', ?, 'completed', ?, ?)`)
    .run(id, JSON.stringify(parameters), JSON.stringify(result), projectId);
}

function revisionInput({
  revisionId,
  projectId,
  familyId,
  artifactId,
  parentRevisionId = null,
  sourceCommit,
  scriptHash,
  parametersHash,
  toolJobId,
  relativePath,
  digest,
  changeSetId,
}) {
  return {
    revisionId,
    projectId,
    artifactFamilyId: familyId,
    artifactId,
    parentRevisionIds: parentRevisionId ? [parentRevisionId] : [],
    sourceCommit,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/p6-pressure.R',
      sha256: scriptHash,
      entryPoint: 'p6-pressure.R',
      artifactId,
      rendererId: `p6-pressure:${artifactId}`,
      language: 'r',
      origin: 'project_materialized',
    },
    inputArtifactRefs: [],
    parametersRef: PARAMETERS_RELATIVE_PATH,
    parametersHash,
    toolJobId,
    outputPath: relativePath,
    outputHash: digest,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    changeSetId,
  };
}

function registerSingleRevision({ repository, adapter, projectId, sourceCommit, input, adopt = true }) {
  const workingBranchRef = `refs/heads/biof3/changeset/${input.changeSetId}`;
  repository.createChangeSet({
    changeSetId: input.changeSetId,
    projectId,
    baseCommit: sourceCommit,
    workingBranchRef,
    createdBy: 'agent',
    parentArtifactRefs: input.parentRevisionIds,
  });
  repository.transitionChangeSet({ changeSetId: input.changeSetId, to: 'running' });
  repository.appendRevision(input);
  if (!adapter.revParse(workingBranchRef)) {
    adapter.updateRefCas({ ref: workingBranchRef, newCommit: sourceCommit, expectedOld: ZERO_OID });
  }
  repository.transitionChangeSet({
    changeSetId: input.changeSetId,
    to: 'preview_ready',
    candidateCommit: sourceCommit,
    jobRefs: [input.toolJobId],
    candidateArtifactRefs: [input.revisionId],
    validationSummary: {
      artifactTruthStatus: 'valid',
      formalArtifactCount: 1,
      formalArtifactCohort: [{
        toolJobId: input.toolJobId,
        artifactId: input.artifactId,
        outputHash: input.outputHash,
      }],
    },
  });
  if (adopt) repository.adoptChangeSet({ changeSetId: input.changeSetId, candidateCommit: sourceCommit });
}

function createPressureFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p6-recovery-'));
  const workspaceRoot = path.join(root, 'workspace');
  const databasePath = path.join(root, 'biof3.db');
  mkdirSync(workspaceRoot, { recursive: true });
  const projectId = 'p_p6_recovery_runtime';
  let sqlite = createDatabase(databasePath, workspaceRoot, projectId);
  let repository = createResultStudioRepository(sqlite, { ensureSchema: false });
  const binding = bindProjectRepository({
    workspaceRoot,
    projectId,
    preferManaged: true,
    allowExistingRepository: false,
    createManagedIfMissing: true,
  });
  assert(binding.status === 'ready' && binding.mode === 'managed', 'p6_recovery_managed_git_unavailable');
  let adapter = binding.adapter;
  const script = 'result <- "p6 recovery pressure"\n';
  const scriptHash = sha256(script);
  const parameters = { contrast: 'A_vs_B', adjustedPValueThreshold: 0.05 };
  const parametersContent = `${JSON.stringify(parameters)}\n`;
  const parametersHash = sha256(parametersContent);
  const scriptFile = path.join(workspaceRoot, 'analysis/scripts/p6-pressure.R');
  const parametersFile = path.join(workspaceRoot, PARAMETERS_RELATIVE_PATH);
  mkdirSync(path.dirname(scriptFile), { recursive: true });
  mkdirSync(path.dirname(parametersFile), { recursive: true });
  writeFileSync(scriptFile, script);
  writeFileSync(parametersFile, parametersContent);
  const sourceCommit = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main',
    expectedOld: ZERO_OID,
    message: 'P6 recovery pressure source',
    files: [
      { path: 'analysis/scripts/p6-pressure.R', content: script },
      { path: PARAMETERS_RELATIVE_PATH, content: parametersContent },
    ],
  }).commit;

  const artifacts = [
    { key: 'largeTable', familyId: 'family_large_table', artifactId: 'large_table', extension: 'csv', bytes: Buffer.from(createLargeTable()) },
    { key: 'complexSvg', familyId: 'family_complex_svg', artifactId: 'complex_svg', extension: 'svg', bytes: Buffer.from(createComplexSvg()) },
    { key: 'complexPng', familyId: 'family_complex_png', artifactId: 'complex_png', extension: 'png', bytes: buildPressurePng() },
    { key: 'longReport', familyId: 'family_long_report', artifactId: 'long_report', extension: 'md', bytes: Buffer.from(createLongReport()) },
  ];
  const artifactTruth = {};
  for (const [index, artifact] of artifacts.entries()) {
    const relativePath = `results/pressure/base/${artifact.artifactId}.${artifact.extension}`;
    const file = path.join(workspaceRoot, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, artifact.bytes);
    const digest = hashFile(file);
    const toolJobId = `tj_p6_base_${index}`;
    const changeSetId = `cs_p6_base_${index}`;
    const revisionId = `rev_p6_base_${index}`;
    insertCompletedJob(sqlite, {
      id: toolJobId, projectId, artifactId: artifact.artifactId, file, digest,
      scriptFile, scriptHash, parameters,
    });
    registerSingleRevision({
      repository,
      adapter,
      projectId,
      sourceCommit,
      input: revisionInput({
        revisionId, projectId, familyId: artifact.familyId, artifactId: artifact.artifactId,
        sourceCommit, scriptHash, parametersHash, toolJobId, relativePath, digest, changeSetId,
      }),
    });
    adapter.updateRefCas({ ref: `refs/heads/biof3/current/${artifact.familyId}`, newCommit: sourceCommit, expectedOld: ZERO_OID });
    artifactTruth[artifact.key] = { relativePath, file, digest, bytes: artifact.bytes };
  }

  const pressureBytes = Buffer.from('gene,value\nA,1\nB,2\nC,3\nD,4\n');
  const pressureDigest = sha256(pressureBytes);
  let parentRevisionId = null;
  for (let index = 0; index < PRESSURE_REVISION_COUNT; index += 1) {
    const suffix = String(index + 1).padStart(3, '0');
    const relativePath = `results/pressure/revisions/table-${suffix}.csv`;
    const file = path.join(workspaceRoot, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, pressureBytes);
    const toolJobId = `tj_p6_pressure_${suffix}`;
    const changeSetId = `cs_p6_pressure_${suffix}`;
    const revisionId = `rev_p6_pressure_${suffix}`;
    insertCompletedJob(sqlite, {
      id: toolJobId, projectId, artifactId: 'pressure_table', file, digest: pressureDigest,
      scriptFile, scriptHash, parameters,
    });
    const input = revisionInput({
      revisionId,
      projectId,
      familyId: 'family_pressure',
      artifactId: 'pressure_table',
      parentRevisionId,
      sourceCommit,
      scriptHash,
      parametersHash,
      toolJobId,
      relativePath,
      digest: pressureDigest,
      changeSetId,
    });
    registerSingleRevision({ repository, adapter, projectId, sourceCommit, input });
    parentRevisionId = revisionId;
  }
  adapter.updateRefCas({ ref: 'refs/heads/biof3/current/family_pressure', newCommit: sourceCommit, expectedOld: ZERO_OID });

  const previewRelative = 'results/pressure/revisions/table-preview.csv';
  const previewFile = path.join(workspaceRoot, previewRelative);
  writeFileSync(previewFile, pressureBytes);
  insertCompletedJob(sqlite, {
    id: 'tj_p6_preview', projectId, artifactId: 'pressure_table', file: previewFile,
    digest: pressureDigest, scriptFile, scriptHash, parameters,
  });
  const previewInput = revisionInput({
    revisionId: 'rev_p6_preview', projectId, familyId: 'family_pressure', artifactId: 'pressure_table',
    parentRevisionId, sourceCommit, scriptHash, parametersHash, toolJobId: 'tj_p6_preview', relativePath: previewRelative,
    digest: pressureDigest, changeSetId: 'cs_p6_preview',
  });
  registerSingleRevision({ repository, adapter, projectId, sourceCommit, input: previewInput, adopt: false });
  const staleRuntimeLease = {
    instanceId: 'a'.repeat(32),
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  };
  repository.saveCheckpoint({
    checkpointId: 'cp_p6_preview', projectId, conversationId: 'conv_p6', baseCommit: sourceCommit,
    candidateCommit: sourceCommit, changeSetId: 'cs_p6_preview', changeSetStatus: 'preview_ready',
    currentRevisionIds: repository.listCurrentRevisions(projectId).map((item) => item.revisionId),
    pendingPreview: {
      stage: 'preview_ready', revisionIds: ['rev_p6_preview'], runtimeLease: staleRuntimeLease,
    },
    jobRefs: ['tj_p6_preview'],
  });

  repository.createChangeSet({ changeSetId: 'cs_p6_interrupted', projectId, conversationId: 'conv_p6', baseCommit: sourceCommit, workingBranchRef: 'refs/heads/biof3/changeset/cs_p6_interrupted', createdBy: 'agent' });
  repository.transitionChangeSet({ changeSetId: 'cs_p6_interrupted', to: 'running' });
  repository.saveCheckpoint({
    checkpointId: 'cp_p6_interrupted', projectId, conversationId: 'conv_p6', baseCommit: sourceCommit,
    changeSetId: 'cs_p6_interrupted', changeSetStatus: 'running',
    currentRevisionIds: repository.listCurrentRevisions(projectId).map((item) => item.revisionId),
    pendingPreview: { stage: 'materialized', revisionIds: [], runtimeLease: staleRuntimeLease },
  });

  repository.createChangeSet({ changeSetId: 'cs_p6_draft', projectId, conversationId: 'conv_p6', baseCommit: sourceCommit, workingBranchRef: 'refs/heads/biof3/changeset/cs_p6_draft', createdBy: 'agent' });
  repository.saveCheckpoint({
    checkpointId: 'cp_p6_draft', projectId, conversationId: 'conv_p6', baseCommit: sourceCommit,
    changeSetId: 'cs_p6_draft', changeSetStatus: 'draft',
    currentRevisionIds: repository.listCurrentRevisions(projectId).map((item) => item.revisionId),
    pendingPreview: { stage: 'change_set', revisionIds: [], runtimeLease: staleRuntimeLease },
  });

  const lastCheckpointTime = Math.max(...repository.listProjectCheckpoints(projectId)
    .map((checkpoint) => Date.parse(checkpoint.updatedAt || ''))
    .filter(Number.isFinite));
  const runtimeLease = {
    instanceId: 'b'.repeat(32),
    startedAt: new Date(lastCheckpointTime + 1).toISOString(),
  };

  adapter.deleteRefCas({ ref: 'refs/heads/biof3/current/family_pressure', expectedOld: sourceCommit });
  sqlite.close();
  sqlite = null;

  return {
    root,
    workspaceRoot,
    databasePath,
    projectId,
    sourceCommit,
    runtimeLease,
    scriptHash,
    parametersHash,
    pressureDigest,
    artifacts: artifactTruth,
    reopen() {
      if (sqlite) return { sqlite, repository, adapter };
      sqlite = new Database(databasePath);
      sqlite.pragma('busy_timeout = 10000');
      repository = createResultStudioRepository(sqlite, { ensureSchema: false });
      adapter = bindProjectRepository({ workspaceRoot, projectId, preferManaged: true, allowExistingRepository: false, createManagedIfMissing: false }).adapter;
      return { sqlite, repository, adapter };
    },
    close() {
      try { sqlite?.close(); } catch { /* best effort */ }
      sqlite = null;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function countStatuses(repository, projectId) {
  const counts = {};
  for (const item of repository.listChangeSets({ projectId, limit: 500 })) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  return counts;
}

function safeInspectionSummary(result) {
  return {
    status: result.lifecycle.status,
    consistencyStatus: result.lifecycle.consistency.status,
    consistencyRecoverable: result.lifecycle.consistency.recoverable === true,
    checkpointIntegrityStatus: result.lifecycle.checkpointIntegrity.status,
    checkpointIntegrityMatches: result.lifecycle.checkpointIntegrity.matches === true,
    interruptedCount: result.lifecycle.interrupted.length,
    pendingDecisionCount: result.lifecycle.pendingDecisions.length,
    revisionCount: result.lifecycle.revisionIntegrity.revisionCount,
    revisionIntegrityIntact: result.lifecycle.revisionIntegrity.intact,
    issueKinds: [...new Set(result.lifecycle.revisionIntegrity.issues.map((item) => item.kind))].sort(),
    storageRevisionCount: result.storage.revisionCount,
    storageObjectCount: result.storage.contentObjectCount,
  };
}

async function runServiceIntegrationFixture() {
  const fixture = createPressureFixture();
  try {
    const recoveryStarted = performance.now();
    const recovery = await runResultStudioBackground('recover-workspace', {
      databasePath: fixture.databasePath,
      workspaceRoot: fixture.workspaceRoot,
      projectId: fixture.projectId,
      conversationId: 'conv_p6',
      runtimeLease: fixture.runtimeLease,
    });
    const recoveryMs = performance.now() - recoveryStarted;
    const opened = fixture.reopen();
    const statusCounts = countStatuses(opened.repository, fixture.projectId);
    const currentRefRestored = opened.adapter.revParse('refs/heads/biof3/current/family_pressure') === fixture.sourceCommit;
    const checkpointsPreserved = opened.repository.listProjectCheckpoints(fixture.projectId).length === 3;
    const repairs = recovery.repaired.map((item) => item.repair).sort();

    await closeResultStudioBackground();
    const inspectStarted = performance.now();
    const restartedInspection = await runResultStudioBackground('inspect-workspace', {
      databasePath: fixture.databasePath,
      workspaceRoot: fixture.workspaceRoot,
      projectId: fixture.projectId,
      conversationId: 'conv_p6',
      runtimeLease: fixture.runtimeLease,
    });
    const inspectionMs = performance.now() - inspectStarted;
    const restartedSummary = safeInspectionSummary(restartedInspection);

    const storageStarted = performance.now();
    const storageBefore = inspectResultStudioStorage({ repository: opened.repository, workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId });
    const storageInspectionMs = performance.now() - storageStarted;
    const dedupPlan = planArtifactDeduplication({ workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId }, { repository: opened.repository });
    const deduped = executeArtifactDeduplication({ workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId, planToken: dedupPlan.planToken }, { repository: opened.repository });
    const storageAfter = inspectResultStudioStorage({ repository: opened.repository, workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId });
    const pressureRevisionFiles = opened.repository.listProjectRevisions(fixture.projectId)
      .filter((revision) => revision.artifactFamilyId === 'family_pressure')
      .slice(0, 2)
      .map((revision) => path.join(fixture.workspaceRoot, revision.outputPath));
    const contentObject = path.join(
      fixture.workspaceRoot,
      '.biof3/result-objects/sha256',
      fixture.pressureDigest.slice(0, 2),
      fixture.pressureDigest,
    );
    const mutationTarget = pressureRevisionFiles[0];
    const isolationPeer = pressureRevisionFiles[1];
    const mutationOriginal = readFileSync(mutationTarget);
    const peerOriginal = readFileSync(isolationPeer);
    const objectOriginal = readFileSync(contentObject);
    const inodeIsolation = statSync(mutationTarget).ino !== statSync(isolationPeer).ino
      && statSync(mutationTarget).ino !== statSync(contentObject).ino
      && statSync(isolationPeer).ino !== statSync(contentObject).ino
      && [mutationTarget, isolationPeer, contentObject].every((file) => statSync(file).nlink === 1);
    writeFileSync(mutationTarget, 'mutation isolation probe');
    const mutationIsolation = readFileSync(isolationPeer).equals(peerOriginal)
      && readFileSync(contentObject).equals(objectOriginal);
    writeFileSync(mutationTarget, mutationOriginal);

    opened.repository.createChangeSet({ changeSetId: 'cs_p6_gc', projectId: fixture.projectId, baseCommit: fixture.sourceCommit, workingBranchRef: 'refs/heads/biof3/changeset/cs_p6_gc', createdBy: 'agent' });
    opened.repository.transitionChangeSet({ changeSetId: 'cs_p6_gc', to: 'abandoned' });
    opened.adapter.updateRefCas({ ref: 'refs/heads/biof3/changeset/cs_p6_gc', newCommit: fixture.sourceCommit, expectedOld: ZERO_OID });
    const staging = path.join(fixture.workspaceRoot, '.biof3/revision/cs_p6_gc');
    mkdirSync(staging, { recursive: true });
    writeFileSync(path.join(staging, 'candidate.R'), 'print(1)\n');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staging, old, old);
    const revisionsBeforeGc = opened.repository.listProjectRevisions(fixture.projectId).length;
    const gcPlan = planResultStudioGc({ workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId }, { repository: opened.repository, adapter: opened.adapter });
    const gc = executeResultStudioGc({ workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId, planToken: gcPlan.planToken }, { repository: opened.repository, adapter: opened.adapter });
    const revisionsAfterGc = opened.repository.listProjectRevisions(fixture.projectId).length;

    const pageTimes = [];
    const heapBefore = process.memoryUsage().heapUsed;
    let cursor = 0;
    let tableRowsRead = 0;
    const traversalStarted = performance.now();
    do {
      const pageStarted = performance.now();
      const page = readTablePage({ filePath: fixture.artifacts.largeTable.file, cursor, limit: 200 });
      pageTimes.push(performance.now() - pageStarted);
      tableRowsRead += page.rows.length;
      cursor = page.nextCursor;
    } while (cursor !== null);
    const traversalMs = performance.now() - traversalStarted;
    const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    const memoryPressure = evaluatePreviewResourceBudget({
      resourceSnapshot: { state: 'ready', memory: { availableBytes: 1000 }, disk: { availableBytes: 10_000 } },
      estimatedMemoryBytes: 800,
    });
    const diskPressure = evaluatePreviewResourceBudget({
      resourceSnapshot: { state: 'ready', memory: { availableBytes: 10_000 }, disk: { availableBytes: 1000 } },
      estimatedDiskBytes: 900,
    });
    const svgElements = (fixture.artifacts.complexSvg.bytes.toString('utf8').match(/<circle /g) || []).length;
    const pngBytes = fixture.artifacts.complexPng.bytes;
    const pngWidth = pngBytes.readUInt32BE(16);
    const pngHeight = pngBytes.readUInt32BE(20);
    const physicalHashesExact = Object.values(fixture.artifacts).every((item) => hashFile(item.file) === item.digest)
      && opened.repository.listProjectRevisions(fixture.projectId).every((revision) => hashFile(path.join(fixture.workspaceRoot, revision.outputPath)) === revision.outputHash);
    const completedJobs = opened.sqlite.prepare('SELECT result_json FROM tool_jobs WHERE project_id=? AND status=?')
      .all(fixture.projectId, 'completed');
    const jobTruthExact = completedJobs.length === PRESSURE_REVISION_COUNT + 5
      && completedJobs.every((row) => {
        const result = JSON.parse(row.result_json || '{}');
        const artifact = result.artifacts?.[0];
        const provenance = result.executionProvenance;
        return result.artifactTruth?.status === 'valid'
          && result.artifactTruth?.blocking === false
          && artifact?.path
          && hashFile(artifact.path) === artifact.sha256
          && provenance?.script?.snapshotPath
          && hashFile(provenance.script.snapshotPath) === provenance.script.sha256
          && verifyExecutionProvenance(provenance).ok === true;
      });

    const originalSvg = fixture.artifacts.complexSvg.bytes;
    writeFileSync(fixture.artifacts.complexSvg.file, 'externally modified');
    const artifactDrift = await runResultStudioBackground('inspect-workspace', {
      databasePath: fixture.databasePath, workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId,
      conversationId: 'conv_p6', runtimeLease: fixture.runtimeLease,
    });
    writeFileSync(fixture.artifacts.complexSvg.file, originalSvg);

    const conflict = opened.adapter.commitVirtualFiles({
      parentCommit: fixture.sourceCommit,
      ref: 'refs/heads/biof3/p6-conflict',
      expectedOld: ZERO_OID,
      message: 'P6 conflicting current ref',
      files: [{ path: 'analysis/scripts/conflict.R', content: 'print(99)\n' }],
    }).commit;
    opened.adapter.updateRefCas({ ref: 'refs/heads/biof3/current/family_complex_svg', newCommit: conflict, expectedOld: fixture.sourceCommit });
    const refDrift = await runResultStudioBackground('inspect-workspace', {
      databasePath: fixture.databasePath, workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId,
      conversationId: 'conv_p6', runtimeLease: fixture.runtimeLease,
    });
    opened.adapter.updateRefCas({ ref: 'refs/heads/biof3/current/family_complex_svg', newCommit: fixture.sourceCommit, expectedOld: conflict });

    opened.repository.saveCheckpoint({
      checkpointId: 'cp_p6_corrupt', projectId: fixture.projectId, conversationId: 'conv_p6_corrupt', baseCommit: fixture.sourceCommit,
      changeSetId: 'cs_p6_base_0', changeSetStatus: 'adopted',
      currentRevisionIds: opened.repository.listCurrentRevisions(fixture.projectId).map((item) => item.revisionId),
      pendingPreview: { stage: 'preview_ready', revisionIds: [], runtimeLease: fixture.runtimeLease },
    });
    opened.sqlite.prepare("UPDATE workspace_revision_checkpoints SET pending_preview_json='{}' WHERE checkpoint_id='cp_p6_corrupt'").run();
    const checkpointDrift = await runResultStudioBackground('inspect-workspace', {
      databasePath: fixture.databasePath, workspaceRoot: fixture.workspaceRoot, projectId: fixture.projectId,
      conversationId: 'conv_p6_corrupt', runtimeLease: fixture.runtimeLease,
    });

    return {
      runtime: {
        classification: 'synthetic_service_integration_fixture_with_disposable_truth_stores',
        providerClaim: false,
        packagedElectronClaim: false,
        electronProductBudgetClaim: false,
        p6QualificationClaim: false,
        qualificationEligible: false,
      },
      recovery: {
        elapsedMs: Number(recoveryMs.toFixed(3)),
        repairedKinds: repairs,
        afterStatus: recovery.after.status,
        afterInterruptedCount: recovery.after.interrupted.length,
        afterPendingDecisionCount: recovery.after.pendingDecisions.length,
        incompleteRunningClosed: statusCounts.validation_failed === 1,
        draftClosed: statusCounts.abandoned >= 1,
        previewPreserved: statusCounts.preview_ready === 1,
        currentRefRestored,
        checkpointsPreserved,
        restartedInspection: restartedSummary,
        restartInspectionMs: Number(inspectionMs.toFixed(3)),
      },
      drift: {
        artifactModificationBlocked: artifactDrift.lifecycle.status === 'blocked'
          && artifactDrift.lifecycle.revisionIntegrity.issues.some((item) => item.kind === 'artifact_hash_drift'),
        conflictingRefBlocked: refDrift.lifecycle.status === 'blocked'
          && refDrift.lifecycle.revisionIntegrity.issues.some((item) => item.kind === 'current_ref_drift'),
        corruptCheckpointBlocked: checkpointDrift.lifecycle.status === 'blocked'
          && checkpointDrift.lifecycle.consistency.status === 'checkpoint_corrupt',
      },
      pressure: {
        revisionCount: restartedInspection.lifecycle.revisionIntegrity.revisionCount,
        largeTableRows: LARGE_TABLE_ROWS,
        tableRowsRead,
        tablePageCount: pageTimes.length,
        tablePageP95Ms: Number(percentile(pageTimes, 0.95).toFixed(3)),
        tableTraversalMs: Number(traversalMs.toFixed(3)),
        serviceTraversalHeapGrowthBytes: heapGrowthBytes,
        svgElementCount: svgElements,
        svgBytes: fixture.artifacts.complexSvg.bytes.length,
        pngWidth,
        pngHeight,
        pngPixels: pngWidth * pngHeight,
        pngBytes: fixture.artifacts.complexPng.bytes.length,
        longReportBytes: fixture.artifacts.longReport.bytes.length,
        physicalHashesExact,
        completedJobCount: completedJobs.length,
        jobTruthExact,
      },
      storage: {
        inspectionMs: Number(storageInspectionMs.toFixed(3)),
        logicalBytesBefore: storageBefore.logicalArtifactBytes,
        uniqueBytesBefore: storageBefore.uniqueArtifactBytes,
        deduplicableBytesBefore: storageBefore.deduplicableBytes,
        dedupPlanGroupCount: dedupPlan.groups.length,
        dedupStrategy: deduped.strategy,
        dedupClonePrimitives: deduped.clonePrimitives,
        dedupClonedCount: deduped.clonedCount,
        dedupHardLinkCount: deduped.hardLinkCount,
        dedupInodeIsolation: inodeIsolation,
        dedupMutationIsolation: mutationIsolation,
        deduplicableBytesAfter: storageAfter.deduplicableBytes,
        gcPlannedEntries: gcPlan.entries.length,
        gcRemovedEntries: gc.removedCount,
        gcArtifactDeletionCount: gc.artifactDeletionCount,
        revisionCountBeforeGc: revisionsBeforeGc,
        revisionCountAfterGc: revisionsAfterGc,
      },
      resourceBudget: {
        memoryDecision: memoryPressure.decision,
        diskDecision: diskPressure.decision,
        scientificParametersChanged: memoryPressure.scientificParametersChanged
          || diskPressure.scientificParametersChanged,
      },
    };
  } finally {
    await closeResultStudioBackground();
    fixture.close();
  }
}

export function buildP6ServiceFixtureChecks(result) {
  assert(result && typeof result === 'object', 'p6_service_fixture_runtime_invalid');
  const checks = [
    ['P6S-01', result.recovery.incompleteRunningClosed, 'Synthetic interrupted running work reaches an explicit failed terminal state.'],
    ['P6S-02', result.recovery.draftClosed, 'Synthetic unstarted draft work closes as abandoned after restart.'],
    ['P6S-03', result.recovery.previewPreserved && result.recovery.afterPendingDecisionCount === 1, 'Durable preview remains a pending user decision, not an interruption.'],
    ['P6S-04', result.recovery.currentRefRestored, 'Missing current ref is restored from exact SQLite Revision truth.'],
    ['P6S-05', result.recovery.checkpointsPreserved, 'Recovery preserves every durable checkpoint.'],
    ['P6S-06', result.recovery.afterStatus === 'ready' && result.recovery.afterInterruptedCount === 0, 'Recovery converges without a permanent recovery loop.'],
    ['P6S-07', result.recovery.restartedInspection.status === 'ready'
      && result.recovery.restartedInspection.pendingDecisionCount === 1
      && result.recovery.restartedInspection.consistencyStatus === 'consistent'
      && result.recovery.restartedInspection.checkpointIntegrityMatches === true,
    'A new background generation reconstructs a consistent checkpoint with verified integrity.'],
    ['P6S-08', result.drift.artifactModificationBlocked, 'External Artifact modification fails closed.'],
    ['P6S-09', result.drift.conflictingRefBlocked, 'Conflicting current Git ref fails closed.'],
    ['P6S-10', result.drift.corruptCheckpointBlocked, 'Corrupted checkpoint hash fails closed.'],
    ['P6S-11', result.storage.gcArtifactDeletionCount === 0 && result.storage.revisionCountBeforeGc === result.storage.revisionCountAfterGc, 'GC removes no Artifact or Revision history.'],
    ['P6S-12', result.storage.dedupStrategy === 'copy_on_write_clone'
      && result.storage.dedupHardLinkCount === 0
      && result.storage.dedupClonedCount >= PRESSURE_REVISION_COUNT - 1
      && result.storage.dedupClonePrimitives.length > 0
      && result.storage.dedupClonePrimitives.every((primitive) => primitive.startsWith('copyfile_ficlone'))
      && result.storage.dedupInodeIsolation === true
      && result.storage.dedupMutationIsolation === true
      && result.storage.deduplicableBytesAfter === result.storage.deduplicableBytesBefore,
    'Copy-on-write clones use distinct inodes and isolate post-dedup mutation without hard links.'],
    ['P6S-13', result.resourceBudget.memoryDecision === 'blocked'
      && result.resourceBudget.diskDecision === 'blocked'
      && result.resourceBudget.scientificParametersChanged === false,
    'Synthetic memory and disk pressure blocks without changing scientific parameters.'],
    ['P6S-14', result.pressure.largeTableRows === LARGE_TABLE_ROWS && result.pressure.tableRowsRead === LARGE_TABLE_ROWS, 'The service reader traverses the complete 100k-row table fixture.'],
    ['P6S-15', result.pressure.svgElementCount === SVG_ELEMENT_COUNT && result.pressure.pngPixels === PNG_WIDTH * PNG_HEIGHT && result.pressure.longReportBytes >= LONG_REPORT_MIN_BYTES, 'Synthetic SVG, PNG and long-report inputs meet fixture thresholds.'],
    ['P6S-16', result.pressure.revisionCount >= PRESSURE_REVISION_COUNT, 'The fixture project carries at least 200 immutable Revisions.'],
    ['P6S-17', result.pressure.physicalHashesExact && result.pressure.jobTruthExact, 'Every fixture Revision and completed Job matches physical Artifact and provenance bytes.'],
    ['P6S-18', result.recovery.elapsedMs <= P6_SERVICE_FIXTURE_BUDGETS.backgroundRecoveryMs && result.recovery.restartInspectionMs <= P6_SERVICE_FIXTURE_BUDGETS.backgroundInspectionMs, 'Background service recovery and inspection meet fixture wall-time budgets.'],
    ['P6S-19', result.pressure.tableTraversalMs <= P6_SERVICE_FIXTURE_BUDGETS.fullTableTraversalMs
      && result.pressure.tablePageP95Ms <= P6_SERVICE_FIXTURE_BUDGETS.tablePageP95Ms
      && result.pressure.serviceTraversalHeapGrowthBytes <= P6_SERVICE_FIXTURE_BUDGETS.serviceTraversalHeapGrowthBytes,
    'Node service table traversal meets its diagnostic latency and 128 MiB heap-growth budgets.'],
    ['P6S-20', result.storage.inspectionMs <= P6_SERVICE_FIXTURE_BUDGETS.storageInspectionMs, 'Storage accounting meets its fixture wall-time budget.'],
  ];
  return checks.map(([id, passed, detail]) => ({ id, passed: passed === true, detail }));
}

function sourceFileMapMatchesFrozen(value) {
  return JSON.stringify(stable(value)) === JSON.stringify(stable(P6_SERVICE_FIXTURE_SOURCE_FILES));
}

function checksMatchRuntime(evidence) {
  try {
    const expected = buildP6ServiceFixtureChecks(evidence?.runtime);
    return JSON.stringify(stable(evidence?.checks)) === JSON.stringify(stable(expected));
  } catch {
    return false;
  }
}

function hasNonQualifyingRuntimeBoundary(evidence) {
  const boundary = evidence?.runtime?.runtime;
  return boundary?.classification === 'synthetic_service_integration_fixture_with_disposable_truth_stores'
    && boundary.providerClaim === false
    && boundary.packagedElectronClaim === false
    && boundary.electronProductBudgetClaim === false
    && boundary.p6QualificationClaim === false
    && boundary.qualificationEligible === false;
}

export function assertP6ServiceFixtureEvidenceWritable(evidence) {
  if (evidence?.qualificationEligible !== false
      || evidence?.classification !== P6_SERVICE_FIXTURE_CLASSIFICATION
      || !hasNonQualifyingRuntimeBoundary(evidence)) {
    const error = new Error('refusing_to_write_misclassified_p6_service_fixture');
    error.code = 'p6_service_fixture_boundary_invalid';
    throw error;
  }
  if (!sourceFileMapMatchesFrozen(evidence?.sourceFiles) || !checksMatchRuntime(evidence)) {
    const error = new Error('refusing_to_write_unverified_p6_service_fixture');
    error.code = 'p6_service_fixture_truth_invalid';
    throw error;
  }
  if (evidence?.sourceCommitMatchesSourceHashes !== true || evidence?.sourceMismatches?.length !== 0) {
    const error = new Error('refusing_to_write_unbound_p6_service_fixture');
    error.code = 'p6_service_fixture_source_binding_not_current';
    throw error;
  }
  if (evidence?.sourceBindingStableDuringObservation !== true) {
    const error = new Error('refusing_to_write_changed_p6_service_fixture_sources');
    error.code = 'p6_service_fixture_source_binding_changed';
    throw error;
  }
  if (evidence?.passed !== true) {
    const error = new Error('refusing_to_write_failed_p6_service_fixture');
    error.code = 'p6_service_fixture_not_passed';
    throw error;
  }
  assertSanitizedP6ServiceFixtureEvidence(evidence);
  return true;
}

export function writeP6ServiceFixtureEvidence(evidence, io = {}) {
  assertP6ServiceFixtureEvidenceWritable(evidence);
  const payload = `${JSON.stringify(evidence, null, 2)}\n`;
  const makeDirectory = io.makeDirectory || ((directory) => mkdirSync(directory, { recursive: true }));
  const write = io.write || writeFileSync;
  makeDirectory(path.dirname(EVIDENCE_PATH));
  write(EVIDENCE_PATH, payload);
  return { bytes: Buffer.byteLength(payload), digest: sha256(payload) };
}

function verifyCommittedSources(evidence) {
  if (!/^[a-f0-9]{40}$/.test(evidence?.sourceCommit || '')) return false;
  if (!sourceFileMapMatchesFrozen(evidence?.sourceFiles)) return false;
  const expectedKeys = Object.keys(P6_SERVICE_FIXTURE_SOURCE_FILES).sort();
  const actualHashKeys = Object.keys(evidence?.sourceHashes || {}).sort();
  if (JSON.stringify(actualHashKeys) !== JSON.stringify(expectedKeys)) return false;
  const reachable = git(['merge-base', '--is-ancestor', evidence.sourceCommit, 'HEAD']);
  if (reachable.status !== 0) return false;
  for (const [key, relative] of Object.entries(P6_SERVICE_FIXTURE_SOURCE_FILES)) {
    const shown = git(['show', `${evidence.sourceCommit}:${relative}`]);
    if (shown.status !== 0 || sha256(Buffer.from(shown.stdout)) !== evidence.sourceHashes?.[key]) return false;
  }
  return evidence.bindingDigest === stableHash({
    sourceCommit: evidence.sourceCommit,
    sourceFiles: P6_SERVICE_FIXTURE_SOURCE_FILES,
    sourceHashes: evidence.sourceHashes,
  });
}

export function verifyStoredP6ServiceFixtureEvidence(evidence) {
  assert(evidence?.schemaVersion === 1, 'p6_service_fixture_schema_invalid');
  assert(evidence?.qualificationEligible === false, 'p6_service_fixture_qualification_boundary_invalid');
  assert(evidence?.classification === P6_SERVICE_FIXTURE_CLASSIFICATION, 'p6_service_fixture_classification_invalid');
  assert(hasNonQualifyingRuntimeBoundary(evidence), 'p6_service_fixture_runtime_boundary_invalid');
  assert(sourceFileMapMatchesFrozen(evidence?.sourceFiles), 'p6_service_fixture_source_map_invalid');
  assert(checksMatchRuntime(evidence), 'p6_service_fixture_checks_not_recomputed');
  assert(Array.isArray(evidence?.checks) && evidence.checks.length === 20 && evidence.checks.every((item) => item.passed === true), 'p6_service_fixture_checks_invalid');
  assert(evidence?.passed === true, 'p6_service_fixture_failed');
  assert(evidence?.sourceCommitMatchesSourceHashes === true
    && evidence?.sourceBindingStableDuringObservation === true
    && Array.isArray(evidence?.sourceMismatches)
    && evidence.sourceMismatches.length === 0,
  'p6_service_fixture_source_binding_invalid');
  assert(verifyCommittedSources(evidence), 'p6_service_fixture_committed_sources_invalid');
  assertSanitizedP6ServiceFixtureEvidence(evidence);
  return true;
}

export async function observeP6ServiceFixture({ writeEvidence = false } = {}) {
  const bindingAtStart = getP6ServiceFixtureSourceBinding();
  const runtime = await runServiceIntegrationFixture();
  const binding = getP6ServiceFixtureSourceBinding();
  const sourceBindingStableDuringObservation = bindingAtStart.bindingDigest === binding.bindingDigest;
  const result = {
    schemaVersion: 1,
    workPackage: 'G0-RS-P6 / P6-1a service fixture',
    classification: P6_SERVICE_FIXTURE_CLASSIFICATION,
    qualificationEligible: false,
    scope: 'synthetic_service_recovery_pressure_primitive_checkpoint',
    exclusions: [
      'p6_product_closeout',
      'real_orchestrator_stop_failure_restart_matrix',
      'real_provider',
      'packaged_electron',
      'electron_renderer_product_budget',
      'product_requalification',
    ],
    budgets: P6_SERVICE_FIXTURE_BUDGETS,
    ...binding,
    sourceBindingStableDuringObservation,
    sourceBindingObservation: { startDigest: bindingAtStart.bindingDigest, endDigest: binding.bindingDigest },
    runtime,
  };
  result.checks = buildP6ServiceFixtureChecks(runtime);
  result.passed = result.sourceCommitMatchesSourceHashes
    && sourceBindingStableDuringObservation
    && result.checks.every((item) => item.passed);
  assertSanitizedP6ServiceFixtureEvidence(result);
  if (writeEvidence) writeP6ServiceFixtureEvidence(result);
  return result;
}

async function main() {
  if (process.argv.includes('--write-evidence') || process.argv.includes('--observe')) {
    const result = await observeP6ServiceFixture({ writeEvidence: process.argv.includes('--write-evidence') });
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  assert(existsSync(EVIDENCE_PATH), 'p6_service_fixture_checkpoint_missing');
  verifyStoredP6ServiceFixtureEvidence(JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')));
  console.log('[G0-RS-P6/P6-1a service fixture] PASS - 20/20 source-bound diagnostic checks');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The background service intentionally unrefs its child and IPC channel so
  // the product can exit cleanly. A standalone diagnostic CLI must keep one
  // referenced handle until its observation Promise settles.
  const keepAlive = setInterval(() => {}, 1000);
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }).finally(() => clearInterval(keepAlive));
}
