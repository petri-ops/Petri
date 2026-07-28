#!/usr/bin/env node

/**
 * G0-RS-P4R-6 — one-shot, disposable continuous live journey.
 *
 * This is development evidence, not product qualification.  In particular the
 * "Agent" step invokes the real context-bound Agent tools deterministically
 * with a trusted presentation patch; it does not claim that a real Provider
 * understood the natural-language request.  Provider and packaged-app proof
 * remains owned by P7.
 *
 * The parent process owns the complete lifecycle:
 *   corpus -> backend #1 -> edit/review/code/replay/adopt/revert
 *          -> backend stop -> backend #2 -> durable truth verification
 *          -> cleanup
 *
 * Default runs print the sanitized report only.  `--write-evidence` is the
 * sole mode that writes the canonical acceptance JSON.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCaptureEnv, startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-result-studio/rs-p4r-live-observation.json');
const SHA256 = /^[a-f0-9]{64}$/;
const INTERNAL_ID = /(?:^|[^A-Za-z0-9])(?:p|tj|rev|cs|conv|msg|sel)_[A-Za-z0-9._-]+/;
const SECRET_KEY = /(?:authorization|cookie|token|password|secret|api[_-]?key)/i;
const AGENT_CHILD_MARKER = '__P4R6_AGENT_RESULT__';
const CORPUS_CHILD_MARKER = '__P4R6_CORPUS_RESULT__';
const SIGNAL_FIXTURE_MARKER = '__P4R6_SIGNAL_READY__';
const AGENT_CHILD_TIMEOUT_MS = 12 * 60 * 1000;

export const LIVE_SOURCE_FILES = Object.freeze({
  producer: 'scripts/g0-rs-p4r-live-observation.mjs',
  producerTest: 'test/p4r-live-observation.test.mjs',
  corpus: 'scripts/g0-rs-p4r-corpus.mjs',
  capture: 'scripts/g0-rs-p4r-capture.mjs',
  routes: 'core/r-server/routes/result-studio.js',
  contextTools: 'core/r-server/agent-tools/result-context-tools.js',
  contextEditTools: 'core/r-server/agent-tools/result-context-edit-tools.js',
  editTools: 'core/r-server/agent-tools/result-edit-tools.js',
  changeSetService: 'core/shared-backend/result-changeset-service.js',
  compareService: 'core/shared-backend/result-compare-service.js',
  revisionSource: 'core/shared-backend/result-revision-source.js',
  replayService: 'core/shared-backend/result-replay-service.js',
  background: 'core/shared-backend/result-studio-background.js',
  backgroundChild: 'core/shared-backend/result-studio-background-child.js',
  repository: 'core/shared-backend/result-studio-repository.js',
  conversations: 'core/r-server/helpers/conversations.js',
  packageScripts: 'package.json',
  impactMap: 'test/impact-map.json',
});

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return hash(JSON.stringify(stableValue(value)));
}

function sourceBinding() {
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  const sourceHashes = Object.fromEntries(Object.entries(LIVE_SOURCE_FILES).map(([key, file]) => [
    key,
    hash(readFileSync(path.join(ROOT, file))),
  ]));
  const sourceMismatches = Object.entries(LIVE_SOURCE_FILES).flatMap(([key, file]) => {
    const shown = spawnSync('git', ['show', `${sourceCommit}:${file}`], { cwd: ROOT });
    return shown.status === 0 && hash(shown.stdout) === sourceHashes[key] ? [] : [file];
  });
  return {
    sourceCommit,
    sourceFiles: LIVE_SOURCE_FILES,
    sourceHashes,
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

/**
 * Reject evidence that leaks runtime coordinates or secret-bearing material.
 * Repository-relative source refs and cryptographic digests are allowed.
 */
export function assertSanitizedEvidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedEvidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && key !== 'qualificationEligible') {
        throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      }
      assertSanitizedEvidence(item, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  if (/^https?:\/\//i.test(value)) throw new Error(`URL leaked at ${pointer}`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`absolute path leaked at ${pointer}`);
  }
  if (value.includes('..')) throw new Error(`parent path leaked at ${pointer}`);
  if (INTERNAL_ID.test(value)) throw new Error(`internal id leaked at ${pointer}`);
  return true;
}

