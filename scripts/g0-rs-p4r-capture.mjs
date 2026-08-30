#!/usr/bin/env node
/**
 * G0-RS-P4R-0 — disposable capture environment for the Result Studio baseline.
 *
 * P4R-0 has to measure the real open-result path, but the developer database
 * holds real projects and 382 synthetic `test-tool-2` jobs, and it never had
 * `001_result_studio.sql` applied. Sampling it would both touch user data and
 * violate the plan's "no database seed pretending to be a real product
 * journey" rule.
 *
 * So every capture run gets a throwaway root instead. The backend already reads
 * every path it needs from the environment, so isolation needs no production
 * code change. The authoritative list is ISOLATED_PATH_ENV below; on top of it
 * a run sets R_SERVER_PORT and BIOF3_PERF_PROBE=1, which arms the probe from
 * commit 340c09a.
 *
 * The isolation is asserted, not assumed: assertIsolated() refuses to run when
 * any path resolves outside the throwaway root or onto the repository database.
 * It fails closed, because the cost of being wrong is the user's data.
 *
 * This module owns the environment lifecycle only. Which scenarios to drive is
 * P4R-0's next unit; `capture()` takes them as a callback.
 *
 * Usage:
 *   node scripts/g0-rs-p4r-capture.mjs            # smoke: boot, snapshot, tear down
 *   node scripts/g0-rs-p4r-capture.mjs --keep     # keep the root for inspection
 *   node scripts/g0-rs-p4r-capture.mjs --json     # machine-readable snapshot
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'core', 'biof3-server', 'server.js');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'src', 'migrations');
const REPO_DB = path.join(REPO_ROOT, 'core', 'biof3-server', 'biof3.db');

/**
 * Every environment variable that decides where the backend WRITES.
 *
 * Declared once and consumed by both createCaptureEnv() and assertIsolated(),
 * so a path can never be redirected without also being guarded — the first
 * version of this file set four of these and guarded the same four, which left
 * BIOF3_LOCAL_DATA_DIR, BIOF3_PLUGINS_DIR and BIOF3_HARNESS_LOCAL_ROOT falling
 * back to ~/Documents/BioF3-Local, the real user data root.
 *
 * Each entry maps the variable to its subdirectory inside the disposable root.
 * Sources: config.js (db/temp/results/uploads), db.js:550 getLocalDataRoot,
 * server.js:63 + plugin-loader.js:492 + mcp/registry.js:131 (plugins),
 * mcp/registry.js:167 + helpers/tools-executor.js:116 (harness root).
 */
export const ISOLATED_PATH_ENV = Object.freeze({
  BIOF3_DB_PATH: 'biof3.db',
  BIOF3_TEMP_DIR: 'tmp',
  BIOF3_LOCAL_RESULTS_DIR: 'results',
  BIOF3_LOCAL_UPLOADS_DIR: 'uploads',
  BIOF3_LOCAL_DATA_DIR: 'data',
  BIOF3_PLUGINS_DIR: 'plugins',
  BIOF3_HARNESS_LOCAL_ROOT: 'results',
});

/**
 * Bounded fingerprint of the real user data root, for tests that must prove a
 * run stayed out of it.
 *
 * A directory's mtime does NOT change when a file inside it is rewritten, nor
 * when anything is created in a subdirectory — so the obvious
 * `statSync(root).mtimeMs` check cannot see the leaks it appears to guard, and
 * an earlier version of these tests used exactly that. This instead samples the
 * things a leak actually produces: a new project directory, a new top-level
 * entry, or a write to the live database.
 *
 * Deliberately bounded: the root holds ~85k files and a recursive walk costs
 * ~2s per sample. This does not detect a modification deep inside an existing
 * project. It does detect every creation shape a capture run could produce.
 */
export function fingerprintRealDataRoot(realRoot) {
  if (!existsSync(realRoot)) return { present: false };
  const list = (dir) => (existsSync(dir) ? readdirSync(dir).sort().join('\n') : null);
  const dbPath = path.join(realRoot, 'biof3.db');
  const db = existsSync(dbPath) ? statSync(dbPath) : null;
  return {
    present: true,
    rootEntries: list(realRoot),
    projectEntries: list(path.join(realRoot, 'projects')),
    dbSize: db ? db.size : null,
    dbMtimeMs: db ? db.mtimeMs : null,
  };
}

