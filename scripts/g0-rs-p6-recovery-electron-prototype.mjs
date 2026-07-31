#!/usr/bin/env node

/**
 * G0-RS-P6 bounded development Electron recovery trace.
 *
 * This is a local prototype, not canonical evidence. It reuses the no-seed P5
 * runtime and the real P6 candidate worker/SIGKILL path, then observes the
 * public recovery UI in two distinct hardened Electron processes around two
 * backend cold boots of the same durable project.
 */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import { createP5LiveScientificRuntime } from './g0-rs-p5-acceptance.mjs';
import {
  createRealVolcanoBaseline,
  killWorkerWithSigkill,
  spawnEditWorker,
  waitForDurableCandidateCheckpoint,
} from './g0-rs-p6-real-restart-prototype.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER_PATH = path.join(ROOT, 'scripts/g0-rs-p6-recovery-electron-driver.cjs');
const VITE_PATH = path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js');
const ELECTRON_PATH = require('electron');
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TERMINAL_JOBS = new Set(['completed', 'failed', 'cancelled', 'recovery_required']);

const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(ROOT, 'core', 'r-server'), ROOT],
}));

export const P6_RECOVERY_ELECTRON_CLASSIFICATION =
  'development_local_electron_real_sigkill_recovery_non_provider_non_packaged_non_qualifying';
export const P6_RECOVERY_ELECTRON_BUDGETS = Object.freeze({
  restartRestoreMs: 5_000,
});

const SOURCE_PATHS = Object.freeze([
  'scripts/g0-rs-p6-recovery-electron-prototype.mjs',
  'scripts/g0-rs-p6-recovery-electron-driver.cjs',
  'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
  'scripts/g0-rs-p6-real-restart-prototype.mjs',
  'scripts/g0-rs-p5-acceptance.mjs',
  'scripts/g0-rs-p4r-capture.mjs',
  'core/r-server/helpers/artifact-truth.js',
  'core/r-server/helpers/tools-executor.js',
  'core/r-server/routes/result-studio.js',
  'core/shared-backend/result-changeset-service.js',
  'core/shared-backend/result-studio-background-child.js',
  'core/shared-backend/result-studio-background.js',
  'core/shared-backend/result-studio-lifecycle.js',
  'core/shared-backend/result-studio-repository.js',
  'core/shared-backend/result-studio-runtime-lease.js',
  'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
  'frontend/src/components/result-studio/resultStudioClient.ts',
  'frontend/src/pages/project-workspace.tsx',
  'src/backend-health.js',
  'src/preload.js',
]);

export const P6_RECOVERY_ELECTRON_SOURCE_FILES = Object.freeze(Object.fromEntries(
  SOURCE_PATHS.map((relative) => [relative, relative]),
));

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

function checkedSource(relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  const target = path.resolve(ROOT, normalized);
  invariant(normalized && !path.isAbsolute(normalized)
    && !normalized.split('/').includes('..')
    && target.startsWith(`${ROOT}${path.sep}`), 'p6_recovery_electron_source_path_unsafe');
  invariant(existsSync(target), 'p6_recovery_electron_source_missing', { relative: normalized });
  return { relative: normalized, target };
}

