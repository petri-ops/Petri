#!/usr/bin/env node
/**
 * G0-RS-P4R-0 — machine-capture the real open-result baseline.
 *
 * Composes the three pieces P4R-0 needs into one measurement:
 *
 *   g0-rs-p4r-corpus.mjs    real artifacts via run_tool -> tool_job -> artifact truth
 *   g0-rs-p4r-capture.mjs   disposable root + the env-gated probe from 340c09a
 *   this script             drives the request waterfall and records timings
 *
 * The corpus and the server share ONE disposable root, so the server serves real
 * artifacts from real jobs rather than a seeded fixture.
 *
 * WHAT THIS DOES AND DOES NOT MEASURE. Server-side timings are real: per-request
 * duration, the ordering of the waterfall, and event-loop delay from
 * monitorEventLoopDelay at 10ms resolution. Client-side metrics — first content
 * visible, artifact switch, version switch — are NOT captured, because the repo
 * has no browser automation. They are reported as null with an explicit status
 * rather than estimated, following the RS-P1 precedent.
 *
 * The authoritative signal for the plan's ">250ms synchronous block" gate is
 * eventLoop.maxMs from the probe histogram. The tick sampler in server.js
 * samples at 1Hz and only warns above 2000ms, so it cannot resolve 250ms; its
 * blocks[] output is recorded for context but is not the gate.
 *
 * Usage:
 *   node scripts/g0-rs-p4r-baseline.mjs
 *   node scripts/g0-rs-p4r-baseline.mjs --json
 *   node scripts/g0-rs-p4r-baseline.mjs --keep --verbose
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  createCaptureEnv,
  resetProbe,
  snapshotProbe,
  startServer,
  stopServer,
} from './g0-rs-p4r-capture.mjs';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';
import { buildPackEnv } from './g0-rs-p4r-pack.mjs';

const require = createRequire(import.meta.url);

/** How many revisions the sampled workspace held. workspace-status scales with it. */
function countRevisions(dbPath) {
  try {
    const Database = require(require.resolve('better-sqlite3', {
      paths: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'biof3-server')],
    }));
    const db = new Database(dbPath, { readonly: true });
    try {
      const t = db.prepare("select name from sqlite_master where type='table' and name='artifact_revisions'").get();
      return t ? db.prepare('select count(*) c from artifact_revisions').get().c : null;
    } finally { db.close(); }
  } catch { return null; }
}

/**
 * The requests a result open actually issues, in the order the frontend fires
 * them. Sourced from the frontend survey: /tools/status is render-blocking for
 * every body because selectedArtifact derives from it; the rest are secondary
 * and must not block the body, which is what P4R-1 has to prove.
 */
const WATERFALL = [
  { id: 'job-status', role: 'render-blocking', path: ({ jobId }) => `/api/tools/status/${jobId}` },
  { id: 'artifact-bytes', role: 'render-blocking', path: ({ jobId, artifact }) => `/api/tools/file/${jobId}/${artifact}` },
  { id: 'interaction', role: 'secondary', path: ({ jobId, artifact }) => `/api/result-studio/interaction?jobId=${jobId}&artifact=${encodeURIComponent(artifact)}` },
  { id: 'context-envelope', role: 'secondary', path: ({ projectId }) => `/api/result-studio/context-envelope?projectId=${projectId ?? ''}` },
  { id: 'changesets', role: 'secondary', path: ({ projectId }) => `/api/result-studio/changesets?projectId=${projectId ?? ''}` },
  { id: 'workspace-status', role: 'secondary', path: ({ projectId }) => `/api/result-studio/workspace/status?projectId=${projectId ?? ''}` },
];

/** Client metrics the plan asks for that no tooling in this repo can capture. */
/** Steady-state passes after the cold one. Odd, so the median is a real sample. */
const WARM_PASSES = 3;

const UNCAPTURED_CLIENT_METRICS = [
  'firstContentVisibleMs',
  'artifactSwitchMs',
  'versionSwitchMs',
  'codeOpenMs',
];

