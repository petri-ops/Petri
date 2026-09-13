#!/usr/bin/env node

/**
 * Bounded P6 product scenarios that are intentionally not canonical evidence.
 *
 * The Provider failure is a controlled loopback OpenAI-compatible transport
 * probe. It exercises the production adapter and ModelGateway, but it is not a
 * real external Provider run and remains excluded from P7 qualification.
 *
 * The remaining scenarios start from the P5 no-seed runtime. No Revision or
 * ChangeSet row is manufactured by this module: baselines, preview candidates,
 * adoption and GC all pass through their normal product boundaries.
 */

import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import {
  createP5LiveScientificRuntime,
  P5_NO_SEED_TABLES,
  P5_SOURCE_FILES,
  prepareP5LiveScientificBaselines,
} from './g0-rs-p5-acceptance.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const WORKER_MARKER = '__P6_PRODUCT_SCENARIO_WORKER__';
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(ROOT, 'core', 'biof3-server'), ROOT],
}));
const {
  ModelGateway,
  getProvider,
  isRetryableProviderError,
} = require('../core/shared-backend/llm-providers');
const {
  computeCheckpointHash,
} = require('../core/shared-backend/result-studio-contracts');

export const P6_PRODUCT_SCENARIO_CLASSIFICATION = Object.freeze({
  stage: 'G0-RS-P6',
  scope: 'local_product_durability_recovery_performance',
  providerObservation: 'controlled_loopback_openai_compatible_transport_only',
  realProvider: false,
  packagedElectron: false,
  qualificationEligible: false,
  p7Eligible: false,
});

export const P6_PRODUCT_SCENARIO_SOURCE_FILES = Object.freeze({
  ...P5_SOURCE_FILES,
  scenario: 'scripts/g0-rs-p6-product-scenarios.mjs',
  scenarioTest: 'test/g0-rs-p6-product-scenarios.test.mjs',
  p5Runtime: 'scripts/g0-rs-p5-acceptance.mjs',
  rootLockfile: 'package-lock.json',
  frontendLockfile: 'frontend/package-lock.json',
  migrationRunner: 'src/migration-runner.js',
  resultStudioMigration: 'src/migrations/001_result_studio.sql',
  workflowMigration: 'src/migrations/002_result_workflow_graph.sql',
  providerRegistry: 'core/shared-backend/llm-providers/index.js',
  providerAdapter: 'core/shared-backend/llm-providers/deepseek.js',
  providerAnthropic: 'core/shared-backend/llm-providers/anthropic.js',
  providerDashscope: 'core/shared-backend/llm-providers/dashscope.js',
  providerDashscopeVision: 'core/shared-backend/llm-providers/dashscope-vision.js',
  modelGateway: 'core/shared-backend/llm-providers/model-gateway.js',
  modelProfile: 'core/shared-backend/llm-providers/model-profile.js',
  providerProtocolConversion: 'core/shared-backend/llm-providers/protocol-conversion.js',
  providerProtocolUsage: 'core/shared-backend/llm-providers/protocol-usage.js',
  providerReliability: 'core/shared-backend/llm-providers/provider-reliability.js',
  providerStreamAggregate: 'core/shared-backend/llm-providers/stream-aggregate.js',
  aiUsageHelper: 'core/shared-backend/ai-usage-helper.js',
  sharedLogger: 'core/shared-backend/logger.js',
  rServerLogger: 'core/biof3-server/logger.js',
  resultEditTools: 'core/biof3-server/agent-tools/result-edit-tools.js',
  resultContextEditTools: 'core/biof3-server/agent-tools/result-context-edit-tools.js',
  changeSetService: 'core/shared-backend/result-changeset-service.js',
  compareService: 'core/shared-backend/result-compare-service.js',
  resultStudioContracts: 'core/shared-backend/result-studio-contracts.js',
  resultStudioSchema: 'core/shared-backend/result-studio-schema.js',
  scientificTaskSpec: 'core/shared-backend/scientific-task-spec.js',
  lifecycle: 'core/shared-backend/result-studio-lifecycle.js',
  routes: 'core/biof3-server/routes/result-studio.js',
});

function invariant(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

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

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function digestId(value) {
  return sha256(String(value || ''));
}

function sameStringSet(left, right) {
  const a = [...new Set((left || []).filter(Boolean))].sort();
  const b = [...new Set((right || []).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function requestJsonResponse(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 120_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { parseError: true }; }
  return { ok: response.ok, status: response.status, data };
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await requestJsonResponse(baseUrl, route, options);
  if (!response.ok) {
    const error = new Error(response.data?.message || response.data?.error || `http_${response.status}`);
    error.code = response.data?.error || `http_${response.status}`;
    error.status = response.status;
    error.detail = response.data?.detail || null;
    throw error;
  }
  return response.data;
}

function postJsonResponse(baseUrl, route, body, timeoutMs = 120_000) {
  return requestJsonResponse(baseUrl, route, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs,
  });
}

function openLedger(dbPath, options = {}) {
  return new Database(dbPath, options);
}

function readProjectCounts(dbPath, projectId) {
  const sqlite = openLedger(dbPath, { readonly: true });
  try {
    return {
      jobs: sqlite.prepare('SELECT COUNT(*) AS count FROM tool_jobs WHERE project_id=?').get(projectId).count,
      changeSets: sqlite.prepare('SELECT COUNT(*) AS count FROM scientific_change_sets WHERE project_id=?').get(projectId).count,
      revisions: sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_revisions WHERE project_id=?').get(projectId).count,
      checkpoints: sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_revision_checkpoints WHERE project_id=?').get(projectId).count,
      runningChangeSets: sqlite.prepare("SELECT COUNT(*) AS count FROM scientific_change_sets WHERE project_id=? AND status='running'").get(projectId).count,
    };
  } finally {
    sqlite.close();
  }
}

function readJobParameterDigest(dbPath, jobId) {
  const sqlite = openLedger(dbPath, { readonly: true });
  try {
    const row = sqlite.prepare('SELECT params_json FROM tool_jobs WHERE id=?').get(jobId);
    return row ? sha256(String(row.params_json || '')) : null;
  } finally {
    sqlite.close();
  }
}

function readBarrierChangeSet(markerPath) {
  const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
  invariant(parsed?.changeSetId, 'p6_product_barrier_changeset_missing');
  return String(parsed.changeSetId);
}

function startScenarioWorker(runtime, spec) {
  const payload = Buffer.from(JSON.stringify(spec)).toString('base64url');
  const child = spawn(process.execPath, [SELF, '--scenario-worker', payload], {
    cwd: ROOT,
    env: runtime.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), WORKER_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      const marker = stdout.lastIndexOf(WORKER_MARKER);
      if (code !== 0 || marker < 0) {
        reject(Object.assign(new Error(`p6_product_worker_failed:${code}:${signal || 'none'}`), {
          code: 'p6_product_worker_failed',
          detail: stderr.slice(-2000),
        }));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(marker + WORKER_MARKER.length).trim()));
      } catch (error) {
        reject(Object.assign(new Error('p6_product_worker_result_invalid'), { cause: error }));
      }
    });
  });
  return { child, promise };
}

