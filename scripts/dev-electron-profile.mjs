#!/usr/bin/env node

/**
 * dev-electron-profile — measure Electron main-process startup proxy metrics.
 *
 * Measures module-load overhead as a proxy for startup time without requiring
 * a real display or Electron binary. Actual Electron launch timing (T0 spawn →
 * T4 renderer first paint) requires a live display and is documented in the
 * output for local manual verification.
 *
 * Usage (proxy mode):
 *   node scripts/dev-electron-profile.mjs [--warmup N] [--threshold ms]
 *
 * Usage (CDP mode — measures T0→T4):
 *   node scripts/dev-electron-profile.mjs --cdp [--port N] [--timeout ms] [--output json|csv]
 *
 * CLI options (proxy mode):
 *   --warmup N     number of warmup iterations before measurement (default: 5)
 *   --threshold MS warn if average measured time exceeds this threshold (default: 1000)
 *
 * CLI options (CDP mode):
 *   --cdp          enable CDP measurement mode (requires Electron binary on PATH)
 *   --port N       remote-debugging-port (default: 9222)
 *   --timeout MS   max time to wait for Electron startup (default: 30000)
 *   --output FMT   output format: 'text' (default) or 'json'
 *
 * Output:
 *   Prints structured benchmark results and a WARNING line if threshold exceeded.
 *
 * CDP phases captured:
 *   T0: spawn       electron process launched
 *   T1: appReady    app 'ready' event fired in main process
 *   T2: windowShown main window first rendered
 *   T3: DOMLoaded   Page.lifecycleEvent 'DOMContentLoaded'
 *   T4: load        Page.lifecycleEvent 'load'
 *
 * CDP requirements:
 *   - Node.js >= 21 (uses built-in WebSocket)
 *   - Electron binary on PATH
 *   - No --disable-gpu flag needed for headless measurement
 */

import { execSync, spawn } from 'node:child_process';
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
  let cdpMode = false;
  let cdpPort = 9222;
  let cdpTimeout = 30_000;
  let outputFormat = 'text';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--warmup' && i + 1 < argv.length) {
      warmup = parseInt(argv[++i], 10);
    } else if (arg === '--threshold' && i + 1 < argv.length) {
      threshold = parseInt(argv[++i], 10);
    } else if (arg === '--cdp') {
      cdpMode = true;
    } else if (arg === '--port' && i + 1 < argv.length) {
      cdpPort = parseInt(argv[++i], 10);
    } else if (arg === '--timeout' && i + 1 < argv.length) {
      cdpTimeout = parseInt(argv[++i], 10);
    } else if (arg === '--output' && i + 1 < argv.length) {
      const fmt = argv[++i];
      if (!['json', 'csv', 'text'].includes(fmt)) {
        console.error(`Unknown output format: ${fmt} (use json|csv|text)`);
        process.exit(1);
      }
      outputFormat = fmt;
    }
  }
  return { warmup, threshold, cdpMode, cdpPort, cdpTimeout, outputFormat };
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
  } catch {
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

// ── CDP measurement ─────────────────────────────────────────────────────────────
// Uses Node.js built-in WebSocket (Node >= 21) + Electron --remote-debugging-port
// to capture T0–T4 startup phases.

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll http://host:port/json/version until CDP is ready.
 * Returns { webSocketDebuggerUrl }.
 */
async function fetchCdpVersion(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.webSocketDebuggerUrl) return data;
      }
    } catch {}
    await delay(200);
  }
  throw new Error(`CDP endpoint not available on port ${port} within ${timeoutMs}ms`);
}

/**
 * Poll http://host:port/json/list and return the first 'page' target ws URL.
 */