async function timeRequest(baseUrl, url) {
  const startedAt = process.hrtime.bigint();
  let status = null;
  let bytes = null;
  let error = null;
  try {
    const response = await fetch(`${baseUrl}${url}`);
    status = response.status;
    bytes = (await response.arrayBuffer()).byteLength;
  } catch (e) {
    error = e.message;
  }
  return {
    url,
    status,
    bytes,
    error,
    totalMs: Number(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3) * 1,
  };
}

/**
 * Drive the waterfall serially, twice.
 *
 * The two passes are NOT redundant. `/api/result-studio/interaction` does real
 * work on first touch of an artifact: it lazily creates a ChangeSet, writes into
 * `.biof3/revision/`, makes a Git commit on a new branch, inserts an
 * ArtifactRevision and adopts it. Reporting only the first call attributes
 * one-time creation cost to steady-state viewing, which is what an earlier
 * version of this baseline did.
 *
 * Serial rather than concurrent is the honest lower bound: it measures each
 * request's own cost without contention. Contention is what the event-loop
 * histogram captures alongside it.
 */
async function driveWaterfall(baseUrl, target) {
  const cold = [];
  for (const step of WATERFALL) {
    cold.push({ id: step.id, role: step.role, ...(await timeRequest(baseUrl, step.path(target))) });
  }
  // Steady state is sampled more than once. A single sample is cheap to
  // contaminate: an otherwise identical run taken straight after another
  // process reported a 4020ms event-loop peak against a ~450ms cluster from
  // three clean sequential runs. The median of several passes is what gets
  // recorded; the spread is recorded too, so contamination stays visible
  // instead of silently becoming the number.
  const warmSamples = new Map(WATERFALL.map((step) => [step.id, []]));
  for (let pass = 0; pass < WARM_PASSES; pass += 1) {
    for (const step of WATERFALL) {
      const timing = await timeRequest(baseUrl, step.path(target));
      warmSamples.get(step.id).push({ ms: timing.totalMs, status: timing.status });
    }
  }

  return cold.map((request) => {
    const samples = warmSamples.get(request.id) || [];
    const values = samples.map((s) => s.ms).filter(Number.isFinite).sort((a, b) => a - b);
    const median = values.length ? values[Math.floor(values.length / 2)] : null;
    return {
      ...request,
      coldMs: request.totalMs,
      warmMs: median,
      warmSamplesMs: values,
      warmSpreadMs: values.length ? Number((values[values.length - 1] - values[0]).toFixed(3)) : null,
      warmStatus: samples[0]?.status ?? null,
      // A large gap means the first call did one-time work; a flat profile means
      // the cost is inherent to every view.
      oneTimeCostMs: Number.isFinite(median)
        ? Number((request.totalMs - median).toFixed(3))
        : null,
    };
  });
}

/**
 * Calibrate the instrument before trusting its readings.
 *
 * Process-spawn cost is not a constant of this machine — it depends on the PATH
 * the capture inherits. Measured here: `git --version` costs ~9.7ms with a
 * 31-entry PATH and ~122.5ms with the 40-entry PATH that `npm run` injects, a
 * 12.6x difference that propagates straight into any git-touching route because
 * detectGitRuntime() is documented as uncached and re-resolves per call.
 *
 * That is why an identical capture read 412ms invoked directly and 4028ms
 * through `npm run`. Recording the calibration makes a reading interpretable and
 * comparable across environments instead of silently invocation-dependent.
 */
async function calibrateSpawnCost() {
  const { execFileSync } = await import('node:child_process');
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const startedAt = process.hrtime.bigint();
    try {
      execFileSync('git', ['--version'], { encoding: 'utf8' });
      samples.push(Number(Number(process.hrtime.bigint() - startedAt) / 1e6));
    } catch {
      return { gitSpawnMedianMs: null, pathEntries: (process.env.PATH || '').split(path.delimiter).length };
    }
  }
  samples.sort((a, b) => a - b);
  return {
    gitSpawnMedianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    pathEntries: (process.env.PATH || '').split(path.delimiter).length,
    invokedUnderNpm: Boolean(process.env.npm_lifecycle_event),
  };
}

