#!/usr/bin/env node
'use strict';

/**
 * dev-task-runner — portable background task supervisor (BLOCK-231).
 *
 * Why: harness completion notifications are best-effort. The exit code file is
 * the truth. This runner is process-level (Node/OS only, no agent tooling):
 *
 *   run --label <name> --cmd "<shell command>" [--runs-dir <dir>]
 *   wait (--id <id> | --latest) [--timeout-ms N] [--poll-ms N] [--runs-dir <dir>]
 *   status [--json] [--fail-on-failed] [--prune-days N] [--runs-dir <dir>]
 *
 * Exit codes: child exit code; 124 wait timeout; 125 task/status unknown
 * (runner died or status unreadable); 127 spawn failure. Never treats a lost
 * notification as success.
 *
 * Runs are stored under <repo>/.petri-dev-user-data/task-runs by default:
 *   <id>.log          stdout+stderr
 *   <id>.status.json  {id,label,cmd,pid,state,startedAt,updatedAt,endedAt,exitCode,signal,logPath}
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_LOG_BYTES = 50 * 1024 * 1024;

function resolveRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function defaultRunsDir() {
  return path.join(resolveRepoRoot(), '.petri-dev-user-data', 'task-runs');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function statusPath(runsDir, id) {
  return path.join(runsDir, `${id}.status.json`);
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(file, { force: true }); } catch {}
    fs.renameSync(tmp, file);
  }
}

function readStatus(runsDir, id) {
  try {
    return JSON.parse(fs.readFileSync(statusPath(runsDir, id), 'utf8'));
  } catch {
    return null;
  }
}

function listStatuses(runsDir) {
  try {
    return fs.readdirSync(runsDir)
      .filter((name) => name.endsWith('.status.json'))
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf8')); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  } catch {
    return [];
  }
}

function isAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function makeId(label) {
  const slug = String(label || 'task').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'task';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const rand = Math.random().toString(36).slice(2, 7);
  return `${stamp}-${slug}-${rand}`;
}

function parseArgs(argv) {
  const out = { positional: [], options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.options[key] = next;
        i += 1;
      } else {
        out.options[key] = true;
      }
    } else {
      out.positional.push(token);
    }
  }
  return out;
}

function runsDirOf(options) {
  return path.resolve(String(options['runs-dir'] || defaultRunsDir()));
}

function printStatus(status) {
  if (!status) {
    console.log('[task] status unavailable');
    return;
  }
  const detail = status.state === 'ended'
    ? `exit=${status.exitCode}${status.signal ? ` signal=${status.signal}` : ''}`
    : `state=${status.state} pid=${status.pid}`;
  console.log(`[task] ${status.id} ${status.label} ${detail} ${status.logPath}`);
}

function commandRun(options) {
  const cmd = typeof options.cmd === 'string' ? options.cmd : '';
  if (!cmd.trim()) {
    console.error('[task] run requires --cmd "<shell command>"');
    process.exit(2);
  }
  const runsDir = runsDirOf(options);
  ensureDir(runsDir);
  const label = String(options.label || 'task');
  const id = makeId(label);
  const logPath = path.join(runsDir, `${id}.log`);
  const status = {
    id,
    label,
    cmd,
    pid: null,
    state: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    logPath,
  };
  writeJsonAtomic(statusPath(runsDir, id), status);

  const log = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(cmd, { shell: true, cwd: process.cwd(), env: process.env, windowsHide: true });
  status.pid = child.pid || null;
  writeJsonAtomic(statusPath(runsDir, id), status);
  console.log(`[task] started ${id} pid=${status.pid} log=${logPath}`);

  let logBytes = 0;
  const tee = (chunk) => {
    if (logBytes < MAX_LOG_BYTES) {
      log.write(chunk);
      logBytes += chunk.length;
    }
    try { process.stdout.write(chunk); } catch {}
  };
  child.stdout.on('data', tee);
  child.stderr.on('data', tee);

  const finish = (exitCode, signal) => {
    try { log.end(); } catch {}
    status.state = 'ended';
    status.endedAt = new Date().toISOString();
    status.updatedAt = status.endedAt;
    status.exitCode = typeof exitCode === 'number' ? exitCode : 1;
    status.signal = signal || null;
    writeJsonAtomic(statusPath(runsDir, id), status);
    console.log(`[task] ended ${id} exit=${status.exitCode}${signal ? ` signal=${signal}` : ''}`);
    process.exitCode = status.exitCode;
  };

  child.on('error', (error) => {
    status.lastError = error && error.message ? error.message : 'spawn_failed';
    finish(127, null);
  });
  child.on('exit', (code, signal) => finish(code, signal));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { child.kill(sig); } catch {}
      finish(codeFromSignal(sig), sig);
      setTimeout(() => process.exit(codeFromSignal(sig)), 100).unref();
    });
  }
}

function codeFromSignal(signal) {
  return signal === 'SIGINT' ? 130 : 143;
}

function commandWait(options) {
  const runsDir = runsDirOf(options);
  let id = typeof options.id === 'string' ? options.id : '';
  if (!id && options.latest) {
    const latest = listStatuses(runsDir)[0];
    id = latest ? latest.id : '';
  }
  if (!id) {
    console.error('[task] wait requires --id <id> or --latest');
    process.exit(2);
  }
  const timeoutMs = Math.max(1, Number(options['timeout-ms']) || 600_000);
  const pollMs = Math.max(50, Number(options['poll-ms']) || 500);
  const deadline = Date.now() + timeoutMs;
  let delay = pollMs;
  let last = null;
  for (;;) {
    last = readStatus(runsDir, id);
    if (last && last.state === 'ended') {
      printStatus(last);
      process.exit(Number.isInteger(last.exitCode) ? last.exitCode : 1);
    }
    if (last && last.state === 'running' && !isAlive(last.pid)) {
      // Grace: runner may be writing the final status right now.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      const again = readStatus(runsDir, id);
      if (again && again.state === 'ended') {
        printStatus(again);
        process.exit(Number.isInteger(again.exitCode) ? again.exitCode : 1);
      }
      printStatus(again || last);
      console.error('[task] process not alive and no ended status (runner lost). Treat as unknown, NOT success.');
      process.exit(125);
    }
    if (Date.now() >= deadline) {
      printStatus(last);
      console.error(`[task] wait timeout after ${timeoutMs}ms`);
      process.exit(124);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    delay = Math.min(2000, Math.round(delay * 1.5));
  }
}

function commandStatus(options) {
  const runsDir = runsDirOf(options);
  const pruneDays = Number(options['prune-days']);
  if (Number.isFinite(pruneDays) && pruneDays > 0) {
    const cutoff = Date.now() - pruneDays * 86_400_000;
    for (const status of listStatuses(runsDir)) {
      if (status.state !== 'ended') continue;
      const endedAt = Date.parse(status.endedAt || '');
      if (Number.isFinite(endedAt) && endedAt < cutoff) {
        try { fs.rmSync(statusPath(runsDir, status.id), { force: true }); } catch {}
        try { fs.rmSync(status.logPath || '', { force: true }); } catch {}
      }
    }
  }
  const all = listStatuses(runsDir);
  const open = all.filter((status) => status.state !== 'ended' || status.exitCode !== 0);
  if (options.json) {
    console.log(JSON.stringify({ runsDir, total: all.length, open }, null, 2));
  } else if (all.length === 0) {
    console.log(`[task] no runs in ${runsDir}`);
  } else {
    console.log(`[task] runs dir: ${runsDir} (${all.length} total, ${open.length} open/failed)`);
    for (const status of all.slice(0, 20)) printStatus(status);
  }
  if (options['fail-on-failed'] && open.some((status) => status.exitCode !== 0)) {
    process.exit(1);
  }
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (command === 'run') return commandRun(options);
  if (command === 'wait') return commandWait(options);
  if (command === 'status') return commandStatus(options);
  console.error('usage: dev-task-runner.mjs <run|wait|status> [options]');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { resolveRepoRoot, defaultRunsDir, isAlive, parseArgs };