/** Tables `001_result_studio.sql` must create for the RS paths to be reachable. */
export const REQUIRED_RS_TABLES = [
  'git_repository_bindings',
  'scientific_change_sets',
  'artifact_revisions',
  'result_selection_contexts',
  'workspace_revision_checkpoints',
];

const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 100;
const SHUTDOWN_GRACE_MS = 3000;

/** Ask the OS for a free port. Racy in principle, fine for a local capture run. */
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Refuse to run unless every writable path sits inside the throwaway root.
 * Fails closed: an unexpected path aborts the run rather than degrading to a
 * capture that quietly writes into the developer database.
 */
export function assertIsolated(env, root) {
  const resolvedRoot = path.resolve(root);
  const guarded = Object.keys(ISOLATED_PATH_ENV).map((key) => [key, env[key]]);

  // Checked before the containment rule below: pointing at the repository
  // database is the most damaging mistake available here, so it earns the
  // specific message. The generic rule would otherwise swallow it, since the
  // repository database is always outside a throwaway root.
  if (env.BIOF3_DB_PATH && path.resolve(env.BIOF3_DB_PATH) === path.resolve(REPO_DB)) {
    throw new Error('capture isolation: refusing to capture against the repository database');
  }

  for (const [key, value] of guarded) {
    if (!value) throw new Error(`capture isolation: ${key} must be set explicitly`);
    const resolved = path.resolve(value);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`capture isolation: ${key} resolves outside the disposable root (${resolved})`);
    }
  }
  return true;
}

/** Build a disposable root plus the environment that points the server at it. */
export function createCaptureEnv({ port, root } = {}) {
  const captureRoot = root || mkdtempSync(path.join(tmpdir(), 'biof3-p4r-capture-'));

  const paths = Object.fromEntries(
    Object.entries(ISOLATED_PATH_ENV).map(([key, leaf]) => [key, path.join(captureRoot, leaf)]),
  );
  // BIOF3_DB_PATH names a file; the rest are directories the backend expects to exist.
  for (const [key, value] of Object.entries(paths)) {
    if (key !== 'BIOF3_DB_PATH') mkdirSync(value, { recursive: true });
  }

  const env = {
    ...process.env,
    ...paths,
    BIOF3_PERF_PROBE: '1',
    BIOF3_DESKTOP: '1',
    R_SERVER_PORT: String(port ?? 0),
    // Keep a capture run off the network and out of the AI path entirely.
    R_POOL_ENABLED: 'false',
  };

  assertIsolated(env, captureRoot);
  return { root: captureRoot, env, paths };
}

/**
 * Run `fn` with console.log suppressed.
 *
 * The migration runner logs progress to stdout, which corrupts `--json` output
 * for the machine consumers that flag exists to serve. Errors still surface:
 * console.error is untouched and exceptions propagate.
 */
export async function withQuietStdout(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

/** Apply `src/migrations/*.sql` to the disposable database. */
export async function applyMigrations(dbPath, { quiet = false } = {}) {
  const { runMigrations } = require(path.join(REPO_ROOT, 'src', 'migration-runner.js'));
  const run = () => runMigrations(dbPath, MIGRATIONS_DIR);
  return quiet ? withQuietStdout(run) : run();
}

/** Report which RS tables actually exist, so a capture cannot silently run half-migrated. */
export function inspectTables(dbPath) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(REPO_ROOT, 'core', 'biof3-server'), REPO_ROOT],
  }));
  const db = new Database(dbPath, { readonly: true });
  try {
    const present = new Set(
      db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name),
    );
    return {
      present: REQUIRED_RS_TABLES.filter((t) => present.has(t)),
      missing: REQUIRED_RS_TABLES.filter((t) => !present.has(t)),
    };
  } finally {
    db.close();
  }
}