async function waitForBarrier(handle, markerPath, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) return readBarrierChangeSet(markerPath);
    if (handle.child.exitCode !== null) await handle.promise;
    await sleep(25);
  }
  throw new Error('p6_product_barrier_timeout');
}

function releaseBarrier(releasePath) {
  mkdirSync(path.dirname(releasePath), { recursive: true });
  if (!existsSync(releasePath)) writeFileSync(releasePath, 'release\n');
}

function workerSummary(result, planned) {
  return {
    ok: result?.ok === true,
    error: result?.error || null,
    detail: result?.detail || null,
    plan: planned?.intent ? {
      editClass: planned.intent.editClass,
      affectedScope: planned.intent.affectedScope,
      proposedParameterPatch: planned.intent.proposedParameterPatch,
    } : null,
    toolJobId: result?.toolJobId || null,
    changeSet: result?.changeSet ? {
      changeSetId: result.changeSet.changeSetId,
      status: result.changeSet.status,
      candidateCommit: result.changeSet.candidateCommit,
      jobRefs: result.changeSet.jobRefs,
      candidateArtifactRefs: result.changeSet.candidateArtifactRefs,
    } : null,
    cohortRevisions: Array.isArray(result?.cohortRevisions)
      ? result.cohortRevisions.map((revision) => ({
        revisionId: revision.revisionId,
        artifactFamilyId: revision.artifactFamilyId,
        artifactId: revision.artifactId,
        sourceCommit: revision.sourceCommit,
        outputHash: revision.outputHash,
        isCurrent: revision.isCurrent,
      }))
      : [],
  };
}

