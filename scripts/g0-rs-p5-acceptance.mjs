#!/usr/bin/env node

/**
 * G0-RS-P5 — real scientific editing acceptance.
 *
 * Every product record in this journey is produced through the real desktop
 * server or a context-bound registered Agent tool.  The harness creates only
 * disposable input bytes; it never inserts Revision, ChangeSet, Job, workflow
 * graph, selection or Artifact rows.
 */

import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyMigrations,
  createCaptureEnv,
  inspectTables,
  startServer,
  stopServer,
} from './g0-rs-p4r-capture.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-result-studio/rs-p5-scientific-editing.json');
const WORKER_MARKER = '__P5_WORKER_RESULT__';
export const P5_WORKER_CHECKPOINT_HOLD_MARKER = '__P5_WORKER_CHECKPOINT_HOLD__';
const SHA256 = /^[a-f0-9]{64}$/;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'recovery_required']);
const VALID_REPLAY_PACKAGE_STATUSES = new Set(['complete', 'partial_history']);
const JOB_TIMEOUT_MS = 12 * 60 * 1000;

// The bio toolchain (deseq2/volcano/go-kegg fixtures and descriptors) moved to
// the independent domain pack (BLOCK-83 P4). The P5 live scientific journey
// runs only when that pack is available next to this repository (or via
// BIOF3_BIO_PACK_ROOT); without it the gate is an explicit skip, never a
// silent pass.
export function findBioPackRoot() {
  const override = process.env.BIOF3_BIO_PACK_ROOT;
  if (override) return existsSync(path.join(override, 'pack.json')) ? override : null;
  const sibling = path.join(ROOT, '..', 'gewu-pack-bio');
  return existsSync(path.join(sibling, 'pack.json')) ? sibling : null;
}

// These are the focused Node tests the P5 gate runs.  Keep them in the
// source-bound evidence as well: an evidence refresh must never silently bind
// the product while leaving its proof code at another commit.
export const P5_GATE_TEST_FILES = Object.freeze({
  agentRunToolTest: 'test/agent-run-tool.test.mjs',
  agentToolRegistryTest: 'test/agent-tool-registry.test.mjs',
  artifactTruthTest: 'test/artifact-truth.test.mjs',
  executionProvenanceTest: 'test/execution-provenance.test.mjs',
  gitAdapterTest: 'test/git-adapter.test.mjs',
  changeSetServiceTest: 'test/result-changeset-service.test.mjs',
  compareServiceTest: 'test/result-compare-service.test.mjs',
  editAgentToolTest: 'test/result-edit-agent-tool.test.mjs',
  editControlsTest: 'test/result-edit-controls.test.mjs',
  editIntentTest: 'test/result-edit-intent.test.mjs',
  pluginValidatorTest: 'test/result-plugin-validator.test.mjs',
  replayServiceTest: 'test/result-replay-service.test.mjs',
  revisionReplayPackageTest: 'test/result-revision-replay-package.test.mjs',
  revisionSourceTest: 'test/result-revision-source.test.mjs',
  scientificCompareTest: 'test/result-scientific-compare.test.mjs',
  scientificRerunTest: 'test/result-scientific-rerun.test.mjs',
  selectionToolsTest: 'test/result-selection-tools.test.mjs',
  contextTest: 'test/result-studio-context.test.mjs',
  lifecycleTest: 'test/result-studio-lifecycle.test.mjs',
  migrationTest: 'test/result-studio-migration.test.mjs',
  pluginSdkTest: 'test/result-studio-plugin-sdk.test.mjs',
  repositoryTest: 'test/result-studio-repository.test.mjs',
  workflowGraphTest: 'test/result-workflow-graph.test.mjs',
  scientificReplayPackageTest: 'test/scientific-replay-package.test.mjs',
  testAffectedTest: 'test/test-affected.test.mjs',
  toolsExecutorJobContextTest: 'test/tools-executor-job-context.test.mjs',
  toolsInputValidationTest: 'test/tools-input-validation.test.mjs',
});

export const P5_SOURCE_FILES = Object.freeze({
  acceptance: 'scripts/g0-rs-p5-acceptance.mjs',
  acceptanceTest: 'test/g0-rs-p5-acceptance.test.mjs',
  capture: 'scripts/g0-rs-p4r-capture.mjs',
  packageScripts: 'package.json',
  frontendPackage: 'frontend/package.json',
  impactMap: 'test/impact-map.json',
  server: 'core/biof3-server/server.js',
  routeRegistry: 'core/biof3-server/routes/index.js',
  dataApi: 'core/biof3-server/api-data.js',
  routes: 'core/biof3-server/routes/result-studio.js',
  toolsRoute: 'core/biof3-server/routes/tools.js',
  toolsPlatformRoute: 'core/biof3-server/routes/tools-platform.js',
  agentLearning: 'core/biof3-server/agent-tools/learning.js',
  agentRegistry: 'core/biof3-server/agent-tools/registry.js',
  contextBinding: 'core/biof3-server/agent-tools/result-context-binding.js',
  contextTools: 'core/biof3-server/agent-tools/result-context-tools.js',
  contextEditTools: 'core/biof3-server/agent-tools/result-context-edit-tools.js',
  editTools: 'core/biof3-server/agent-tools/result-edit-tools.js',
  selectionTools: 'core/biof3-server/agent-tools/result-selection-tools.js',
  toolDefinitions: 'core/biof3-server/agent-tools/tool-defs.js',
  database: 'core/biof3-server/db.js',
  artifactTruth: 'core/biof3-server/helpers/artifact-truth.js',
  toolExecutor: 'core/biof3-server/helpers/tools-executor.js',
  mcpRegistry: 'core/biof3-server/mcp/registry.js',
  toolsMetadata: 'core/biof3-server/routes/tools-metadata.js',
  pluginLoader: 'core/biof3-server/plugin-loader.js',
  toolRegistry: 'core/biof3-server/tool-registry.js',
  artifactManifest: 'core/shared-backend/artifact-manifest.js',
  executionProvenance: 'core/shared-backend/execution-provenance.js',
  gitAdapter: 'core/shared-backend/git-adapter.js',
  gitRepositoryBinding: 'core/shared-backend/git-repository-binding.js',
  changeSetService: 'core/shared-backend/result-changeset-service.js',
  compareService: 'core/shared-backend/result-compare-service.js',
  editIntent: 'core/shared-backend/result-edit-intent.js',
  replayService: 'core/shared-backend/result-replay-service.js',
  replayPackage: 'core/shared-backend/scientific-replay-package.js',
  revisionSource: 'core/shared-backend/result-revision-source.js',
  backgroundChild: 'core/shared-backend/result-studio-background-child.js',
  resultStudioContext: 'core/shared-backend/result-studio-context.js',
  pluginSdk: 'core/shared-backend/result-studio-plugin-sdk.js',
  repository: 'core/shared-backend/result-studio-repository.js',
  workflowGraph: 'core/shared-backend/result-workflow-graph.js',
  scientificRerun: 'core/shared-backend/result-scientific-rerun.js',
  scientificCompare: 'core/shared-backend/result-scientific-compare.js',
  pluginValidator: 'core/shared-backend/result-plugin-validator.js',
  workflowMigration: 'src/migrations/002_result_workflow_graph.sql',
  changeSetPanel: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
  changeSetPanelStyles: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.module.css',
  changeSetPanelTest: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.test.tsx',
  resultVersionRole: 'frontend/src/components/result-studio/resultVersionRole.ts',
  resultVersionRoleTest: 'frontend/src/components/result-studio/resultVersionRole.test.ts',
  resultStudioSurfaceTest: 'frontend/src/components/result-studio/ResultStudioSurface.test.tsx',
  resultStudioClient: 'frontend/src/components/result-studio/resultStudioClient.ts',
  ...P5_GATE_TEST_FILES,
});

// The migration records themselves are expected. Every project/result/task
// ledger below must be empty before this journey submits its first HTTP write.
// The list is intentionally explicit rather than relying on a heuristic over
// table names, so a newly added P5 truth table has to be reviewed here.
export const P5_NO_SEED_TABLES = Object.freeze([
  'projects',
  'datasets',
  'analyses',
  'project_g0_baselines',
  'tool_jobs',
  'git_repository_bindings',
  'scientific_change_sets',
  'artifact_revisions',
  'result_selection_contexts',
  'workspace_revision_checkpoints',
  'result_workflow_graphs',
  'scientific_task_specs',
]);

// Tool descriptors live inside the domain pack (pack-relative paths, resolved
// through findBioPackRoot() at read time).
const ADMITTED_DESCRIPTOR_FILES = Object.freeze({
  deseq2: 'plugins/deseq2/tool-definition.json',
  'volcano-plot': 'plugins/volcano-plot/tool-definition.json',
  'gene-correlation': 'plugins/gene-correlation/tool-definition.json',
  'go-kegg': 'plugins/go-kegg/tool-definition.json',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function checkedSourcePath(file) {
  const relative = String(file || '').replaceAll('\\', '/');
  const target = path.resolve(ROOT, relative);
  if (!relative || path.isAbsolute(relative) || relative.split('/').includes('..')
      || (target !== ROOT && !target.startsWith(ROOT + path.sep))) {
    throw new Error(`p5_source_file_unsafe:${relative || 'missing'}`);
  }
  if (!existsSync(target)) throw new Error(`p5_source_file_missing:${relative}`);
  return { relative, target };
}

export function getP5SourceBinding() {
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'p5_source_commit_unavailable');
  const sources = Object.fromEntries(Object.entries(P5_SOURCE_FILES).map(([key, file]) => [key, checkedSourcePath(file)]));
  const sourceHashes = Object.fromEntries(Object.entries(sources).map(([key, source]) => [
    key,
    sha256(readFileSync(source.target)),
  ]));
  const sourceMismatches = Object.entries(sources).flatMap(([key, source]) => {
    const shown = spawnSync('git', ['show', `${sourceCommit}:${source.relative}`], { cwd: ROOT });
    return shown.status === 0 && sha256(shown.stdout) === sourceHashes[key] ? [] : [source.relative];
  });
  return {
    sourceCommit,
    sourceFiles: P5_SOURCE_FILES,
    sourceHashes,
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

function openP5Database(dbPath, { readonly = true } = {}) {
  const resolved = path.resolve(String(dbPath || ''));
  assert(Boolean(dbPath) && existsSync(resolved), 'p5_no_seed_database_missing');
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(ROOT, 'core', 'biof3-server'), ROOT],
  }));
  return new Database(resolved, readonly ? { readonly: true } : undefined);
}

function withResultRepository(dbPath, read) {
  const sqlite = openP5Database(dbPath);
  try {
    const { createResultStudioRepository } = require(path.join(
      ROOT,
      'core/shared-backend/result-studio-repository.js',
    ));
    return read(createResultStudioRepository(sqlite, { ensureSchema: false }));
  } finally {
    sqlite.close();
  }
}

function readChangeSetCohort(dbPath, changeSetId) {
  return withResultRepository(dbPath, (repository) => {
    const changeSet = repository.getChangeSet(changeSetId);
    return {
      changeSet,
      revisions: changeSet ? repository.listRevisionsByChangeSet(changeSetId) : [],
      workflowGraph: changeSet?.validationSummary?.workflowGraph?.graphId
        ? repository.getWorkflowGraph(changeSet.validationSummary.workflowGraph.graphId)
        : null,
    };
  });
}

function readCurrentCohort(dbPath, projectId, sourceCohort) {
  return withResultRepository(dbPath, (repository) => sourceCohort.map((source) =>
    repository.getCurrentRevision(source.artifactFamilyId)
  ).filter((revision) => revision?.projectId === projectId));
}

export function replayCohortDatabaseProof(dbPath, {
  projectId,
  sourceChangeSetId,
  replayChangeSetId,
}) {
  return withResultRepository(dbPath, (repository) => {
    const sourceChangeSet = repository.getChangeSet(sourceChangeSetId);
    const replayChangeSet = repository.getChangeSet(replayChangeSetId);
    const sourceRevisions = repository.listRevisionsByChangeSet(sourceChangeSetId);
    const replayRevisions = repository.listRevisionsByChangeSet(replayChangeSetId);
    const sourceByIdentity = new Map(sourceRevisions.map((revision) => [revisionIdentity(revision), revision]));
    const replayByIdentity = new Map(replayRevisions.map((revision) => [revisionIdentity(revision), revision]));
    const graphRef = replayChangeSet?.validationSummary?.workflowGraph || null;
    const workflowGraph = graphRef?.graphId ? repository.getWorkflowGraph(graphRef.graphId) : null;
    const { verifyWorkflowGraphIntegrity } = require(path.join(
      ROOT,
      'core/shared-backend/result-workflow-graph.js',
    ));
    const graphIntegrity = workflowGraph ? verifyWorkflowGraphIntegrity(workflowGraph) : { ok: false };
    const nodesByJobId = new Map((workflowGraph?.nodes || []).map((node) => [node.toolJobId, node]));
    const allRevisionsById = new Map([...sourceRevisions, ...replayRevisions]
      .map((revision) => [revision.revisionId, revision]));
    const exactEdges = (workflowGraph?.edges || []).every((edge) => {
      const source = allRevisionsById.get(edge.sourceRevisionId)
        || repository.getRevision(edge.sourceRevisionId);
      return source?.projectId === projectId
        && edge.fromNodeId === `job:${source.toolJobId}`
        && edge.sourceToolJobId === source.toolJobId
        && edge.sourceArtifactId === source.artifactId
        && edge.sourceOutputHash === source.outputHash;
    });
    const exact = sourceChangeSet?.projectId === projectId
      && replayChangeSet?.projectId === projectId
      && sourceChangeSet.status === 'adopted'
      && replayChangeSet.status === 'preview_ready'
      && sourceRevisions.length > 0
      && sourceRevisions.length === replayRevisions.length
      && sourceByIdentity.size === sourceRevisions.length
      && replayByIdentity.size === replayRevisions.length
      && sameStringSet(sourceChangeSet.candidateArtifactRefs, sourceRevisions.map((revision) => revision.revisionId))
      && sameStringSet(replayChangeSet.candidateArtifactRefs, replayRevisions.map((revision) => revision.revisionId))
      && sameStringSet(replayChangeSet.jobRefs,
        [...new Set(replayRevisions.map((revision) => revision.toolJobId))])
      && sourceRevisions.every((source) => {
        const replay = replayByIdentity.get(revisionIdentity(source));
        return source.reproducibilityStatus === 'verified'
          && replay?.outputHash === source.outputHash
          && replay.parentRevisionIds.includes(source.revisionId)
          && replay.isCurrent === false
          && replay.reproducibilityStatus === 'available'
          && nodesByJobId.get(replay.toolJobId)?.artifactIds?.includes(replay.artifactId);
      })
      && graphRef?.sourceDigest === workflowGraph?.sourceDigest
      && graphIntegrity.ok === true
      && exactEdges;
    return {
      exact,
      sourceChangeSet,
      replayChangeSet,
      sourceRevisions,
      replayRevisions,
      workflowGraph,
      graphIntegrity,
    };
  });
}

/**
 * Read the ledger before the first product write.  A migration may create
 * schemas and `schema_migrations` rows, but it may not pre-populate any
 * project, task, artifact, revision, selection, ChangeSet or workflow truth.
 */
export function inspectP5NoSeedPrecondition(dbPath, { root = null } = {}) {
  const resolvedDbPath = path.resolve(String(dbPath || ''));
  if (root) {
    const resolvedRoot = path.resolve(root);
    assert(resolvedDbPath.startsWith(resolvedRoot + path.sep), 'p5_no_seed_database_not_disposable', {
      dbPath: resolvedDbPath,
      root: resolvedRoot,
    });
  }
  const sqlite = openP5Database(resolvedDbPath);
  try {
    const presentTables = new Set(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all().map((row) => row.name));
    const missingTables = P5_NO_SEED_TABLES.filter((table) => !presentTables.has(table));
    assert(missingTables.length === 0, 'p5_no_seed_required_tables_missing', { missingTables });
    const tableCounts = Object.fromEntries(P5_NO_SEED_TABLES.map((table) => [
      table,
      Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const seededTables = Object.entries(tableCounts)
      .filter(([, count]) => count > 0)
      .map(([table]) => table);
    return {
      tables: P5_NO_SEED_TABLES,
      tableCounts,
      seededTables,
      digest: stableHash(tableCounts),
    };
  } finally {
    sqlite.close();
  }
}

export function assertP5NoSeedPrecondition(dbPath, options = {}) {
  const truth = inspectP5NoSeedPrecondition(dbPath, options);
  assert(truth.seededTables.length === 0, 'p5_seeded_product_records_present', truth);
  return truth;
}

export function assertSanitizedP5Evidence(value, pointer = '$') {
  const secretKey = /(?:authorization|cookie|token|password|secret|api[_-]?key|credential|private[_-]?key|access[_-]?key|session)/i;
  const internalId = /(?:^|[^A-Za-z0-9])(?:p|job|tj|rev|cs|conv|sel|wfg|rrc)_[A-Za-z0-9._-]+/;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP5Evidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (secretKey.test(key) && key !== 'qualificationEligible') {
        throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      }
      assertSanitizedP5Evidence(item, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error(`URI leaked at ${pointer}`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`absolute path leaked at ${pointer}`);
  if (/^(?:~[\\/]|\\\\)/.test(value)) throw new Error(`absolute path leaked at ${pointer}`);
  if (value.includes('..')) throw new Error(`parent path leaked at ${pointer}`);
  if (internalId.test(value)) throw new Error(`internal id leaked at ${pointer}`);
  return true;
}

export function assertP5EvidenceWritable(evidence) {
  if (evidence?.sourceCommitMatchesSourceHashes !== true) {
    const error = new Error('refusing_to_write_unbound_p5_evidence');
    error.code = 'p5_source_binding_not_current';
    throw error;
  }
  if (evidence?.passed !== true) {
    const error = new Error('refusing_to_write_failed_p5_evidence');
    error.code = 'p5_evidence_not_passed';
    throw error;
  }
  assertSanitizedP5Evidence(evidence);
  return true;
}

/**
 * Canonical evidence is written only after all integrity assertions pass.
 * Injectable writers let the contract be tested without touching the evidence
 * ledger during normal unit tests.
 */
export function writeP5Evidence(evidence, {
  makeDirectory = mkdirSync,
  write = writeFileSync,
} = {}) {
  assertP5EvidenceWritable(evidence);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  makeDirectory(path.dirname(EVIDENCE_PATH), { recursive: true });
  write(EVIDENCE_PATH, serialized);
  return {
    bytes: Buffer.byteLength(serialized),
    digest: sha256(serialized),
  };
}

function assert(condition, message, detail = null) {
  if (condition) return;
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 60_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `http_${response.status}`);
    error.code = data.error || `http_${response.status}`;
    error.status = response.status;
    error.detail = data.detail || data.details || null;
    throw error;
  }
  return { data, status: response.status, digest: sha256(raw) };
}

function postJson(baseUrl, route, body, timeoutMs = 60_000) {
  return requestJson(baseUrl, route, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs,
  });
}

async function waitForJob(baseUrl, jobId, timeoutMs = JOB_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await requestJson(baseUrl, `/api/tools/status/${encodeURIComponent(jobId)}`)).data;
    if (TERMINAL_JOB_STATUSES.has(last.status)) break;
    await new Promise((resolve) => { setTimeout(resolve, 400); });
  }
  assert(last && TERMINAL_JOB_STATUSES.has(last.status), 'tool_job_timeout');
  assert(last.status === 'completed', `tool_job_not_completed:${last.status}`, last.error || null);
  assert(last.result?.artifactTruth?.status === 'valid' && last.result.artifactTruth.blocking !== true,
    'tool_job_artifact_truth_invalid', last.result?.artifactTruth || null);
  return last;
}

