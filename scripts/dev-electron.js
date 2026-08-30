#!/usr/bin/env node

/**
 * Start BioF3 desktop in renderer-HMR mode.
 *
 * One command starts:
 * 1. Vite dev server for frontend hot updates.
 * 2. Electron main process loading the Vite URL instead of frontend/dist.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const rendererUrl = process.env.BIOF3_RENDERER_DEV_URL || 'http://localhost:3000';
const projectRoot = process.cwd();
const electronApp = path.join(projectRoot, 'node_modules/electron/dist/Electron.app');
const electronBinary = path.join(electronApp, 'Contents/MacOS/Electron');
const electronUserDataDir =
  process.env.BIOF3_ELECTRON_USER_DATA_DIR || path.join(projectRoot, '.biof3-dev-user-data');
const electronLocalDataDir =
  process.env.BIOF3_LOCAL_DATA_DIR || path.join(electronUserDataDir, 'data');
const electronLogPath = process.env.BIOF3_ELECTRON_LOG_PATH || path.join(os.tmpdir(), 'biof3-electron-main.log');
const electronErrorLogPath = `${electronLogPath}.error`;

const children = new Set();
let shuttingDown = false;
let launchedElectronViaOpen = false;

function spawnChild(command, args, options = {}) {
  const { shutdownOnExit = 'error', ...spawnOptions } = options;
  const child = spawn(command, args, {
    stdio: 'inherit',
    // npm.cmd / npx.cmd need cmd.exe on Windows. POSIX launches directly so
    // paths and optional Electron args are never re-parsed by a shell.
    shell: isWin,
    detached: !isWin,
    ...spawnOptions,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (shutdownOnExit === 'always') {
      shutdown(code || 0);
    } else if (signal !== 'SIGTERM' && code !== 0) {
      shutdown(code || 1);
    }
  });
  return child;
}

function terminateChild(child) {
  try {
    // npm and npx launch grandchildren (Vite/Electron). Killing the POSIX
    // process group prevents those grandchildren from surviving the launcher.
    if (!isWin && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // The child may already have exited.
  }
}

function getWorkspaceElectronPids() {
  if (process.platform !== 'darwin' || !fs.existsSync(electronBinary)) return [];
  const result = spawnSync('pgrep', ['-f', electronBinary], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function signalPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may already have exited.
    }
  }
}

async function waitForPidsToExit(pids, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const remaining = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (remaining.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
}

async function stopWorkspaceElectron() {
  const pids = getWorkspaceElectronPids();
  if (pids.length === 0) return;
  signalPids(pids, 'SIGTERM');
  const remaining = await waitForPidsToExit(pids, 5000);
  if (remaining.length > 0) {
    signalPids(remaining, 'SIGKILL');
    const survivors = await waitForPidsToExit(remaining, 2000);
    if (survivors.length > 0) {
      throw new Error(`Unable to stop workspace Electron processes: ${survivors.join(', ')}`);
    }
  }
}

async function waitForWorkspaceElectron(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (getWorkspaceElectronPids().length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Electron did not start within ${timeoutMs}ms. See ${electronLogPath} and ${electronErrorLogPath}`,
  );
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }
  // On macOS the Electron instance is launched via `open -a` (GUI session) and
  // is not part of our process group, so tear it down explicitly.
  if (launchedElectronViaOpen && process.platform === 'darwin') {
    try {
      await stopWorkspaceElectron();
    } catch (error) {
      console.error(`[dev] ${error.message}`);
      code = code || 1;
    }
  }
  process.exit(code);
}

function urlIsAvailable(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, 250);
      });
      req.setTimeout(1200, () => {
        req.destroy();
      });
    };
    tick();
  });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function getPortOwnerPids(port) {
  if (process.platform === 'win32') {
    // netstat -ano | findstr :PORT then FOR /F tokens=5 to extract PID — kept
    // out of the dev loop's hot path because devs almost never run on Windows.
    return [];
  }
  // `lsof -ti :PORT` returns PIDs listening on PORT, one per line. Exit code 1
  // means "no matches" which is the steady state we want, not an error.
  const result = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopPidsByPort(port, label) {
  const pids = await getPortOwnerPids(port);
  if (pids.length === 0) return 0;
  console.log(`[dev] clearing ${pids.length} stale ${label} process(es) holding :${port} (pids: ${pids.join(', ')})`);
  signalPids(pids, 'SIGTERM');
  const remaining = await waitForPidsToExit(pids, 3000);
  if (remaining.length > 0) {
    signalPids(remaining, 'SIGKILL');
    const survivors = await waitForPidsToExit(remaining, 2000);
    if (survivors.length > 0) {
      console.warn(`[dev] ${label} pid(s) still alive after SIGKILL: ${survivors.join(', ')}`);
    }
  }
  // Final settle — give the kernel a beat to release the listening socket.
  await new Promise((resolve) => setTimeout(resolve, 200));
  return pids.length;
}

async function stopWorkspaceDevProcesses() {
  // macOS-launched Electron is detached from our process group and survives
  // shell exits; kill it before touching the backend ports so it doesn't
  // immediately re-bind them via its child process manager.
  if (process.platform === 'darwin') {
    try {
      await stopWorkspaceElectron();
    } catch (error) {
      console.warn(`[dev] ${error.message}`);
    }
  }
  // Always sweep vite / biof3-server regardless of OS — these are the
    // ports the dev loop actually waits on. The order matches the boot
    // sequence so an older stack drops in reverse.
    // (BLOCK-30 P1: 独立 Python 后端 :3004 已摘除。)
  const rendererPort = Number(new URL(rendererUrl).port) || 3000;
  await stopPidsByPort(rendererPort, 'vite renderer');
  await stopPidsByPort(3001, 'biof3-server');
}

async function main() {
  // Auto-clear any BioF3 dev process from a previous session that still owns
  // the dev ports, then verify the renderer port is actually free. Doing both
  // means a hot-reload dev loop can re-run `npm run dev` without first having
  // to manually `lsof -ti :3000 | xargs kill`.
  await stopWorkspaceDevProcesses();
  if (await urlIsAvailable(rendererUrl)) {
    // A foreign server (not BioF3) is holding the port — refuse rather than
    // kill something we don't own.
    throw new Error(
      `${rendererUrl} is already serving a page by a non-BioF3 process. ` +
        `Stop it manually before running npm run dev again.`
    );
  }

  spawnChild(npmCmd, ['--prefix', 'frontend', 'run', 'dev']);
  await waitForUrl(rendererUrl);

  // biof3-server (and later Electron) both need the same DB. The Electron main
  // process stores it in ~/Library/Application Support/biof3-local/ (see
  // env-coordinator.js). We mirror that path here so biof3-server opens the already-
  // migrated DB instead of its own empty core/biof3-server/bioF3.db.
  const rServerUserDataDir = process.env.BIOF3_ELECTRON_USER_DATA_DIR ||
    path.join(os.homedir(), 'Library', 'Application Support', 'biof3-local');
  process.env.BIOF3_DB_PATH = path.join(rServerUserDataDir, 'bioF3.db');

  // Run pending DB migrations against the shared DB before biof3-server starts.
  // Uses the same BIOF3_BETTER_SQLITE3_ROOT root as main.js:367 so the
  // better-sqlite3 native addon ABI matches.
  const migrationEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', BIOF3_BETTER_SQLITE3_ROOT: path.join(projectRoot, 'core/biof3-server') };
  const migrationResult = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'src', 'migration-runner.js'), process.env.BIOF3_DB_PATH, path.join(projectRoot, 'src', 'migrations')],
    { cwd: projectRoot, encoding: 'utf8', env: migrationEnv },
  );
  if (migrationResult.error) throw migrationResult.error;
  if (migrationResult.status !== 0) {
    throw new Error((migrationResult.stderr || migrationResult.stdout || 'migration child failed').trim());
  }
  const migrationOutput = String(migrationResult.stdout || '').trim();
  if (migrationOutput) console.log('[dev-electron] ' + migrationOutput.replace(/\n/g, '\n[dev-electron] '));

  // Start biof3-server on :3001 so /api/ai/chat (and other /api/* routes used by
  // the renderer) are reachable from the dev shell. Without this the copilot
  // context-budget ring (UI-190) and other live SSE features stay empty.
  spawnChild(npmCmd, ['--prefix', 'core/biof3-server', 'start'], { env: { ...process.env } });
  await waitForUrl('http://127.0.0.1:3001/api/health');

  // Optional extra Electron CLI args for local debugging, e.g.
  //   BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev
  // Empty by default so normal dev runs are unchanged.
  const extraElectronArgs = (process.env.BIOF3_DEV_ELECTRON_ARGS || '')
    .split(' ')
    .map((arg) => arg.trim())
    .filter(Boolean);

  if (process.platform === 'darwin') {
    // macOS: launch Electron via `open -a` so it inherits the GUI login session
    // and receives keyboard focus. A plain spawn from a background/agent shell
    // starts Electron without a key window (AXFocused=false) → the input box
    // can be clicked but cannot receive keystrokes. `open` brokers the launch
    // through LaunchServices, which attaches a proper window-server connection.
    // `open -a` otherwise focuses an existing instance. Only stop the Electron
    // binary from this workspace; never match generic Electron Helper processes.
    fs.mkdirSync(electronUserDataDir, { recursive: true });
    fs.mkdirSync(electronLocalDataDir, { recursive: true });
    fs.writeFileSync(electronLogPath, '');
    fs.writeFileSync(electronErrorLogPath, '');
    // `open` returns immediately; do NOT treat its exit as a shutdown signal.
    // Electron is tracked separately so SIGINT/Cmd+Q can still tear it down.
    launchedElectronViaOpen = true;
    const openArgs = [
      '-n',
      '-a',
      electronApp,
      '-o',
      electronLogPath,
      '--stderr',
      electronErrorLogPath,
      '--env',
      'ELECTRON_IS_DEV=1',
      '--env',
      'NODE_ENV=development',
      '--env',
      `BIOF3_RENDERER_DEV_URL=${rendererUrl}`,
      '--env',
      `BIOF3_ELECTRON_USER_DATA_DIR=${electronUserDataDir}`,
      '--env',
      `BIOF3_LOCAL_DATA_DIR=${electronLocalDataDir}`,
    ];
    if (process.env.ELECTRON_DISABLE_SANDBOX) {
      openArgs.push('--env', `ELECTRON_DISABLE_SANDBOX=${process.env.ELECTRON_DISABLE_SANDBOX}`);
    }
    openArgs.push('--args', projectRoot, '--dev', ...extraElectronArgs);
    spawnChild('/usr/bin/open', openArgs);
    await waitForWorkspaceElectron();
    console.log(`[dev] Electron started via LaunchServices; main log: ${electronLogPath}`);
    console.log(`[dev] Electron stderr: ${electronErrorLogPath}`);
  } else {
    spawnChild(npxCmd, ['electron', '.', '--dev', ...extraElectronArgs], {
      shutdownOnExit: 'always',
      env: {
        ...process.env,
        ELECTRON_IS_DEV: '1',
        NODE_ENV: 'development',
        BIOF3_RENDERER_DEV_URL: rendererUrl,
      },
    });
  }
}

main().catch((error) => {
  console.error('[dev] failed:', error.message);
  shutdown(1);
});