export function injectFailure(stage, faultAt) {
  if (faultAt && stage === faultAt) {
    const error = new Error(`injected_failure:${stage}`);
    error.code = 'p4r6_injected_failure';
    throw error;
  }
}

export function assertEvidenceWritable(evidence) {
  if (evidence?.sourceCommitMatchesSourceHashes !== true) {
    const error = new Error('refusing to write evidence whose source hashes are not bound to sourceCommit');
    error.code = 'source_binding_not_current';
    throw error;
  }
  if (evidence?.passed !== true) {
    const error = new Error('refusing to write failed live evidence');
    error.code = 'live_observation_not_passed';
    throw error;
  }
  return true;
}

export async function withGuaranteedCleanup(operation, cleanup) {
  try {
    return await operation();
  } finally {
    await cleanup();
  }
}

/**
 * Install cleanup for interruptible local runs.  SIGKILL cannot be trapped;
 * SIGINT/SIGTERM are handled once and cleanup itself must be idempotent.
 */
export function installSignalCleanup(cleanup, {
  processRef = process,
  signals = ['SIGINT', 'SIGTERM'],
  terminate = (code) => {
    processRef.exitCode = code;
    if (typeof processRef.exit === 'function') processRef.exit(code);
  },
} = {}) {
  let handling = false;
  const listeners = new Map();
  for (const signal of signals) {
    const listener = () => {
      if (handling) return;
      handling = true;
      Promise.resolve(cleanup()).finally(() => {
        terminate(signal === 'SIGINT' ? 130 : 143);
      });
    };
    listeners.set(signal, listener);
    processRef.once(signal, listener);
  }
  return () => {
    for (const [signal, listener] of listeners) processRef.removeListener(signal, listener);
  };
}

export function createOwnedLifecycle({ keep = false } = {}) {
  let root = null;
  let backend = null;
  let cleaned = false;
  const children = new Set();
  return {
    setRoot(next) { root = next; },
    setBackend(next) { backend = next; },
    addChild(child) { if (child) children.add(child); },
    removeChild(child) { children.delete(child); },
    get root() { return root; },
    get backend() { return backend; },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      const ownedChildren = [...children];
      children.clear();
      await Promise.all(ownedChildren.map((child) => new Promise((resolve) => {
        if (!child || child.exitCode !== null) { resolve(); return; }
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already exited */ }
          resolve();
        }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
      })));
      const current = backend;
      backend = null;
      await stopServer(current?.child);
      if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
    },
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function fetchResponse(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  return response;
}

async function fetchJson(baseUrl, route, options = {}) {
  const response = await fetchResponse(baseUrl, route, options);
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.code = data.error || 'http_request_failed';
    error.status = response.status;
    throw error;
  }
  return { data, responseDigest: hash(raw), status: response.status };
}

function postJson(baseUrl, route, body, timeoutMs = 30000) {
  return fetchJson(baseUrl, route, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs,
  });
}

function artifactName(outputs, preferred = 'volcano.png') {
  if (outputs?.[preferred]) return preferred;
  return Object.keys(outputs || {}).find((name) => /volcano.*\.(?:png|svg)$/i.test(name)) || null;
}

function openDatabase(dbPath, { readonly = false } = {}) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(ROOT, 'core/r-server'), ROOT],
  }));
  return new Database(dbPath, readonly ? { readonly: true } : undefined);
}

function alignDisposableDesktopIdentity(dbPath, projectId) {
  const db = openDatabase(dbPath);
  try {
    const row = db.prepare('SELECT user_id FROM projects WHERE id=?').get(projectId);
    if (!row) throw new Error('disposable project is missing');
    if (row.user_id === 'local-user') return { matched: true, changed: false };
    if (row.user_id !== 'p4r-corpus') {
      throw new Error('refusing to rewrite an unexpected disposable project owner');
    }
    const result = db.prepare('UPDATE projects SET user_id=? WHERE id=? AND user_id=?')
      .run('local-user', projectId, 'p4r-corpus');
    if (result.changes !== 1) throw new Error('disposable desktop identity alignment failed');
    return { matched: true, changed: true };
  } finally {
    db.close();
  }
}