export async function captureBaseline({ keep = false, quiet = false, onLog } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p4r-baseline-'));
  let server = null;

  try {
    // 1. Real artifacts in this root.
    const corpus = await generateCorpus({ root, keep: true, quiet, onLog });
    if (!corpus.ok) throw new Error(`corpus generation failed: ${JSON.stringify(corpus.records)}`);

    // 2. Boot the server against the same root, with the probe armed.
    const { env } = createCaptureEnv({ port: 0, root });
    // BLOCK-83/86 package awareness: same pack sources as the corpus child.
    Object.assign(env, buildPackEnv({ captureRoot: root, toolIds: corpus.pack.stagedToolIds }).env);
    const port = await import('node:net').then(({ createServer }) => new Promise((resolve, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port: p } = probe.address();
        probe.close(() => resolve(p));
      });
    }));
    env.R_SERVER_PORT = String(port);
    server = await startServer(env, { onLog });

    // 3. Measure from a clean probe window.
    await resetProbe(server.baseUrl);
    const deseq2 = corpus.records.find((record) => record.id === 'deseq2');
    const target = {
      jobId: deseq2.toolJobId,
      artifact: 'volcano.png',
      projectId: corpus.projectId,
    };
    const calibration = await calibrateSpawnCost();
    const requests = await driveWaterfall(server.baseUrl, target);
    // Sampled AFTER the waterfall: the first interaction call is what registers
    // the baseline revision, so counting earlier reports 0 and understates the
    // very term workspace-status scales with.
    const revisionCount = countRevisions(env.BIOF3_DB_PATH);
    const snapshot = await snapshotProbe(server.baseUrl);

    return {
      root,
      corpus: corpus.records.map(({ id, toolId, durationMs, artifactCount, toolJobId }) =>
        ({ id, toolId, durationMs, artifactCount, toolJobId })),
      target,
      calibration,
      revisionCount,
      requests,
      eventLoop: snapshot.eventLoop,
      probeBlocks: snapshot.blocks,
      probeRoutes: snapshot.requests,
      clientMetrics: Object.fromEntries(UNCAPTURED_CLIENT_METRICS.map((key) => [key, {
        observedMs: null,
        status: 'not_captured_no_browser_automation_in_repo',
      }])),
      kept: keep,
    };
  } finally {
    await stopServer(server?.child);
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const keep = argv.includes('--keep');
  const asJson = argv.includes('--json');
  const verbose = argv.includes('--verbose');

  const result = await captureBaseline({
    keep,
    quiet: asJson,
    onLog: verbose ? (channel, line) => console.error(`[${channel}] ${line}`) : undefined,
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('G0-RS-P4R-0 open-result baseline\n');
  console.log('  corpus (real run_tool chain)');
  for (const record of result.corpus) {
    console.log(`    ${record.toolId.padEnd(18)} ${String(record.durationMs).padStart(7)}ms  ${record.artifactCount} artifacts`);
  }

  console.log('\n  request waterfall');
  console.log(`    ${'route'.padEnd(18)} ${'cold'.padStart(9)} ${'warm'.padStart(9)}  ${'one-time'.padStart(9)}  status  role`);
  for (const request of result.requests) {
    const warm = request.warmMs === null ? '-' : `${request.warmMs}ms`;
    const once = request.oneTimeCostMs === null ? '-' : `${request.oneTimeCostMs}ms`;
    console.log(`    ${request.id.padEnd(18)} ${String(request.coldMs).padStart(7)}ms ${warm.padStart(9)}  ${once.padStart(9)}  ${String(request.status ?? 'ERR').padEnd(6)}  ${request.role}${request.error ? `  ${request.error}` : ''}`);
  }

  const el = result.eventLoop || {};
  console.log('\n  event loop (10ms-resolution histogram — the authoritative >250ms signal)');
  console.log(`    samples ${el.samples ?? 0}  p50 ${el.p50Ms ?? '-'}ms  p95 ${el.p95Ms ?? '-'}ms  p99 ${el.p99Ms ?? '-'}ms  max ${el.maxMs ?? '-'}ms`);

  console.log('\n  client metrics: not captured (no browser automation in repo)');
  for (const key of Object.keys(result.clientMetrics)) console.log(`    ${key}: null`);

  if (result.kept) console.log(`\n  remove when done:  rm -rf ${result.root}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