async function runScenarioWorkerMain() {
  const payloadIndex = process.argv.indexOf('--scenario-worker') + 1;
  const spec = JSON.parse(Buffer.from(process.argv[payloadIndex], 'base64url').toString('utf8'));
  const db = require(path.join(ROOT, 'core/biof3-server/db.js'));
  const mcpRegistry = require(path.join(ROOT, 'core/biof3-server/mcp/registry.js'));
  const {
    createResultChangeSetTools,
  } = require(path.join(ROOT, 'core/biof3-server/agent-tools/result-edit-tools.js'));
  const {
    createResultChangeSet,
  } = require(path.join(ROOT, 'core/shared-backend/result-changeset-service.js'));
  const {
    createResultContextEditTools,
  } = require(path.join(ROOT, 'core/biof3-server/agent-tools/result-context-edit-tools.js'));

  const project = db.getProject(spec.projectId);
  invariant(project?.id === spec.projectId, 'p6_product_worker_project_missing');
  const ownerId = String(project.user_id || 'local-user');
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
  const controlledDisk = spec.resourceProbe?.controlledDisk;
  const controlledStatfs = controlledDisk && Number.isInteger(controlledDisk.bavail)
    && Number.isInteger(controlledDisk.bsize) && Number.isInteger(controlledDisk.blocks)
    ? () => ({
      bavail: controlledDisk.bavail,
      bsize: controlledDisk.bsize,
      blocks: controlledDisk.blocks,
    })
    : null;
  const changeSetTools = createResultChangeSetTools({
    createResultChangeSet: (input, dependencies) => createResultChangeSet(input, {
      ...dependencies,
      ...(controlledStatfs ? { statfsSync: controlledStatfs } : {}),
    }),
    callTool: async (toolId, params, toolContext) => {
      if (spec.barrier?.readyPath && spec.barrier?.releasePath) {
        mkdirSync(path.dirname(spec.barrier.readyPath), { recursive: true });
        writeFileSync(spec.barrier.readyPath, JSON.stringify({
          changeSetId: toolContext?.resultStudioMaterializedScript?.changeSetId || null,
        }));
        const deadline = Date.now() + 90_000;
        while (!existsSync(spec.barrier.releasePath)) {
          if (Date.now() >= deadline) throw Object.assign(new Error('p6_product_worker_release_timeout'), { code: 'p6_product_worker_release_timeout' });
          await sleep(25);
        }
      }
      return mcpRegistry.callTool(toolId, params, {
        ...toolContext,
        userId: ownerId,
        projectId: spec.projectId,
        accessMode: 'full',
        allowExecution: true,
      });
    },
  });
  const tools = createResultContextEditTools({ changeSetTools });
  const planned = await tools.plan({
    requestedOutcome: spec.requestedOutcome,
    proposedParameterPatch: spec.parameterPatch,
    editOrigin: 'agent',
    userMessageId: spec.userMessageId || `p6-product-${randomUUID()}`,
  }, ctx);
  if (!planned?.ok || !planned.intent || !planned.context?.contextToken) {
    process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(planned, planned))}\n`);
    return;
  }
  const created = await tools.create({
    contextToken: planned.context.contextToken,
    intent: planned.intent,
    scientificConfirmed: planned.intent.requiresScientificConfirmation === true,
  }, ctx);
  process.stdout.write(`${WORKER_MARKER}${JSON.stringify(workerSummary(created, planned))}\n`);
}

function providerSettings(baseUrl, status) {
  return {
    model_profiles: [
      {
        id: `p6-primary-${status}`,
        label: `P6 primary ${status}`,
        provider: 'openai-compatible',
        protocol: 'openai-compatible',
        model: `primary-${status}`,
        baseUrl,
        capabilities: ['chat'],
      },
      {
        id: `p6-fallback-${status}`,
        label: `P6 fallback ${status}`,
        provider: 'openai-compatible',
        protocol: 'openai-compatible',
        model: `fallback-${status}`,
        baseUrl,
        capabilities: ['chat'],
      },
    ],
    model_role_bindings: { chat: `p6-primary-${status}` },
    model_fallback_enabled: true,
    model_fallback_bindings: { chat: [`p6-fallback-${status}`] },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function closeHttpServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Exercise real loopback HTTP bytes through DeepSeekProvider + ModelGateway. */
export async function captureP6ControlledTransportScenario() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* adapter should always send JSON */ }
      const model = String(parsed.model || '');
      const status = model.startsWith('primary-') ? Number(model.slice('primary-'.length)) : 200;
      requests.push({ method: req.method, path: req.url, model, status });
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      if (status >= 400) {
        res.end(JSON.stringify({ error: { message: `controlled ${status}` } }));
        return;
      }
      res.end(JSON.stringify({
        id: `local-${model}`,
        choices: [{ message: { role: 'assistant', content: `recovered-${model}` } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    const cases = [];
    for (const status of [503, 429]) {
      const routing = [];
      const before = requests.length;
      const gateway = new ModelGateway({
        getSettings: () => providerSettings(baseUrl, status),
        getCredential: () => '',
        getProvider,
        recordRouting: (event) => routing.push(event),
      });
      const result = await gateway.chat({
        role: 'chat',
        body: { messages: [{ role: 'user', content: 'controlled transport probe' }] },
      });
      const attemptRequests = requests.slice(before);
      cases.push({
        status,
        retryable: isRetryableProviderError({ error: 'http_error', status }),
        requestPath: attemptRequests[0]?.path || null,
        requestModels: attemptRequests.map((entry) => entry.model),
        requestStatuses: attemptRequests.map((entry) => entry.status),
        requestCount: attemptRequests.length,
        routingEvent: routing[0] ? {
          type: routing[0].type,
          fromProfileId: routing[0].fromProfileId,
          toProfileId: routing[0].toProfileId,
          reason: routing[0].reason,
        } : null,
        modelRouting: result?.modelRouting || null,
        recovered: result?.choices?.[0]?.message?.content === `recovered-fallback-${status}`,
      });
    }
    return {
      classification: P6_PRODUCT_SCENARIO_CLASSIFICATION.providerObservation,
      adapter: 'openai-compatible/DeepSeekProvider',
      loopbackOnly: true,
      realProvider: false,
      p7Eligible: false,
      cases,
    };
  } finally {
    await closeHttpServer(server);
  }
}

function holderSpec(runtime, baseline, parameterPatch, barrier, suffix) {
  return {
    projectId: runtime.project.id,
    conversationId: runtime.conversation.id,
    jobId: baseline.jobId,
    artifact: baseline.artifact,
    revisionId: baseline.revisionId,
    requestedOutcome: `Create accessible presentation candidate ${suffix} without changing scientific thresholds.`,
    parameterPatch,
    barrier,
    userMessageId: `p6-product-holder-${suffix}`,
  };
}

function budgetSpec(runtime, baseline, parameterPatch, resourceProbe, suffix) {
  return {
    projectId: runtime.project.id,
    conversationId: runtime.conversation.id,
    jobId: baseline.jobId,
    artifact: baseline.artifact,
    revisionId: baseline.revisionId,
    requestedOutcome: `Request presentation candidate ${suffix} without changing scientific thresholds.`,
    parameterPatch,
    resourceProbe,
    userMessageId: `p6-product-budget-${suffix}`,
  };
}

function projectRows(sqlite, table, projectId, orderBy) {
  return sqlite.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY ${orderBy}`).all(projectId);
}