async function waitForHealth(baseUrl, { signal } = {}) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    if (signal?.exited) throw new Error(`server exited before becoming healthy: ${signal.exited}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return await response.json();
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => { setTimeout(resolve, HEALTH_POLL_MS); });
  }
  throw new Error(`server did not become healthy within ${HEALTH_TIMEOUT_MS}ms (${lastError})`);
}

/** Spawn the real server against the disposable environment. */
export async function startServer(env, { onLog } = {}) {
  // Only take the server's output when someone is actually consuming it.
  // Piping it unconditionally makes the measurement measure the harness: the
  // server's console.log blocks once the pipe buffer fills and the parent is
  // slow to drain, which happens as soon as this runs under `npm run ... | tail`.
  // That backpressure stalls the server's event loop, and the probe faithfully
  // records the stall — the same capture read 463ms run directly and 4257ms
  // through npm, purely from this.
  const capturesOutput = typeof onLog === 'function';
  const stdio = capturesOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'];
  const child = spawn(process.execPath, [SERVER_ENTRY], { env, cwd: REPO_ROOT, stdio });
  const logs = [];
  const signal = { exited: null };

  const collect = (stream, channel) => {
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        logs.push({ channel, line });
        onLog?.(channel, line);
      }
    });
  };
  collect(child.stdout, 'stdout');
  collect(child.stderr, 'stderr');
  child.on('exit', (code, sig) => { signal.exited = `code=${code} signal=${sig}`; });

  const baseUrl = `http://127.0.0.1:${env.R_SERVER_PORT}`;
  try {
    await waitForHealth(baseUrl, { signal });
  } catch (error) {
    child.kill('SIGKILL');
    const tail = logs.slice(-15).map((l) => `  [${l.channel}] ${l.line}`).join('\n');
    throw new Error(`${error.message}\n${tail}`);
  }
  return { child, baseUrl, logs };
}

export async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, SHUTDOWN_GRACE_MS);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export async function snapshotProbe(baseUrl) {
  const response = await fetch(`${baseUrl}/api/__perf/event-loop`);
  if (!response.ok) throw new Error(`probe snapshot failed: status ${response.status}`);
  return response.json();
}

export async function resetProbe(baseUrl) {
  const response = await fetch(`${baseUrl}/api/__perf/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`probe reset failed: status ${response.status}`);
  return response.json();
}

/**
 * Full lifecycle: disposable root → migrate → boot with probe → run scenarios →
 * snapshot → tear down. `scenarios` receives { baseUrl, env, root } and drives
 * whatever the caller wants measured.
 */
export async function capture({ scenarios, keep = false, quiet = false, onLog } = {}) {
  const port = await findFreePort();
  const { root, env } = createCaptureEnv({ port });
  let server = null;

  try {
    const migration = await applyMigrations(env.BIOF3_DB_PATH, { quiet });
    const tables = inspectTables(env.BIOF3_DB_PATH);
    if (tables.missing.length) {
      throw new Error(`migration left RS tables missing: ${tables.missing.join(', ')}`);
    }

    server = await startServer(env, { onLog });
    await resetProbe(server.baseUrl);

    const scenarioResult = scenarios ? await scenarios({ baseUrl: server.baseUrl, env, root }) : null;
    const snapshot = await snapshotProbe(server.baseUrl);

    return { root, port, migration, tables, snapshot, scenarioResult, kept: keep };
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

  const result = await capture({
    keep,
    quiet: asJson,
    onLog: verbose ? (channel, line) => console.error(`[server:${channel}] ${line}`) : undefined,
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('G0-RS-P4R-0 capture environment');
  console.log(`  disposable root : ${result.kept ? result.root : '(removed)'}`);
  console.log(`  port            : ${result.port}`);
  console.log(`  RS tables       : ${result.tables.present.length}/${REQUIRED_RS_TABLES.length} present`);
  console.log(`  probe enabled   : ${result.snapshot.enabled}`);
  console.log(`  event-loop      : ${result.snapshot.eventLoop?.samples ?? 0} samples`);
  console.log(`  routes recorded : ${result.snapshot.requests.length}`);
  console.log('\nEnvironment is reusable; scenario driving is the next P4R-0 unit.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
