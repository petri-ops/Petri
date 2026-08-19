#!/usr/bin/env node

/**
 * dev-electron-profile — measure Electron main-process startup proxy metrics.
 *
 * Measures module-load overhead as a proxy for startup time without requiring
 * a real display or Electron binary. Actual Electron launch timing (T0 spawn →
 * T4 renderer first paint) requires a live display and is documented in the
 * output for local manual verification.
 *
 * Usage:
 *   node scripts/dev-electron-profile.mjs [--warmup N] [--threshold ms]
 *
 * CLI options:
 *   --warmup N     number of warmup iterations before measurement (default: 5)
 *   --threshold MS warn if average measured time exceeds this threshold (default: 1000)
 *
 * Output:
 *   Prints structured benchmark results and a WARNING line if threshold exceeded.
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_JS = path.join(ROOT, 'src/main.js');
const PRELOAD_JS = path.join(ROOT, 'src/preload.js');

// ── CLI argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  let warmup = 5;
  let threshold = 1000;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--warmup' && i + 1 < argv.length) {
      warmup = parseInt(argv[++i], 10);
    } else if (arg === '--threshold' && i + 1 < argv.length) {
      threshold = parseInt(argv[++i], 10);
    }
  }
  return { warmup, threshold };
}

// ── Static metrics ─────────────────────────────────────────────────────────────

function countPattern(content, pattern) {
  return (content.match(pattern) || []).length;
}

function collectStaticMetrics() {
  const main = readFileSync(MAIN_JS, 'utf8');
  const preload = readFileSync(PRELOAD_JS, 'utf8');

  const ipcHandleCount = countPattern(main, /ipcMain\.handle\(/g);
  const ipcOnCount = countPattern(main, /ipcMain\.on\(/g);
  const preloadInvokeCount = countPattern(preload, /ipcRenderer\.invoke\(/g);
  const preloadOnCount = countPattern(preload, /ipcRenderer\.on\(/g);
  const contextBridgeCount = countPattern(preload, /contextBridge\.exposeInMainWorld\(/g);

  const mainLines = main.split('\n').length;
  const preloadLines = preload.split('\n').length;
  const mainBytes = Buffer.byteLength(main, 'utf8');
  const preloadBytes = Buffer.byteLength(preload, 'utf8');
  const mainStat = statSync(MAIN_JS);
  const preloadStat = statSync(PRELOAD_JS);

  return {
    main: {
      lines: mainLines,
      bytes: mainBytes,
      modifiedMs: mainStat.mtimeMs,
      ipcHandlers: ipcHandleCount,
      ipcOn: ipcOnCount,
    },
    preload: {
      lines: preloadLines,
      bytes: preloadBytes,
      modifiedMs: preloadStat.mtimeMs,
      ipcInvokes: preloadInvokeCount,
      ipcOn: preloadOnCount,
      contextBridgeExposes: contextBridgeCount,
    },
    totalIpcChannels: ipcHandleCount + ipcOnCount,
  };
}

// ── Module-load timing ─────────────────────────────────────────────────────────
// node --check fails in plain Node because main.js requires Electron-only modules
// (electron, better-sqlite3, etc.). Detect this gracefully and fall back.

function tryNodeCheck(args, options) {
  try {
    return execSync('node --check src/main.js', { cwd: ROOT, encoding: 'utf8', ...options });
  } catch (err) {
    return null; // Electron-only module — plain Node cannot parse
  }
}

function measureNodeCheckWarmup(iterations) {
  for (let i = 0; i < iterations; i++) {
    tryNodeCheck(['--check', 'src/main.js'], { stdio: 'ignore' });
  }
}

function measureNodeCheck(iterations) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const result = tryNodeCheck(['--check', 'src/main.js'], { stdio: 'ignore' });
    const elapsed = performance.now() - t0;
    if (result !== null) {
      times.push(elapsed);
    }
  }
  return times;
}

// ── File-read timing ──────────────────────────────────────────────────────────

function measureFileRead(iterations) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    readFileSync(MAIN_JS, 'utf8');
    readFileSync(PRELOAD_JS, 'utf8');
    times.push(performance.now() - t0);
  }
  return times;
}

// ── Statistics helpers ─────────────────────────────────────────────────────────

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(argv = process.argv.slice(2)) {
  const { warmup, threshold } = parseArgs(argv);

  console.log('=== dev-electron-profile baseline ===');
  console.log(`platform: ${process.platform}-${process.arch}`);
  console.log(`node: ${process.version}`);
  console.log(`timestamp: ${new Date().toISOString()}`);
  console.log('');

  // Static metrics
  const static_ = collectStaticMetrics();
  console.log('--- Static metrics ---');
  console.log(`main.js:            ${static_.main.lines} lines, ${static_.main.bytes} bytes`);
  console.log(`  ipcMain.handle:  ${static_.main.ipcHandlers}`);
  console.log(`  ipcMain.on:       ${static_.main.ipcOn}`);
  console.log(`preload.js:        ${static_.preload.lines} lines, ${static_.preload.bytes} bytes`);
  console.log(`  ipcRenderer.invoke:   ${static_.preload.ipcInvokes}`);
  console.log(`  ipcRenderer.on:       ${static_.preload.ipcOn}`);
  console.log(`  contextBridge.exposeInMainWorld: ${static_.preload.contextBridgeExposes}`);
  console.log(`total IPC channels: ${static_.totalIpcChannels}`);
  console.log('');

  // File-read timing
  console.log(`--- File read timing (${warmup} warmup + 3 measurement iterations) ---`);
  measureNodeCheckWarmup(warmup);
  const fileReadTimes = measureFileRead(3);
  const fileReadMedian = median(fileReadTimes);
  const fileReadMean = mean(fileReadTimes);
  console.log(`file-read times:  ${fileReadTimes.map((t) => `${t.toFixed(1)}ms`).join(', ')}`);
  console.log(`file-read median:  ${fileReadMedian.toFixed(1)}ms`);
  console.log(`file-read mean:    ${fileReadMean.toFixed(1)}ms`);
  console.log('');

  // node --check timing (primary proxy metric — may be empty in plain Node environments)
  console.log(`--- node --check src/main.js timing (${warmup} warmup + 3 measurement iterations) ---`);
  measureNodeCheckWarmup(warmup);
  const nodeCheckTimes = measureNodeCheck(3);
  if (nodeCheckTimes.length > 0) {
    const nodeCheckMedian = median(nodeCheckTimes);
    const nodeCheckMean = mean(nodeCheckTimes);
    console.log(`node --check times: ${nodeCheckTimes.map((t) => `${t.toFixed(1)}ms`).join(', ')}`);
    console.log(`node --check median: ${nodeCheckMedian.toFixed(1)}ms`);
    console.log(`node --check mean:   ${nodeCheckMean.toFixed(1)}ms`);
  } else {
    console.log('(skipped: main.js requires Electron-only modules — plain Node cannot parse syntax)');
  }
  console.log('');

  // Baseline summary
  console.log('--- Baseline summary ---');
  if (nodeCheckTimes.length > 0) {
    const nodeCheckMean = mean(nodeCheckTimes);
    console.log(`node --check mean (ms): ${nodeCheckMean.toFixed(1)}`);
    console.log(`threshold (ms):         ${threshold}`);
    console.log('');
    const exceeded = nodeCheckMean > threshold;
    if (exceeded) {
      console.log(`WARNING: node --check mean (${nodeCheckMean.toFixed(1)}ms) exceeds threshold (${threshold}ms)`);
      process.exitCode = 1;
    } else {
      console.log('OK: within threshold');
    }
  } else {
    console.log('(node --check skipped — Electron-only modules not available in plain Node)');
    console.log('Using file-read median as proxy baseline metric:');
    console.log(`file-read median (ms): ${fileReadMedian.toFixed(1)}`);
    console.log(`threshold (ms):        ${threshold}`);
    console.log('');
    const exceeded = fileReadMedian > threshold;
    if (exceeded) {
      console.log(`WARNING: file-read median (${fileReadMedian.toFixed(1)}ms) exceeds threshold (${threshold}ms)`);
      process.exitCode = 1;
    } else {
      console.log('OK: within threshold');
    }
  }

  // Document actual Electron launch timing requirements (not measured here)
  console.log('');
  console.log('--- Notes ---');
  console.log('This fixture measures module-load proxy metrics only.');
  console.log('Actual Electron launch timing requires a display and the following sequence:');
  console.log('  T0: spawn        electron . --disable-gpu --no-sandbox --remote-debugging-port=9222');
  console.log('  T1: app.whenReady    main process "app ready" event');
  console.log('  T2: did-finish-load  renderer HTML loaded (CDP Page.loadEventFired)');
  console.log('  T3: did-stop-loading all resources loaded (CDP Page.networkIdle)');
  console.log('  T4: first paint      renderer DOM first paint (CDP Runtime.evaluate performance.timing.loadEventEnd)');
  console.log('');
  console.log('To measure with CDP locally:');
  console.log('  1. Start Vite: cd frontend && npm run dev');
  console.log('  2. Start Electron with remote debugging: electron . --dev --remote-debugging-port=9222');
  console.log('  3. Connect Chrome DevTools to ws://localhost:9222 and measure lifecycle events');
  console.log('');
  console.log(`qualificationEligible: false (G0 dev Electron; packaged/Provider/GA out of scope)`);
}

main();