function parseJson(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function checkpointRowHashMatches(row) {
  if (!row || !SHA256_PATTERN.test(String(row.checkpoint_hash || ''))) return false;
  return computeCheckpointHash({
    contractVersion: row.contract_version,
    checkpointId: row.checkpoint_id,
    projectId: row.project_id,
    conversationId: row.conversation_id || null,
    baseCommit: row.base_commit || null,
    candidateCommit: row.candidate_commit || null,
    changeSetId: row.change_set_id || null,
    changeSetStatus: row.change_set_status || null,
    currentRevisionIds: parseJson(row.current_revision_ids_json, []),
    selectionId: row.selection_id || null,
    pendingPreview: parseJson(row.pending_preview_json, null),
    jobRefs: parseJson(row.job_refs_json, []),
    loopRefs: parseJson(row.loop_refs_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) === row.checkpoint_hash;
}

function currentRefs(workspaceRoot) {
  const result = spawnSync('git', [
    `--git-dir=${path.join(workspaceRoot, '.biof3/git')}`,
    `--work-tree=${workspaceRoot}`,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/heads/biof3/current/',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  invariant(result.status === 0, 'p6_product_current_ref_read_failed');
  return String(result.stdout || '').trim().split('\n').filter(Boolean).sort();
}

function adoptionMutationDigest(dbPath, workspaceRoot, projectId) {
  const sqlite = openLedger(dbPath, { readonly: true });
  try {
    return stableHash({
      changeSets: projectRows(sqlite, 'scientific_change_sets', projectId, 'change_set_id'),
      revisions: projectRows(sqlite, 'artifact_revisions', projectId, 'revision_id'),
      checkpoints: projectRows(sqlite, 'workspace_revision_checkpoints', projectId, 'checkpoint_id'),
      currentRefs: currentRefs(workspaceRoot),
    });
  } finally {
    sqlite.close();
  }
}

function readCandidateState(dbPath, projectId, changeSetIds) {
  const sqlite = openLedger(dbPath, { readonly: true });
  try {
    const changeSets = changeSetIds.map((changeSetId) => sqlite.prepare(
      'SELECT change_set_id, status, candidate_commit FROM scientific_change_sets WHERE project_id=? AND change_set_id=?'
    ).get(projectId, changeSetId));
    const revisions = changeSetIds.flatMap((changeSetId) => sqlite.prepare(
      'SELECT revision_id, artifact_family_id, is_current, output_hash FROM artifact_revisions WHERE project_id=? AND change_set_id=? ORDER BY revision_id'
    ).all(projectId, changeSetId));
    return { changeSets, revisions };
  } finally {
    sqlite.close();
  }
}

async function sourceRouteDigest(baseUrl, projectId, revisionIds) {
  const rows = [];
  for (const revisionId of [...revisionIds].sort()) {
    const source = await requestJson(
      baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(revisionId)}/source?projectId=${encodeURIComponent(projectId)}`,
    );
    rows.push({ revisionId, sourceDigest: stableHash(source) });
  }
  return stableHash(rows);
}

async function readColdTruth(baseUrl, dbPath, workspaceRoot, projectId, conversationId, artifactFamilyId) {
  const sqlite = openLedger(dbPath, { readonly: true });
  let revisionRows;
  let changeSetRows;
  let checkpointRows;
  let jobRows;
  try {
    revisionRows = projectRows(sqlite, 'artifact_revisions', projectId, 'revision_id');
    changeSetRows = projectRows(sqlite, 'scientific_change_sets', projectId, 'change_set_id');
    checkpointRows = projectRows(sqlite, 'workspace_revision_checkpoints', projectId, 'checkpoint_id');
    jobRows = projectRows(sqlite, 'tool_jobs', projectId, 'id');
  } finally {
    sqlite.close();
  }
  const physical = revisionRows.map((revision) => {
    const absolute = path.resolve(workspaceRoot, revision.output_path);
    return {
      revisionId: revision.revision_id,
      expected: revision.output_hash,
      actual: existsSync(absolute) ? sha256(readFileSync(absolute)) : null,
    };
  });
  const sourceDigest = await sourceRouteDigest(
    baseUrl,
    projectId,
    revisionRows.map((revision) => revision.revision_id),
  );
  const history = await requestJson(
    baseUrl,
    `/api/result-studio/changesets?${new URLSearchParams({
      projectId,
      artifactFamilyId,
      revisionLimit: '200',
    }).toString()}`,
  );
  const workspace = await requestJson(
    baseUrl,
    `/api/result-studio/workspace/status?${new URLSearchParams({ projectId, conversationId }).toString()}`,
    { timeoutMs: 120_000 },
  );
  const statusByChangeSet = new Map(changeSetRows.map((row) => [row.change_set_id, row.status]));
  return {
    ledgerDigest: stableHash({ revisionRows, changeSetRows, checkpointRows, jobRows }),
    revisionDigest: stableHash(revisionRows),
    changeSetDigest: stableHash(changeSetRows),
    checkpointDigest: stableHash(checkpointRows),
    jobDigest: stableHash(jobRows),
    physicalDigest: stableHash(physical),
    physicalHashesExact: physical.length > 0 && physical.every((entry) => entry.actual === entry.expected),
    sourceDigest,
    historyDigest: stableHash(history),
    revisionCount: revisionRows.length,
    changeSetCount: changeSetRows.length,
    checkpointCount: checkpointRows.length,
    jobCount: jobRows.length,
    currentRevisionCount: revisionRows.filter((row) => row.is_current === 1).length,
    historicalRevisionCount: revisionRows.filter((row) => row.is_current === 0
      && statusByChangeSet.get(row.change_set_id) === 'adopted').length,
    previewRevisionCount: revisionRows.filter((row) => statusByChangeSet.get(row.change_set_id) === 'preview_ready').length,
    previewChangeSetCount: changeSetRows.filter((row) => row.status === 'preview_ready').length,
    checkpointHashesExact: checkpointRows.length > 0
      && checkpointRows.every(checkpointRowHashMatches),
    historyCurrentRevisionDigest: digestId(history.currentRevision?.revisionId),
    historyRevisionCount: Array.isArray(history.revisions) ? history.revisions.length : 0,
    workspaceStatus: workspace.status || null,
    workspaceBlockingIssueCount: Array.isArray(workspace.issues)
      ? workspace.issues.filter((issue) => issue?.blocking === true).length
      : 0,
  };
}

function runManagedGitGc(workspaceRoot) {
  const startedAt = Date.now();
  const result = spawnSync('git', [
    `--git-dir=${path.join(workspaceRoot, '.biof3/git')}`,
    `--work-tree=${workspaceRoot}`,
    'gc',
    '--prune=now',
  ], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  return {
    exitCode: result.status,
    signal: result.signal || null,
    durationMs: Date.now() - startedAt,
    stderrDigest: sha256(String(result.stderr || '')),
  };
}

/**
 * Run resource-budget, stale-adoption and HTTP-GC scenarios in one no-seed
 * runtime. The two real preview candidates intentionally serve both the active
 * preview budget and stale-base scenarios.
 */
export async function captureP6LiveProductScenarios({ keep = false, verbose = false } = {}) {
  let runtime = null;
  let coldServer = null;
  let root = null;
  let noSeedPrecondition = null;
  const releases = [];
  const handles = [];
  try {
    runtime = await createP5LiveScientificRuntime({ verbose });
    root = runtime.root;
    noSeedPrecondition = runtime.noSeedPrecondition;
    const baselines = await prepareP5LiveScientificBaselines(runtime);
    const baseline = baselines.volcano;
    const projectId = runtime.project.id;
    const conversationId = runtime.conversation.id;
    const sourceParametersBefore = readJobParameterDigest(runtime.env.BIOF3_DB_PATH, baseline.jobId);

    // The memory branch uses the descriptor's largest valid raster parameters.
    // The service, rather than this runner, converts those trusted dimensions
    // plus Job/Artifact Truth into the resource estimate.
    const memoryBlockedCountsBefore = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);
    const memoryBlockedWorker = startScenarioWorker(runtime, budgetSpec(runtime, baseline, {
      color_up: '#d55e00', color_down: '#56b4e9', point_size: 3,
      plot_width: 20, plot_height: 20, export_dpi: 1200,
    }, null, 'memory-blocked'));
    handles.push(memoryBlockedWorker);
    const memoryBlockedResult = await memoryBlockedWorker.promise;
    const memoryBlockedCountsAfter = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);

    // Filling the host disk would be destructive and nondeterministic. This is
    // a controlled filesystem-stat fault at the same service dependency that
    // obtains fs.statfsSync in production; all input/output/raster estimates
    // still come from the real baseline Job and admitted descriptor.
    const diskBlockedCountsBefore = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);
    const diskBlockedWorker = startScenarioWorker(runtime, budgetSpec(runtime, baseline, {
      color_up: '#0072b2', color_down: '#e69f00', point_size: 2.2,
    }, {
      controlledDisk: { bavail: 1, bsize: 1024, blocks: 2048 },
    }, 'disk-blocked'));
    handles.push(diskBlockedWorker);
    const diskBlockedResult = await diskBlockedWorker.promise;
    const diskBlockedCountsAfter = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);

    const barrierRoot = path.join(runtime.root, 'p6-product-barriers');
    mkdirSync(barrierRoot, { recursive: true });
    const firstBarrier = {
      readyPath: path.join(barrierRoot, 'first.ready.json'),
      releasePath: path.join(barrierRoot, 'first.release'),
    };
    const secondBarrier = {
      readyPath: path.join(barrierRoot, 'second.ready.json'),
      releasePath: path.join(barrierRoot, 'second.release'),
    };
    releases.push(firstBarrier.releasePath, secondBarrier.releasePath);
    const firstHolder = startScenarioWorker(runtime, holderSpec(runtime, baseline, {
      color_up: '#c44e52', color_down: '#4c72b0', point_size: 2.1,
    }, firstBarrier, 'first'));
    handles.push(firstHolder);
    const firstRunningId = await waitForBarrier(firstHolder, firstBarrier.readyPath);

    const secondHolder = startScenarioWorker(runtime, holderSpec(runtime, baseline, {
      color_up: '#009e73', color_down: '#cc79a7', point_size: 2.4,
    }, secondBarrier, 'second'));
    handles.push(secondHolder);
    const secondRunningId = await waitForBarrier(secondHolder, secondBarrier.readyPath);
    const saturatedCounts = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);
    invariant(saturatedCounts.runningChangeSets >= 2, 'p6_product_active_preview_saturation_missing', saturatedCounts);

    const queuedCountsBefore = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);
    const queuedWorker = startScenarioWorker(runtime, budgetSpec(runtime, baseline, {
      color_up: '#e69f00', color_down: '#0072b2', point_size: 2.8,
    }, null, 'queued'));
    handles.push(queuedWorker);
    const queuedResult = await queuedWorker.promise;
    const queuedCountsAfter = readProjectCounts(runtime.env.BIOF3_DB_PATH, projectId);

    releaseBarrier(firstBarrier.releasePath);
    releaseBarrier(secondBarrier.releasePath);
    const [firstCandidate, secondCandidate] = await Promise.all([
      firstHolder.promise,
      secondHolder.promise,
    ]);
    invariant(firstCandidate.ok && firstCandidate.changeSet?.status === 'preview_ready',
      'p6_product_first_candidate_not_ready', firstCandidate);
    invariant(secondCandidate.ok && secondCandidate.changeSet?.status === 'preview_ready',
      'p6_product_second_candidate_not_ready', secondCandidate);
    invariant(firstCandidate.changeSet.changeSetId === firstRunningId
      && secondCandidate.changeSet.changeSetId === secondRunningId,
    'p6_product_barrier_candidate_drift');

    const sourceParametersAfter = readJobParameterDigest(runtime.env.BIOF3_DB_PATH, baseline.jobId);
    const adoptedSecond = await postJsonResponse(
      runtime.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(secondCandidate.changeSet.changeSetId)}/adopt`,
      {},
    );
    invariant(adoptedSecond.ok && adoptedSecond.data?.changeSet?.status === 'adopted',
      'p6_product_second_candidate_adoption_failed', adoptedSecond.data);
    const beforeStaleDigest = adoptionMutationDigest(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.workspace_path,
      projectId,
    );
    const staleResponse = await postJsonResponse(
      runtime.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(firstCandidate.changeSet.changeSetId)}/adopt`,
      {},
    );
    const afterStaleDigest = adoptionMutationDigest(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.workspace_path,
      projectId,
    );
    const candidateState = readCandidateState(runtime.env.BIOF3_DB_PATH, projectId, [
      firstCandidate.changeSet.changeSetId,
      secondCandidate.changeSet.changeSetId,
    ]);

    const firstFamilies = firstCandidate.cohortRevisions.map((revision) => revision.artifactFamilyId);
    const secondCurrentFamilies = candidateState.revisions
      .filter((revision) => revision.is_current === 1)
      .map((revision) => revision.artifact_family_id);
    const truthBeforeGc = await readColdTruth(
      runtime.baseUrl,
      runtime.env.BIOF3_DB_PATH,
      runtime.project.workspace_path,
      projectId,
      conversationId,
      baseline.artifactFamilyId,
    );
    const gcPlan = await requestJson(
      runtime.baseUrl,
      `/api/result-studio/storage/gc?projectId=${encodeURIComponent(projectId)}`,
    );
    const gcExecution = await requestJson(
      runtime.baseUrl,
      '/api/result-studio/storage/gc',
      {
        method: 'POST',
        body: JSON.stringify({ projectId, planToken: gcPlan.planToken }),
      },
    );

    const retained = {
      env: runtime.env,
      root: runtime.root,
      projectWorkspace: runtime.project.workspace_path,
      baseUrl: runtime.baseUrl,
    };
    await runtime.close({ removeRoot: false });
    runtime = null;
    const gitGc = runManagedGitGc(retained.projectWorkspace);
    coldServer = await startServer(retained.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-product-cold:${channel}] ${line}`) }
      : {});
    invariant(coldServer.baseUrl === retained.baseUrl, 'p6_product_cold_boot_url_drift');
    const truthAfterGc = await readColdTruth(
      coldServer.baseUrl,
      retained.env.BIOF3_DB_PATH,
      retained.projectWorkspace,
      projectId,
      conversationId,
      baseline.artifactFamilyId,
    );

    const resourceBudget = {
      classification: 'real_product_changeset_preflight_no_seed',
      sourceBaselineJobDigest: digestId(baseline.jobId),
      sourceBaselineRevisionDigest: digestId(baseline.revisionId),
      sourceScientificParametersUnchanged: sourceParametersBefore != null
        && sourceParametersBefore === sourceParametersAfter,
      memoryBlocked: {
        error: memoryBlockedResult.error,
        decision: memoryBlockedResult.detail?.decision || null,
        reasons: memoryBlockedResult.detail?.reasons || [],
        scientificParametersChanged: memoryBlockedResult.detail?.scientificParametersChanged,
        resourceEstimate: projectP6ResourceEstimateForEvidence(
          memoryBlockedResult.detail?.resourceEstimate,
        ),
        measurement: 'host_statfs_and_runtime_snapshot',
        noJobOrChangeSetOrRevisionOrCheckpointWrite: stableHash(memoryBlockedCountsBefore) === stableHash(memoryBlockedCountsAfter),
        countsBefore: memoryBlockedCountsBefore,
        countsAfter: memoryBlockedCountsAfter,
      },
      diskBlocked: {
        error: diskBlockedResult.error,
        decision: diskBlockedResult.detail?.decision || null,
        reasons: diskBlockedResult.detail?.reasons || [],
        scientificParametersChanged: diskBlockedResult.detail?.scientificParametersChanged,
        resourceEstimate: projectP6ResourceEstimateForEvidence(
          diskBlockedResult.detail?.resourceEstimate,
        ),
        measurement: 'controlled_statfs_dependency_fault',
        noJobOrChangeSetOrRevisionOrCheckpointWrite: stableHash(diskBlockedCountsBefore) === stableHash(diskBlockedCountsAfter),
        countsBefore: diskBlockedCountsBefore,
        countsAfter: diskBlockedCountsAfter,
      },
      queued: {
        error: queuedResult.error,
        decision: queuedResult.detail?.decision || null,
        reasons: queuedResult.detail?.reasons || [],
        scientificParametersChanged: queuedResult.detail?.scientificParametersChanged,
        noJobOrChangeSetOrRevisionOrCheckpointWrite: stableHash(queuedCountsBefore) === stableHash(queuedCountsAfter),
        countsBefore: queuedCountsBefore,
        countsAfter: queuedCountsAfter,
        activePreviewJobs: saturatedCounts.runningChangeSets,
      },
      holders: {
        createdByProductService: [firstCandidate, secondCandidate].every((candidate) => candidate.ok === true
          && candidate.changeSet?.status === 'preview_ready'
          && Array.isArray(candidate.changeSet?.jobRefs) && candidate.changeSet.jobRefs.length > 0
          && Array.isArray(candidate.cohortRevisions) && candidate.cohortRevisions.length > 0),
        realToolExecution: [firstCandidate, secondCandidate].every((candidate) => typeof candidate.toolJobId === 'string'
          && candidate.toolJobId.length > 0),
        previewReadyCount: [firstCandidate, secondCandidate]
          .filter((candidate) => candidate.changeSet?.status === 'preview_ready').length,
        changeSetDigests: [firstRunningId, secondRunningId].map(digestId).sort(),
      },
    };
    const staleAdoption = {
      classification: 'real_no_seed_same_family_candidate_adoption_race',
      secondAdopted: adoptedSecond.data?.changeSet?.status === 'adopted',
      staleHttpStatus: staleResponse.status,
      staleError: staleResponse.data?.error || null,
      noPartialMutation: beforeStaleDigest === afterStaleDigest,
      firstCandidateRemainsPreviewReady: candidateState.changeSets[0]?.status === 'preview_ready',
      secondCandidateRemainsAdopted: candidateState.changeSets[1]?.status === 'adopted',
      adoptedCohortCurrent: secondCandidate.cohortRevisions.length > 0
        && candidateState.revisions.filter((revision) => revision.is_current === 1).length
          === secondCandidate.cohortRevisions.length
        && sameStringSet(firstFamilies, secondCurrentFamilies),
      firstCandidateDigest: digestId(firstCandidate.changeSet.changeSetId),
      secondCandidateDigest: digestId(secondCandidate.changeSet.changeSetId),
      stateDigestBeforeFailure: beforeStaleDigest,
      stateDigestAfterFailure: afterStaleDigest,
    };
    const gcColdReadback = {
      classification: 'real_product_http_gc_then_managed_git_gc_and_same_disk_cold_boot',
      httpPlanMode: gcPlan.mode,
      httpExecutionMode: gcExecution.mode,
      planVersion: gcPlan.gcPlanVersion,
      artifactDeletionCount: gcExecution.artifactDeletionCount,
      sourceRevisionCount: gcExecution.sourceRevisionCount,
      sourceCommitCount: gcExecution.sourceCommitCount,
      protectedSourceRefCount: Array.isArray(gcExecution.protectedSourceRefs)
        ? gcExecution.protectedSourceRefs.length
        : 0,
      gitGc,
      before: truthBeforeGc,
      after: truthAfterGc,
      ledgerExact: truthBeforeGc.ledgerDigest === truthAfterGc.ledgerDigest,
      revisionsExact: truthBeforeGc.revisionDigest === truthAfterGc.revisionDigest,
      changeSetsExact: truthBeforeGc.changeSetDigest === truthAfterGc.changeSetDigest,
      checkpointsExact: truthBeforeGc.checkpointDigest === truthAfterGc.checkpointDigest,
      jobsExact: truthBeforeGc.jobDigest === truthAfterGc.jobDigest,
      physicalHashesExact: truthBeforeGc.physicalHashesExact === true
        && truthAfterGc.physicalHashesExact === true
        && truthBeforeGc.physicalDigest === truthAfterGc.physicalDigest,
      scriptsExact: truthBeforeGc.sourceDigest === truthAfterGc.sourceDigest,
      historyExact: truthBeforeGc.historyDigest === truthAfterGc.historyDigest,
      adoptedCurrentHistoryPresent: truthAfterGc.currentRevisionCount > 0
        && truthAfterGc.historicalRevisionCount > 0,
      nonterminalPreviewPreserved: truthBeforeGc.previewChangeSetCount > 0
        && truthBeforeGc.previewChangeSetCount === truthAfterGc.previewChangeSetCount
        && truthBeforeGc.previewRevisionCount === truthAfterGc.previewRevisionCount,
      checkpointTruthPreserved: truthBeforeGc.checkpointHashesExact === true
        && truthAfterGc.checkpointHashesExact === true
        && truthBeforeGc.checkpointCount === truthAfterGc.checkpointCount,
      coldWorkspaceNotBlocked: truthAfterGc.workspaceStatus !== 'blocked'
        && truthAfterGc.workspaceBlockingIssueCount === 0,
    };
    return {
      classification: P6_PRODUCT_SCENARIO_CLASSIFICATION,
      noSeedPrecondition,
      projectDigest: digestId(projectId),
      resourceBudget,
      staleAdoption,
      gcColdReadback,
    };
  } finally {
    for (const release of releases) releaseBarrier(release);
    for (const handle of handles) {
      if (handle.child.exitCode === null) handle.child.kill('SIGKILL');
      await handle.promise.catch(() => {});
    }
    if (runtime) await runtime.close({ removeRoot: !keep });
    if (coldServer?.child) await stopServer(coldServer.child);
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

export async function captureP6ProductScenarios(options = {}) {
  const [transport, product] = await Promise.all([
    captureP6ControlledTransportScenario(),
    captureP6LiveProductScenarios(options),
  ]);
  return sanitizeP6ProductScenarioObservation({
    classification: P6_PRODUCT_SCENARIO_CLASSIFICATION,
    transport,
    product,
  });
}

export function evaluateP6ProviderTransportObservation(observation) {
  const cases = Array.isArray(observation?.cases) ? observation.cases : [];
  return observation?.classification === P6_PRODUCT_SCENARIO_CLASSIFICATION.providerObservation
    && observation?.adapter === 'openai-compatible/DeepSeekProvider'
    && observation?.loopbackOnly === true
    && observation?.realProvider === false
    && observation?.p7Eligible === false
    && cases.length === 2
    && sameStringSet(cases.map((entry) => String(entry.status)), ['429', '503'])
    && cases.every((entry) => entry.retryable === true
      && entry.requestPath === '/v1/chat/completions'
      && entry.requestCount === 2
      && entry.requestStatuses[0] === entry.status
      && entry.requestStatuses[1] === 200
      && entry.routingEvent?.reason?.code === 'http_error'
      && entry.routingEvent?.reason?.status === entry.status
      && entry.modelRouting?.fallbackReason?.status === entry.status
      && entry.recovered === true);
}

export function evaluateP6NoSeedPrecondition(observation) {
  const counts = observation?.tableCounts;
  const expectedCounts = Object.fromEntries(P5_NO_SEED_TABLES.map((table) => [table, 0]));
  return Array.isArray(observation?.tables)
    && sameStringSet(observation.tables, P5_NO_SEED_TABLES)
    && Array.isArray(observation.seededTables)
    && observation.seededTables.length === 0
    && counts && typeof counts === 'object'
    && stableHash(counts) === stableHash(expectedCounts)
    && String(observation.digest || '') === stableHash(expectedCounts);
}

export function projectP6ResourceEstimateForEvidence(estimate) {
  if (!estimate || typeof estimate !== 'object') return null;
  return {
    estimateVersion: estimate.estimateVersion,
    source: estimate.source,
    memoryBytes: estimate.memoryBytes,
    diskBytes: estimate.diskBytes,
    inputBytes: estimate.inputBytes,
    sourceOutputBytes: estimate.sourceOutputBytes,
    sourceOutputMeasurement: estimate.sourceOutputMeasurement,
    selectedRevisionDigest: estimate.selectedRevisionId
      ? digestId(estimate.selectedRevisionId)
      : null,
    downstreamOutputBytes: estimate.downstreamOutputBytes,
    historicalRssBytes: estimate.historicalRssBytes,
    rasterBytes: estimate.rasterBytes,
    rasterParameterSource: estimate.rasterParameterSource,
  };
}

function trustedBlockedPreviewObservation(observation, requiredReason, measurement) {
  const estimate = observation?.resourceEstimate;
  return observation?.error === 'preview_resource_budget_blocked'
    && observation?.decision === 'blocked'
    && observation?.reasons?.includes(requiredReason)
    && observation?.scientificParametersChanged === false
    && observation?.measurement === measurement
    && observation?.noJobOrChangeSetOrRevisionOrCheckpointWrite === true
    && estimate?.source === 'server_job_descriptor_input_truth'
    && estimate?.estimateVersion === 1
    && Number.isSafeInteger(estimate.memoryBytes) && estimate.memoryBytes > 0
    && Number.isSafeInteger(estimate.diskBytes) && estimate.diskBytes > 0;
}

export function evaluateP6ResourceBudgetObservation(observation) {
  return observation?.classification === 'real_product_changeset_preflight_no_seed'
    && observation.sourceScientificParametersUnchanged === true
    && trustedBlockedPreviewObservation(
      observation.memoryBlocked,
      'memory_budget_exceeded',
      'host_statfs_and_runtime_snapshot',
    )
    && trustedBlockedPreviewObservation(
      observation.diskBlocked,
      'disk_budget_exceeded',
      'controlled_statfs_dependency_fault',
    )
    && observation.queued?.error === 'preview_resource_queued'
    && observation.queued?.decision === 'queued'
    && observation.queued?.reasons?.includes('preview_concurrency_saturated')
    && observation.queued?.scientificParametersChanged === false
    && observation.queued?.noJobOrChangeSetOrRevisionOrCheckpointWrite === true
    && observation.queued?.activePreviewJobs >= 2
    && observation.holders?.createdByProductService === true
    && observation.holders?.realToolExecution === true
    && observation.holders?.previewReadyCount === 2;
}

export function evaluateP6StaleAdoptionObservation(observation) {
  return observation?.classification === 'real_no_seed_same_family_candidate_adoption_race'
    && observation.secondAdopted === true
    && observation.staleHttpStatus === 409
    && observation.staleError === 'adoption_base_stale'
    && observation.noPartialMutation === true
    && observation.firstCandidateRemainsPreviewReady === true
    && observation.secondCandidateRemainsAdopted === true
    && observation.adoptedCohortCurrent === true
    && observation.stateDigestBeforeFailure === observation.stateDigestAfterFailure;
}

export function evaluateP6GcColdReadbackObservation(observation) {
  return observation?.classification === 'real_product_http_gc_then_managed_git_gc_and_same_disk_cold_boot'
    && observation.httpPlanMode === 'dry_run'
    && observation.httpExecutionMode === 'executed'
    && observation.planVersion === 2
    && observation.artifactDeletionCount === 0
    && observation.sourceRevisionCount > 0
    && observation.sourceCommitCount > 0
    && observation.protectedSourceRefCount === observation.sourceCommitCount
    && observation.gitGc?.exitCode === 0
    && observation.ledgerExact === true
    && observation.revisionsExact === true
    && observation.changeSetsExact === true
    && observation.checkpointsExact === true
    && observation.jobsExact === true
    && observation.physicalHashesExact === true
    && observation.scriptsExact === true
    && observation.historyExact === true
    && observation.adoptedCurrentHistoryPresent === true
    && observation.nonterminalPreviewPreserved === true
    && observation.checkpointTruthPreserved === true
    && observation.coldWorkspaceNotBlocked === true;
}

export function evaluateP6ProductScenarios(observation) {
  const checks = {
    controlledTransport: evaluateP6ProviderTransportObservation(observation?.transport),
    noSeedLedger: evaluateP6NoSeedPrecondition(observation?.product?.noSeedPrecondition),
    resourceBudget: evaluateP6ResourceBudgetObservation(observation?.product?.resourceBudget),
    staleAdoption: evaluateP6StaleAdoptionObservation(observation?.product?.staleAdoption),
    gcColdReadback: evaluateP6GcColdReadbackObservation(observation?.product?.gcColdReadback),
    exclusionsExplicit: observation?.classification?.realProvider === false
      && observation?.classification?.packagedElectron === false
      && observation?.classification?.qualificationEligible === false
      && observation?.classification?.p7Eligible === false,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

const PRIVATE_COORDINATE = /(?:file:\/\/|[a-zA-Z]:[\\/]|(?:^|[\s"'(:=])\/(?!v1\/)[^\s"'<>]+)/;
const LOOPBACK_URL = /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i;

export function assertSanitizedP6ProductScenarioObservation(value, pointer = '$') {
  if (typeof value === 'string') {
    invariant(!LOOPBACK_URL.test(value), 'p6_product_observation_loopback_url', pointer);
    invariant(!PRIVATE_COORDINATE.test(value), 'p6_product_observation_private_path', pointer);
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    invariant(!/(?:root|workspacePath|dbPath|baseUrl|readyPath|releasePath)$/i.test(key),
      'p6_product_observation_private_key', `${pointer}.${key}`);
    assertSanitizedP6ProductScenarioObservation(child, `${pointer}.${key}`);
  }
  return true;
}

export function sanitizeP6ProductScenarioObservation(value) {
  const cloned = JSON.parse(JSON.stringify(value));
  assertSanitizedP6ProductScenarioObservation(cloned);
  return cloned;
}

async function main() {
  if (process.argv.includes('--scenario-worker')) {
    await runScenarioWorkerMain();
    return;
  }
  const runReal = process.argv.includes('--real');
  const observation = runReal
    ? await captureP6ProductScenarios({ keep: process.argv.includes('--keep'), verbose: process.argv.includes('--verbose') })
    : { transport: await captureP6ControlledTransportScenario() };
  const evaluation = runReal
    ? evaluateP6ProductScenarios(observation)
    : { passed: evaluateP6ProviderTransportObservation(observation.transport) };
  process.stdout.write(`${JSON.stringify({ observation, evaluation }, null, 2)}\n`);
  if (!evaluation.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.code || error.message);
    if (error.detail) console.error(JSON.stringify(error.detail));
    process.exit(1);
  });
}