async function runHttpTool(baseUrl, { toolId, projectId, params, files = null }) {
  const submitted = await postJson(baseUrl, '/api/tools/run', {
    toolId,
    projectId,
    params,
    ...(files ? { files } : {}),
  });
  assert(submitted.data?.ok === true && submitted.data?.jobId, 'tool_submission_failed');
  return waitForJob(baseUrl, submitted.data.jobId);
}

function artifactsById(job) {
  return new Map((job?.result?.artifacts || []).map((artifact) => [artifact.id, artifact]));
}

function verifiedArtifact(job, artifactId) {
  const resultArtifacts = (job?.result?.artifacts || []).filter((artifact) => artifact?.id === artifactId);
  const provenance = job?.result?.executionProvenance || null;
  const provenanceArtifacts = (provenance?.artifacts || []).filter((entry) => entry?.id === artifactId);
  const artifact = resultArtifacts[0] || null;
  const provenanceArtifact = provenanceArtifacts[0] || null;
  const jobId = String(job?.id || job?.toolJobId || '').trim();
  const projectId = String(job?.project_id || job?.projectId || '').trim();
  const { verifyExecutionProvenance } = require(path.join(
    ROOT,
    'core/shared-backend/execution-provenance.js',
  ));
  let resultRoot = null;
  let artifactPath = null;
  let physicalHash = null;
  try {
    resultRoot = realpathSync(job?.result?.artifactTruth?.resultDir);
    artifactPath = realpathSync(artifact?.path);
    if ((artifactPath === resultRoot || artifactPath.startsWith(`${resultRoot}${path.sep}`))
        && statSync(artifactPath).isFile()) {
      physicalHash = sha256(readFileSync(artifactPath));
    }
  } catch {}
  assert(resultArtifacts.length === 1
    && provenanceArtifacts.length === 1
    && artifactPath
    && SHA256.test(provenanceArtifact?.sha256 || '')
    && physicalHash === provenanceArtifact.sha256
    && (!artifact.sha256 || artifact.sha256 === physicalHash)
    && provenance?.toolJobId === jobId
    && provenance?.projectId === projectId
    && verifyExecutionProvenance(provenance).ok,
  `artifact_missing_or_unverified:${artifactId}`, {
    jobId,
    projectId,
    resultArtifactCount: resultArtifacts.length,
    provenanceArtifactCount: provenanceArtifacts.length,
    artifact: artifact || null,
    provenanceArtifact: provenanceArtifact || null,
    resultRoot,
    artifactPath,
    physicalHash,
  });
  return { artifact: { ...artifact, path: artifactPath }, provenanceArtifact, physicalHash };
}

function artifactPath(job, artifactId) {
  return verifiedArtifact(job, artifactId).artifact.path;
}

function artifactFileName(job, artifactId) {
  return path.basename(artifactPath(job, artifactId));
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
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function readCsv(filePath) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const columns = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function readSquareMatrix(filePath, expectedSize) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const header = lines.length > 0 ? splitCsvLine(lines[0]) : [];
  const rows = lines.slice(1).map(splitCsvLine);
  const columnIds = header.slice(1).map((value) => String(value || '').trim());
  const rowIds = rows.map((values) => String(values[0] || '').trim());
  const exact = rows.length === expectedSize
    && columnIds.length === expectedSize
    && rowIds.length === expectedSize
    && rowIds.every(Boolean) && columnIds.every(Boolean)
    && new Set(rowIds).size === expectedSize
    && new Set(columnIds).size === expectedSize
    && rows.every((values) => values.length === expectedSize + 1)
    && sameStringSet(rowIds, columnIds);
  return { exact, rowIds, columnIds, rowCount: rows.length, columnCount: columnIds.length };
}

function buildScientificInput() {
  const packRoot = findBioPackRoot();
  if (!packRoot) throw Object.assign(new Error('p5_bio_pack_root_missing'), {
    detail: { hint: 'set BIOF3_BIO_PACK_ROOT or check out gewu-pack-bio as a sibling directory' },
  });
  const symbols = readFileSync(
    path.join(packRoot, 'plugins/go-kegg/demo-data/genes.csv'),
    'utf8',
  ).split(/\r?\n/).slice(1).map((line) => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
  assert(symbols.length >= 60, 'scientific_symbol_fixture_too_small');
  const samples = ['Control1', 'Control2', 'Control3', 'Treatment1', 'Treatment2', 'Treatment3'];
  const rows = symbols.map((gene, index) => {
    let control = 180 + (index % 11) * 9;
    let treatment = control;
    if (index < 16) treatment = control * 5;
    else if (index < 30) treatment = control * 2;
    else if (index < 44) { control *= 4; treatment = control / 4; }
    else if (index < 56) { control *= 2; treatment = control / 2; }
    // The input must look like a real replicated count experiment to DESeq2:
    // deterministic group effects plus independent, gene-specific replicate
    // variation.  A fixed group-wide multiplier makes every dispersion sit at
    // the same floor and DESeq2 correctly refuses to fit it.
    const replicateFactor = (group, replicate) => {
      const state = (index * 37 + group * 19 + replicate * 13 + (index % 7) * replicate) % 41;
      return 0.8 + state / 100;
    };
    const values = [
      ...[0, 1, 2].map((replicate) => Math.max(1, Math.round(control * replicateFactor(0, replicate)))),
      ...[0, 1, 2].map((replicate) => Math.max(1, Math.round(treatment * replicateFactor(1, replicate)))),
    ];
    return [gene, ...values].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
  });
  const counts = [`"gene",${samples.map((sample) => `"${sample}"`).join(',')}`, ...rows].join('\n') + '\n';
  const coldata = [
    '"sample","condition"',
    ...samples.map((sample, index) => `"${sample}","${index < 3 ? 'Control' : 'Treatment'}"`),
  ].join('\n') + '\n';
  return { symbols, counts, coldata };
}

function chooseChangedLfcThreshold(degPath, baseline = 0.25) {
  const values = readCsv(degPath)
    .map((row) => ({ lfc: Math.abs(Number(row.log2FoldChange)), padj: Number(row.padj) }))
    .filter((row) => Number.isFinite(row.lfc) && Number.isFinite(row.padj) && row.padj < 0.05 && row.lfc > baseline)
    .map((row) => row.lfc)
    .sort((left, right) => left - right);
  assert(values.length >= 6, 'deseq2_fixture_did_not_produce_threshold_range', { values: values.length });
  const unique = [...new Set(values.map((value) => Number(value.toPrecision(12))))];
  assert(unique.length >= 2, 'deseq2_fixture_lfc_range_is_degenerate');
  const index = Math.min(unique.length - 2, Math.max(0, Math.floor(unique.length * 0.6)));
  return unique[index];
}

function jobInputHashes(job) {
  return Object.fromEntries((job?.result?.executionProvenance?.inputs || [])
    .filter((input) => input?.id && SHA256.test(input.sha256 || ''))
    .map((input) => [input.id, input.sha256]));
}

function sameStringSet(left, right) {
  const leftValues = Array.isArray(left) ? left.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const rightValues = Array.isArray(right) ? right.map((value) => String(value || '').trim()).filter(Boolean) : [];
  return leftValues.length === new Set(leftValues).size
    && rightValues.length === new Set(rightValues).size
    && leftValues.length === rightValues.length
    && leftValues.every((value) => rightValues.includes(value));
}

export function allCandidateRevisionsValid(created) {
  const revisions = Array.isArray(created?.cohortRevisions) ? created.cohortRevisions : [];
  const changeSet = created?.changeSet || {};
  const validatorIds = changeSet.validationSummary?.validatorIds;
  const revisionIds = revisions.map((revision) => revision?.revisionId);
  const candidateRefs = changeSet.candidateArtifactRefs;
  const jobRefs = changeSet.jobRefs;
  const producingJobIds = [...new Set(revisions.map((revision) => revision?.toolJobId))];
  const familyIds = revisions.map((revision) => revision?.artifactFamilyId);
  return revisions.length > 0
    && sameStringSet(revisionIds, candidateRefs)
    && sameStringSet(jobRefs, producingJobIds)
    && familyIds.every((value) => typeof value === 'string' && value.trim())
    && new Set(familyIds).size === familyIds.length
    && ['preview_ready', 'adopted', 'reverted'].includes(changeSet.status)
    && changeSet.validationSummary?.formalArtifactCount === revisions.length
    && revisions.every((revision) => revision.validationStatus === 'valid'
      && revision.changeSetId === changeSet.changeSetId
      && jobRefs.includes(revision.toolJobId))
    && Array.isArray(validatorIds) && validatorIds.length > 0
    && validatorIds.every((value) => typeof value === 'string' && value.trim());
}

function admittedFormalArtifactIds(job) {
  const toolId = String(job?.tool_id || job?.toolId || '').trim();
  const descriptorFile = ADMITTED_DESCRIPTOR_FILES[toolId];
  if (!descriptorFile) return null;
  const packRoot = findBioPackRoot();
  if (!packRoot) return null;
  const descriptor = JSON.parse(readFileSync(path.join(packRoot, descriptorFile), 'utf8'));
  const declared = descriptor?.resultStudio?.artifacts;
  const actualIds = new Set((job?.result?.artifacts || []).map((artifact) => artifact?.id).filter(Boolean));
  if (!Array.isArray(declared) || declared.length === 0) return null;
  return declared
    .filter((artifact) => artifact?.required !== false || actualIds.has(artifact.id))
    .map((artifact) => artifact.id)
    .sort();
}

export function candidateCohortMatchesJobs(created, jobs) {
  if (!allCandidateRevisionsValid(created) || !Array.isArray(jobs) || jobs.length === 0) return false;
  const revisions = created.cohortRevisions;
  const jobIds = jobs.map((job) => String(job?.id || job?.toolJobId || '').trim());
  if (!sameStringSet(jobIds, created.changeSet.jobRefs)) return false;
  try {
    return jobs.every((job) => {
      const jobId = String(job?.id || job?.toolJobId || '').trim();
      const expectedArtifactIds = admittedFormalArtifactIds(job);
      const jobRevisions = revisions.filter((revision) => revision.toolJobId === jobId);
      if (!expectedArtifactIds || !sameStringSet(
        jobRevisions.map((revision) => revision.artifactId),
        expectedArtifactIds,
      )) return false;
      return jobRevisions.every((revision) => {
        const verified = verifiedArtifact(job, revision.artifactId);
        return revision.outputHash === verified.physicalHash;
      });
    });
  } catch {
    return false;
  }
}

function inputLineage(job, inputId) {
  return (job?.result?.executionProvenance?.inputs || []).find((input) => input?.id === inputId)?.lineage || null;
}

function stagedInputIsNotAnArtifact(job, inputId, filename) {
  const inputs = (job?.result?.executionProvenance?.inputs || [])
    .filter((input) => input?.id === inputId && SHA256.test(input.sha256 || ''));
  const artifactNames = (job?.result?.artifacts || [])
    .map((artifact) => path.basename(String(artifact?.filename || artifact?.name || '')))
    .filter(Boolean);
  return inputs.length === 1
    && !artifactNames.includes(filename)
    && job?.result?.artifactTruth?.exclusionPolicy === 'server_staged_inputs_v1'
    && job.result.artifactTruth.excludedInputNames?.includes(filename)
    && job.result.artifactTruth.stagedInputIntegrity === 'verified'
    && job.result.artifactTruth.stagedInputSnapshotCount > 0;
}

function hasMeaningfulEnrichmentDifference(difference) {
  const terms = difference?.terms;
  if (!terms || !Array.isArray(terms.topBefore) || !Array.isArray(terms.topAfter)) return false;
  return terms.beforeCount !== terms.afterCount
    || terms.membership?.gainedCount > 0
    || terms.membership?.lostCount > 0
    || stableHash(terms.topBefore) !== stableHash(terms.topAfter);
}

function hasAuditedEnrichmentRankingAndDirection(difference) {
  const topBefore = difference?.terms?.topBefore || [];
  const topAfter = difference?.terms?.topAfter || [];
  return difference?.direction?.status === 'available'
    && difference.direction.changedCount > 0
    && topBefore.length > 0
    && topAfter.length > 0
    && stableHash(topBefore.map((item) => [item.rank, item.id]))
      !== stableHash(topAfter.map((item) => [item.rank, item.id]));
}

function revisionIdentity(revision) {
  return `${revision?.artifactFamilyId || ''}\u0000${revision?.artifactId || ''}`;
}

function historicalCohortHasExactParents({ baselineCohort, adoptedCohort, historicalCohort }) {
  const baselineByIdentity = new Map(baselineCohort.map((revision) => [revisionIdentity(revision), revision]));
  const adoptedRevisionIds = new Set(adoptedCohort.map((revision) => revision?.revisionId));
  return baselineCohort.length > 0
    && historicalCohort.length === baselineCohort.length
    && baselineByIdentity.size === baselineCohort.length
    && new Set(historicalCohort.map(revisionIdentity)).size === historicalCohort.length
    && historicalCohort.every((revision) => {
      const baseline = baselineByIdentity.get(revisionIdentity(revision));
      return baseline
        && sameStringSet(revision.parentRevisionIds, [baseline.revisionId])
        && revision.parentRevisionIds.every((revisionId) => !adoptedRevisionIds.has(revisionId));
    });
}

function restoredCohortIsFresh(sourceCreated, restored, previousCurrentCohort) {
  const sourceCohort = Array.isArray(sourceCreated?.cohortRevisions) ? sourceCreated.cohortRevisions : [];
  const restoredCohort = Array.isArray(restored?.cohortRevisions) ? restored.cohortRevisions : [];
  const sourceChangeSet = sourceCreated?.changeSet || {};
  const restoredChangeSet = restored?.changeSet || {};
  const summary = restoredChangeSet.validationSummary || {};
  const sourceRevisionIds = sourceCohort.map((revision) => revision?.revisionId);
  const sourceByIdentity = new Map(sourceCohort.map((revision) => [revisionIdentity(revision), revision]));
  const currentByIdentity = new Map(previousCurrentCohort.map((revision) => [revisionIdentity(revision), revision]));
  const restoredByIdentity = new Map(restoredCohort.map((revision) => [revisionIdentity(revision), revision]));
  const selectedSource = sourceCohort.find((revision) => revision.revisionId === summary.restoredFromRevisionId) || null;
  const selectedRestored = selectedSource ? restoredByIdentity.get(revisionIdentity(selectedSource)) : null;
  return restoredCohort.length === sourceCohort.length
    && sourceByIdentity.size === sourceCohort.length
    && currentByIdentity.size === sourceCohort.length
    && restoredByIdentity.size === sourceCohort.length
    && restoredChangeSet.changeSetId !== sourceChangeSet.changeSetId
    && restoredChangeSet.status === 'adopted'
    && sameStringSet(restoredChangeSet.candidateArtifactRefs, restoredCohort.map((revision) => revision.revisionId))
    && sameStringSet(restoredChangeSet.jobRefs,
      [...new Set(restoredCohort.map((revision) => revision.toolJobId))])
    && summary.restore === true && summary.cohort === true
    && summary.restoredFromChangeSetId === sourceChangeSet.changeSetId
    && sameStringSet(summary.restoredCohortRevisionIds, sourceRevisionIds)
    && summary.formalArtifactCount === sourceCohort.length
    && sameStringSet(summary.validatorIds, sourceChangeSet.validationSummary?.validatorIds)
    && stableHash(summary.sourceWorkflowGraph) === stableHash(sourceChangeSet.validationSummary?.workflowGraph)
    && stableHash(summary.restoredWorkflowGraph) === stableHash(summary.workflowGraph)
    && selectedRestored?.revisionId === restored?.revision?.revisionId
    && restoredCohort.every((revision) => {
      const source = sourceByIdentity.get(revisionIdentity(revision));
      const previousCurrent = currentByIdentity.get(revisionIdentity(revision));
      return source && previousCurrent && revision?.revisionId
        && !sourceRevisionIds.includes(revision.revisionId)
        && revision.changeSetId === restoredChangeSet.changeSetId
        && revision.revisionOrdinal > source.revisionOrdinal
        && revision.revisionOrdinal > previousCurrent.revisionOrdinal
        && sameStringSet(revision.parentRevisionIds, [previousCurrent.revisionId])
        && revision.outputHash === source.outputHash
        && revision.toolJobId === source.toolJobId
        && revision.sourceScriptRef?.sha256 === source.sourceScriptRef?.sha256
        && revision.parametersHash === source.parametersHash
        && stableHash(revision.inputArtifactRefs) === stableHash(source.inputArtifactRefs)
        && revision.isCurrent === true
        && revision.reproducibilityStatus === 'available';
    });
}

function isPng(filePath) {
  const bytes = readFileSync(filePath);
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function pngDimensions(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 24 || !isPng(filePath) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function pngText(filePath, keyword) {
  const bytes = readFileSync(filePath);
  if (!isPng(filePath)) return null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0 && data.subarray(0, separator).toString('latin1') === keyword) {
        return data.subarray(separator + 1).toString('latin1');
      }
    }
    offset = dataEnd + 4;
  }
  return null;
}