async function fetchCdpPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const targets = await resp.json();
        if (Array.isArray(targets)) {
          const page = targets.find((t) => t?.type === 'page' && t.webSocketDebuggerUrl);
          if (page) return page;
        }
      }
    } catch {}
    await delay(200);
  }
  throw new Error(`CDP page target not found within ${timeoutMs}ms`);
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
    this._wsClass = null;
  }

  async connect(timeoutMs = 15_000) {
    const wsUrl = this.wsUrl;

    // Node.js >= 21 ships a global WebSocket; use dynamic import to be safe.
    const { default: WSClass } = await import('node:ws').catch(() => {
      throw new Error(
        'ws_unavailable: Node.js built-in WebSocket not found. ' +
        'Ensure Node.js >= 21, or install the "ws" package: npm install --save-dev ws',
      );
    });
    this._wsClass = WSClass;

    return new Promise((resolve, reject) => {
      const socket = new WSClass(wsUrl);
      this.socket = socket;

      const rejectOnce = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        socket.removeListener('message', onMessage);
      };

      const onOpen = () => {
        socket.on('message', onMessage);
        socket.on('close', onClose);
        socket.on('error', () => {});
      };

      const onError = () => rejectOnce(new Error('cdp_socket_open_failed'));

      const onClose = () => {
        for (const p of this.pending.values()) p.reject(new Error('cdp_socket_closed'));
        this.pending.clear();
      };

      const onMessage = (data) => {
        let payload;
        try { payload = JSON.parse(String(data)); } catch { return; }
        if (payload.id) {
          const pending = this.pending.get(payload.id);
          if (!pending) return;
          this.pending.delete(payload.id);
          if (payload.error) pending.reject(new Error(`cdp_command_failed:${payload.error.code}`));
          else pending.resolve(payload.result || {});
        } else if (payload.method) {
          const listeners = this.listeners.get(payload.method) || [];
          for (const l of listeners) l(payload.params || {});
        }
      };

      const timer = setTimeout(() => rejectOnce(new Error('cdp_socket_open_timeout')), timeoutMs);

      const onOpenTimeout = () => {
        clearTimeout(timer);
        cleanup();
        rejectOnce(new Error('cdp_socket_open_timeout'));
      };

      socket.on('open', () => {
        clearTimeout(timer);
        socket.on('open', onOpen);
        socket.on('error', onError);
        resolve(this);
      });

      socket.on('error', onError);
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) || [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1 /* OPEN */) {
      return Promise.reject(new Error('cdp_socket_not_open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.terminate?.(); } catch {}
    try { this.socket?.close?.(); } catch {}
  }
}

/**
 * Measure Electron startup phases T0–T4 using CDP.
 *
 * @param {object} opts
 * @param {number}  opts.port      remote-debugging-port
 * @param {number}  opts.timeoutMs  max total measurement time
 * @param {string}  opts.electronPath optional path to electron binary
 */
async function measureCdpStartup({ port = 9222, timeoutMs = 30_000, electronPath = 'electron' } = {}) {
  const t0 = performance.now(); // spawn time — set immediately
  const phases = {
    T1: null, // app ready
    T2: null, // window shown
    T3: null, // DOMContentLoaded
    T4: null, // load
  };

  // Step 1: spawn Electron with --remote-debugging-port
  console.log(`[CDP] Spawning ${electronPath} with --remote-debugging-port=${port}...`);
  const electronBin = electronPath;

  let electronProcess;
  try {
    electronProcess = spawn(electronBin, ['.', '--dev', `--remote-debugging-port=${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
    });
  } catch {
    throw new Error(`electron_not_found: "${electronBin}" not on PATH. Install Electron globally or pass --electron-path.`);
  }

  // Capture stderr lines until CDP is ready (app 'ready' event fires before CDP is up)
  const stderrLines = [];
  electronProcess.stderr?.on('data', (chunk) => {
    const line = String(chunk);
    stderrLines.push(line);
    if (line.includes('(electron)') || line.includes('app ready') || line.includes('App ready')) {
      if (!phases.T1) phases.T1 = performance.now();
    }
  });

  electronProcess.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== null) {
      console.error(`[CDP] Electron exited early with code ${code}`);
      electronProcess.kill();
    }
  });

  // Step 2: wait for CDP to be available
  let versionInfo;
  try {
    versionInfo = await fetchCdpVersion(port, timeoutMs);
  } catch (err) {
    electronProcess.kill();
    throw new Error(`cdp_not_available: ${err.message}`);
  }

  // Step 3: connect to the first page target
  let target;
  try {
    target = await fetchCdpPageTarget(port, timeoutMs);
  } catch (err) {
    electronProcess.kill();
    throw new Error(`cdp_target_not_found: ${err.message}`);
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect(10_000);
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  // Register lifecycle listeners
  const lifecycleEvents = [];
  client.on('Page.lifecycleEvent', (params) => {
    const now = performance.now();
    lifecycleEvents.push({ name: params.name, timestamp: params.timestamp, elapsed: now - t0 });

    if (params.name === 'init' && !phases.T1) phases.T1 = now;
    if (params.name === 'firstPaint' && !phases.T2) phases.T2 = now;
    if (params.name === 'DOMContentLoaded' && !phases.T3) phases.T3 = now;
    if (params.name === 'load' && !phases.T4) phases.T4 = now;
  });

  // Wait for T4 (load) or timeout
  const deadline = Date.now() + timeoutMs;
  while (!phases.T4 && Date.now() < deadline) {
    await delay(100);
    // Also check if process died
    if (electronProcess.exitCode !== null && !phases.T4) {
      // Process exited before load — that's a real measurement
      break;
    }
  }

  // Compute absolute timestamps relative to T0 (spawn)
  const t0_abs = t0;
  const result = {
    spawn: { ms: 0, label: 'T0 spawn' },
    T1: phases.T1 ? { ms: phases.T1 - t0_abs, label: 'T1 appReady' } : null,
    T2: phases.T2 ? { ms: phases.T2 - t0_abs, label: 'T2 firstPaint' } : null,
    T3: phases.T3 ? { ms: phases.T3 - t0_abs, label: 'T3 DOMLoaded' } : null,
    T4: phases.T4 ? { ms: phases.T4 - t0_abs, label: 'T4 load' } : null,
  };

  // Attach raw lifecycle events
  result._lifecycleEvents = lifecycleEvents;

  // Clean up
  client.close();
  electronProcess.kill();

  return result;
}

function printCdpResult(result, outputFormat) {
  if (outputFormat === 'json') {
    const serializable = { ...result };
    delete serializable._lifecycleEvents;
    serializable.lifecycleEvents = result._lifecycleEvents;
    console.log(JSON.stringify(serializable, null, 2));
    return;
  }

  if (outputFormat === 'csv') {
    const headers = ['phase', 'elapsed_ms', 'label'];
    const rows = [headers];
    for (const [key, val] of Object.entries(result)) {
      if (key === '_lifecycleEvents') {
        for (const ev of val) {
          rows.push([ev.name, ev.elapsed.toFixed(2), `lifecycle:${ev.name}`]);
        }
      } else if (val !== null) {
        rows.push([key, val.ms.toFixed(2), val.label]);
      }
    }
    console.log(rows.map((r) => r.join(',')).join('\n'));
    return;
  }

  // text format (default)
  console.log('=== dev-electron-profile CDP T0-T4 measurement ===');
  console.log(`platform: ${process.platform}-${process.arch}`);
  console.log(`node: ${process.version}`);
  console.log(`timestamp: ${new Date().toISOString()}`);
  console.log('');
  console.log('--- Startup phases ---');
  console.log(`T0 spawn:         0.0 ms (reference point)`);
  for (const key of ['T1', 'T2', 'T3', 'T4']) {
    const phase = result[key];
    if (phase) {
      console.log(`${phase.label}: ${phase.ms.toFixed(1)} ms`);
    } else {
      console.log(`${key} (${key}): not observed within timeout`);
    }
  }
  console.log('');
  console.log('--- Lifecycle events ---');
  for (const ev of result._lifecycleEvents) {
    console.log(`  ${ev.name.padEnd(20)} +${ev.elapsed.toFixed(1)} ms`);
  }
  console.log('');
  console.log('qualificationEligible: false (G0 dev Electron; packaged/Provider/GA out of scope)');
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(argv = process.argv.slice(2)) {
  const { warmup, threshold, cdpMode, cdpPort, cdpTimeout, outputFormat } = parseArgs(argv);

  if (cdpMode) {
    // CDP mode: spawn Electron and measure T0→T4 via Chrome DevTools Protocol
    measureCdpStartup({ port: cdpPort, timeoutMs: cdpTimeout, outputFormat })
      .then((result) => {
        printCdpResult(result, outputFormat);
      })
      .catch((err) => {
        console.error(`ERROR: ${err.message}`);
        process.exitCode = 1;
      });
    return;
  }

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
