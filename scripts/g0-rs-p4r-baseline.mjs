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
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createCaptureEnv,
  resetProbe,
  snapshotProbe,
  startServer,
  stopServer,
} from './g0-rs-p4r-capture.mjs';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';

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
 * Drive the waterfall serially, which is the honest lower bound: it measures
 * each request's own cost without contention. Concurrent contention is what the
 * event-loop histogram captures alongside it.
 */
async function driveWaterfall(baseUrl, target) {
  const requests = [];
  for (const step of WATERFALL) {
    const timing = await timeRequest(baseUrl, step.path(target));
    requests.push({ id: step.id, role: step.role, ...timing });
  }
  return requests;
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
    const requests = await driveWaterfall(server.baseUrl, target);
    const snapshot = await snapshotProbe(server.baseUrl);

    return {
      root,
      corpus: corpus.records.map(({ id, toolId, durationMs, artifactCount, toolJobId }) =>
        ({ id, toolId, durationMs, artifactCount, toolJobId })),
      target,
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
  for (const request of result.requests) {
    const size = request.bytes === null ? '-' : `${request.bytes}B`;
    console.log(`    ${request.id.padEnd(18)} ${String(request.totalMs).padStart(9)}ms  ${String(request.status ?? 'ERR').padEnd(4)} ${size.padStart(10)}  ${request.role}${request.error ? `  ${request.error}` : ''}`);
  }

  const el = result.eventLoop || {};
  console.log('\n  event loop (10ms-resolution histogram — the authoritative >250ms signal)');
  console.log(`    samples ${el.samples ?? 0}  p50 ${el.p50Ms ?? '-'}ms  p95 ${el.p95Ms ?? '-'}ms  p99 ${el.p99Ms ?? '-'}ms  max ${el.maxMs ?? '-'}ms`);

  console.log('\n  client metrics: not captured (no browser automation in repo)');
  for (const key of Object.keys(result.clientMetrics)) console.log(`    ${key}: null`);

  if (result.kept) console.log(`\n  remove when done:  rm -rf ${result.root}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