function renderContractFromPng(filePath) {
  const raw = pngText(filePath, 'BioF3RenderContract');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function renderContractFromSvg(raw) {
  const match = String(raw || '').match(/<metadata\s+id="biof3-render-contract"\s+data-json-hex="([a-f0-9]+)"\s*\/>/i);
  if (!match || match[1].length % 2 !== 0) return null;
  try { return JSON.parse(Buffer.from(match[1], 'hex').toString('utf8')); } catch { return null; }
}

function normalizedExecutionParams(job) {
  const params = job?.result?.executionProvenance?.params?.normalized;
  return params && typeof params === 'object' && !Array.isArray(params) ? params : {};
}

function artifactSha256(job, artifactId) {
  return verifiedArtifact(job, artifactId).provenanceArtifact.sha256;
}

export function svgIncludesColor(svg, hex) {
  const normalized = String(hex || '').trim().replace(/^#/, '').toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(normalized)) return false;
  const source = String(svg || '').toLowerCase();
  if (source.includes(`#${normalized}`)) return true;

  const expected = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  const rgb = /rgb\(\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?\s*\)/gi;
  for (const match of source.matchAll(rgb)) {
    const actual = [1, 3, 5].map((index, channel) => {
      const value = Number(match[index]);
      return Math.round(match[index + 1] === '%' ? value * 255 / 100 : value);
    });
    if (actual.every((value, index) => value === expected[index])) return true;
  }
  return false;
}

function workerSummary(result) {
  if (!result || typeof result !== 'object') return result;
  const revisions = Array.isArray(result.cohortRevisions) ? result.cohortRevisions : [];
  return {
    ok: result.ok === true,
    error: result.error || null,
    message: result.message || null,
    detail: result.detail || null,
    diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
    toolJobId: result.toolJobId || null,
    workflowGraph: result.workflowGraph || result.enrichmentAction?.workflowGraph || result.selectionAction?.workflowGraph || null,
    selectionAction: result.selectionAction ? {
      entityIdCount: result.selectionAction.entityIdCount,
      entityIdsHash: result.selectionAction.entityIdsHash,
      materialization: result.selectionAction.materialization || null,
      workflowGraph: result.selectionAction.workflowGraph,
    } : null,
    plan: result.plan || null,
    changeSet: result.changeSet ? {
      changeSetId: result.changeSet.changeSetId,
      status: result.changeSet.status,
      jobRefs: result.changeSet.jobRefs,
      candidateArtifactRefs: result.changeSet.candidateArtifactRefs,
      validationSummary: result.changeSet.validationSummary,
    } : null,
    revision: result.revision || null,
    cohortRevisions: revisions,
    downstreamRevisions: Array.isArray(result.downstreamRevisions) ? result.downstreamRevisions : [],
  };
}

export function inspectP5AcceptanceRuntimeProcessOutput(output, {
  workerPid,
  trustedRuntimePaths = [],
  trustedRuntimeExecCommandPaths = [],
  expectedRunScriptPaths = [],
  expectedJobDirPaths = [],
} = {}) {
  const trustedRuntimePathSet = new Set(trustedRuntimePaths.map(String));
  const trustedRuntimeExecCommandPathSet = new Set(
    trustedRuntimeExecCommandPaths.map(String),
  );
  const expectedRunScriptPathSet = new Set(expectedRunScriptPaths.map(String));
  const expectedJobDirPathSet = new Set(expectedJobDirPaths.map(String));
  const matches = String(output || '').split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    const argv = match[5].trim().split(/\s+/);
    const process = {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      state: match[4],
      argv,
    };
    const rscriptShapeExact = argv.length === 3
      && trustedRuntimePathSet.has(argv[0])
      && expectedRunScriptPathSet.has(argv[1])
      && expectedJobDirPathSet.has(argv[2]);
    const execRShapeExact = argv.length === 6
      && trustedRuntimeExecCommandPathSet.has(argv[0])
      && argv[1] === '--no-echo'
      && argv[2] === '--no-restore'
      && [...expectedRunScriptPathSet].some((runScript) => argv[3] === `--file=${runScript}`)
      && argv[4] === '--args'
      && expectedJobDirPathSet.has(argv[5]);
    return process.ppid === workerPid
      && process.pgid === workerPid
      && process.pid !== workerPid
      && !/^Z/.test(process.state)
      && (rscriptShapeExact || execRShapeExact)
      ? [process]
      : [];
  });
  return matches.length === 1 ? matches[0] : null;
}

function existingPathAliases(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return [];
  const resolved = path.resolve(filePath);
  if (/\s/.test(resolved) || !existsSync(resolved)) return [];
  try {
    const canonical = realpathSync(resolved);
    return /\s/.test(canonical) ? [] : [...new Set([resolved, canonical])];
  } catch {
    return [];
  }
}

function configuredP5RRuntimeIdentity(configuredRscript) {
  const rscriptCommandPaths = existingPathAliases(configuredRscript);
  if (rscriptCommandPaths.length === 0) return null;
  try {
    const homeProbe = spawnSync(configuredRscript, [
      '--vanilla', '-e', 'cat(R.home())',
    ], { cwd: ROOT, encoding: 'utf8', timeout: 5_000 });
    if (homeProbe.status !== 0 || !path.isAbsolute(String(homeProbe.stdout || '').trim())) {
      return null;
    }
    const runtimeHome = path.resolve(String(homeProbe.stdout).trim());
    const canonicalRuntimeHome = realpathSync(runtimeHome);
    const canonicalRscript = realpathSync(path.resolve(configuredRscript));
    if (!canonicalRscript.startsWith(`${canonicalRuntimeHome}${path.sep}`)) return null;
    const execR = path.join(runtimeHome, 'bin', 'exec', 'R');
    if (!existsSync(execR)) return null;
    const canonicalExecR = realpathSync(execR);
    if (!canonicalExecR.startsWith(`${canonicalRuntimeHome}${path.sep}`)) return null;
    const execCommandPaths = existingPathAliases(execR);
    return Object.freeze({
      rscriptCommandPaths,
      execCommandPaths,
      executablePaths: [...new Set([...rscriptCommandPaths, ...execCommandPaths])],
    });
  } catch {
    return null;
  }
}

function readP5AcceptanceProcessExecutablePath(pid) {
  try {
    if (process.platform === 'darwin') {
      const inspected = spawnSync('/usr/sbin/lsof', [
        '-a', '-p', String(pid), '-d', 'txt', '-Fn',
      ], { cwd: ROOT, encoding: 'utf8' });
      if (inspected.status !== 0) return null;
      const lines = String(inspected.stdout || '').split('\n')
        .map((line) => line.trim()).filter(Boolean);
      const start = lines.indexOf(`p${pid}`);
      if (start < 0) return null;
      for (let index = start + 1; index < lines.length; index += 1) {
        if (/^p\d+$/.test(lines[index])) break;
        if (lines[index] === 'ftxt' && lines[index + 1]?.startsWith('n')) {
          const executablePath = lines[index + 1].slice(1);
          return path.isAbsolute(executablePath) ? realpathSync(executablePath) : null;
        }
      }
      return null;
    }
    if (process.platform === 'linux') return realpathSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
  return null;
}

/**
 * P6 recovery acceptance needs to observe the real UI while a real edit is
 * still interrupted at its durable candidate checkpoint.  A polling timer is
 * intentional here: `tools.create()` yields only after the registered plugin
 * has created its running tool_job and spawned its child process.  The timer
 * then verifies the persisted ChangeSet/checkpoint/Job tuple, writes a
 * synchronous handshake to fd 1, and stops the entire detached worker process
 * group (worker + scientific runtime).  The P6 parent is the only caller that
 * opts into this protocol and it must finish the interruption with SIGKILL.
 */
function installP6AcceptanceCheckpointHold(spec, dbModule) {
  const hold = spec?.acceptanceCheckpointHold;
  if (hold == null) return () => {};
  if (hold?.version !== 1 || hold?.mode !== 'sigstop_process_group'
      || hold?.checkpointStage !== 'candidate_committed'
      || hold?.expectedToolId !== 'volcano-plot'
      || !Number.isFinite(hold?.notBeforeEpochMs)) {
    throw new Error('p5_worker_checkpoint_hold_protocol_invalid');
  }
  if (process.platform === 'win32') {
    throw new Error('p5_worker_checkpoint_hold_unsupported_platform:win32');
  }
  const sqlite = typeof dbModule.getDatabase === 'function' ? dbModule.getDatabase() : dbModule.db;
  if (!sqlite || typeof sqlite.prepare !== 'function') {
    throw new Error('p5_worker_checkpoint_hold_database_unavailable');
  }
  let closed = false;
  let lastDiagnostic = null;
  let pausedRuntimePid = null;
  let pausedCandidateJobId = null;
  let groupHoldCommitted = false;
  const { RExecutor } = require(
    path.join(ROOT, 'core/shared-backend/executors/r-executor.js')
  );
  const configuredRscript = new RExecutor().binPath;
  const runtimeIdentity = configuredP5RRuntimeIdentity(configuredRscript);
  if (!runtimeIdentity?.rscriptCommandPaths?.length
      || !runtimeIdentity?.execCommandPaths?.length) {
    throw new Error('p5_worker_checkpoint_hold_r_runtime_unavailable');
  }
  const resumePausedRuntime = () => {
    if (!Number.isInteger(pausedRuntimePid) || groupHoldCommitted) return;
    try { process.kill(pausedRuntimePid, 'SIGCONT'); } catch {}
    pausedRuntimePid = null;
    pausedCandidateJobId = null;
  };
  const timer = setInterval(() => {
    if (closed) return;
    let checkpoint;
    let candidateJobs;
    try {
      checkpoint = sqlite.prepare(`
        SELECT cs.change_set_id, cp.checkpoint_id, cp.pending_preview_json
        FROM scientific_change_sets cs
        JOIN workspace_revision_checkpoints cp ON cp.change_set_id=cs.change_set_id
        WHERE cs.project_id=? AND cs.conversation_id=? AND cs.status='running'
        ORDER BY cp.updated_at DESC LIMIT 1
      `).get(spec.projectId, spec.conversationId);
      candidateJobs = sqlite.prepare(`
        SELECT id, tool_id, params_json, status, created_at, is_test_run
        FROM tool_jobs
        WHERE project_id=? AND id<>? AND status='running' AND created_at>=?
        ORDER BY created_at DESC, id DESC
      `).all(spec.projectId, spec.jobId, hold.notBeforeEpochMs);
    } catch (error) {
      closed = true;
      clearInterval(timer);
      throw error;
    }
    let pendingPreview = null;
    try {
      pendingPreview = checkpoint?.pending_preview_json
        ? JSON.parse(checkpoint.pending_preview_json)
        : null;
    } catch {
      return;
    }
    if (candidateJobs?.length !== 1) {
      if (checkpoint && Array.isArray(candidateJobs) && candidateJobs.length > 0) {
        const diagnostic = stableHash({
          candidateJobCount: candidateJobs.length,
          checkpointStage: pendingPreview?.stage || null,
        });
        if (diagnostic !== lastDiagnostic) {
          lastDiagnostic = diagnostic;
          writeSync(2, `[p5-worker-checkpoint-hold] waiting:${JSON.stringify({
            candidateJobCount: candidateJobs.length,
            checkpointStageExact: pendingPreview?.stage === hold.checkpointStage,
          })}\n`);
        }
      }
      return;
    }
    const candidateJob = candidateJobs[0];
    let candidateParams = null;
    let baselineParams = null;
    let baselineInputSha256 = null;
    try {
      candidateParams = JSON.parse(candidateJob.params_json || '{}');
      const baselineJob = sqlite.prepare(`
        SELECT params_json, result_json FROM tool_jobs WHERE id=? AND project_id=?
      `).get(spec.jobId, spec.projectId);
      baselineParams = JSON.parse(baselineJob?.params_json || '{}');
      const baselineResult = JSON.parse(baselineJob?.result_json || '{}');
      const baselineInput = (baselineResult.executionProvenance?.inputs || [])
        .filter((entry) => entry?.id === 'deg_table');
      if (baselineInput.length !== 1 || !SHA256.test(baselineInput[0].sha256 || '')) return;
      baselineInputSha256 = baselineInput[0].sha256;
    } catch {
      return;
    }
    const expectedParams = { ...baselineParams, ...(spec.parameterPatch || {}) };
    const candidateParamKeys = Object.keys(candidateParams).sort();
    const expectedParamKeys = Object.keys(expectedParams).sort();
    const nonFileParamsExact = candidateParamKeys.length === expectedParamKeys.length
      && candidateParamKeys.every((key, index) => key === expectedParamKeys[index])
      && expectedParamKeys.filter((key) => key !== 'deg_table')
        .every((key) => stableHash(candidateParams[key]) === stableHash(expectedParams[key]));
    const project = dbModule.getProject(spec.projectId);
    let expectedInputRoot = '';
    let expectedInput = '';
    let candidateInput = '';
    try {
      expectedInputRoot = realpathSync(path.resolve(
        project?.workspace_path || '', 'results', 'jobs', spec.jobId,
      ));
      expectedInput = typeof baselineParams.deg_table === 'string'
        ? realpathSync(path.resolve(expectedInputRoot, baselineParams.deg_table))
        : '';
      candidateInput = typeof candidateParams.deg_table === 'string'
        ? realpathSync(candidateParams.deg_table)
        : '';
    } catch {
      expectedInputRoot = '';
      expectedInput = '';
      candidateInput = '';
    }
    const inputExact = typeof baselineParams.deg_table === 'string'
      && candidateInput === expectedInput
      && candidateInput.startsWith(`${expectedInputRoot}${path.sep}`)
      && existsSync(candidateInput)
      && sha256(readFileSync(candidateInput)) === baselineInputSha256;
    const candidateJobExact = candidateJob.tool_id === hold.expectedToolId
      && candidateJob.status === 'running'
      && candidateJob.is_test_run === 0
      && Number(candidateJob.created_at) >= hold.notBeforeEpochMs
      && nonFileParamsExact
      && inputExact;
    if (!candidateJobExact) {
      resumePausedRuntime();
      const detail = {
        toolExact: candidateJob.tool_id === hold.expectedToolId,
        statusExact: candidateJob.status === 'running',
        nonTest: candidateJob.is_test_run === 0,
        createdAfterHold: Number(candidateJob.created_at) >= hold.notBeforeEpochMs,
        nonFileParamsExact,
        inputExact,
        candidateParamCount: candidateParamKeys.length,
        expectedParamCount: expectedParamKeys.length,
      };
      const diagnostic = stableHash(detail);
      if (diagnostic !== lastDiagnostic) {
        lastDiagnostic = diagnostic;
        writeSync(2, `[p5-worker-checkpoint-hold] candidate_not_exact:${JSON.stringify(detail)}\n`);
      }
      return;
    }

    const candidateJobDir = path.resolve(
      project?.workspace_path || '', 'results', 'jobs', candidateJob.id,
    );
    const candidateRunScript = path.join(candidateJobDir, 'run-script.R');
    const expectedJobDirPaths = existingPathAliases(candidateJobDir);
    const expectedRunScriptPaths = existingPathAliases(candidateRunScript);
    if (expectedJobDirPaths.length === 0 || expectedRunScriptPaths.length === 0) return;
    const processInspection = spawnSync('ps', [
      '-axo', 'pid=,ppid=,pgid=,stat=,command=',
    ], { cwd: ROOT, encoding: 'utf8' });
    const runtimeProcess = processInspection.status === 0
      ? inspectP5AcceptanceRuntimeProcessOutput(processInspection.stdout, {
        workerPid: process.pid,
        trustedRuntimePaths: runtimeIdentity.rscriptCommandPaths,
        trustedRuntimeExecCommandPaths: runtimeIdentity.execCommandPaths,
        expectedRunScriptPaths,
        expectedJobDirPaths,
      })
      : null;
    const kernelExecutablePath = runtimeProcess
      ? readP5AcceptanceProcessExecutablePath(runtimeProcess.pid)
      : null;
    if (!runtimeProcess || !runtimeIdentity.executablePaths.includes(kernelExecutablePath)) return;
    if (pausedRuntimePid == null) {
      try {
        process.kill(runtimeProcess.pid, 'SIGSTOP');
        pausedRuntimePid = runtimeProcess.pid;
        pausedCandidateJobId = candidateJob.id;
      } catch {
        return;
      }
      return;
    }
    if (pausedRuntimePid !== runtimeProcess.pid
        || pausedCandidateJobId !== candidateJob.id
        || !/^T/.test(runtimeProcess.state)) return;

    // Pause the exact scientific runtime as soon as the running candidate Job
    // is fully identified. The worker remains live so candidate Git/checkpoint
    // persistence can finish without racing a fast R child into a zombie.
    if (!checkpoint || pendingPreview?.stage !== hold.checkpointStage) return;

    closed = true;
    clearInterval(timer);
    try {
      writeSync(1, `${P5_WORKER_CHECKPOINT_HOLD_MARKER}${JSON.stringify({
        version: 1,
        mode: hold.mode,
        checkpointStage: pendingPreview.stage,
        changeSetId: checkpoint.change_set_id,
        checkpointId: checkpoint.checkpoint_id,
        candidateJobId: candidateJob.id,
        candidateJobExact: true,
        candidateInputExact: true,
        candidateRuntimePausedBeforeCheckpoint: true,
      })}\n`);
    } catch (error) {
      resumePausedRuntime();
      throw error;
    }
    groupHoldCommitted = true;
    try {
      process.kill(-process.pid, 'SIGSTOP');
    } catch (error) {
      groupHoldCommitted = false;
      resumePausedRuntime();
      throw error;
    }
    // No successful P6 run resumes this worker: the parent sends SIGKILL to
    // the stopped process group.  Reaching this line means the protocol was
    // externally violated and must fail closed rather than finish the edit.
    throw new Error('p5_worker_checkpoint_hold_resumed_without_sigkill');
  }, 2);
  timer.unref?.();
  return () => {
    closed = true;
    clearInterval(timer);
    resumePausedRuntime();
  };
}

function runWorker(env, spec) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(spec)).toString('base64url');
    const child = spawn(process.execPath, [SELF, '--worker', payload], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), JOB_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const marker = stdout.lastIndexOf(WORKER_MARKER);
      if (code !== 0 || marker < 0) {
        reject(new Error(`p5_worker_failed:${code}:${stderr.slice(-1600)}`));
        return;
      }
      try { resolve(JSON.parse(stdout.slice(marker + WORKER_MARKER.length).trim())); }
      catch (error) { reject(new Error(`p5_worker_result_invalid:${error.message}`)); }
    });
  });
}

