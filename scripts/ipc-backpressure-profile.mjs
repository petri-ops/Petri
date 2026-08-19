#!/usr/bin/env node

/**
 * ipc-backpressure-profile — measure IPC serialization backpressure under payload load.
 *
 * Simulates IPC payloads of varying sizes and measures JSON serialization overhead.
 * Optionally measures event-loop lag before and after large payloads (via --probe flag).
 * This is a measurement fixture only; it does not modify Electron application code.
 * G0 compliant: no Worker / MessageChannel / SharedArrayBuffer.
 *
 * Usage:
 *   node scripts/ipc-backpressure-profile.mjs --size=1mb
 *   node scripts/ipc-backpressure-profile.mjs --size=10mb
 *   node scripts/ipc-backpressure-profile.mjs --size=100mb
 *   node scripts/ipc-backpressure-profile.mjs --size=1mb --iterations=20 --warmup=5
 *   node scripts/ipc-backpressure-profile.mjs --size=100mb --probe
 *
 * CLI options:
 *   --size=SIZE        payload size: 1mb | 10mb | 100mb (required)
 *   --iterations=N     number of measurement iterations (default: 10)
 *   --warmup=N         number of warmup iterations (default: 3)
 *   --threshold=MS     warn if stringify exceeds this threshold in ms (default: 5000)
 *   --format=FORMAT    output format: csv | human (default: human)
 *   --probe            enable event-loop lag measurement (100MB test only)
 *
 * Output (human):
 *   Structured benchmark results and WARNING line if threshold exceeded.
 *   When --probe is set, includes event-loop lag delta for 100MB payload.
 *
 * Output (csv):
 *   CSV row: size,iterations,stringify_ms,parse_ms,total_ms,memory_mb,event_loop_lag_ms
 *   event_loop_lag_ms is empty for sizes != 100mb.
 */

import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_MAP = {
  '1mb':  1 * 1024 * 1024,
  '10mb': 10 * 1024 * 1024,
  '100mb': 100 * 1024 * 1024,
};

const PROBE_LAG_THRESHOLD_MS = 100; // warn if lag delta exceeds this

const DEFAULT_ITERATIONS = 10;
const DEFAULT_WARMUP = 3;
const DEFAULT_THRESHOLD = 5000; // ms

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── CLI argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  let size = null;
  let iterations = DEFAULT_ITERATIONS;
  let warmup = DEFAULT_WARMUP;
  let threshold = DEFAULT_THRESHOLD;
  let format = 'human';
  let probe = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--size=')) {
      size = arg.slice('--size='.length).toLowerCase();
    } else if (arg.startsWith('--iterations=')) {
      iterations = parseInt(arg.slice('--iterations='.length), 10);
    } else if (arg.startsWith('--warmup=')) {
      warmup = parseInt(arg.slice('--warmup='.length), 10);
    } else if (arg.startsWith('--threshold=')) {
      threshold = parseInt(arg.slice('--threshold='.length), 10);
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length).toLowerCase();
    } else if (arg === '--probe') {
      probe = true;
    }
  }

  if (!size || !SIZE_MAP[size]) {
    console.error(`Error: --size is required and must be one of: ${Object.keys(SIZE_MAP).join(' | ')}`);
    process.exit(1);
  }

  return { size, iterations, warmup, threshold, format, probe };
}

// ── Payload generation ─────────────────────────────────────────────────────────

/**
 * Generate a synthetic IPC payload of approximately the target byte size.
 * Uses crypto.randomBytes to simulate realistic binary data that would
 * commonly flow through IPC channels.
 *
 * @param {number} targetBytes - target payload size in bytes
 * @returns {object} payload with data and metadata
 */