export function getP6RecoveryElectronSourceBinding() {
  const resolved = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const sourceCommit = resolved.status === 0 ? resolved.stdout.trim() : '';
  invariant(COMMIT.test(sourceCommit), 'p6_recovery_electron_source_commit_unavailable');
  const sources = Object.fromEntries(Object.entries(P6_RECOVERY_ELECTRON_SOURCE_FILES)
    .map(([key, relative]) => [key, checkedSource(relative)]));
  const sourceHashes = Object.fromEntries(Object.entries(sources)
    .map(([key, source]) => [key, sha256(readFileSync(source.target))]));
  const sourcePaths = Object.values(sources).map((source) => source.relative);
  const tracked = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const changed = spawnSync(
    'git',
    ['diff', '--no-ext-diff', '--name-only', '-z', sourceCommit, '--', ...sourcePaths],
    { cwd: ROOT, encoding: 'utf8' },
  );
  invariant(tracked.status === 0 && changed.status === 0,
    'p6_recovery_electron_source_tree_unavailable');
  const trackedPaths = new Set(tracked.stdout.split('\0').filter(Boolean));
  const changedPaths = new Set(changed.stdout.split('\0').filter(Boolean));
  const sourceMismatches = sourcePaths.filter((relative) => (
    !trackedPaths.has(relative) || changedPaths.has(relative)
  ));
  return {
    sourceCommit,
    sourceFiles: P6_RECOVERY_ELECTRON_SOURCE_FILES,
    sourceHashes,
    bindingDigest: stableHash({
      sourceCommit,
      sourceFiles: P6_RECOVERY_ELECTRON_SOURCE_FILES,
      sourceHashes,
    }),
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

const secretKey = /(?:authorization|cookie|token|password|secret|api[_-]?key|credential|private[_-]?key|access[_-]?key|session)/i;
const internalId = /(?:^|[^A-Za-z0-9])(?:p|job|tj|rev|cs|conv|sel|wfg)_[A-Za-z0-9._-]+/;

export function assertSanitizedP6RecoveryElectronEvidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP6RecoveryElectronEvidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (secretKey.test(key) && key !== 'qualificationEligible') {
        throw new Error(`unsafe evidence key at ${pointer}.${key}`);
      }
      assertSanitizedP6RecoveryElectronEvidence(child, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error(`URI leaked at ${pointer}`);
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
      || /^(?:~[\\/]|\\\\)/.test(value)) {
    throw new Error(`absolute path leaked at ${pointer}`);
  }
  if (value.includes('..')) throw new Error(`parent path leaked at ${pointer}`);
  if (internalId.test(value)) throw new Error(`internal id leaked at ${pointer}`);
  return true;
}

function check(id, passed, observed = null) {
  return { id, passed: passed === true, observed };
}

function withinBudget(value, limit) {
  return Number.isFinite(value) && value >= 0 && value <= limit;
}

export function buildP6RecoveryElectronVerdict(observation = {}) {
  const activeCrash = observation.renderer?.activeCrash || {};
  const recover = observation.renderer?.recover || {};
  const reopen = observation.renderer?.reopen || {};
  const checks = [
    check('P6RE-01', observation.classification === P6_RECOVERY_ELECTRON_CLASSIFICATION
      && observation.boundary?.providerEvidence === 'not_exercised'
      && observation.boundary?.packagedAppEvidence === 'not_exercised'
      && observation.boundary?.qualificationEligible === false),
    check('P6RE-02', observation.truth?.noSeedProductLedger === true
      && observation.truth?.baselineJobCompleted === true
      && observation.truth?.baselineArtifactTruthValid === true
      && observation.truth?.baselineRevisionCount >= 3),
    check('P6RE-03', observation.interruption?.checkpointStage === 'candidate_committed'
      && observation.interruption?.checkpointIntegrityExact === true
      && observation.interruption?.candidateRefExact === true
      && observation.interruption?.workerExitSignal === 'SIGKILL'
      && observation.interruption?.workerCompletionMarkerSeen === false),
    check('P6RE-04', observation.firstColdStatus?.status === 'recovery_available'
      && observation.firstColdStatus?.interruptedCount === 1
      && observation.firstColdStatus?.activeOperationCount === 0
      && observation.firstColdStatus?.pendingIssueCount === 0),
    check('P6RE-05', recover.before?.detectedInterruptedSite === true
      && recover.before?.stoppingStageExplained === true
      && recover.before?.preservedCandidateCountExplained === true
      && recover.before?.automaticHandlingExplained === true
      && recover.before?.nextActionExplained === true
      && recover.before?.recoveryControlEnabled === true),
    check('P6RE-06', recover.recoveryRequestCount === 1
      && recover.recoveryRequestStatuses?.[0] === 200
      && recover.after?.lifecycleState === 'ready'
      && recover.after?.recoveryControlAbsent === true),
    check('P6RE-07', observation.recoveredTruth?.changeSetStatus === 'validation_failed'
      && observation.recoveredTruth?.checkpointStatus === 'validation_failed'
      && observation.recoveredTruth?.candidateRevisionCount === 0
      && observation.recoveredTruth?.interruptedJobTerminal === true),
    check('P6RE-08', observation.recoveredTruth?.baselineDigestStable === true
      && observation.recoveredTruth?.baselineArtifactsExact === true
      && observation.recoveredTruth?.baselineCurrentCountExact === true),
    check('P6RE-09', observation.afterRecoveryStatus?.status === 'ready'
      && observation.afterRecoveryStatus?.interruptedCount === 0
      && observation.afterRecoveryStatus?.activeOperationCount === 0
      && observation.afterRecoveryStatus?.pendingIssueCount === 0),
    check('P6RE-10', observation.processBoundaries?.electronProcessRelaunched === true
      && observation.processBoundaries?.backendColdBootCount === 2
      && observation.processBoundaries?.sqliteFileIdentityStable === true),
    check('P6RE-11', observation.secondColdStatus?.status === 'ready'
      && observation.secondColdStatus?.interruptedCount === 0
      && reopen.before?.lifecycleState === 'ready'
      && reopen.after?.lifecycleState === 'ready'
      && reopen.after?.recoveryControlAbsent === true
      && reopen.recoveryRequestCount === 0),
    check('P6RE-12', activeCrash.publicProjectionClean === true
      && recover.publicProjectionClean === true
      && reopen.publicProjectionClean === true
      && activeCrash.renderProcessGoneCount === 0
      && recover.renderProcessGoneCount === 0
      && reopen.renderProcessGoneCount === 0
      && activeCrash.browserWindowSecurity?.contextIsolation === true
      && activeCrash.browserWindowSecurity?.nodeIntegrationDisabled === true
      && activeCrash.browserWindowSecurity?.sandbox === true
      && activeCrash.browserWindowSecurity?.popupDenied === true
      && recover.browserWindowSecurity?.contextIsolation === true
      && recover.browserWindowSecurity?.nodeIntegrationDisabled === true
      && recover.browserWindowSecurity?.sandbox === true
      && recover.browserWindowSecurity?.popupDenied === true
      && reopen.browserWindowSecurity?.contextIsolation === true
      && reopen.browserWindowSecurity?.nodeIntegrationDisabled === true
      && reopen.browserWindowSecurity?.sandbox === true
      && reopen.browserWindowSecurity?.popupDenied === true
      && activeCrash.backendStatus?.checkCount > 0
      && activeCrash.backendStatus?.everyCheckReady === true
      && recover.backendStatus?.checkCount > 0
      && recover.backendStatus?.everyCheckReady === true
      && reopen.backendStatus?.checkCount > 0
      && reopen.backendStatus?.everyCheckReady === true),
    check('P6RE-13', observation.sourceBindingStableDuringObservation === true),
    check('P6RE-14', activeCrash.before?.lifecycleState === 'ready'
      && activeCrash.before?.activeOperationExplained === true
      && activeCrash.before?.activeStageExplained === true
      && activeCrash.before?.recoveryControlAbsent === true
      && activeCrash.recoveryRequestCount === 0
      && activeCrash.passed === true
      && observation.processBoundaries?.electronActuallySigkilled === true
      && observation.processBoundaries?.electronRelaunchedAfterCrash === true),
    check('P6RE-15', withinBudget(
      observation.performance?.restartRestoreMs,
      P6_RECOVERY_ELECTRON_BUDGETS.restartRestoreMs,
    ), {
      observedMs: observation.performance?.restartRestoreMs ?? null,
      limitMs: P6_RECOVERY_ELECTRON_BUDGETS.restartRestoreMs,
    }),
  ];
  return {
    checks,
    passed: checks.every((entry) => entry.passed),
    remainingBoundaries: [
      'real_provider_not_exercised_p7_exclusion',
      'packaged_app_not_exercised_p7_exclusion',
      'development_trace_not_qualification_evidence',
    ],
  };
}

export function assertP6RecoveryElectronEvidenceWritable(evidence) {
  invariant(evidence?.classification === P6_RECOVERY_ELECTRON_CLASSIFICATION
    && evidence?.qualificationEligible === false
    && evidence?.p6CloseoutEligible === false,
  'p6_recovery_electron_classification_invalid');
  invariant(evidence?.sourceCommitMatchesSourceHashes === true
    && evidence?.sourceBindingStableDuringObservation === true,
  'p6_recovery_electron_source_binding_not_current');
  const verdict = buildP6RecoveryElectronVerdict(evidence);
  invariant(evidence?.passed === true && verdict.passed === true
    && Array.isArray(evidence?.checks)
    && evidence.checks.length === verdict.checks.length
    && evidence.checks.every((entry, index) => (
      entry.id === verdict.checks[index].id && entry.passed === true
    )), 'p6_recovery_electron_observation_not_passed');
  assertSanitizedP6RecoveryElectronEvidence(evidence);
  return true;
}

async function freePort(excluded = new Set()) {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const selected = typeof address === 'object' && address ? address.port : null;
        server.close((error) => (error ? reject(error) : resolve(selected)));
      });
    });
    if (Number.isInteger(port) && !excluded.has(port)) return port;
  }
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error('p6_recovery_electron_vite_exited');
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = response.status;
    } catch (error) {
      last = error?.message || String(error);
    }
    await sleep(100);
  }
  throw Object.assign(new Error('p6_recovery_electron_vite_timeout'), { detail: last });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 120_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  invariant(response.ok, data.error || `http_${response.status}`);
  return { status: response.status, data };
}