async function runWorkerMain() {
  const payload = process.argv[process.argv.indexOf('--worker') + 1];
  const spec = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const db = require(path.join(ROOT, 'core/biof3-server/db.js'));
  const project = db.getProject(spec.projectId);
  if (!project) throw new Error('worker_project_not_found');
  const ownerId = String(project.user_id || 'local-user');
  // Worker processes do not pass through server.js bootstrap. Loading the
  // registered execution boundary here initializes the same validated
  // built-in/installed/development plugin sources before any Agent tool reads
  // a trusted Result Studio descriptor.
  const mcpRegistry = require(path.join(ROOT, 'core/biof3-server/mcp/registry.js'));

  if (spec.op === 'selection_enrichment') {
    const { tool_result_selection_run: runSelection } = require(
      path.join(ROOT, 'core/biof3-server/agent-tools/result-selection-tools.js')
    );
    const result = await runSelection({
      selectionId: spec.selectionId,
      action: 'go_kegg',
      species: 'human',
      geneIdType: 'SYMBOL',
      analysisType: 'all',
    }, { projectId: spec.projectId, userId: ownerId, accessMode: 'full', allowExecution: true });
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(result))}\n`);
    return;
  }

  if (spec.op === 'artifact_tool_run') {
    const { tool_run_tool: runTool } = require(
      path.join(ROOT, 'core/biof3-server/agent-tools/learning.js')
    );
    const { createResultStudioRepository } = require(
      path.join(ROOT, 'core/shared-backend/result-studio-repository.js')
    );
    const repository = createResultStudioRepository(db.db || db.getDatabase());
    const sourceRevision = repository.getRevision(spec.sourceRevisionId);
    const inputId = String(spec.inputId || '').trim();
    const inputPath = inputId && typeof spec.params?.[inputId] === 'string'
      ? spec.params[inputId]
      : null;
    if (spec.toolId !== 'volcano-plot' || inputId !== 'deg_table') {
      throw new Error('worker_artifact_tool_not_admitted');
    }
    if (!sourceRevision
        || sourceRevision.projectId !== spec.projectId
        || sourceRevision.artifactId !== inputId
        || !inputPath
        || sha256(readFileSync(inputPath)) !== sourceRevision.outputHash) {
      throw new Error('worker_artifact_lineage_unverified');
    }
    const result = await runTool({
      op: 'run',
      toolId: spec.toolId,
      params: spec.params,
    }, {
      projectId: spec.projectId,
      userId: ownerId,
      accessMode: 'full',
      allowExecution: true,
      resultStudioInputLineage: {
        [inputId]: {
          lineageVersion: 1,
          kind: 'artifact',
          sourceRevisionId: sourceRevision.revisionId,
          sourceToolJobId: sourceRevision.toolJobId,
          sourceArtifactId: sourceRevision.artifactId,
          sourceOutputHash: sourceRevision.outputHash,
          materializationHash: sourceRevision.outputHash,
        },
      },
    });
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(result))}\n`);
    return;
  }

  const { createResultContextEditTools, resolveResultStudioContext } = require(
    path.join(ROOT, 'core/biof3-server/agent-tools/result-context-edit-tools.js')
  );
  const { createResultChangeSetTools } = require(
    path.join(ROOT, 'core/biof3-server/agent-tools/result-edit-tools.js')
  );
  const ctx = {
    projectId: spec.projectId,
    userId: ownerId,
    conversationId: spec.conversationId || null,
    accessMode: 'full',
    allowExecution: true,
    activeArtifact: {
      jobId: spec.jobId,
      name: spec.artifact,
      revisionId: spec.revisionId,
    },
    emitResultEditProgress() {},
  };
  const changeSetTools = createResultChangeSetTools({
    callTool(toolId, params, toolContext) {
      return mcpRegistry.callTool(toolId, params, {
        ...toolContext,
        userId: ownerId,
        accessMode: 'full',
        allowExecution: true,
      });
    },
  });
  const tools = createResultContextEditTools({ changeSetTools });

  if (spec.op === 'derive_enrichment') {
    const resolved = resolveResultStudioContext(ctx);
    if (!resolved?.ok) throw new Error(`worker_context_unavailable:${resolved?.diagnostics?.[0]?.code || 'unknown'}`);
    const result = await tools.deriveEnrichmentFromCurrentResult({
      contextToken: resolved.envelope.contextToken,
      species: 'human',
      geneIdType: 'SYMBOL',
      analysisType: 'GO-BP',
      padjCutoff: spec.padjCutoff,
      lfcCutoff: spec.lfcCutoff,
    }, ctx);
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(result))}\n`);
    return;
  }

  if (!['context_edit', 'context_edit_graph_loss'].includes(spec.op)) {
    throw new Error(`worker_operation_unsupported:${spec.op}`);
  }
  const planArgs = {
    requestedOutcome: spec.requestedOutcome,
    proposedParameterPatch: spec.parameterPatch,
    useCurrentSelectionForLabels: spec.useCurrentSelectionForLabels === true,
    editOrigin: 'agent',
    userMessageId: 'p5-live-scientific-edit',
  };
  const planned = await tools.plan(planArgs, ctx);
  if (!planned?.ok || !planned.intent || !planned.context?.contextToken) {
    const error = new Error(`worker_edit_plan_failed:${planned?.error || planned?.diagnostics?.[0]?.code || 'unknown'}`);
    error.detail = planned;
    throw error;
  }
  if (spec.op === 'context_edit_graph_loss') {
    const graphId = planned.intent.workflowGraph?.graphId;
    if (!graphId) throw new Error('worker_graph_loss_fixture_missing_graph');
    const resolvedBeforeLoss = resolveResultStudioContext(ctx);
    const persistedGraph = resolvedBeforeLoss?.workflowSnapshot;
    if (!persistedGraph || persistedGraph.graphId !== graphId) {
      throw new Error('worker_graph_loss_fixture_missing_persisted_snapshot');
    }
    const sqlite = typeof db.getDatabase === 'function' ? db.getDatabase() : db.db;
    const removed = sqlite.prepare('DELETE FROM result_workflow_graphs WHERE graph_id=?').run(graphId);
    if (removed.changes !== 1) throw new Error('worker_graph_loss_fixture_did_not_remove_graph');
    let blocked;
    try {
      blocked = await changeSetTools.create({
        intent: planned.intent,
        scientificConfirmed: planned.intent.requiresScientificConfirmation === true,
      }, { ...ctx, resultStudioTrustedIntent: true });
    } finally {
      resolvedBeforeLoss.repository.saveWorkflowGraph(persistedGraph);
    }
    if (blocked?.ok) throw new Error('worker_graph_loss_was_not_blocked');
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify({
      ok: true,
      graphId,
      blockedError: blocked?.error || null,
      diagnostics: blocked?.diagnostics || [],
    })}\n`);
    return;
  }
  const releaseCheckpointHold = installP6AcceptanceCheckpointHold(spec, db);
  let created;
  try {
    created = await tools.create({
      contextToken: planned.context.contextToken,
      intent: planned.intent,
      scientificConfirmed: planned.intent.requiresScientificConfirmation === true,
    }, ctx);
  } finally {
    releaseCheckpointHold();
  }
  if (!created?.ok || created.changeSet?.status !== 'preview_ready') {
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(created))}\n`);
    return;
  }
  process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary({
    ...created,
    plan: {
      editClass: planned.intent.editClass,
      affectedScope: planned.intent.affectedScope,
      affectedNodeCount: planned.intent.affectedNodeIds.length,
      selectionLabelsBound: planned.selectionLabelsBound,
      contextToken: planned.context.contextToken,
    },
  }))}\n`);
}

async function openInteraction(baseUrl, { projectId, job, artifactId, revisionId = null }) {
  const artifact = artifactFileName(job, artifactId);
  const query = new URLSearchParams({ projectId, jobId: job.id, artifact });
  if (revisionId) query.set('revisionId', revisionId);
  const interaction = await requestJson(baseUrl, `/api/result-studio/interaction?${query.toString()}`, { timeoutMs: 120_000 });
  assert(interaction.data?.revision?.revisionId, `formal_revision_missing:${artifactId}`, interaction.data?.manifest?.diagnostics);
  assert(interaction.data.revision.validationStatus === 'valid', `formal_revision_invalid:${artifactId}`);
  return { ...interaction.data, artifact };
}

function assertLiveP5Runtime(runtime) {
  assert(runtime?.kind === 'p5_live_scientific_runtime', 'p5_live_runtime_invalid');
  assert(runtime.closed !== true, 'p5_live_runtime_closed');
  assert(typeof runtime.baseUrl === 'string' && runtime.baseUrl.startsWith('http://127.0.0.1:'),
    'p5_live_runtime_url_invalid');
  assert(runtime.env?.BIOF3_DB_PATH && runtime.project?.id && runtime.conversation?.id,
    'p5_live_runtime_coordinates_missing');
  return runtime;
}

function p5ArtifactCoordinate(job, interaction, artifactId) {
  const revision = interaction?.revision || {};
  assert(job?.id && interaction?.artifact && revision.revisionId,
    `p5_live_baseline_coordinate_missing:${artifactId}`);
  return Object.freeze({
    jobId: job.id,
    artifactId,
    artifact: interaction.artifact,
    revisionId: revision.revisionId,
    artifactFamilyId: revision.artifactFamilyId || null,
  });
}

/**
 * Start an isolated P5 product runtime without manufacturing Result Studio
 * rows.  The returned coordinates are intentionally live-only: callers may
 * hand them to a disposable Electron driver, but they must never be copied
 * into canonical evidence (which is sanitized and source-bound separately).
 *
 * Call `await runtime.close()` in a finally block.  The normal P5 acceptance
 * does this automatically; P6 keeps the process alive long enough to perform
 * actual BrowserWindow interactions against the same truth ledger.
 */