function inspectTruth(dbPath, {
  projectId,
  artifactFamilyId,
  sourceRevisionId,
  adoptedRevisionId,
  replayRevisionId,
  conversationId,
} = {}) {
  const db = openDatabase(dbPath, { readonly: true });
  try {
    const revisions = db.prepare(`
      SELECT revision_id, artifact_family_id, artifact_id, revision_ordinal,
             source_commit, parameters_hash, tool_job_id, output_hash,
             validation_status, reproducibility_status, change_set_id, is_current
      FROM artifact_revisions
      WHERE project_id=? AND artifact_family_id=?
      ORDER BY revision_ordinal
    `).all(projectId, artifactFamilyId);
    const changeSets = db.prepare(`
      SELECT change_set_id, status, candidate_commit, created_by
      FROM scientific_change_sets WHERE project_id=? ORDER BY created_at
    `).all(projectId);
    const jobs = db.prepare(`
      SELECT tool_id, status, COUNT(*) AS count
      FROM tool_jobs WHERE project_id=? GROUP BY tool_id, status ORDER BY tool_id, status
    `).all(projectId);
    const conversation = db.prepare(`
      SELECT id, user_id, project_id, status, message_count
      FROM copilot_conversations WHERE id=?
    `).get(conversationId) || null;
    const messages = db.prepare(`
      SELECT role, content, meta_json FROM copilot_messages
      WHERE conversation_id=? ORDER BY ts, id
    `).all(conversationId);
    const byId = new Map(revisions.map((row) => [row.revision_id, row]));
    const changeById = new Map(changeSets.map((row) => [row.change_set_id, row]));
    const current = revisions.find((row) => row.is_current === 1) || null;
    const projection = {
      revisionCount: revisions.length,
      currentRevisionOrdinal: current?.revision_ordinal || null,
      currentIsAdoptedRevision: current?.revision_id === adoptedRevisionId,
      sourceOutputHash: byId.get(sourceRevisionId)?.output_hash || null,
      adoptedOutputHash: byId.get(adoptedRevisionId)?.output_hash || null,
      replayOutputHash: byId.get(replayRevisionId)?.output_hash || null,
      adoptedStatus: changeById.get(byId.get(adoptedRevisionId)?.change_set_id)?.status || null,
      replayStatus: changeById.get(byId.get(replayRevisionId)?.change_set_id)?.status || null,
      jobs,
      conversationPresent: Boolean(conversation),
      conversationStatus: conversation?.status || null,
      conversationMessageCount: conversation?.message_count || 0,
      durableMessageCount: messages.length,
      durableMessageDigest: stableHash(messages),
      revisionTruthDigest: stableHash(revisions),
      changeSetTruthDigest: stableHash(changeSets),
    };
    return projection;
  } finally {
    db.close();
  }
}

function countTool(truth, toolId) {
  return truth.jobs
    .filter((row) => row.tool_id === toolId)
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
}