function projectWorkspaceStatus(value) {
  const lifecycle = value?.lifecycle || value || {};
  return {
    status: lifecycle.status || null,
    checkpointIntegrityExact: lifecycle.checkpointIntegrity?.matches === true,
    consistencyStatus: lifecycle.consistency?.status || null,
    interruptedCount: Array.isArray(lifecycle.interrupted) ? lifecycle.interrupted.length : 0,
    activeOperationCount: Array.isArray(lifecycle.activeOperations) ? lifecycle.activeOperations.length : 0,
    pendingDecisionCount: Array.isArray(lifecycle.pendingDecisions) ? lifecycle.pendingDecisions.length : 0,
    pendingIssueCount: Array.isArray(lifecycle.pendingIssues) ? lifecycle.pendingIssues.length : 0,
    revisionIntegrityStatus: lifecycle.revisionIntegrity?.status || null,
  };
}

async function readWorkspaceStatus(baseUrl, projectId) {
  const query = new URLSearchParams({ projectId });
  return projectWorkspaceStatus((await requestJson(
    baseUrl,
    `/api/result-studio/workspace/status?${query.toString()}`,
  )).data);
}

function openLedger(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function readBaselineSnapshot(dbPath, workspaceRoot, projectId, revisionIds) {
  const db = openLedger(dbPath);
  try {
    const select = db.prepare(`
      SELECT revision_id, artifact_family_id, artifact_id, source_commit,
             output_path, output_hash, change_set_id, revision_ordinal, is_current
      FROM artifact_revisions WHERE project_id=? AND revision_id=?
    `);
    const rows = revisionIds.map((revisionId) => select.get(projectId, revisionId)).filter(Boolean);
    const exactArtifacts = rows.length === revisionIds.length && rows.every((row) => {
      const target = path.resolve(workspaceRoot, row.output_path);
      return target.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`)
        && existsSync(target)
        && SHA256.test(row.output_hash || '')
        && sha256(readFileSync(target)) === row.output_hash;
    });
    return {
      rows,
      digest: stableHash(rows),
      exactArtifacts,
      currentCount: rows.filter((row) => row.is_current === 1).length,
      journalMode: db.pragma('journal_mode', { simple: true }),
    };
  } finally {
    db.close();
  }
}

function readRecoveredTruth(dbPath, changeSetId, candidateJobId) {
  const db = openLedger(dbPath);
  try {
    const changeSet = db.prepare(`
      SELECT status FROM scientific_change_sets WHERE change_set_id=?
    `).get(changeSetId);
    const checkpoint = db.prepare(`
      SELECT change_set_status FROM workspace_revision_checkpoints
      WHERE change_set_id=? ORDER BY updated_at DESC LIMIT 1
    `).get(changeSetId);
    const candidateRevisionCount = db.prepare(`
      SELECT COUNT(*) AS count FROM artifact_revisions WHERE change_set_id=?
    `).get(changeSetId).count;
    const job = db.prepare('SELECT status FROM tool_jobs WHERE id=?').get(candidateJobId);
    const activeChangeSetCount = db.prepare(`
      SELECT COUNT(*) AS count FROM scientific_change_sets WHERE status='running'
    `).get().count;
    return {
      changeSetStatus: changeSet?.status || null,
      checkpointStatus: checkpoint?.change_set_status || null,
      candidateRevisionCount,
      interruptedJobTerminal: TERMINAL_JOBS.has(job?.status),
      activeChangeSetCount,
    };
  } finally {
    db.close();
  }
}

function fileIdentity(filePath) {
  const stat = statSync(filePath);
  return { dev: stat.dev, ino: stat.ino };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function runElectron(configPath, resultPath, backendPort) {
  const stderr = [];
  const child = spawn(ELECTRON_PATH, [DRIVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      BIOF3_DESKTOP: '1',
      R_SERVER_PORT: String(backendPort),
      BIOF3_P6_RECOVERY_ELECTRON_CONFIG: configPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const pid = child.pid;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    while (stderr.join('').length > 12_000) stderr.shift();
  });
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: 'spawn_error' }));
  });
  const persisted = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
  if (exit.code !== 0 || !persisted?.passed) {
    const error = new Error(`p6_recovery_electron_driver_failed:${persisted?.failedStage || 'unknown'}`);
    error.detail = stderr.join('').slice(-4_000);
    throw error;
  }
  return { pid, result: persisted };
}

async function crashActiveElectron(configPath, resultPath, backendPort) {
  const stderr = [];
  const child = spawn(ELECTRON_PATH, [DRIVER_PATH], {
    cwd: ROOT,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BIOF3_DESKTOP: '1',
      R_SERVER_PORT: String(backendPort),
      BIOF3_P6_RECOVERY_ELECTRON_CONFIG: configPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const pid = child.pid;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    while (stderr.join('').length > 12_000) stderr.shift();
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: 'spawn_error' }));
  });
  // The driver owns the 120s renderer timeout. Leave room for it to persist a
  // bounded diagnostic before the parent terminates the isolated process.
  const deadline = Date.now() + 135_000;
  let persisted = null;
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      try {
        persisted = JSON.parse(readFileSync(resultPath, 'utf8'));
        if (persisted?.passed) break;
      } catch {}
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await sleep(100);
  }
  if (!persisted?.passed || child.exitCode !== null || child.signalCode !== null) {
    await stopChild(child);
    const error = new Error(`p6_recovery_active_electron_not_ready:${persisted?.failedStage || 'unknown'}`);
    error.detail = stderr.join('').slice(-4_000);
    throw error;
  }
  if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
  else child.kill('SIGKILL');
  const exit = await exitPromise;
  invariant(exit.signal === 'SIGKILL', 'p6_recovery_active_electron_not_sigkilled', exit);
  return { pid, exitSignal: exit.signal, result: persisted };
}

function terminateWorkerBestEffort(worker) {
  if (!worker?.child || worker.child.exitCode !== null || worker.child.signalCode !== null) return;
  try {
    if (worker.detached) process.kill(-worker.child.pid, 'SIGKILL');
    else worker.child.kill('SIGKILL');
  } catch {}
}

export async function observeP6RecoveryElectron({ keep = false, show = false, verbose = false } = {}) {
  const sourceAtStart = getP6RecoveryElectronSourceBinding();
  const backendPort = await freePort();
  const uiPort = await freePort(new Set([backendPort]));
  let runtime = null;
  let worker = null;
  let coldServer = null;
  let vite = null;
  let root = null;
  let originalRuntimeClosed = false;
  let cleaning = false;

  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    terminateWorkerBestEffort(worker);
    await stopChild(vite);
    await stopServer(coldServer?.child);
    if (runtime && !originalRuntimeClosed) await runtime.close({ removeRoot: false });
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  };
  const onSignal = () => { void cleanup(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    runtime = await createP5LiveScientificRuntime({
      port: backendPort,
      verbose,
      beforeStart({ env }) {
        const rendererOrigin = `http://127.0.0.1:${uiPort}`;
        env.BIOF3_RENDERER_DEV_URL = rendererOrigin;
        env.BIOF3_TRUSTED_DESKTOP_ORIGINS = rendererOrigin;
        env.BIOF3_TOOL_ZOMBIE_TIMEOUT_MS = '250';
        env.BIOF3_TOOL_HEARTBEAT_INTERVAL_MS = '100';
      },
    });
    root = runtime.root;
    const dbIdentityBefore = fileIdentity(runtime.env.BIOF3_DB_PATH);
    const baseline = await createRealVolcanoBaseline(runtime, 50_000);
    const db = openLedger(runtime.env.BIOF3_DB_PATH);
    let baselineRevisionIds;
    try {
      baselineRevisionIds = db.prepare(`
        SELECT revision_id FROM artifact_revisions
        WHERE project_id=? AND change_set_id=? ORDER BY artifact_id
      `).all(runtime.project.id, baseline.interaction.revision.changeSetId)
        .map((row) => row.revision_id);
    } finally {
      db.close();
    }
    invariant(baselineRevisionIds.length >= 3, 'p6_recovery_electron_baseline_cohort_incomplete');
    const baselineBefore = readBaselineSnapshot(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.workspace_path,
      runtime.project.id,
      baselineRevisionIds,
    );

    worker = spawnEditWorker(runtime, baseline);
    const durable = await waitForDurableCandidateCheckpoint(runtime, worker);

    vite = spawn(process.execPath, [
      VITE_PATH,
      '--host', '127.0.0.1',
      '--port', String(uiPort),
      '--strictPort',
    ], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(`http://127.0.0.1:${uiPort}`, vite);

    const traceDir = path.join(root, 'p6-recovery-electron');
    const configPath = path.join(traceDir, 'driver-config.json');
    const activeCrashResultPath = path.join(traceDir, 'driver-active-crash-result.json');
    const recoverResultPath = path.join(traceDir, 'driver-recover-result.json');
    const reopenResultPath = path.join(traceDir, 'driver-reopen-result.json');
    mkdirSync(traceDir, { recursive: true, mode: 0o700 });
    const baseConfig = {
      uiBaseUrl: `http://127.0.0.1:${uiPort}`,
      backendBaseUrl: `http://127.0.0.1:${backendPort}`,
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      jobId: baseline.job.id,
      artifact: path.basename(baseline.artifact.path),
      outputDir: traceDir,
      show,
    };
    writeFileSync(configPath, `${JSON.stringify({
      ...baseConfig,
      phase: 'active-crash',
      resultPath: activeCrashResultPath,
    })}\n`, { mode: 0o600 });
    const crashedElectron = await crashActiveElectron(
      configPath,
      activeCrashResultPath,
      backendPort,
    );

    // The renderer observation above must happen while the edit worker still
    // owns a live candidate operation. Only after Electron is actually gone do
    // we kill the worker and create the interrupted site recovered below.
    const killed = await killWorkerWithSigkill(worker);
    const markerSeen = worker.output().stdout.includes('__P5_WORKER_RESULT__');
    worker = null;

    await sleep(350);
    await runtime.close({ removeRoot: false });
    originalRuntimeClosed = true;
    invariant(existsSync(root), 'p6_recovery_electron_root_removed_before_cold_boot');

    const restartRestoreStartedAt = performance.now();
    coldServer = await startServer(runtime.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-recovery-cold-1:${channel}] ${line}`) }
      : {});
    const firstColdStatus = await readWorkspaceStatus(coldServer.baseUrl, runtime.project.id);

    writeFileSync(configPath, `${JSON.stringify({
      ...baseConfig,
      phase: 'recover',
      resultPath: recoverResultPath,
    })}\n`, { mode: 0o600 });
    const recoverElectron = await runElectron(configPath, recoverResultPath, backendPort);
    const restartRestoreMs = performance.now() - restartRestoreStartedAt;

    const recoveredState = readRecoveredTruth(
      runtime.env.BIOF3_DB_PATH,
      durable.checkpoint.change_set_id,
      durable.checkpoint.candidateJob.id,
    );
    const baselineAfterRecovery = readBaselineSnapshot(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.workspace_path,
      runtime.project.id,
      baselineRevisionIds,
    );
    const afterRecoveryStatus = await readWorkspaceStatus(coldServer.baseUrl, runtime.project.id);

    await stopServer(coldServer.child);
    coldServer = null;
    coldServer = await startServer(runtime.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-recovery-cold-2:${channel}] ${line}`) }
      : {});
    const secondColdStatus = await readWorkspaceStatus(coldServer.baseUrl, runtime.project.id);

    writeFileSync(configPath, `${JSON.stringify({
      ...baseConfig,
      phase: 'reopen',
      resultPath: reopenResultPath,
    })}\n`, { mode: 0o600 });
    const reopenElectron = await runElectron(configPath, reopenResultPath, backendPort);
    const finalStatus = await readWorkspaceStatus(coldServer.baseUrl, runtime.project.id);
    const dbIdentityAfter = fileIdentity(runtime.env.BIOF3_DB_PATH);
    const sourceAtEnd = getP6RecoveryElectronSourceBinding();

    const observation = {
      schemaVersion: 1,
      planId: 'G0-RS-P6',
      slice: 'P6-1 bounded development Electron recovery trace',
      classification: P6_RECOVERY_ELECTRON_CLASSIFICATION,
      qualificationEligible: false,
      p6CloseoutEligible: false,
      boundary: {
        providerEvidence: 'not_exercised',
        packagedAppEvidence: 'not_exercised',
        qualificationEligible: false,
        systemRestartClaim: false,
        processBoundary: 'owned_electron_and_backend_processes_restarted_against_same_durable_local_stores',
      },
      sourceCommit: sourceAtStart.sourceCommit,
      sourceFiles: sourceAtStart.sourceFiles,
      sourceHashes: sourceAtStart.sourceHashes,
      sourceBindingDigest: sourceAtStart.bindingDigest,
      sourceCommitMatchesSourceHashes: sourceAtStart.sourceCommitMatchesSourceHashes,
      sourceMismatches: sourceAtStart.sourceMismatches,
      sourceBindingStableDuringObservation: sourceAtStart.bindingDigest === sourceAtEnd.bindingDigest,
      truth: {
        noSeedProductLedger: runtime.noSeedPrecondition.seededTables.length === 0,
        baselineJobCompleted: baseline.job.status === 'completed',
        baselineArtifactTruthValid: baseline.job.result?.artifactTruth?.status === 'valid'
          && baseline.job.result.artifactTruth.blocking !== true,
        baselineRevisionCount: baselineRevisionIds.length,
        baselineJournalMode: baselineBefore.journalMode,
      },
      interruption: {
        checkpointStage: durable.checkpoint.pendingPreview.stage,
        checkpointIntegrityExact: durable.integrity.matches === true,
        candidateRefExact: durable.git.commit === durable.checkpoint.candidate_commit,
        candidateJobRunningBeforeKill: durable.checkpoint.candidateJob.status === 'running',
        workerExitSignal: killed.signal,
        workerCompletionMarkerSeen: markerSeen,
      },
      firstColdStatus,
      renderer: {
        activeCrash: crashedElectron.result,
        recover: recoverElectron.result,
        reopen: reopenElectron.result,
      },
      recoveredTruth: {
        ...recoveredState,
        baselineDigestStable: baselineBefore.digest === baselineAfterRecovery.digest,
        baselineArtifactsExact: baselineAfterRecovery.exactArtifacts,
        baselineCurrentCountExact: baselineAfterRecovery.currentCount === baselineRevisionIds.length,
      },
      afterRecoveryStatus,
      secondColdStatus,
      finalStatus,
      performance: {
        restartRestoreMs,
        budgets: P6_RECOVERY_ELECTRON_BUDGETS,
      },
      processBoundaries: {
        electronActuallySigkilled: crashedElectron.exitSignal === 'SIGKILL',
        electronRelaunchedAfterCrash: Number.isInteger(crashedElectron.pid)
          && Number.isInteger(recoverElectron.pid)
          && crashedElectron.pid !== recoverElectron.pid,
        electronProcessRelaunched: Number.isInteger(recoverElectron.pid)
          && Number.isInteger(reopenElectron.pid)
          && recoverElectron.pid !== reopenElectron.pid,
        backendColdBootCount: 2,
        sqliteFileIdentityStable: sameFileIdentity(dbIdentityBefore, dbIdentityAfter),
        workspaceStillPresent: existsSync(runtime.project.workspace_path),
      },
    };
    const verdict = buildP6RecoveryElectronVerdict(observation);
    const result = {
      ...observation,
      checks: verdict.checks,
      remainingBoundaries: verdict.remainingBoundaries,
      passed: verdict.passed,
    };
    assertSanitizedP6RecoveryElectronEvidence(result);
    return result;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

async function main() {
  invariant(!process.argv.includes('--write-evidence'),
    'p6_recovery_electron_prototype_has_no_evidence_writer');
  const result = await observeP6RecoveryElectron({
    keep: process.argv.includes('--keep'),
    show: process.argv.includes('--show'),
    verbose: process.argv.includes('--verbose'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    if (error?.detail) console.error(JSON.stringify(error.detail, null, 2));
    process.exitCode = 1;
  });
}