export async function createP5LiveScientificRuntime({
  verbose = false,
  port = null,
  beforeStart = null,
} = {}) {
  const requestedPort = port == null ? await freePort() : Number(port);
  assert(Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535,
    'p5_live_runtime_port_invalid');
  const { root, env } = createCaptureEnv({ port: requestedPort });
  env.R_POOL_ENABLED = 'false';
  let server = null;
  let closed = false;
  let closePromise = null;
  const close = async ({ removeRoot = true } = {}) => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      await stopServer(server?.child);
      if (removeRoot && existsSync(root)) rmSync(root, { recursive: true, force: true });
    })();
    return closePromise;
  };

  try {
    await applyMigrations(env.BIOF3_DB_PATH, { quiet: true });
    const tables = inspectTables(env.BIOF3_DB_PATH);
    assert(tables.missing.length === 0, `migration_tables_missing:${tables.missing.join(',')}`);
    if (typeof beforeStart === 'function') {
      await beforeStart(Object.freeze({ root, env, port: requestedPort }));
    }
    server = await startServer(env, verbose
      ? { onLog: (channel, line) => console.error(`[p5-server:${channel}] ${line}`) }
      : {});
    const { baseUrl } = server;

    // The check happens after every schema/bootstrap side effect but before
    // either HTTP write.  A live UI trace therefore starts from exactly the
    // same unseeded product ledger contract as the canonical P5 capture.
    const noSeedPrecondition = assertP5NoSeedPrecondition(env.BIOF3_DB_PATH, { root });
    const createdProject = await postJson(baseUrl, '/api/data/projects', {
      name: 'P5 disposable scientific editing',
      description: 'G0-RS-P5 live no-seed scientific runtime',
      modality: 'bulk',
    });
    const project = createdProject.data?.project;
    assert(project?.id && project?.workspace_path, 'http_project_creation_failed');
    assert(path.resolve(project.workspace_path).startsWith(path.resolve(root) + path.sep),
      'project_workspace_not_isolated');

    // P5's original deterministic worker did not need a conversation.  P6's
    // product trace does: the real renderer must bind Result/Selection/Agent
    // context to an actual project conversation rather than an invented ID.
    const createdConversation = await postJson(baseUrl, '/api/ai/conversations', {
      title: 'P5 live scientific editing',
      projectId: project.id,
      lastPage: 'project-workspace',
    });
    const conversation = createdConversation.data?.conversation;
    assert(createdConversation.status === 200
      && conversation?.id
      && conversation.project_id === project.id,
    'http_project_conversation_creation_failed', createdConversation.data);

    const coordinates = Object.freeze({
      root,
      baseUrl,
      dbPath: env.BIOF3_DB_PATH,
      projectId: project.id,
      projectWorkspace: project.workspace_path,
      conversationId: conversation.id,
    });
    const runtime = {
      kind: 'p5_live_scientific_runtime',
      root,
      env,
      baseUrl,
      project,
      conversation,
      coordinates,
      tables,
      noSeedPrecondition,
      get closed() { return closed; },
      close,
    };
    runtime.runWorker = (spec) => runP5LiveWorker(runtime, spec);
    return runtime;
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * Run one of the existing P5 registered worker operations against a live
 * runtime.  Project and conversation coordinates are always injected from
 * the runtime, so a caller cannot accidentally aim a P6 helper at another
 * product ledger.
 */
export async function runP5LiveWorker(runtime, spec = {}) {
  const live = assertLiveP5Runtime(runtime);
  const requestedProjectId = spec.projectId == null ? live.project.id : spec.projectId;
  const requestedConversationId = spec.conversationId == null ? live.conversation.id : spec.conversationId;
  assert(requestedProjectId === live.project.id, 'p5_live_worker_cross_project_forbidden');
  assert(requestedConversationId === live.conversation.id, 'p5_live_worker_cross_conversation_forbidden');
  return runWorker(live.env, {
    ...spec,
    projectId: live.project.id,
    conversationId: live.conversation.id,
  });
}

/**
 * Produce only real, adopted baseline outputs for P6.  It intentionally does
 * not create a selection, candidate ChangeSet, adoption, revert or restore:
 * those are the user-visible UI-110 operations the Electron trace must drive
 * itself.  Repeated calls return the original baseline coordinates rather
 * than submitting a second set of Jobs.
 */
export async function prepareP5LiveScientificBaselines(runtime) {
  const live = assertLiveP5Runtime(runtime);
  if (live.baselines) return live.baselines;

  const { baseUrl } = live;
  const projectId = live.project.id;
  const scientificInput = buildScientificInput();
  const baselineLfc = 0.25;

  const deseqBaseline = await runHttpTool(baseUrl, {
    toolId: 'deseq2',
    projectId,
    params: {
      design: 'condition',
      contrast_ref: 'Control',
      contrast_treat: 'Treatment',
      padj_cutoff: 0.05,
      lfc_cutoff: baselineLfc,
    },
    files: {
      'counts.csv': Buffer.from(scientificInput.counts).toString('base64'),
      'coldata.csv': Buffer.from(scientificInput.coldata).toString('base64'),
    },
  });
  deseqBaseline.id = deseqBaseline.id || deseqBaseline.toolJobId;
  const degInteraction = await openInteraction(baseUrl, {
    projectId,
    job: deseqBaseline,
    artifactId: 'deg_table',
  });
  const changedLfc = chooseChangedLfcThreshold(
    artifactPath(deseqBaseline, 'deg_table'),
    baselineLfc,
  );

  const directEnrichment = await runP5LiveWorker(live, {
    op: 'derive_enrichment',
    jobId: deseqBaseline.id,
    artifact: degInteraction.artifact,
    revisionId: degInteraction.revision.revisionId,
    padjCutoff: 0.05,
    lfcCutoff: baselineLfc,
  });
  assert(directEnrichment.ok
    && directEnrichment.toolJobId
    && directEnrichment.workflowGraph?.validationStatus === 'valid',
  'direct_enrichment_workflow_failed', directEnrichment);
  const enrichmentBaseline = await waitForJob(baseUrl, directEnrichment.toolJobId);
  enrichmentBaseline.id = enrichmentBaseline.id || directEnrichment.toolJobId;
  const enrichmentInteraction = await openInteraction(baseUrl, {
    projectId,
    job: enrichmentBaseline,
    artifactId: 'go_bp_results',
  });

  const volcanoRun = await runP5LiveWorker(live, {
    op: 'artifact_tool_run',
    toolId: 'volcano-plot',
    sourceRevisionId: degInteraction.revision.revisionId,
    inputId: 'deg_table',
    params: {
      deg_table: artifactPath(deseqBaseline, 'deg_table'),
      fc_threshold: baselineLfc,
      pval_threshold: 1.3,
      top_n: 8,
    },
  });
  assert(volcanoRun.ok && volcanoRun.toolJobId,
    'volcano_baseline_lineage_run_failed', volcanoRun);
  const volcanoBaseline = await waitForJob(baseUrl, volcanoRun.toolJobId);
  volcanoBaseline.id = volcanoBaseline.id || volcanoBaseline.toolJobId;
  const volcanoInteraction = await openInteraction(baseUrl, {
    projectId,
    job: volcanoBaseline,
    artifactId: 'volcano',
  });

  const heatmapBaseline = await runHttpTool(baseUrl, {
    toolId: 'gene-correlation',
    projectId,
    params: {
      expr_matrix: 'expr_matrix.csv',
      top_n: 30,
      method: 'pearson',
    },
    files: {
      'expr_matrix.csv': Buffer.from(scientificInput.counts).toString('base64'),
    },
  });
  heatmapBaseline.id = heatmapBaseline.id || heatmapBaseline.toolJobId;
  assert(stagedInputIsNotAnArtifact(heatmapBaseline, 'expr_matrix', 'expr_matrix.csv'),
    'heatmap_baseline_input_exposed_as_artifact', heatmapBaseline.result?.artifactTruth);
  const heatmapInteraction = await openInteraction(baseUrl, {
    projectId,
    job: heatmapBaseline,
    artifactId: 'heatmap',
  });

  const availableGenes = new Set(readCsv(artifactPath(deseqBaseline, 'deg_table'))
    .map((row) => String(row.gene || '').trim()));
  const stableGeneIds = scientificInput.symbols.filter((gene) => availableGenes.has(gene)).slice(0, 24);
  assert(stableGeneIds.length >= 12, 'stable_gene_ids_unavailable_after_deseq2');

  const baselines = Object.freeze({
    baselineLfc,
    changedLfc,
    stableGeneIds: Object.freeze(stableGeneIds),
    deg: p5ArtifactCoordinate(deseqBaseline, degInteraction, 'deg_table'),
    enrichment: p5ArtifactCoordinate(enrichmentBaseline, enrichmentInteraction, 'go_bp_results'),
    volcano: p5ArtifactCoordinate(volcanoBaseline, volcanoInteraction, 'volcano'),
    heatmap: p5ArtifactCoordinate(heatmapBaseline, heatmapInteraction, 'heatmap'),
    directEnrichment: Object.freeze({
      jobId: enrichmentBaseline.id,
      workflowGraphId: directEnrichment.workflowGraph.graphId,
      workflowSourceDigest: directEnrichment.workflowGraph.sourceDigest,
    }),
  });
  live.baselines = baselines;
  return baselines;
}

export async function exactReplayRevision(baseUrl, {
  projectId,
  dbPath,
  workspaceRoot,
  job,
  artifactId,
  revisionId,
  expectedAffectedJobCount,
}) {
  const interaction = await openInteraction(baseUrl, { projectId, job, artifactId, revisionId });
  const sourceSnapshot = readChangeSetCohort(dbPath, interaction.revision.changeSetId);
  assert(sourceSnapshot.changeSet?.status === 'adopted'
    && sourceSnapshot.revisions.length > 0
    && sameStringSet(
      sourceSnapshot.changeSet.candidateArtifactRefs,
      sourceSnapshot.revisions.map((revision) => revision.revisionId),
    )
    && sourceSnapshot.revisions.some((revision) => revision.revisionId === revisionId),
  'replay_source_cohort_incomplete', sourceSnapshot);
  const context = (await requestJson(baseUrl,
    `/api/result-studio/context-envelope?${new URLSearchParams({
      projectId,
      jobId: job.id,
      artifact: interaction.artifact,
      revisionId,
    }).toString()}`)).data;
  const contextToken = context.agentView?.contextToken;
  assert(SHA256.test(contextToken || ''), 'replay_context_missing', { artifactId, revisionId });
  const source = (await requestJson(baseUrl,
    `/api/result-studio/revisions/${encodeURIComponent(revisionId)}/source?projectId=${encodeURIComponent(projectId)}`)).data;
  const preflight = (await postJson(baseUrl,
    `/api/result-studio/revisions/${encodeURIComponent(revisionId)}/replay`, {
      phase: 'preflight',
      projectId,
      revisionId,
      contextToken,
      expectedSourceSha256: source.sha256,
      expectedParametersHash: source.parameters?.sha256,
    })).data;
  assert(preflight.execution?.affectedJobCount === expectedAffectedJobCount
    && preflight.execution?.sourceRevisionCount === sourceSnapshot.revisions.length
    && preflight.execution?.requiresExactOutputCohort === true,
  'replay_preflight_incomplete', { artifactId, revisionId, execution: preflight.execution });
  assert(preflight.revision?.revisionId === revisionId
    && preflight.revision?.artifactId === artifactId
    && preflight.revision?.sourceSha256 === source.sha256
    && preflight.revision?.parametersHash === source.parameters?.sha256,
  'replay_preflight_identity_drift', { artifactId, revisionId, revision: preflight.revision });
  const replay = (await postJson(baseUrl,
    `/api/result-studio/revisions/${encodeURIComponent(revisionId)}/replay`, {
      phase: 'confirm',
      projectId,
      revisionId,
      contextToken,
      confirmationToken: preflight.confirmationToken,
    }, JOB_TIMEOUT_MS)).data;
  assert(replay.reproducibility?.exactMatch === true
    && replay.reproducibility?.sourceCohortVerified === true
    && replay.reproducibility?.sourceChangeSetId === sourceSnapshot.changeSet.changeSetId
    && replay.reproducibility?.replayChangeSetId === replay.changeSetId
    && replay.reproducibility?.artifactCount === sourceSnapshot.revisions.length
    && SHA256.test(replay.reproducibility?.outputCohortHash || '')
    && replay.parentRevisionId === revisionId
    && replay.revisionId !== revisionId
    && VALID_REPLAY_PACKAGE_STATUSES.has(replay.replayPackage?.status)
    && SHA256.test(replay.replayPackage?.packageDigest || '')
    && replay.adopted === false,
  'replay_exactness_failed', { artifactId, revisionId, reproducibility: replay.reproducibility });
  let packageRoot = null;
  let packageManifest = null;
  let packageManifestName = null;
  try {
    const realWorkspace = realpathSync(workspaceRoot);
    packageRoot = realpathSync(path.join(realWorkspace, replay.replayPackage.relativePath));
    if (packageRoot !== realWorkspace && !packageRoot.startsWith(`${realWorkspace}${path.sep}`)) {
      packageRoot = null;
    }
    if (packageRoot) {
      packageManifestName = ['cohort-manifest.json', 'package-manifest.json']
        .find((name) => existsSync(path.join(packageRoot, name))) || null;
      packageManifest = packageManifestName
        ? JSON.parse(readFileSync(path.join(packageRoot, packageManifestName), 'utf8'))
        : null;
    }
  } catch {}
  const { packageDigest, ...packagePayload } = packageManifest || {};
  assert(packageRoot
    && packageDigest === replay.replayPackage.packageDigest
    && (!packageManifest.status || packageManifest.status === replay.replayPackage.status)
    && stableHash(packagePayload) === packageDigest,
  'replay_package_physical_digest_mismatch', { packageRoot, packageManifestName, packageDigest });

  const databaseProof = replayCohortDatabaseProof(dbPath, {
    projectId,
    sourceChangeSetId: sourceSnapshot.changeSet.changeSetId,
    replayChangeSetId: replay.changeSetId,
  });
  const replayJobs = [];
  for (const replayJobId of databaseProof.replayChangeSet?.jobRefs || []) {
    const replayJob = await waitForJob(baseUrl, replayJobId);
    replayJob.id = replayJob.id || replayJobId;
    replayJobs.push(replayJob);
  }
  const replayGraphNodesExact = replayJobs.every((replayJob) => {
    const node = databaseProof.workflowGraph?.nodes?.find((entry) => entry.toolJobId === replayJob.id);
    return node
      && stableHash(node) === stableHash(workflowNodeExpectation(replayJob, node.dependsOn));
  });
  const selectedReplayRevision = databaseProof.replayRevisions
    .find((revision) => revision.revisionId === replay.revisionId);
  assert(databaseProof.exact
    && replayGraphNodesExact
    && selectedReplayRevision
    && selectedReplayRevision.parentRevisionIds.includes(revisionId)
    && candidateCohortMatchesJobs({
      changeSet: databaseProof.replayChangeSet,
      cohortRevisions: databaseProof.replayRevisions,
    }, replayJobs),
  'replay_database_cohort_mismatch', {
    replay,
    sourceRevisionIds: databaseProof.sourceRevisions.map((revision) => revision.revisionId),
    replayRevisionIds: databaseProof.replayRevisions.map((revision) => revision.revisionId),
    graphDiagnostics: databaseProof.graphIntegrity?.diagnostics || [],
  });
  return {
    interaction,
    source,
    sourceSnapshot,
    preflight,
    replay,
    databaseProof: { ...databaseProof, replayGraphNodesExact },
    replayJobs,
  };
}

async function verifyFormalSourceCohort(baseUrl, {
  projectId,
  workspaceRoot,
  created,
  expectedValidatorIds = null,
}) {
  const revisions = Array.isArray(created?.cohortRevisions) ? created.cohortRevisions : [];
  const summary = created?.changeSet?.validationSummary || {};
  const validatorIds = Array.isArray(summary.validatorIds) && summary.validatorIds.length > 0
    ? summary.validatorIds
    : expectedValidatorIds;
  assert(revisions.length > 0
    && summary.formalArtifactCount === revisions.length
    && Array.isArray(validatorIds) && validatorIds.length > 0
    && validatorIds.every((value) => typeof value === 'string' && value.trim()),
  'formal_source_validator_proof_missing', {
    formalArtifactCount: summary.formalArtifactCount,
    revisionCount: revisions.length,
    validatorIds,
  });
  const entries = [];
  const realWorkspace = realpathSync(workspaceRoot);
  for (const revision of revisions) {
    const source = (await requestJson(baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(revision.revisionId)}/source?projectId=${encodeURIComponent(projectId)}`)).data;
    const reproduction = source.reproduction || {};
    let outputPath = null;
    let outputHash = null;
    try {
      outputPath = realpathSync(path.join(realWorkspace, revision.outputPath));
      if ((outputPath === realWorkspace || outputPath.startsWith(`${realWorkspace}${path.sep}`))
          && statSync(outputPath).isFile()) {
        outputHash = sha256(readFileSync(outputPath));
      }
    } catch {}
    assert(source.revisionId === revision.revisionId
      && source.artifactId === revision.artifactId
      && source.sha256 === revision.sourceScriptRef?.sha256
      && sha256(source.content || '') === source.sha256
      && source.parameters?.sha256 === revision.parametersHash
      && source.parameters?.values && typeof source.parameters.values === 'object'
      && reproduction.status !== 'unavailable'
      && reproduction.replayable === true
      && Array.isArray(reproduction.inputDrift) && reproduction.inputDrift.length === 0
      && Array.isArray(reproduction.inputs) && reproduction.inputs.length > 0
      && reproduction.inputs.every((input) => input.status === 'intact' && SHA256.test(input.sha256 || ''))
      && typeof reproduction.runtime?.name === 'string' && reproduction.runtime.name.length > 0
      && typeof reproduction.runtime?.version === 'string' && reproduction.runtime.version.length > 0
      && reproduction.runtime?.readiness === true
      && typeof reproduction.plugin?.id === 'string' && reproduction.plugin.id.length > 0
      && typeof reproduction.plugin?.version === 'string' && reproduction.plugin.version.length > 0
      && typeof reproduction.plugin?.language === 'string' && reproduction.plugin.language.length > 0
      && reproduction.plugin?.packageConstraints
      && typeof reproduction.plugin.packageConstraints === 'object'
      && outputPath
      && SHA256.test(revision.outputHash || '')
      && outputHash === revision.outputHash
      && revision.validationStatus === 'valid',
    'formal_revision_source_incomplete', {
      artifactId: revision.artifactId,
      sourceSha256: source.sha256,
      parametersSha256: source.parameters?.sha256 || null,
      outputPath,
      outputHash,
      reproduction,
    });
    entries.push({ revision, source });
  }
  return {
    entries,
    validatorIds,
    digest: stableHash(entries.map(({ revision, source }) => ({
      artifactId: revision.artifactId,
      sourceSha256: source.sha256,
      parametersSha256: source.parameters.sha256,
      inputHashes: source.reproduction.inputs.map((input) => input.sha256),
      runtime: source.reproduction.runtime,
      plugin: source.reproduction.plugin,
    }))),
  };
}

async function createSelection(baseUrl, { projectId, interaction, entityIds, conversationId = null }) {
  assert(interaction.manifest?.selectionDurable === true, 'selection_mapping_not_durable');
  const selectionId = `sel_${randomUUID().replace(/-/g, '')}`;
  const saved = await postJson(baseUrl, '/api/result-studio/selection', {
    selectionId,
    projectId,
    conversationId,
    artifactId: interaction.manifest.artifactId,
    revisionId: interaction.revision.revisionId,
    entityType: interaction.manifest.entityType,
    entityIds,
    entityIdCount: entityIds.length,
    displayState: { durable: true, source: 'p5_real_table_selection' },
  });
  assert(saved.data?.selection?.entityIdsHash && saved.data.selection.entityIdCount === entityIds.length,
    'selection_persistence_failed');
  return saved.data.selection;
}

function comparisonArtifact(comparison, artifactId) {
  return (comparison?.artifacts || []).find((artifact) => artifact.artifactId === artifactId) || null;
}

function exactInputHashes(before, after) {
  const left = jobInputHashes(before);
  const right = jobInputHashes(after);
  return Object.keys(left).length > 0 && stableHash(left) === stableHash(right);
}

function readDatabaseTruth(dbPath, projectId) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(ROOT, 'core/biof3-server'), ROOT],
  }));
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const counts = {
      jobs: sqlite.prepare('SELECT COUNT(*) AS count FROM tool_jobs WHERE project_id=?').get(projectId).count,
      revisions: sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_revisions WHERE project_id=?').get(projectId).count,
      changeSets: sqlite.prepare('SELECT COUNT(*) AS count FROM scientific_change_sets WHERE project_id=?').get(projectId).count,
      workflowGraphs: sqlite.prepare('SELECT COUNT(*) AS count FROM result_workflow_graphs WHERE project_id=?').get(projectId).count,
      selections: sqlite.prepare('SELECT COUNT(*) AS count FROM result_selection_contexts WHERE project_id=?').get(projectId).count,
    };
    const statuses = sqlite.prepare(`
      SELECT status, COUNT(*) AS count FROM scientific_change_sets
      WHERE project_id=? GROUP BY status ORDER BY status
    `).all(projectId);
    const revisions = sqlite.prepare(`
      SELECT validation_status, reproducibility_status, is_current, COUNT(*) AS count
      FROM artifact_revisions WHERE project_id=?
      GROUP BY validation_status, reproducibility_status, is_current
      ORDER BY validation_status, reproducibility_status, is_current
    `).all(projectId);
    const { verifyWorkflowGraphIntegrity } = require(path.join(
      ROOT,
      'core/shared-backend/result-workflow-graph.js',
    ));
    const workflowGraphs = sqlite.prepare(`
      SELECT graph_id, contract_version, project_id, root_tool_job_id,
             source_digest, nodes_json, edges_json, validation_status
      FROM result_workflow_graphs WHERE project_id=? ORDER BY created_at, graph_id
    `).all(projectId).map((row) => {
      let nodes = null;
      let edges = null;
      try { nodes = JSON.parse(row.nodes_json); } catch {}
      try { edges = JSON.parse(row.edges_json); } catch {}
      const graph = {
        graphId: row.graph_id,
        contractVersion: row.contract_version,
        projectId: row.project_id,
        rootToolJobId: row.root_tool_job_id,
        sourceDigest: row.source_digest,
        nodes,
        edges,
        validationStatus: row.validation_status,
      };
      const integrity = verifyWorkflowGraphIntegrity(graph);
      return {
        ...graph,
        integrityValid: integrity?.ok === true,
        integrityDiagnostics: integrity?.diagnostics || [],
      };
    });
    return {
      counts,
      statuses,
      revisions,
      workflowGraphs,
      digest: stableHash({ counts, statuses, revisions, workflowGraphs }),
    };
  } finally {
    sqlite.close();
  }
}

function workflowNodeExpectation(job, dependsOn = []) {
  const jobId = String(job?.id || job?.toolJobId || '').trim();
  return {
    id: `job:${jobId}`,
    toolJobId: jobId,
    toolId: String(job?.tool_id || job?.toolId || '').trim(),
    artifactIds: [...new Set((job?.result?.executionProvenance?.artifacts || [])
      .map((artifact) => String(artifact?.id || '').trim()).filter(Boolean))].sort(),
    provenanceHash: job?.result?.executionProvenance?.provenanceHash || null,
    dependsOn: [...dependsOn].sort(),
  };
}

export function exactWorkflowGraph(truth, graphRef, {
  rootToolJobId,
  nodeIds = null,
  nodes = null,
  edge = null,
  edges = null,
  edgeCount = null,
}) {
  const expectedEdges = Array.isArray(edges) ? edges : edge ? [edge] : [];
  const expectedEdgeCount = edgeCount == null ? expectedEdges.length : edgeCount;
  const graph = truth.workflowGraphs.find((item) => item.graphId === graphRef?.graphId
    && item.sourceDigest === graphRef?.sourceDigest);
  const exactNodes = Array.isArray(nodes)
    ? Array.isArray(graph?.nodes)
      && graph.nodes.length === nodes.length
      && nodes.every((expected) => {
        const actual = graph.nodes.find((node) => node.id === expected.id);
        return actual && stableHash(actual) === stableHash(expected);
      })
    : sameStringSet(graph?.nodes?.map((node) => node.id), nodeIds);
  if (!graph || !graph.integrityValid || graph.validationStatus !== 'valid'
      || graph.rootToolJobId !== rootToolJobId
      || !exactNodes
      || graph.edges?.length !== expectedEdgeCount
      || expectedEdges.length !== expectedEdgeCount) return false;
  return expectedEdges.every((expected) => (graph.edges || []).some((item) =>
    Object.entries(expected).every(([key, value]) => item?.[key] === value)
  ));
}

export async function captureP5Acceptance({ writeEvidence = false, keep = false, verbose = false } = {}) {
  const startedAt = Date.now();
  const { root, env } = createCaptureEnv({ port: await freePort() });
  env.R_POOL_ENABLED = 'false';
  let server = null;
  try {
    await applyMigrations(env.BIOF3_DB_PATH, { quiet: true });
    const tables = inspectTables(env.BIOF3_DB_PATH);
    assert(tables.missing.length === 0, `migration_tables_missing:${tables.missing.join(',')}`);
    server = await startServer(env, verbose
      ? { onLog: (channel, line) => console.error(`[p5-server:${channel}] ${line}`) }
      : {});
    const { baseUrl } = server;

    // Server bootstrap is allowed to create schema only.  Inspect the live
    // disposable database immediately before the first HTTP product write so
    // a preloaded project, Job or Result Studio record cannot masquerade as a
    // real P5 journey.
    const noSeedPrecondition = assertP5NoSeedPrecondition(env.BIOF3_DB_PATH, { root });

    const createdProject = await postJson(baseUrl, '/api/data/projects', {
      name: 'P5 disposable scientific editing',
      description: 'G0-RS-P5 real no-seed acceptance',
      modality: 'bulk',
    });
    const project = createdProject.data?.project;
    assert(project?.id && project?.workspace_path, 'http_project_creation_failed');
    assert(path.resolve(project.workspace_path).startsWith(path.resolve(root) + path.sep), 'project_workspace_not_isolated');
    const projectId = project.id;
    const conversationId = null;
    const scientificInput = buildScientificInput();
    const baselineLfc = 0.25;

    const deseqBaseline = await runHttpTool(baseUrl, {
      toolId: 'deseq2',
      projectId,
      params: {
        design: 'condition',
        contrast_ref: 'Control',
        contrast_treat: 'Treatment',
        padj_cutoff: 0.05,
        lfc_cutoff: baselineLfc,
      },
      files: {
        'counts.csv': Buffer.from(scientificInput.counts).toString('base64'),
        'coldata.csv': Buffer.from(scientificInput.coldata).toString('base64'),
      },
    });
    deseqBaseline.id = deseqBaseline.id || deseqBaseline.toolJobId;
    const degBaseline = await openInteraction(baseUrl, {
      projectId,
      job: deseqBaseline,
      artifactId: 'deg_table',
    });
    const changedLfc = chooseChangedLfcThreshold(artifactPath(deseqBaseline, 'deg_table'), baselineLfc);

    const missingGraphFailure = await runWorker(env, {
      op: 'context_edit_graph_loss',
      projectId,
      conversationId,
      jobId: deseqBaseline.id,
      artifact: degBaseline.artifact,
      revisionId: degBaseline.revision.revisionId,
      requestedOutcome: 'Raise the absolute log2 fold-change cutoff.',
      parameterPatch: { lfc_cutoff: changedLfc },
    });
    assert(missingGraphFailure.ok
      && missingGraphFailure.blockedError === 'workflow_graph_stale_or_unpersisted',
    'missing_authoritative_graph_did_not_fail_closed', missingGraphFailure);

    const directEnrichment = await runWorker(env, {
      op: 'derive_enrichment',
      projectId,
      jobId: deseqBaseline.id,
      artifact: degBaseline.artifact,
      revisionId: degBaseline.revision.revisionId,
      padjCutoff: 0.05,
      lfcCutoff: baselineLfc,
    });
    assert(directEnrichment.ok && directEnrichment.toolJobId && directEnrichment.workflowGraph?.validationStatus === 'valid',
      'direct_enrichment_workflow_failed', directEnrichment);
    const enrichmentBaseline = await waitForJob(baseUrl, directEnrichment.toolJobId);
    enrichmentBaseline.id = enrichmentBaseline.id || directEnrichment.toolJobId;
    const enrichmentBaselineInteraction = await openInteraction(baseUrl, {
      projectId,
      job: enrichmentBaseline,
      artifactId: 'go_bp_results',
    });

    const scientificEdit = await runWorker(env, {
      op: 'context_edit',
      projectId,
      conversationId,
      jobId: deseqBaseline.id,
      artifact: degBaseline.artifact,
      revisionId: degBaseline.revision.revisionId,
      requestedOutcome: 'Raise the absolute log2 fold-change cutoff and recompute every affected enrichment result.',
      parameterPatch: { lfc_cutoff: changedLfc },
    });
    assert(scientificEdit.ok && scientificEdit.plan?.editClass === 'scientific_recompute'
      && scientificEdit.plan.affectedScope === 'workflow_subgraph'
      && scientificEdit.plan.affectedNodeCount === 2,
    'scientific_affected_subgraph_plan_failed', scientificEdit);
    assert(scientificEdit.changeSet?.jobRefs?.length === 2 && allCandidateRevisionsValid(scientificEdit),
      'scientific_candidate_cohort_invalid', scientificEdit.changeSet);
    const scientificRootJob = await waitForJob(baseUrl, scientificEdit.changeSet.jobRefs[0]);
    scientificRootJob.id = scientificRootJob.id || scientificEdit.changeSet.jobRefs[0];
    const scientificChildJob = await waitForJob(baseUrl, scientificEdit.changeSet.jobRefs[1]);
    scientificChildJob.id = scientificChildJob.id || scientificEdit.changeSet.jobRefs[1];
    const scientificComparison = (await requestJson(
      baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(scientificEdit.changeSet.changeSetId)}/compare`,
    )).data;
    const degDifference = comparisonArtifact(scientificComparison, 'deg_table')?.scientific;
    const enrichmentDifference = comparisonArtifact(scientificComparison, 'go_bp_results')?.scientific;
    assert(degDifference?.status === 'available'
      && degDifference.significantGenes.before.significantCount !== degDifference.significantGenes.after.significantCount
      && (degDifference.significantGenes.membership.gainedCount + degDifference.significantGenes.membership.lostCount) > 0,
    'deg_scientific_difference_missing', degDifference);
    assert(enrichmentDifference?.status === 'available'
      && enrichmentDifference.kind === 'functional_enrichment'
      && hasMeaningfulEnrichmentDifference(enrichmentDifference)
      && hasAuditedEnrichmentRankingAndDirection(enrichmentDifference),
    'enrichment_scientific_difference_missing', enrichmentDifference);
    const adoptedScientific = (await postJson(
      baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(scientificEdit.changeSet.changeSetId)}/adopt`,
      {},
    )).data;
    assert(adoptedScientific.changeSet?.status === 'adopted', 'scientific_adoption_failed');

    const scientificDegRevision = scientificEdit.cohortRevisions.find((revision) => revision.artifactId === 'deg_table');
    assert(scientificDegRevision?.revisionId, 'scientific_deg_revision_missing');
    const currentDeg = await openInteraction(baseUrl, {
      projectId,
      job: scientificRootJob,
      artifactId: 'deg_table',
      revisionId: scientificDegRevision.revisionId,
    });
    const scientificReplay = await exactReplayRevision(baseUrl, {
      projectId,
      dbPath: env.BIOF3_DB_PATH,
      workspaceRoot: project.workspace_path,
      job: scientificRootJob,
      artifactId: 'deg_table',
      revisionId: scientificDegRevision.revisionId,
      expectedAffectedJobCount: 2,
    });
    const replay = scientificReplay.replay;

    const currentDegRows = readCsv(artifactPath(scientificRootJob, 'deg_table'));
    const availableGenes = new Set(currentDegRows.map((row) => String(row.gene || '').trim()));
    const selectedGenes = scientificInput.symbols.filter((gene) => availableGenes.has(gene)).slice(0, 24);
    assert(selectedGenes.length >= 12, 'stable_gene_ids_unavailable_after_deseq2');
    const degSelection = await createSelection(baseUrl, {
      projectId,
      interaction: currentDeg,
      entityIds: selectedGenes,
      conversationId,
    });
    const selectionEnrichment = await runWorker(env, {
      op: 'selection_enrichment',
      projectId,
      selectionId: degSelection.selectionId,
    });
    assert(selectionEnrichment.ok && selectionEnrichment.selectionAction?.entityIdCount === selectedGenes.length
      && selectionEnrichment.workflowGraph?.validationStatus === 'valid',
    'stable_gene_selection_enrichment_failed', selectionEnrichment);
    const selectionEnrichmentJob = await waitForJob(baseUrl, selectionEnrichment.toolJobId);
    selectionEnrichmentJob.id = selectionEnrichmentJob.id || selectionEnrichment.toolJobId;
    const selectionArtifacts = artifactsById(selectionEnrichmentJob);
    assert(selectionArtifacts.has('go_bp_results') && selectionArtifacts.has('kegg_results'),
      'go_kegg_outputs_incomplete', [...selectionArtifacts.keys()]);
    const materializationRef = selectionEnrichment.selectionAction?.materialization?.output;
    assert(typeof materializationRef === 'string' && !path.isAbsolute(materializationRef)
      && !materializationRef.split('/').includes('..'),
    'selection_materialization_ref_invalid', materializationRef);
    const materializationPath = path.resolve(project.workspace_path, materializationRef);
    assert(materializationPath.startsWith(path.resolve(project.workspace_path) + path.sep)
      && existsSync(materializationPath),
    'selection_materialization_missing');
    const materializedGenes = readCsv(materializationPath).map((row) => String(row.gene || '').trim()).filter(Boolean);
    const selectionJobInput = (selectionEnrichmentJob.result?.executionProvenance?.inputs || [])
      .find((input) => input?.id === 'deg_table') || null;
    const selectionJobLineage = inputLineage(selectionEnrichmentJob, 'deg_table');
    const materializationHash = sha256(readFileSync(materializationPath));
    assert(sameStringSet(materializedGenes, selectedGenes)
      && materializedGenes.length === selectedGenes.length
      && selectionJobInput?.sha256 === materializationHash
      && selectionJobLineage?.kind === 'selection'
      && selectionJobLineage?.selectionId === degSelection.selectionId
      && selectionJobLineage?.selectionHash === degSelection.entityIdsHash
      && selectionJobLineage?.materializationHash === materializationHash
      && selectionJobLineage?.sourceRevisionId === scientificDegRevision.revisionId
      && selectionJobLineage?.sourceArtifactId === 'deg_table'
      && selectionJobLineage?.sourceOutputHash === scientificDegRevision.outputHash,
    'selection_materialization_or_lineage_drift', {
      selectedGenes,
      materializedGenes,
      selectionJobInput,
      selectionJobLineage,
      materializationHash,
    });

    const volcanoBaseline = await runHttpTool(baseUrl, {
      toolId: 'volcano-plot',
      projectId,
      params: {
        deg_table: artifactPath(scientificRootJob, 'deg_table'),
        fc_threshold: changedLfc,
        pval_threshold: 1.3,
        top_n: 8,
      },
    });
    volcanoBaseline.id = volcanoBaseline.id || volcanoBaseline.toolJobId;
    const volcanoInteraction = await openInteraction(baseUrl, {
      projectId,
      job: volcanoBaseline,
      artifactId: 'volcano',
    });
    const volcanoBaselineSnapshot = readChangeSetCohort(
      env.BIOF3_DB_PATH,
      volcanoInteraction.revision.changeSetId,
    );
    assert(volcanoBaselineSnapshot.changeSet?.status === 'adopted'
      && volcanoBaselineSnapshot.revisions.length > 0,
    'volcano_baseline_cohort_missing', volcanoBaselineSnapshot);
    const volcanoSelection = await createSelection(baseUrl, {
      projectId,
      interaction: volcanoInteraction,
      entityIds: selectedGenes.slice(0, 6),
      conversationId,
    });
    const volcanoEdit = await runWorker(env, {
      op: 'context_edit',
      projectId,
      conversationId,
      jobId: volcanoBaseline.id,
      artifact: volcanoInteraction.artifact,
      revisionId: volcanoInteraction.revision.revisionId,
      requestedOutcome: 'Label the selected genes and use an accessible palette with larger points and labels.',
      parameterPatch: {
        color_up: '#d55e00',
        color_down: '#0072b2',
        point_size: 2.6,
        label_size: 4.2,
        plot_width: 8,
        plot_height: 6,
      },
      useCurrentSelectionForLabels: true,
    });
    assert(volcanoEdit.ok && volcanoEdit.plan?.editClass === 'presentation_rerender'
      && volcanoEdit.plan?.selectionLabelsBound === volcanoSelection.entityIdCount
      && allCandidateRevisionsValid(volcanoEdit),
    'volcano_selection_edit_failed', volcanoEdit);
    const volcanoCandidateJob = await waitForJob(baseUrl, volcanoEdit.toolJobId);
    volcanoCandidateJob.id = volcanoCandidateJob.id || volcanoEdit.toolJobId;
    const volcanoCandidateArtifacts = artifactsById(volcanoCandidateJob);
    assert(volcanoCandidateArtifacts.has('volcano') && volcanoCandidateArtifacts.has('volcano_svg')
      && volcanoCandidateArtifacts.has('classified_table'),
    'volcano_png_svg_cohort_missing', [...volcanoCandidateArtifacts.keys()]);
    const requestedVolcanoLabels = selectedGenes.slice(0, 6);
    const volcanoParams = normalizedExecutionParams(volcanoCandidateJob);
    const volcanoPresentation = volcanoCandidateJob.result?.manifest?.summary?.presentation || null;
    const volcanoPngPath = artifactPath(volcanoCandidateJob, 'volcano');
    const volcanoSvgPath = artifactPath(volcanoCandidateJob, 'volcano_svg');
    const volcanoSvg = readFileSync(volcanoSvgPath, 'utf8');
    const volcanoPngSize = pngDimensions(volcanoPngPath);
    const volcanoPngRender = renderContractFromPng(volcanoPngPath);
    const volcanoSvgRender = renderContractFromSvg(volcanoSvg);
    assert(isPng(volcanoPngPath)
      && volcanoPngSize?.width === 2400 && volcanoPngSize?.height === 1800
      && /<svg\b/i.test(volcanoSvg)
      && svgIncludesColor(volcanoSvg, '#d55e00')
      && svgIncludesColor(volcanoSvg, '#0072b2')
      && artifactSha256(volcanoBaseline, 'volcano') !== artifactSha256(volcanoCandidateJob, 'volcano')
      && artifactSha256(volcanoBaseline, 'volcano_svg') !== artifactSha256(volcanoCandidateJob, 'volcano_svg')
      && artifactSha256(volcanoBaseline, 'classified_table') === artifactSha256(volcanoCandidateJob, 'classified_table')
      && sameStringSet(String(volcanoParams.label_genes || '').split(','), requestedVolcanoLabels)
      && volcanoParams.color_up === '#d55e00' && volcanoParams.color_down === '#0072b2'
      && volcanoParams.point_size === 2.6 && volcanoParams.label_size === 4.2
      && volcanoParams.plot_width === 8 && volcanoParams.plot_height === 6
      && sameStringSet(volcanoPresentation?.label_genes, requestedVolcanoLabels)
      && volcanoPresentation?.color_up === '#d55e00' && volcanoPresentation?.color_down === '#0072b2'
      && volcanoPresentation?.point_size === 2.6 && volcanoPresentation?.label_size === 4.2
      && volcanoPresentation?.plot_width === 8 && volcanoPresentation?.plot_height === 6
      && stableHash(volcanoPngRender) === stableHash(volcanoSvgRender)
      && sameStringSet(volcanoPngRender?.selectedLabelGenes, requestedVolcanoLabels)
      && requestedVolcanoLabels.every((gene) => volcanoPngRender?.renderedLabelGenes?.includes(gene))
      && volcanoPngRender?.palette?.up === '#d55e00'
      && volcanoPngRender?.palette?.down === '#0072b2'
      && volcanoPngRender?.pointSize === 2.6 && volcanoPngRender?.labelSize === 4.2
      && volcanoPngRender?.width === 8 && volcanoPngRender?.height === 6
      && volcanoPngRender?.dpi === 300,
    'volcano_render_semantics_missing', {
      volcanoPngSize,
      volcanoParams,
      volcanoPresentation,
      volcanoPngRender,
      volcanoSvgRender,
      requestedVolcanoLabels,
    });
    const volcanoComparison = (await requestJson(
      baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(volcanoEdit.changeSet.changeSetId)}/compare`,
    )).data;
    const volcanoScience = comparisonArtifact(volcanoComparison, 'classified_table')?.scientific;
    assert(volcanoScience?.status === 'available'
      && volcanoScience.classifications.membership.gainedCount === 0
      && volcanoScience.classifications.membership.lostCount === 0,
    'volcano_presentation_changed_science', volcanoScience);
    const adoptedVolcano = (await postJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(volcanoEdit.changeSet.changeSetId)}/adopt`, {})).data;
    assert(adoptedVolcano.changeSet?.status === 'adopted', 'volcano_adoption_failed');
    const adoptedVolcanoRevision = volcanoEdit.cohortRevisions.find((revision) => revision.artifactId === 'volcano');
    const volcanoReplay = await exactReplayRevision(baseUrl, {
      projectId,
      dbPath: env.BIOF3_DB_PATH,
      workspaceRoot: project.workspace_path,
      job: volcanoCandidateJob,
      artifactId: 'volcano',
      revisionId: adoptedVolcanoRevision.revisionId,
      expectedAffectedJobCount: 1,
    });

    // Task 5 must branch from an actual historical Revision. The first
    // presentation candidate is current at this point; the original baseline
    // Revision below is therefore historical and remains the explicit parent
    // of this alternative rather than being silently replaced with current.
    const historicalAlternative = await runWorker(env, {
      op: 'context_edit',
      projectId,
      conversationId,
      jobId: volcanoBaseline.id,
      artifact: volcanoInteraction.artifact,
      revisionId: volcanoInteraction.revision.revisionId,
      requestedOutcome: 'Create an alternative from this historical volcano version for comparison.',
      parameterPatch: {
        color_up: '#cc79a7',
        color_down: '#009e73',
        point_size: 2.2,
        label_size: 3.6,
        plot_width: 7.5,
        plot_height: 5.5,
      },
      useCurrentSelectionForLabels: true,
    });
    assert(historicalAlternative.ok
      && historicalAlternative.plan?.editClass === 'presentation_rerender'
      && allCandidateRevisionsValid(historicalAlternative),
    'historical_alternative_creation_failed', historicalAlternative);
    const historicalCandidateJob = await waitForJob(baseUrl, historicalAlternative.toolJobId);
    historicalCandidateJob.id = historicalCandidateJob.id || historicalAlternative.toolJobId;
    const historicalSelectedRevision = historicalAlternative.cohortRevisions
      .find((revision) => revision.artifactId === 'volcano');
    const historicalParentsExact = historicalCohortHasExactParents({
      baselineCohort: volcanoBaselineSnapshot.revisions,
      adoptedCohort: volcanoEdit.cohortRevisions,
      historicalCohort: historicalAlternative.cohortRevisions,
    });
    assert(historicalSelectedRevision && historicalParentsExact,
    'historical_alternative_parent_drift', {
      historicalRevisionId: volcanoInteraction.revision.revisionId,
      currentRevisionId: adoptedVolcanoRevision.revisionId,
      baselineRevisionIds: volcanoBaselineSnapshot.revisions.map((revision) => revision.revisionId),
      adoptedRevisionIds: volcanoEdit.cohortRevisions.map((revision) => revision.revisionId),
      candidates: historicalAlternative.cohortRevisions,
    });
    const historicalParams = normalizedExecutionParams(historicalCandidateJob);
    const historicalComparison = (await requestJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(historicalAlternative.changeSet.changeSetId)}/compare`)).data;
    const historicalVisual = comparisonArtifact(historicalComparison, 'volcano');
    const historicalTable = comparisonArtifact(historicalComparison, 'classified_table');
    assert(historicalComparison.changeSet?.status === 'preview_ready'
      && historicalComparison.jsonDiffs?.length > 0
      && historicalVisual?.kind === 'visual'
      && historicalVisual.beforeHash === artifactSha256(volcanoBaseline, 'volcano')
      && historicalVisual.afterHash === artifactSha256(historicalCandidateJob, 'volcano')
      && historicalVisual.beforeHash !== historicalVisual.afterHash
      && historicalTable?.beforeHash === artifactSha256(volcanoBaseline, 'classified_table')
      && historicalTable.afterHash === artifactSha256(historicalCandidateJob, 'classified_table')
      && historicalTable.beforeHash === historicalTable.afterHash
      && historicalParams.color_up === '#cc79a7'
      && historicalParams.color_down === '#009e73'
      && historicalParams.point_size === 2.2
      && historicalParams.label_size === 3.6
      && historicalParams.plot_width === 7.5
      && historicalParams.plot_height === 5.5,
    'historical_alternative_compare_missing', historicalComparison);
    const revertedVolcano = (await postJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(volcanoEdit.changeSet.changeSetId)}/revert`,
      { reason: 'p5_historical_branch_base' })).data;
    assert(revertedVolcano.changeSet?.status === 'reverted', 'volcano_branch_base_revert_failed');
    const adoptedHistorical = (await postJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(historicalAlternative.changeSet.changeSetId)}/adopt`, {})).data;
    assert(adoptedHistorical.changeSet?.status === 'adopted', 'historical_alternative_adoption_failed');
    const historicalReplay = await exactReplayRevision(baseUrl, {
      projectId,
      dbPath: env.BIOF3_DB_PATH,
      workspaceRoot: project.workspace_path,
      job: historicalCandidateJob,
      artifactId: 'volcano',
      revisionId: historicalSelectedRevision.revisionId,
      expectedAffectedJobCount: 1,
    });
    const revertedHistorical = (await postJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(historicalAlternative.changeSet.changeSetId)}/revert`,
      { reason: 'p5_historical_lifecycle' })).data;
    assert(revertedHistorical.changeSet?.status === 'reverted', 'historical_alternative_revert_failed');
    const preRestoreCurrentCohort = readCurrentCohort(
      env.BIOF3_DB_PATH,
      projectId,
      historicalAlternative.cohortRevisions,
    );
    assert(preRestoreCurrentCohort.length === historicalAlternative.cohortRevisions.length,
      'restore_parent_cohort_incomplete', preRestoreCurrentCohort);
    const restoredVolcano = (await postJson(baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(historicalSelectedRevision.revisionId)}/restore`, {})).data;
    const restoredFreshBeforeReplay = restoredCohortIsFresh(
      historicalAlternative,
      restoredVolcano,
      preRestoreCurrentCohort,
    );
    assert(restoredVolcano.restored === true
      && restoredVolcano.revision?.revisionOrdinal > historicalSelectedRevision.revisionOrdinal
      && restoredFreshBeforeReplay,
    'volcano_historical_restore_failed', restoredVolcano);
    const restoredReplay = await exactReplayRevision(baseUrl, {
      projectId,
      dbPath: env.BIOF3_DB_PATH,
      workspaceRoot: project.workspace_path,
      job: historicalCandidateJob,
      artifactId: 'volcano',
      revisionId: restoredVolcano.revision.revisionId,
      expectedAffectedJobCount: 1,
    });
    const restoredAfterReplaySnapshot = readChangeSetCohort(
      env.BIOF3_DB_PATH,
      restoredVolcano.changeSet.changeSetId,
    );
    assert(restoredAfterReplaySnapshot.revisions.length === restoredVolcano.cohortRevisions.length
      && restoredAfterReplaySnapshot.revisions.every((revision) =>
        revision.isCurrent === true && revision.reproducibilityStatus === 'verified'),
    'restored_cohort_replay_status_missing', restoredAfterReplaySnapshot);

    const heatmapBaseline = await runHttpTool(baseUrl, {
      toolId: 'gene-correlation',
      projectId,
      params: {
        expr_matrix: 'expr_matrix.csv',
        top_n: 30,
        method: 'pearson',
      },
      files: {
        'expr_matrix.csv': Buffer.from(scientificInput.counts).toString('base64'),
      },
    });
    heatmapBaseline.id = heatmapBaseline.id || heatmapBaseline.toolJobId;
    assert(stagedInputIsNotAnArtifact(heatmapBaseline, 'expr_matrix', 'expr_matrix.csv'),
      'heatmap_baseline_input_exposed_as_artifact', heatmapBaseline.result?.artifactTruth);
    const heatmapInteraction = await openInteraction(baseUrl, {
      projectId,
      job: heatmapBaseline,
      artifactId: 'heatmap',
    });
    const heatmapEdit = await runWorker(env, {
      op: 'context_edit',
      projectId,
      conversationId,
      jobId: heatmapBaseline.id,
      artifact: heatmapInteraction.artifact,
      revisionId: heatmapInteraction.revision.revisionId,
      requestedOutcome: 'Change the heatmap palette, displayed clustering and numeric annotations without changing the correlation computation.',
      parameterPatch: {
        color_low: '#2166ac',
        color_mid: '#f7f7f7',
        color_high: '#b2182b',
        cluster_rows: false,
        cluster_cols: true,
        show_correlation_values: true,
        base_font_size: 10,
      },
    });
    assert(heatmapEdit.ok && heatmapEdit.plan?.editClass === 'presentation_rerender'
      && heatmapEdit.plan?.affectedScope === 'current_result_only'
      && allCandidateRevisionsValid(heatmapEdit),
    'heatmap_presentation_boundary_failed', heatmapEdit);
    const heatmapCandidateJob = await waitForJob(baseUrl, heatmapEdit.toolJobId);
    heatmapCandidateJob.id = heatmapCandidateJob.id || heatmapEdit.toolJobId;
    assert(stagedInputIsNotAnArtifact(heatmapCandidateJob, 'expr_matrix', 'expr_matrix.csv'),
      'heatmap_candidate_input_exposed_as_artifact', heatmapCandidateJob.result?.artifactTruth);
    const heatmapParams = normalizedExecutionParams(heatmapCandidateJob);
    const heatmapDisplay = heatmapCandidateJob.result?.manifest?.summary?.display || null;
    const heatmapPngPath = artifactPath(heatmapCandidateJob, 'heatmap');
    const heatmapPngSize = pngDimensions(heatmapPngPath);
    const heatmapBaselineRender = renderContractFromPng(artifactPath(heatmapBaseline, 'heatmap'));
    const heatmapCandidateRender = renderContractFromPng(heatmapPngPath);
    const heatmapBaselineCorrelationHash = artifactSha256(heatmapBaseline, 'corr_matrix');
    const heatmapCandidateCorrelationHash = artifactSha256(heatmapCandidateJob, 'corr_matrix');
    const correlationMatrix = readSquareMatrix(artifactPath(heatmapCandidateJob, 'corr_matrix'), 30);
    const correlationGeneIds = correlationMatrix.rowIds;
    const heatmapComparison = (await requestJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(heatmapEdit.changeSet.changeSetId)}/compare`)).data;
    const correlationArtifact = comparisonArtifact(heatmapComparison, 'corr_matrix');
    assert(SHA256.test(correlationArtifact?.beforeHash || '')
      && SHA256.test(correlationArtifact?.afterHash || '')
      && correlationArtifact.beforeHash === heatmapBaselineCorrelationHash
      && correlationArtifact.afterHash === heatmapCandidateCorrelationHash
      && correlationArtifact.beforeHash === correlationArtifact.afterHash
      && correlationMatrix.exact
      && artifactSha256(heatmapBaseline, 'heatmap') !== artifactSha256(heatmapCandidateJob, 'heatmap')
      && isPng(heatmapPngPath) && heatmapPngSize?.width === 2100 && heatmapPngSize?.height === 1800
      && heatmapParams.color_low === '#2166ac' && heatmapParams.color_mid === '#f7f7f7'
      && heatmapParams.color_high === '#b2182b'
      && heatmapParams.cluster_rows === false && heatmapParams.cluster_cols === true
      && heatmapParams.show_correlation_values === true && heatmapParams.base_font_size === 10
      && heatmapDisplay?.color_low === '#2166ac' && heatmapDisplay?.color_mid === '#f7f7f7'
      && heatmapDisplay?.color_high === '#b2182b'
      && heatmapDisplay?.cluster_rows === false && heatmapDisplay?.cluster_cols === true
      && heatmapDisplay?.show_correlation_values === true && heatmapDisplay?.base_font_size === 10
      && heatmapCandidateRender?.palette?.low === '#2166ac'
      && heatmapCandidateRender?.palette?.mid === '#f7f7f7'
      && heatmapCandidateRender?.palette?.high === '#b2182b'
      && heatmapCandidateRender?.clusterRows === false
      && heatmapCandidateRender?.clusterCols === true
      && heatmapCandidateRender?.showCorrelationValues === true
      && heatmapCandidateRender?.displayedCorrelationValueCount === correlationGeneIds.length ** 2
      && heatmapCandidateRender?.baseFontSize === 10
      && Array.isArray(heatmapCandidateRender?.renderedRowOrder)
      && JSON.stringify(heatmapCandidateRender.renderedRowOrder) === JSON.stringify(correlationMatrix.rowIds)
      && sameStringSet(heatmapCandidateRender?.renderedColumnOrder, correlationMatrix.columnIds)
      && stableHash(heatmapBaselineRender?.palette) !== stableHash(heatmapCandidateRender?.palette)
      && heatmapBaselineRender?.showCorrelationValues === false,
    'heatmap_presentation_semantics_failed', {
      correlationArtifact,
      heatmapPngSize,
      heatmapParams,
      heatmapDisplay,
      heatmapBaselineRender,
      heatmapCandidateRender,
      correlationMatrix,
    });

    const heatmapScientificEdit = await runWorker(env, {
      op: 'context_edit',
      projectId,
      conversationId,
      jobId: heatmapBaseline.id,
      artifact: heatmapInteraction.artifact,
      revisionId: heatmapInteraction.revision.revisionId,
      requestedOutcome: 'Recompute the heatmap from a smaller gene set using Spearman correlation.',
      parameterPatch: { top_n: 20, method: 'spearman' },
    });
    assert(heatmapScientificEdit.ok
      && ['data_transform', 'scientific_recompute', 'workflow_replan'].includes(heatmapScientificEdit.plan?.editClass)
      && heatmapScientificEdit.plan?.affectedScope === 'workflow_subgraph'
      && allCandidateRevisionsValid(heatmapScientificEdit),
    'heatmap_scientific_compute_boundary_failed', heatmapScientificEdit);
    const heatmapScientificJob = await waitForJob(baseUrl, heatmapScientificEdit.toolJobId);
    heatmapScientificJob.id = heatmapScientificJob.id || heatmapScientificEdit.toolJobId;
    assert(stagedInputIsNotAnArtifact(heatmapScientificJob, 'expr_matrix', 'expr_matrix.csv'),
      'heatmap_scientific_input_exposed_as_artifact', heatmapScientificJob.result?.artifactTruth);
    const heatmapScientificComparison = (await requestJson(baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(heatmapScientificEdit.changeSet.changeSetId)}/compare`)).data;
    const computedCorrelationArtifact = comparisonArtifact(heatmapScientificComparison, 'corr_matrix');
    const heatmapScientificParams = normalizedExecutionParams(heatmapScientificJob);
    const heatmapScientificCorrelationHash = artifactSha256(heatmapScientificJob, 'corr_matrix');
    const heatmapScientificMatrix = readSquareMatrix(artifactPath(heatmapScientificJob, 'corr_matrix'), 20);
    assert(SHA256.test(computedCorrelationArtifact?.beforeHash || '')
      && SHA256.test(computedCorrelationArtifact?.afterHash || '')
      && computedCorrelationArtifact.beforeHash === heatmapBaselineCorrelationHash
      && computedCorrelationArtifact.afterHash === heatmapScientificCorrelationHash
      && computedCorrelationArtifact.beforeHash !== computedCorrelationArtifact.afterHash
      && heatmapScientificMatrix.exact,
    'heatmap_scientific_change_did_not_recompute_correlation_matrix', {
      computedCorrelationArtifact,
      heatmapScientificMatrix,
    });
    assert(heatmapScientificParams.top_n === 20 && heatmapScientificParams.method === 'spearman',
      'heatmap_scientific_parameters_missing', heatmapScientificParams);

    const [
      scientificSourceProof,
      volcanoSourceProof,
      historicalSourceProof,
      restoredSourceProof,
      heatmapSourceProof,
      heatmapScientificSourceProof,
    ] = await Promise.all([
      verifyFormalSourceCohort(baseUrl, { projectId, workspaceRoot: project.workspace_path, created: scientificEdit }),
      verifyFormalSourceCohort(baseUrl, { projectId, workspaceRoot: project.workspace_path, created: volcanoEdit }),
      verifyFormalSourceCohort(baseUrl, { projectId, workspaceRoot: project.workspace_path, created: historicalAlternative }),
      verifyFormalSourceCohort(baseUrl, {
        projectId,
        workspaceRoot: project.workspace_path,
        created: restoredVolcano,
        expectedValidatorIds: historicalAlternative.changeSet.validationSummary.validatorIds,
      }),
      verifyFormalSourceCohort(baseUrl, { projectId, workspaceRoot: project.workspace_path, created: heatmapEdit }),
      verifyFormalSourceCohort(baseUrl, { projectId, workspaceRoot: project.workspace_path, created: heatmapScientificEdit }),
    ]);
    const formalSourceProofs = [
      scientificSourceProof,
      volcanoSourceProof,
      historicalSourceProof,
      restoredSourceProof,
      heatmapSourceProof,
      heatmapScientificSourceProof,
    ];
    const baselineDegSource = (await requestJson(baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(degBaseline.revision.revisionId)}/source?projectId=${encodeURIComponent(projectId)}`)).data;
    const baselineEnrichmentSource = (await requestJson(baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(enrichmentBaselineInteraction.revision.revisionId)}/source?projectId=${encodeURIComponent(projectId)}`)).data;
    const scientificDegSource = scientificSourceProof.entries
      .find(({ revision }) => revision.artifactId === 'deg_table')?.source;
    const scientificEnrichmentSource = scientificSourceProof.entries
      .find(({ revision }) => revision.artifactId === 'go_bp_results')?.source;
    const lfcParameterChange = (scientificComparison.jsonDiffs || [])
      .flatMap((difference) => difference.changes || [])
      .find((change) => change.field === 'lfc_cutoff' && change.after === changedLfc) || null;
    const changedScientificTable = scientificComparison.artifacts
      .find((artifact) => artifact.kind === 'table' && artifact.beforeHash !== artifact.afterHash) || null;
    const changedScientificVisual = scientificComparison.artifacts
      .find((artifact) => artifact.kind === 'visual' && artifact.beforeHash !== artifact.afterHash) || null;

    const replayProofs = [scientificReplay, volcanoReplay, historicalReplay, restoredReplay];
    const replayIdentitiesUnique = ['changeSetId', 'toolJobId', 'revisionId'].every((field) => {
      const values = replayProofs.map(({ replay: replayResult }) => replayResult?.[field]);
      return values.every((value) => typeof value === 'string' && value.trim())
        && new Set(values).size === values.length;
    });

    const truth = readDatabaseTruth(env.BIOF3_DB_PATH, projectId);
    const sourceWorkflowGraphExact = directEnrichment.workflowGraph?.graphId
      === scientificEdit.changeSet.validationSummary.sourceWorkflowGraph?.graphId
      && directEnrichment.workflowGraph?.sourceDigest
        === scientificEdit.changeSet.validationSummary.sourceWorkflowGraph?.sourceDigest
      && exactWorkflowGraph(truth, scientificEdit.changeSet.validationSummary.sourceWorkflowGraph, {
        rootToolJobId: deseqBaseline.id,
        nodes: [
          workflowNodeExpectation(deseqBaseline),
          workflowNodeExpectation(enrichmentBaseline, [`job:${deseqBaseline.id}`]),
        ],
        edge: {
          kind: 'artifact',
          fromNodeId: `job:${deseqBaseline.id}`,
          toNodeId: `job:${enrichmentBaseline.id}`,
          sourceToolJobId: deseqBaseline.id,
          sourceRevisionId: degBaseline.revision.revisionId,
          sourceArtifactId: 'deg_table',
          sourceOutputHash: degBaseline.revision.outputHash,
          selectionId: null,
          selectionHash: null,
          inputId: 'deg_table',
        },
      });
    const candidateWorkflowGraphExact = exactWorkflowGraph(
      truth,
      scientificEdit.changeSet.validationSummary.workflowGraph,
      {
        rootToolJobId: scientificRootJob.id,
        nodes: [
          workflowNodeExpectation(scientificRootJob),
          workflowNodeExpectation(scientificChildJob, [`job:${scientificRootJob.id}`]),
        ],
        edge: {
          kind: 'artifact',
          fromNodeId: `job:${scientificRootJob.id}`,
          toNodeId: `job:${scientificChildJob.id}`,
          sourceToolJobId: scientificRootJob.id,
          sourceRevisionId: scientificDegRevision.revisionId,
          sourceArtifactId: 'deg_table',
          sourceOutputHash: scientificDegRevision.outputHash,
          selectionId: null,
          selectionHash: null,
          inputId: 'deg_table',
        },
      },
    );
    const selectionWorkflowGraphExact = exactWorkflowGraph(truth, selectionEnrichment.workflowGraph, {
      rootToolJobId: scientificRootJob.id,
      nodes: [
        workflowNodeExpectation(scientificRootJob),
        workflowNodeExpectation(scientificChildJob, [`job:${scientificRootJob.id}`]),
        workflowNodeExpectation(selectionEnrichmentJob, [`job:${scientificRootJob.id}`]),
      ],
      edges: [
        {
          kind: 'artifact',
          fromNodeId: `job:${scientificRootJob.id}`,
          toNodeId: `job:${scientificChildJob.id}`,
          sourceToolJobId: scientificRootJob.id,
          sourceRevisionId: scientificDegRevision.revisionId,
          sourceArtifactId: 'deg_table',
          sourceOutputHash: scientificDegRevision.outputHash,
          selectionId: null,
          selectionHash: null,
          inputId: 'deg_table',
        },
        {
          kind: 'selection',
          fromNodeId: `job:${scientificRootJob.id}`,
          toNodeId: `job:${selectionEnrichmentJob.id}`,
          sourceToolJobId: scientificRootJob.id,
          sourceRevisionId: scientificDegRevision.revisionId,
          sourceArtifactId: 'deg_table',
          sourceOutputHash: scientificDegRevision.outputHash,
          selectionId: degSelection.selectionId,
          selectionHash: degSelection.entityIdsHash,
          inputId: 'deg_table',
        },
      ],
    });
    const singleJobWorkflowGraphsExact = [
      [volcanoEdit, volcanoCandidateJob],
      [historicalAlternative, historicalCandidateJob],
      [heatmapEdit, heatmapCandidateJob],
      [heatmapScientificEdit, heatmapScientificJob],
    ].every(([created, job]) => exactWorkflowGraph(
      truth,
      created.changeSet.validationSummary.workflowGraph,
      { rootToolJobId: job.id, nodes: [workflowNodeExpectation(job)], edges: [] },
    ));
    const checks = {
      disposableMigrationsApplied: tables.missing.length === 0,
      projectCreatedThroughHttp: createdProject.status === 200 && project.workspace_path.startsWith(root),
      noSeededProductRecords: noSeedPrecondition.seededTables.length === 0,
      admittedExecutionTruth: [deseqBaseline, enrichmentBaseline, scientificRootJob, scientificChildJob,
        selectionEnrichmentJob, volcanoBaseline, volcanoCandidateJob, historicalCandidateJob,
        heatmapBaseline, heatmapCandidateJob, heatmapScientificJob]
        .every((job) => job.status === 'completed' && job.result?.artifactTruth?.status === 'valid'),
      stableGeneSelectionToGoKegg: degSelection.entityIdsHash === selectionEnrichment.selectionAction.entityIdsHash
        && selectionArtifacts.has('go_bp_results') && selectionArtifacts.has('kegg_results')
        && sameStringSet(materializedGenes, selectedGenes)
        && selectionJobInput?.sha256 === materializationHash
        && selectionJobLineage?.selectionHash === degSelection.entityIdsHash,
      volcanoSelectionLabelsAndSvgPng: volcanoEdit.plan.selectionLabelsBound === volcanoSelection.entityIdCount
        && isPng(volcanoPngPath) && volcanoPngSize?.width === 2400 && volcanoPngSize?.height === 1800
        && /<svg\b/i.test(volcanoSvg) && svgIncludesColor(volcanoSvg, '#d55e00')
        && svgIncludesColor(volcanoSvg, '#0072b2')
        && sameStringSet(volcanoPresentation?.label_genes, requestedVolcanoLabels)
        && stableHash(volcanoPngRender) === stableHash(volcanoSvgRender)
        && requestedVolcanoLabels.every((gene) => volcanoPngRender?.renderedLabelGenes?.includes(gene)),
      volcanoPresentationScienceStable: volcanoScience?.status === 'available'
        && volcanoScience.classifications.membership.gainedCount === 0
        && volcanoScience.classifications.membership.lostCount === 0,
      heatmapPresentationSeparatedFromCompute: heatmapEdit.plan.editClass === 'presentation_rerender'
        && correlationMatrix.exact
        && correlationArtifact?.beforeHash === heatmapBaselineCorrelationHash
        && correlationArtifact?.afterHash === heatmapCandidateCorrelationHash
        && correlationArtifact.beforeHash === correlationArtifact.afterHash
        && artifactSha256(heatmapBaseline, 'heatmap') !== artifactSha256(heatmapCandidateJob, 'heatmap')
        && heatmapDisplay?.cluster_rows === false && heatmapDisplay?.show_correlation_values === true
        && heatmapCandidateRender?.clusterRows === false
        && heatmapCandidateRender?.showCorrelationValues === true
        && heatmapCandidateRender?.displayedCorrelationValueCount === correlationGeneIds.length ** 2,
      heatmapScientificChangeRecomputed: ['data_transform', 'scientific_recompute', 'workflow_replan']
        .includes(heatmapScientificEdit.plan.editClass)
        && heatmapScientificMatrix.exact
        && computedCorrelationArtifact?.beforeHash === heatmapBaselineCorrelationHash
        && computedCorrelationArtifact?.afterHash === heatmapScientificCorrelationHash
        && computedCorrelationArtifact.beforeHash !== computedCorrelationArtifact.afterHash,
      affectedSubgraphExecuted: scientificEdit.changeSet.jobRefs.length === 2
        && sameStringSet(scientificEdit.changeSet.validationSummary.executedNodeIds,
          [`job:${deseqBaseline.id}`, `job:${enrichmentBaseline.id}`])
        && sameStringSet(scientificEdit.changeSet.jobRefs, [scientificRootJob.id, scientificChildJob.id]),
      scientificGeneDifferenceAuditable: degDifference?.status === 'available'
        && degDifference.significantGenes.before.significantCount !== degDifference.significantGenes.after.significantCount
        && (degDifference.significantGenes.membership.gainedCount
          + degDifference.significantGenes.membership.lostCount) > 0,
      enrichmentDifferenceAuditable: enrichmentDifference?.status === 'available'
        && hasMeaningfulEnrichmentDifference(enrichmentDifference)
        && hasAuditedEnrichmentRankingAndDirection(enrichmentDifference),
      parameterScriptTableAndVisualCompare: lfcParameterChange?.after === changedLfc
        && scientificComparison.textDiff?.additions > 0
        && scientificComparison.textDiff.patch.includes('lfc_cutoff')
        && changedScientificTable?.beforeHash !== changedScientificTable?.afterHash
        && changedScientificVisual?.beforeHash !== changedScientificVisual?.afterHash
        && scientificDegSource?.sha256 === baselineDegSource.sha256
        && scientificEnrichmentSource?.sha256 === baselineEnrichmentSource.sha256,
      allCandidatesPluginValidated: [scientificEdit, volcanoEdit, historicalAlternative,
        restoredVolcano, heatmapEdit, heatmapScientificEdit]
        .every(allCandidateRevisionsValid)
        && candidateCohortMatchesJobs(scientificEdit, [scientificRootJob, scientificChildJob])
        && candidateCohortMatchesJobs(volcanoEdit, [volcanoCandidateJob])
        && candidateCohortMatchesJobs(historicalAlternative, [historicalCandidateJob])
        && candidateCohortMatchesJobs(restoredVolcano, [historicalCandidateJob])
        && candidateCohortMatchesJobs(heatmapEdit, [heatmapCandidateJob])
        && candidateCohortMatchesJobs(heatmapScientificEdit, [heatmapScientificJob]),
      sourceInputsImmutable: exactInputHashes(deseqBaseline, scientificRootJob)
        && exactInputHashes(volcanoBaseline, volcanoCandidateJob)
        && exactInputHashes(volcanoBaseline, historicalCandidateJob)
        && exactInputHashes(heatmapBaseline, heatmapCandidateJob)
        && exactInputHashes(heatmapBaseline, heatmapScientificJob),
      everyFormalOutputHasReproductionSource: formalSourceProofs.every((proof) => proof.entries.length > 0
        && SHA256.test(proof.digest))
        && formalSourceProofs.reduce((count, proof) => count + proof.entries.length, 0)
          === [scientificEdit, volcanoEdit, historicalAlternative, restoredVolcano,
            heatmapEdit, heatmapScientificEdit]
            .reduce((count, created) => count + created.cohortRevisions.length, 0)
        && sameStringSet(restoredVolcano.changeSet.validationSummary.validatorIds,
          historicalAlternative.changeSet.validationSummary.validatorIds),
      exactIndependentReplayPackage: replayIdentitiesUnique && replayProofs
        .every(({ replay: replayResult }) => replayResult.reproducibility?.exactMatch === true
          && replayResult.reproducibility?.sourceCohortVerified === true
          && SHA256.test(replayResult.reproducibility?.outputCohortHash || '')
          && VALID_REPLAY_PACKAGE_STATUSES.has(replayResult.replayPackage?.status)
          && SHA256.test(replayResult.replayPackage?.packageDigest || '')
          && replayResult.adopted === false)
        && replayProofs.every(({ databaseProof }) =>
          databaseProof.exact && databaseProof.replayGraphNodesExact),
      historyAdoptRevertRestoreNewRevision: adoptedVolcano.changeSet.status === 'adopted'
        && revertedVolcano.changeSet.status === 'reverted'
        && adoptedHistorical.changeSet.status === 'adopted'
        && revertedHistorical.changeSet.status === 'reverted'
        && historicalParentsExact
        && restoredVolcano.restored === true
        && restoredVolcano.revision.revisionOrdinal > historicalSelectedRevision.revisionOrdinal
        && restoredFreshBeforeReplay
        && restoredAfterReplaySnapshot.revisions.every((revision) =>
          revision.isCurrent === true && revision.reproducibilityStatus === 'verified'),
      missingWorkflowGraphFailsClosed: missingGraphFailure.blockedError === 'workflow_graph_stale_or_unpersisted',
      persistentWorkflowTruthPresent: truth.counts.workflowGraphs >= 3
        && truth.counts.revisions > 0
        && truth.workflowGraphs.every((graph) => graph.integrityValid && graph.validationStatus === 'valid')
        && sourceWorkflowGraphExact && candidateWorkflowGraphExact && selectionWorkflowGraphExact
        && singleJobWorkflowGraphsExact,
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
    assert(failedChecks.length === 0, `p5_acceptance_checks_failed:${failedChecks.join(',')}`);

    const binding = getP5SourceBinding();
    const evidence = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P5',
      evidenceClass: 'real_local_scientific_editing_non_qualifying',
      capturedAt: new Date().toISOString(),
      qualificationEligible: false,
      providerBoundary: 'deterministic_context_bound_tools_no_provider_claim',
      packagedBoundary: 'local_disposable_runtime_no_packaged_claim',
      seedPolicy: 'input fixtures only; product ledgers start empty',
      ...binding,
      executionTruthChain: [
        'http_project_creation',
        'registered_tool_execution',
        'durable_execution_record',
        'artifact_truth',
        'baseline_output_cohort',
        'persisted_workflow_graph',
        'context_bound_edit',
        'plugin_validator',
        'candidate_output_cohort',
        'scientific_compare',
        'adopt',
        'independent_replay_package',
        'revert',
        'historical_restore_as_new_output_version',
      ],
      observations: {
        scientificTasksCompleted: 5,
        stableSelectedGeneCount: selectedGenes.length,
        baselineLfcCutoff: baselineLfc,
        editedLfcCutoff: changedLfc,
        significantGeneCountBefore: degDifference.significantGenes.before.significantCount,
        significantGeneCountAfter: degDifference.significantGenes.after.significantCount,
        enrichmentTermCountBefore: enrichmentDifference.terms.beforeCount,
        enrichmentTermCountAfter: enrichmentDifference.terms.afterCount,
        replayArtifactCount: replay.reproducibility.artifactCount,
        replayOutputCohortHash: replay.reproducibility.outputCohortHash,
        selectionEntityIdsHash: degSelection.entityIdsHash,
        noSeedPrecondition,
        truthCounts: truth.counts,
        truthDigest: truth.digest,
        durationMs: Date.now() - startedAt,
      },
      checks,
      sourceBindingRequiredForCanonicalEvidence: true,
      passed: Object.values(checks).every(Boolean) && binding.sourceCommitMatchesSourceHashes,
    };
    assertSanitizedP5Evidence(evidence);
    if (writeEvidence) {
      writeP5Evidence(evidence);
    }
    return {
      ...evidence,
      // A WIP dry run may prove product behavior before the implementation is
      // committed. It is deliberately non-canonical until source binding is exact.
      dryRunPassed: Object.values(checks).every(Boolean),
    };
  } finally {
    await stopServer(server?.child);
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

function parseCli(argv) {
  return {
    writeEvidence: argv.includes('--write-evidence'),
    keep: argv.includes('--keep'),
    verbose: argv.includes('--verbose'),
  };
}

async function main() {
  if (process.argv.includes('--worker')) {
    await runWorkerMain();
    return;
  }
  if (!findBioPackRoot()) {
    // Explicit skip with reason (BLOCK-83 §P4 C-class semantics): the live
    // scientific journey needs the independent bio pack; without it this gate
    // is a skip, never a silent pass and never a fake green.
    console.log('[G0-RS-P5] SKIP — bio pack not present (expected sibling ../gewu-pack-bio or BIOF3_BIO_PACK_ROOT); live scientific journey not exercised');
    return;
  }
  const result = await captureP5Acceptance(parseCli(process.argv.slice(2)));
  const passed = result.passed || (!process.argv.includes('--write-evidence') && result.dryRunPassed);
  console.log(`[G0-RS-P5] ${passed ? 'PASS' : 'FAIL'} — ${Object.keys(result.checks || {}).filter((key) => result.checks[key]).length}/${Object.keys(result.checks || {}).length} checks`);
  if (!passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[G0-RS-P5] FAIL — ${error.message}`);
    if (process.argv.includes('--verbose')) {
      console.error(error.stack || error);
      if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
    }
    process.exitCode = 1;
  });
}