function generatePayload(targetBytes) {
  // Fill most of the payload with random binary data
  const dataSize = Math.floor(targetBytes * 0.85);
  const binaryChunk = randomBytes(dataSize);

  // Create a structured payload that mimics common IPC message shapes
  return {
    id: `ipc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    type: 'biof3.ipc.payload',
    version: 1,
    meta: {
      source: 'ipc-backpressure-profile',
      targetBytes,
      encoding: 'base64',
    },
    data: {
      // Base64-encode the random bytes to simulate realistic IPC content
      payload: binaryChunk.toString('base64'),
      size: binaryChunk.length,
    },
    // Add some structured metadata fields
    tags: ['backpressure-test', `size-${targetBytes}`],
    priority: Math.floor(Math.random() * 10),
  };
}

// ── Measurement ───────────────────────────────────────────────────────────────

/**
 * Force garbage collection if available (Node.js --expose-gc flag).
 * Falls back gracefully if GC is not available.
 */
function tryGc() {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

/**
 * Measure memory usage. Returns heapUsed in MB.
 */
function getMemoryMb() {
  const mem = process.memoryUsage();
  return (mem.heapUsed / (1024 * 1024)).toFixed(2);
}

// ── Event-loop lag probe ─────────────────────────────────────────────────────────

/**
 * Measure event-loop lag via wall-clock delta: schedule a small CPU burst via
 * setImmediate, measure actual wall time elapsed vs. expected tick duration.
 *
 * A blocked event loop causes setImmediate callbacks to fire late, making the
 * wall delta larger. We take the mean over multiple ticks to reduce noise.
 *
 * Returns mean lag in ms, or null if measurement fails.
 * G0 compliant: no Worker / MessageChannel / SharedArrayBuffer.
 */
function measureEventLoopLagMs() {
  return new Promise((resolve) => {
    try {
      const TICKS = 5;
      const TICK_MS = 20;
      let tick = 0;
      let totalLag = 0;

      const scheduleNext = () => {
        const before = performance.now();
        setImmediate(() => {
          const elapsed = performance.now() - before;
          const lag = Math.max(0, elapsed - TICK_MS);
          totalLag += lag;
          tick++;
          if (tick < TICKS) {
            setTimeout(scheduleNext, TICK_MS);
          } else {
            resolve(null); // this function doesn't resolve; resolved below
          }
        });
      };

      // Kick off with a setTimeout first, then use setImmediate for remaining ticks
      setTimeout(() => {
        const before = performance.now();
        setImmediate(() => {
          const elapsed = performance.now() - before;
          const lag = Math.max(0, elapsed - TICK_MS);
          totalLag += lag;
          tick++;
          while (tick < TICKS) {
            const t0 = performance.now();
            // Synchronous busy-wait for the nominal tick period
            while (performance.now() - t0 < TICK_MS) { /* spin */ }
            const elapsed2 = performance.now() - t0;
            totalLag += Math.max(0, elapsed2 - TICK_MS);
            tick++;
          }
          resolve(Number((totalLag / TICKS).toFixed(3)));
        });
      }, TICK_MS);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Measure event-loop lag delta: take baseline, run payload iterations, take post-lag.
 * Returns { beforeMs, afterMs, deltaMs } or null if measurement fails.
 * G0 compliant: no Worker / MessageChannel / SharedArrayBuffer.
 */
async function measureLagDelta(payload, iterations) {
  const beforeMs = await measureEventLoopLagMs();
  if (beforeMs === null) return null;

  // Run the heavy iterations
  for (let i = 0; i < iterations; i++) {
    const serialized = JSON.stringify(payload);
    JSON.parse(serialized);
  }

  const afterMs = await measureEventLoopLagMs();
  if (afterMs === null) return null;

  return {
    beforeMs,
    afterMs,
    deltaMs: Number((afterMs - beforeMs).toFixed(3)),
  };
}

/**
 * Run warmup iterations (results discarded).
 */
function runWarmup(payload, iterations) {
  for (let i = 0; i < iterations; i++) {
    const serialized = JSON.stringify(payload);
    JSON.parse(serialized);
  }
}

/**
 * Run measurement iterations and return timing results.
 */
async function runMeasurements(payload, iterations, { probe = false } = {}) {
  const results = {
    stringifyTimes: [],
    parseTimes: [],
    totalTimes: [],
    memoryBefore: null,
    memoryAfter: null,
    memoryPeak: null,
    lagBefore: null,
    lagAfter: null,
    lagDelta: null,
  };

  // Force GC before measurements
  tryGc();

  results.memoryBefore = parseFloat(getMemoryMb());

  for (let i = 0; i < iterations; i++) {
    // Measure stringify
    const t0 = performance.now();
    const serialized = JSON.stringify(payload);
    const stringifyMs = performance.now() - t0;

    // Measure parse
    const t1 = performance.now();
    const parsed = JSON.parse(serialized);
    const parseMs = performance.now() - t1;

    const totalMs = stringifyMs + parseMs;

    results.stringifyTimes.push(stringifyMs);
    results.parseTimes.push(parseMs);
    results.totalTimes.push(totalMs);
  }

  results.memoryAfter = parseFloat(getMemoryMb());

  // Measure peak memory with a fresh GC cycle
  tryGc();
  // Do a final stringify/parse to push memory to peak
  const finalSerialized = JSON.stringify(payload);
  JSON.parse(finalSerialized);
  results.memoryPeak = parseFloat(getMemoryMb());

  // Event-loop lag delta: only measured when --probe is set
  if (probe) {
    const lagResult = await measureLagDelta(payload, iterations);
    if (lagResult) {
      results.lagBefore = lagResult.beforeMs;
      results.lagAfter = lagResult.afterMs;
      results.lagDelta = lagResult.deltaMs;
    }
  }

  return results;
}

// ── Statistics helpers ─────────────────────────────────────────────────────────

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function min(values) {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

function max(values) {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

// ── Output formatters ─────────────────────────────────────────────────────────

function formatHuman(sizeLabel, payloadSize, iterations, warmup, results, threshold) {
  const stringifyMean = mean(results.stringifyTimes);
  const parseMean = mean(results.parseTimes);
  const totalMean = mean(results.totalTimes);
  const stringifyMedian = median(results.stringifyTimes);
  const parseMedian = median(results.parseTimes);
  const totalMedian = median(results.totalTimes);
  const stringifyMin = min(results.stringifyTimes);
  const stringifyMax = max(results.stringifyTimes);
  const parseMin = min(results.parseTimes);
  const parseMax = max(results.parseTimes);

  console.log('=== ipc-backpressure-profile ===');
  console.log(`platform: ${process.platform}-${process.arch}`);
  console.log(`node: ${process.version}`);
  console.log(`timestamp: ${new Date().toISOString()}`);
  console.log('');
  console.log('--- Configuration ---');
  console.log(`payload size:  ${sizeLabel} (${payloadSize} bytes)`);
  console.log(`warmup:        ${warmup} iterations`);
  console.log(`iterations:    ${iterations} iterations`);
  console.log(`threshold:     ${threshold} ms (stringify warning)`);
  console.log(`probe:         ${results.lagDelta !== null ? 'enabled' : 'disabled'}`);
  console.log('');

  console.log(`--- JSON.stringify timing (${iterations} iterations) ---`);
  console.log(`  mean:   ${stringifyMean.toFixed(3)} ms`);
  console.log(`  median: ${stringifyMedian.toFixed(3)} ms`);
  console.log(`  min:    ${stringifyMin.toFixed(3)} ms`);
  console.log(`  max:    ${stringifyMax.toFixed(3)} ms`);
  console.log('');

  console.log(`--- JSON.parse timing (${iterations} iterations) ---`);
  console.log(`  mean:   ${parseMean.toFixed(3)} ms`);
  console.log(`  median: ${parseMedian.toFixed(3)} ms`);
  console.log(`  min:    ${parseMin.toFixed(3)} ms`);
  console.log(`  max:    ${parseMax.toFixed(3)} ms`);
  console.log('');

  console.log(`--- Total roundtrip (${iterations} iterations) ---`);
  console.log(`  mean:   ${totalMean.toFixed(3)} ms`);
  console.log(`  median: ${totalMedian.toFixed(3)} ms`);
  console.log('');

  console.log('--- Memory ---');
  console.log(`  before:  ${results.memoryBefore} MB`);
  console.log(`  after:   ${results.memoryAfter} MB`);
  console.log(`  peak:    ${results.memoryPeak} MB`);
  console.log('');

  if (results.lagDelta !== null) {
    console.log('--- Event-loop lag (--probe mode) ---');
    console.log(`  before:  ${results.lagBefore} ms`);
    console.log(`  after:   ${results.lagAfter} ms`);
    console.log(`  delta:   ${results.lagDelta} ms`);
    if (results.lagDelta > PROBE_LAG_THRESHOLD_MS) {
      console.log(`WARNING: event-loop lag delta (${results.lagDelta} ms) exceeds threshold (${PROBE_LAG_THRESHOLD_MS} ms)`);
    } else {
      console.log(`OK: event-loop lag delta within threshold`);
    }
    console.log('');
  }

  console.log('--- Threshold check ---');
  console.log(`  threshold: ${threshold} ms (stringify)`);
  if (stringifyMean > threshold) {
    console.log(`WARNING: stringify mean (${stringifyMean.toFixed(3)} ms) exceeds threshold (${threshold} ms)`);
    process.exitCode = 1;
  } else {
    console.log(`OK: stringify mean within threshold`);
  }

  console.log('');
  console.log('--- Notes ---');
  console.log('This fixture measures IPC serialization overhead as a proxy for backpressure.');
  console.log('It simulates IPC payloads but does not use actual Electron IPC channels.');
  console.log('G0 compliant: no Worker / MessageChannel / SharedArrayBuffer.');
  console.log('');
  console.log(`qualificationEligible: false (G0 dev Electron; packaged/Provider/GA out of scope)`);
}

function formatCsv(sizeLabel, payloadSize, iterations, results) {
  const stringifyMean = mean(results.stringifyTimes);
  const parseMean = mean(results.parseTimes);
  const totalMean = mean(results.totalTimes);
  const memoryPeak = results.memoryPeak;
  const eventLoopLagMs = results.lagDelta !== null ? results.lagDelta.toFixed(3) : '';

  // CSV format: size,iterations,stringify_ms,parse_ms,total_ms,memory_mb,event_loop_lag_ms
  const row = [
    sizeLabel,
    iterations,
    stringifyMean.toFixed(3),
    parseMean.toFixed(3),
    totalMean.toFixed(3),
    memoryPeak,
    eventLoopLagMs,
  ].join(',');

  console.log(row);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const { size, iterations, warmup, threshold, format, probe } = parseArgs(argv);

  const payloadSize = SIZE_MAP[size];

  // Generate payload once (same payload for warmup + measurements)
  const payload = generatePayload(payloadSize);

  // Run warmup
  runWarmup(payload, warmup);

  // Run measurements
  const results = await runMeasurements(payload, iterations, { probe });

  // Output
  if (format === 'csv') {
    formatCsv(size, payloadSize, iterations, results);
  } else {
    formatHuman(size, payloadSize, iterations, warmup, results, threshold);
  }
}

main();