async function runMarkerChild({
  args,
  env,
  marker,
  lifecycle,
  timeoutMs = AGENT_CHILD_TIMEOUT_MS,
  label,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SELF, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    lifecycle?.addChild(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => {
      clearTimeout(timer);
      lifecycle?.removeChild(child);
      const markerAt = stdout.lastIndexOf(marker);
      if (code !== 0 || markerAt === -1) {
        reject(new Error(`${label} failed (${code}): ${stderr.slice(-1200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(markerAt + marker.length).trim()));
      } catch (error) {
        reject(new Error(`${label} result invalid: ${error.message}`));
      }
    });
  });
}

export function runAgentChild(env, spec, lifecycle) {
  return runMarkerChild({
    args: ['--agent-child', JSON.stringify(spec)],
    env,
    marker: AGENT_CHILD_MARKER,
    lifecycle,
    label: 'agent child',
  });
}

function runCorpusChild(root, lifecycle) {
  return runMarkerChild({
    args: ['--corpus-child', root],
    env: process.env,
    marker: CORPUS_CHILD_MARKER,
    lifecycle,
    timeoutMs: AGENT_CHILD_TIMEOUT_MS,
    label: 'corpus child',
  });
}

async function runCorpusChildMain() {
  const index = process.argv.indexOf('--corpus-child');
  const root = process.argv[index + 1];
  const corpus = await generateCorpus({ root, keep: true, quiet: true });
  process.stdout.write(`${CORPUS_CHILD_MARKER}${JSON.stringify({
    root: corpus.root,
    tables: corpus.tables,
    records: corpus.records,
    outputs: corpus.outputs,
    projectId: corpus.projectId,
    ok: corpus.ok,
    kept: true,
  })}\n`);
}

async function runSignalFixtureChildMain() {
  const index = process.argv.indexOf('--signal-fixture-child');
  const root = process.argv[index + 1];
  const lifecycle = createOwnedLifecycle();
  lifecycle.setRoot(root);
  installSignalCleanup(() => lifecycle.cleanup());
  process.stdout.write(`${SIGNAL_FIXTURE_MARKER}\n`);
  // The signal handler owns termination. This interval makes it impossible for
  // the fixture to pass merely because the process naturally reached EOF.
  setInterval(() => {}, 1000);
}

async function runAgentChildMain() {
  const index = process.argv.indexOf('--agent-child');
  const spec = JSON.parse(process.argv[index + 1]);
  const {
    createResultContextEditTools,
  } = require(path.join(ROOT, 'core/r-server/agent-tools/result-context-edit-tools.js'));
  const {
    createResultChangeSetTools,
  } = require(path.join(ROOT, 'core/r-server/agent-tools/result-edit-tools.js'));
  const mcpRegistry = require(path.join(ROOT, 'core/r-server/mcp/registry.js'));
  const {
    getOrCreateActiveConversation,
    appendMessageToConversation,
  } = require(path.join(ROOT, 'core/r-server/helpers/conversations.js'));
  const db = require(path.join(ROOT, 'core/r-server/db.js'));
  const project = db.getProject(spec.projectId);
  const ownerId = String(project?.user_id || '').trim();
  if (!project || !ownerId) throw new Error('live project owner is unavailable');
  const conversation = getOrCreateActiveConversation(ownerId, {
    projectId: spec.projectId,
    titleHint: 'P4R-6 live journey',
    page: 'project-workspace',
  });
  appendMessageToConversation(conversation.id, 'user', spec.requestedOutcome, {
    page: 'project-workspace',
    evidenceMode: 'deterministic_context_bound_no_provider',
  });

  const progress = [];
  const ctx = {
    projectId: spec.projectId,
    // The disposable backend is booted without an authenticated HTTP user;
    // use the same local-desktop trust boundary here. Both context/edit tool
    // authorizers explicitly admit a missing user id while still requiring
    // the project, Job, Revision and context token to match SQLite truth.
    userId: undefined,
    conversationId: conversation.id,
    activeArtifact: {
      jobId: spec.jobId,
      name: spec.artifact,
      revisionId: spec.revisionId,
    },
    emitResultEditProgress(event) { progress.push(event); },
  };
  const changeSetTools = createResultChangeSetTools({
    callTool(toolId, params, toolContext) {
      return mcpRegistry.callTool(toolId, params, { ...toolContext, userId: ownerId });
    },
  });
  const tools = createResultContextEditTools({ changeSetTools });
  const planned = await tools.plan({
    requestedOutcome: spec.requestedOutcome,
    proposedParameterPatch: spec.parameterPatch,
    editOrigin: 'agent',
    userMessageId: 'live-observation-user-turn',
  }, ctx);
  if (!planned?.ok || !planned.intent || !planned.context?.contextToken) {
    throw new Error(`context edit plan failed: ${planned?.error || 'unknown'}`);
  }
  const created = await tools.create({
    contextToken: planned.context.contextToken,
    intent: planned.intent,
    scientificConfirmed: false,
  }, ctx);
  if (!created?.ok || created.changeSet?.status !== 'preview_ready' || !created.revision) {
    throw new Error(`context edit create failed: ${created?.error || 'unknown'}`);
  }
  appendMessageToConversation(conversation.id, 'assistant', '展示修改候选已生成并完成验证。', {
    page: 'project-workspace',
    resultEditStatus: 'preview_ready',
  });
  process.stdout.write(`${AGENT_CHILD_MARKER}${JSON.stringify({
    conversationId: conversation.id,
    contextToken: planned.context.contextToken,
    editClass: planned.intent.editClass,
    affectedScope: planned.intent.affectedScope,
    changeSetId: created.changeSet.changeSetId,
    revisionId: created.revision.revisionId,
    artifactFamilyId: created.revision.artifactFamilyId,
    revisionOrdinal: created.revision.revisionOrdinal,
    toolJobId: created.toolJobId,
    outputHash: created.revision.outputHash,
    parametersHash: created.revision.parametersHash,
    publicProgressPhases: (created.publicProgress || []).map((item) => item.phase),
    emittedProgressCount: progress.length,
  })}\n`);
}

function eventChain(events) {
  let previous = '0'.repeat(64);
  return events.map((event, index) => {
    const digest = stableHash({ index, previous, event });
    previous = digest;
    return { ...event, digest };
  });
}

/**
 * Full live run. `faultAt` exists only for deterministic lifecycle tests and
 * local diagnosis; CLI callers do not expose it as an acceptance shortcut.
 */
export async function captureLiveObservation({
  keep = false,
  faultAt = null,
  writeEvidence = false,
} = {}) {
  const lifecycle = createOwnedLifecycle({ keep });
  const removeSignalHandlers = installSignalCleanup(() => lifecycle.cleanup());
  const startedAt = Date.now();

  return withGuaranteedCleanup(async () => {
    injectFailure('before_corpus', faultAt);
    const captureRoot = createCaptureEnv({ port: 0 }).root;
    lifecycle.setRoot(captureRoot);
    const corpus = await runCorpusChild(captureRoot, lifecycle);
    if (!corpus.ok) throw new Error('live corpus incomplete');
    const desktopIdentity = alignDisposableDesktopIdentity(
      path.join(corpus.root, 'biof3.db'),
      corpus.projectId,
    );
    const volcano = corpus.records.find((record) => record.id === 'volcano-plot');
    const artifact = artifactName(corpus.outputs['volcano-plot']);
    if (!volcano?.toolJobId || !artifact) throw new Error('standalone volcano artifact unavailable');
    injectFailure('after_corpus', faultAt);

    const { env } = createCaptureEnv({ root: corpus.root, port: await freePort() });
    let backend = await startServer(env);
    lifecycle.setBackend(backend);
    const timings = {};
    const timed = async (name, operation) => {
      const start = process.hrtime.bigint();
      const result = await operation();
      timings[name] = Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(3));
      return result;
    };

    const interaction = await timed('openResultMs', () => fetchJson(
      backend.baseUrl,
      `/api/result-studio/interaction?projectId=${encodeURIComponent(corpus.projectId)}&jobId=${encodeURIComponent(volcano.toolJobId)}&artifact=${encodeURIComponent(artifact)}`,
    ));
    const sourceRevision = interaction.data.revision;
    if (!sourceRevision?.revisionId || !interaction.data.manifest?.artifactFamilyId) {
      throw new Error('interaction did not create a formal source Revision');
    }
    injectFailure('after_open', faultAt);

    const beforeEdit = inspectTruth(env.BIOF3_DB_PATH, {
      projectId: corpus.projectId,
      artifactFamilyId: interaction.data.manifest.artifactFamilyId,
      sourceRevisionId: sourceRevision.revisionId,
      conversationId: 'not-created',
    });
    const requestedOutcome = '换成色盲友好配色，并让标签更容易阅读';
    const agent = await timed('agentEditMs', () => runAgentChild(env, {
      userId: 'p4r-corpus',
      projectId: corpus.projectId,
      jobId: volcano.toolJobId,
      artifact,
      revisionId: sourceRevision.revisionId,
      requestedOutcome,
      parameterPatch: {
        color_up: '#d55e00',
        color_down: '#0072b2',
        point_size: 2.4,
        label_size: 3.6,
      },
    }, lifecycle));
    if (agent.editClass !== 'presentation_rerender' || agent.affectedScope !== 'current_result_only') {
      throw new Error('deterministic Agent edit escaped the presentation-only boundary');
    }
    injectFailure('after_agent_edit', faultAt);

    const comparisonA = await timed('compareMs', () => fetchJson(
      backend.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(agent.changeSetId)}/compare`,
    ));
    const sourceA = await timed('codeOpenMs', () => fetchJson(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/source?projectId=${encodeURIComponent(corpus.projectId)}`,
    ));
    const downloaded = await fetchResponse(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/source?projectId=${encodeURIComponent(corpus.projectId)}&download=1`,
    );
    const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
    if (!downloaded.ok || hash(downloadedBytes) !== sourceA.data.sha256) {
      throw new Error('downloaded Revision source did not match sourceScriptRef');
    }

    const adopted = await timed('adoptMs', () => postJson(
      backend.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(agent.changeSetId)}/adopt`,
      {},
    ));
    const adoptedRevision = adopted.data.currentRevisions?.find(
      (revision) => revision.revisionId === agent.revisionId,
    ) || adopted.data.currentRevisions?.[0];
    if (!adoptedRevision || adoptedRevision.revisionId !== agent.revisionId) {
      throw new Error('Agent candidate was not adopted as current');
    }

    const adoptedContext = await fetchJson(
      backend.baseUrl,
      `/api/result-studio/context-envelope?projectId=${encodeURIComponent(corpus.projectId)}&conversationId=${encodeURIComponent(agent.conversationId)}&jobId=${encodeURIComponent(agent.toolJobId)}&artifact=${encodeURIComponent(artifact)}&revisionId=${encodeURIComponent(agent.revisionId)}`,
    );
    const contextToken = adoptedContext.data.agentView?.contextToken;
    if (!SHA256.test(contextToken || '')) throw new Error('adopted Revision context token unavailable');
    const preflight = await timed('replayPreflightMs', () => postJson(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/replay`,
      {
        phase: 'preflight',
        projectId: corpus.projectId,
        revisionId: agent.revisionId,
        conversationId: agent.conversationId,
        contextToken,
        expectedSourceSha256: sourceA.data.sha256,
        expectedParametersHash: sourceA.data.parameters?.sha256,
      },
    ));
    const confirmBody = {
      phase: 'confirm',
      projectId: corpus.projectId,
      revisionId: agent.revisionId,
      conversationId: agent.conversationId,
      contextToken,
      confirmationToken: preflight.data.confirmationToken,
    };
    const replay = await timed('replayConfirmMs', () => postJson(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/replay`,
      confirmBody,
      10 * 60 * 1000,
    ));
    const afterFirstReplay = inspectTruth(env.BIOF3_DB_PATH, {
      projectId: corpus.projectId,
      artifactFamilyId: agent.artifactFamilyId,
      sourceRevisionId: sourceRevision.revisionId,
      adoptedRevisionId: agent.revisionId,
      replayRevisionId: replay.data.revisionId,
      conversationId: agent.conversationId,
    });
    const replayAgain = await postJson(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/replay`,
      confirmBody,
      10 * 60 * 1000,
    );
    const afterDuplicateReplay = inspectTruth(env.BIOF3_DB_PATH, {
      projectId: corpus.projectId,
      artifactFamilyId: agent.artifactFamilyId,
      sourceRevisionId: sourceRevision.revisionId,
      adoptedRevisionId: agent.revisionId,
      replayRevisionId: replay.data.revisionId,
      conversationId: agent.conversationId,
    });
    if (replay.data.adopted !== false || replay.data.idempotent !== false
      || replayAgain.data.idempotent !== true
      || replayAgain.data.revisionId !== replay.data.revisionId) {
      throw new Error('controlled replay idempotency/current contract failed');
    }
    const comparisonB = await fetchJson(
      backend.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(replay.data.changeSetId)}/compare`,
    );
    const reverted = await timed('revertMs', () => postJson(
      backend.baseUrl,
      `/api/result-studio/changesets/${encodeURIComponent(replay.data.changeSetId)}/revert`,
      { reason: 'p4r6_live_discard_candidate' },
    ));
    injectFailure('before_restart', faultAt);

    const beforeRestart = inspectTruth(env.BIOF3_DB_PATH, {
      projectId: corpus.projectId,
      artifactFamilyId: agent.artifactFamilyId,
      sourceRevisionId: sourceRevision.revisionId,
      adoptedRevisionId: agent.revisionId,
      replayRevisionId: replay.data.revisionId,
      conversationId: agent.conversationId,
    });
    await stopServer(backend.child);
    lifecycle.setBackend(null);
    let unreachableBetweenRestarts = false;
    try {
      await fetchResponse(backend.baseUrl, '/api/health', { timeoutMs: 1200 });
    } catch {
      unreachableBetweenRestarts = true;
    }
    if (!unreachableBetweenRestarts) throw new Error('backend did not stop before restart observation');

    backend = await startServer(env);
    lifecycle.setBackend(backend);
    const healthAfterRestart = await fetchJson(backend.baseUrl, '/api/health');
    const versionsAfterRestart = await fetchJson(
      backend.baseUrl,
      `/api/result-studio/changesets?projectId=${encodeURIComponent(corpus.projectId)}&artifactFamilyId=${encodeURIComponent(agent.artifactFamilyId)}`,
    );
    const workspaceAfterRestart = await fetchJson(
      backend.baseUrl,
      `/api/result-studio/workspace/status?projectId=${encodeURIComponent(corpus.projectId)}&conversationId=${encodeURIComponent(agent.conversationId)}`,
    );
    const sourceAfterRestart = await fetchJson(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/source?projectId=${encodeURIComponent(corpus.projectId)}&expectSha256=${encodeURIComponent(sourceA.data.sha256)}`,
    );
    const artifactAfterRestart = await fetchResponse(
      backend.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(agent.revisionId)}/artifact`,
    );
    const artifactBytesAfterRestart = Buffer.from(await artifactAfterRestart.arrayBuffer());
    if (!artifactAfterRestart.ok || hash(artifactBytesAfterRestart) !== agent.outputHash) {
      throw new Error('adopted Artifact failed hash verification after restart');
    }
    const afterRestart = inspectTruth(env.BIOF3_DB_PATH, {
      projectId: corpus.projectId,
      artifactFamilyId: agent.artifactFamilyId,
      sourceRevisionId: sourceRevision.revisionId,
      adoptedRevisionId: agent.revisionId,
      replayRevisionId: replay.data.revisionId,
      conversationId: agent.conversationId,
    });
    injectFailure('after_restart', faultAt);

    const checks = {
      realCorpusCompleted: corpus.ok === true && corpus.records.every((record) => record.ok === true),
      disposableDesktopIdentityMatchesRuntime: desktopIdentity.matched === true,
      formalResultOpened: sourceRevision.validationStatus === 'valid',
      userSuppliedNoInternalIds: !INTERNAL_ID.test(requestedOutcome),
      deterministicAgentBoundaryHonest: agent.editClass === 'presentation_rerender',
      agentCandidateValid: comparisonA.data.summary?.status === 'preview_ready'
        && comparisonA.data.summary?.validationStatus === 'valid',
      codeSourceExact: SHA256.test(sourceA.data.sha256 || '')
        && hash(downloadedBytes) === sourceA.data.sha256
        && sourceA.data.parameters?.sha256 === agent.parametersHash,
      adoptedExactlyOnce: adopted.data.changeSet?.status === 'adopted'
        && beforeRestart.currentIsAdoptedRevision,
      replayCreatedNonCurrentCandidate: replay.data.adopted === false
        && comparisonB.data.summary?.status === 'preview_ready',
      replayConfirmationIdempotent: replayAgain.data.idempotent === true
        && afterFirstReplay.revisionCount === afterDuplicateReplay.revisionCount
        && countTool(afterFirstReplay, 'volcano-plot') === countTool(afterDuplicateReplay, 'volcano-plot'),
      replayCandidateDiscarded: reverted.data.changeSet?.status === 'reverted'
        && beforeRestart.replayStatus === 'reverted',
      sourceAnalysisNotRerun: countTool(beforeEdit, 'deseq2') === countTool(beforeRestart, 'deseq2'),
      sourceArtifactPreserved: beforeEdit.sourceOutputHash === beforeRestart.sourceOutputHash,
      conversationDurable: beforeRestart.conversationPresent
        && beforeRestart.conversationMessageCount === 2
        && beforeRestart.durableMessageCount === 2,
      backendActuallyRestarted: unreachableBetweenRestarts && healthAfterRestart.status === 200,
      truthRecoveredAfterRestart: beforeRestart.revisionTruthDigest === afterRestart.revisionTruthDigest
        && beforeRestart.changeSetTruthDigest === afterRestart.changeSetTruthDigest
        && beforeRestart.durableMessageDigest === afterRestart.durableMessageDigest,
      currentRecoveredAfterRestart: afterRestart.currentIsAdoptedRevision
        && versionsAfterRestart.data.currentRevision?.revisionOrdinal === agent.revisionOrdinal,
      lifecycleRecoveredFromTruth: workspaceAfterRestart.data.lifecycle?.status === 'ready'
        && workspaceAfterRestart.data.lifecycle?.revisionIntegrity?.intact === true,
      sourceAndArtifactReadableAfterRestart: sourceAfterRestart.data.sha256 === sourceA.data.sha256
        && hash(artifactBytesAfterRestart) === agent.outputHash,
    };

    const events = eventChain([
      { step: 'real_completed_job', status: 'observed' },
      { step: 'open_result', status: 'observed' },
      { step: 'context_bound_agent_style_edit', status: 'observed' },
      { step: 'candidate_compare', status: 'observed' },
      { step: 'revision_code', status: 'observed' },
      { step: 'adopt_candidate', status: 'observed' },
      { step: 'controlled_replay', status: 'observed' },
      { step: 'discard_replay_candidate', status: 'observed' },
      { step: 'conversation_roundtrip', status: 'observed' },
      { step: 'backend_restart_recovery', status: 'observed' },
    ]);
    const binding = sourceBinding();
    const evidence = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P4R-6',
      evidenceClass: 'live_local_continuous_journey_non_qualifying',
      capturedAt: new Date().toISOString(),
      qualificationEligible: false,
      providerBoundary: {
        realProviderUsed: false,
        mode: 'deterministic_context_bound_agent_tool_invocation',
        deferredQualificationOwner: 'G0-RS-P7',
      },
      runtimeBoundary: {
        appMode: 'local_backend_and_real_tool_runtime',
        packagedDesktopObserved: false,
        uiInteractionObserved: false,
      },
      privacy: {
        classification: 'digests_counts_statuses_and_timings_only',
        rawInternalIdsPersisted: false,
        absolutePathsPersisted: false,
        urlsOrPortsPersisted: false,
        promptsOrResultValuesPersisted: false,
        credentialsPersisted: false,
      },
      ...binding,
      executionTruthChain: [
        'run_tool',
        'tool_job',
        'artifact_truth',
        'artifact_revision',
        'context_bound_edit',
        'candidate_revision',
        'compare',
        'adopt',
        'controlled_replay',
        'discard_candidate',
        'backend_restart',
        'truth_reopen',
      ],
      events,
      eventChainDigest: events.at(-1)?.digest || null,
      observations: {
        corpusToolCount: corpus.records.length,
        initialRevisionOrdinal: sourceRevision.revisionOrdinal,
        adoptedRevisionOrdinal: agent.revisionOrdinal,
        revisionCountAfterJourney: afterRestart.revisionCount,
        conversationMessageCount: afterRestart.durableMessageCount,
        sourceSha256: sourceA.data.sha256,
        adoptedArtifactSha256: agent.outputHash,
        sourceTruthDigest: afterRestart.revisionTruthDigest,
        changeSetTruthDigest: afterRestart.changeSetTruthDigest,
        conversationTruthDigest: afterRestart.durableMessageDigest,
        publicProgressPhaseCount: agent.publicProgressPhases.length,
        backendStartCount: 2,
        disposableDesktopIdentityChanged: desktopIdentity.changed,
        timingsMs: timings,
        totalDurationMs: Date.now() - startedAt,
      },
      checks,
    };
    evidence.passed = Object.values(checks).every(Boolean)
      && binding.sourceCommitMatchesSourceHashes === true;
    assertSanitizedEvidence(evidence);
    if (writeEvidence) {
      assertEvidenceWritable(evidence);
      mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
      writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    return evidence;
  }, async () => {
    removeSignalHandlers();
    await lifecycle.cleanup();
  });
}

function parseCli(argv) {
  return {
    writeEvidence: argv.includes('--write-evidence'),
    keep: argv.includes('--keep'),
  };
}

async function main() {
  if (process.argv.includes('--signal-fixture-child')) {
    await runSignalFixtureChildMain();
    return;
  }
  if (process.argv.includes('--corpus-child')) {
    await runCorpusChildMain();
    return;
  }
  if (process.argv.includes('--agent-child')) {
    await runAgentChildMain();
    return;
  }
  const result = await captureLiveObservation(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[G0-RS-P4R-6 live] FAIL — ${error.code || error.message}`);
    if (process.argv.includes('--verbose')) console.error(error.stack || error);
    process.exitCode = 1;
  });
}
