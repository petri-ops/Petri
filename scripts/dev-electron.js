#!/usr/bin/env node

/**
 * Start Petri desktop in renderer-HMR mode.
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
// BLOCK-45 — 启动记录持久化 + boot 清理决策（纯逻辑，可单测）。
const {
  readLaunchRecord,
  writeLaunchRecord,
  clearLaunchRecord,
  resolveBootElectronAction,
} = require('./lib/dev-launch-state');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const rendererUrl = process.env.PETRI_RENDERER_DEV_URL || 'http://localhost:3000';
const projectRoot = process.cwd();
const electronApp = path.join(projectRoot, 'node_modules/electron/dist/Electron.app');
const electronBinary = path.join(electronApp, 'Contents/MacOS/Electron');
const electronUserDataDir =
  process.env.PETRI_ELECTRON_USER_DATA_DIR || path.join(projectRoot, '.petri-dev-user-data');
const electronLocalDataDir =
  process.env.PETRI_LOCAL_DATA_DIR || path.join(electronUserDataDir, 'data');
// petri-server 与迁移子进程同样按 PETRI_LOCAL_DATA_DIR 解析 ai-settings.json /
// credential-store / 数据根。只把它放进 electronEnv 会让后端各自回落到
// ~/Documents/Petri-Local（无配置 → 模型列表重置为 deepseek 默认、凭据读空），
// 必须在 fork 任何子进程前导出，与 Electron 主进程（env-coordinator）同根。
process.env.PETRI_LOCAL_DATA_DIR = electronLocalDataDir;
const electronLogPath = process.env.PETRI_ELECTRON_LOG_PATH || path.join(os.tmpdir(), 'petri-electron-main.log');
const electronErrorLogPath = `${electronLogPath}.error`;

const children = new Set();
let shuttingDown = false;
let launchedElectronViaOpen = false;
// BLOCK-35：launch-token 定向。shutdown 只杀本 wrapper 启动的 Electron 实例
// （token 随 --args 注入主进程 argv；Helper 子进程 argv 不含 token，天然只中主进程），
// 不再按二进制路径全杀工作区 Electron —— 否则会误杀人工 `electron . --dev`
// 或另一 wrapper 启动的并存实例（BLOCK-34 P4 实机两次静默退出的根因）。
const launchToken = `petridev-${process.pid}-${Date.now().toString(36)}`;
// BLOCK-45：boot 清理逃生口 —— 仅显式传入时恢复旧「全杀工作区 Electron」语义，
// 覆盖 pre-BLOCK-45 无启动记录残留实例的极端场景。
const forceCleanElectron =
  process.argv.includes('--force-clean-electron') || process.env.PETRI_FORCE_CLEAN_ELECTRON === '1';

function spawnChild(command, args, options = {}) {
  const { shutdownOnExit = 'error', exitHint = '', ...spawnOptions } = options;
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
    // C-35：子进程非零退出时，先把可读诊断打出来再收栈——否则 Electron 在创建
    // 窗口前就崩（例如本机安全软件拦了 Chromium 沙箱），用户只看到命令结束、
    // 没有窗口也没有任何错误信息。
    if (exitHint && code) {
      console.error(exitHint.replace('{code}', String(code)));
    }
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

// 工作区 Electron 主进程的两种启动变体（BLOCK-35 P2 实机发现）：
// 1. wrapper 经 `open -a Electron.app` 启动 → argv 为
//    `<root>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
// 2. `npx electron .` / `./node_modules/.bin/electron`（cli.js）启动 → argv 为
//    `<root>/node_modules/electron/dist/electron`（小写直连二进制）。
// 旧模式只匹配 .app 路径，boot 清理会漏掉变体 2。Helper 子进程位于
// `.../Frameworks/Electron Helper ...`，不匹配任一分支，天然只中主进程。
function getWorkspaceElectronPids() {
  if (process.platform !== 'darwin' || !fs.existsSync(electronBinary)) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `${esc(projectRoot)}/node_modules/electron/dist/(Electron[.]app/Contents/MacOS/Electron|electron)( |$)`;
  const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

// token 定向 pgrep（BLOCK-45 泛化）：匹配 argv 含 `petri-dev-launch-token=<token>`
// 的进程。pattern 不带前导 `--`（避免被 pgrep 当选项解析）；pgrep 会把仍存活的
// `open` 自身也命中（其 argv 含 token），排除掉。
function getElectronPidsByToken(token) {
  if (process.platform !== 'darwin' || !token) return [];
  const result = spawnSync('pgrep', ['-f', `petri-dev-launch-token=${token}`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const childPids = new Set([...children].map((child) => child.pid));
  return result.stdout
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0 && !childPids.has(pid));
}

// 本 wrapper 经 `open --args ... --petri-dev-launch-token=<token>` 启动的实例。
function getLaunchedElectronPids() {
  return getElectronPidsByToken(launchToken);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// BLOCK-45：SIGTERM → 等待 → SIGKILL 的优雅击杀，boot 清理与 shutdown 共用。
async function killPidsGracefully(pids, label) {
  if (pids.length === 0) return;
  signalPids(pids, 'SIGTERM');
  const remaining = await waitForPidsToExit(pids, 5000);
  if (remaining.length > 0) {
    signalPids(remaining, 'SIGKILL');
    const survivors = await waitForPidsToExit(remaining, 2000);
    if (survivors.length > 0) {
      throw new Error(`Unable to stop ${label}: ${survivors.join(', ')}`);
    }
  }
}

// BLOCK-45 逃生口：显式 force-clean 时恢复旧「全杀工作区 Electron 主进程」语义。
// BLOCK-45：boot 清理 Electron 段 —— 读上一启动记录做定向决策，
// 不再按二进制路径全杀（并存实例误杀根因，BLOCK-43 P3 实测踩中）。
// fail-closed 决策向上抛出（中止 boot）；清理失败仅告警不阻塞端口接管。
async function stopPreviousLaunchElectron() {
  const record = readLaunchRecord(electronUserDataDir);
  const tokenPids = record ? getElectronPidsByToken(record.token) : [];
  const wrapperAlive = record
    ? record.wrapperPid !== process.pid && isPidAlive(record.wrapperPid)
    : false;
  const decision = resolveBootElectronAction({
    record,
    wrapperAlive,
    hasTokenPids: tokenPids.length > 0,
    forceClean: false,
  });
  if (decision.action === 'fail') throw new Error(decision.message);
  if (decision.action === 'cleanup') {
    console.log(`[dev] cleaning up previous launch Electron (token-scoped, pids: ${tokenPids.join(', ')})`);
    await killPidsGracefully(tokenPids, 'previous launch Electron');
  }
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

// BLOCK-35：shutdown 路径专用 —— 只停本 wrapper 启动的实例，并存实例不受影响。
async function stopLaunchedElectron() {
  const pids = getLaunchedElectronPids();
  await killPidsGracefully(pids, 'launched Electron');
}

async function waitForWorkspaceElectron(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    // token 就绪判定：只认本 wrapper 启动的实例，陈旧实例不构成假阳性
    if (getLaunchedElectronPids().length > 0) return;
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
  // is not part of our process group, so tear it down explicitly. BLOCK-35:
  // only the instance this wrapper launched (token-scoped) — coexisting
  // Electron instances from this workspace must survive our shutdown.
  if (launchedElectronViaOpen && process.platform === 'darwin') {
    try {
      await stopLaunchedElectron();
    } catch (error) {
      console.error(`[dev] ${error.message}`);
      code = code || 1;
    }
    // BLOCK-45：清掉自己的启动记录（仅当记录仍指向本 wrapper —— 若已被
    // 后继 wrapper 覆盖则不动，避免误删他者记录）。
    try {
      const record = readLaunchRecord(electronUserDataDir);
      if (record && record.token === launchToken) clearLaunchRecord(electronUserDataDir);
    } catch {
      // best-effort；残留记录会在下次 boot 按「wrapper 已死」路径正常清理
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
  //
  // BLOCK-45：Electron 段不再按二进制路径全杀（并存实例误杀根因）——
  //   - 显式 `--force-clean-electron` / PETRI_FORCE_CLEAN_ELECTRON=1 →
  //     恢复旧全杀语义（逃生口，覆盖 pre-BLOCK-45 无记录残留）；
  //   - 默认走 token 定向：上一 wrapper 仍存活且其 token 命中 → fail-closed
  //     抛错中止 boot（提示先停旧栈）；wrapper 已死 → token 定向清理残留；
  //     无记录 → 跳过 Electron 段（仅端口接管）。
  //   fail-closed 决策必须向上传播中止 boot（不得吞掉）；清理类失败仅告警。
  if (process.platform === 'darwin') {
    try {
      if (forceCleanElectron) {
        await stopWorkspaceElectron();
      } else {
        await stopPreviousLaunchElectron();
      }
    } catch (error) {
      if (forceCleanElectron) {
        console.warn(`[dev] ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  // Always sweep vite / petri-server regardless of OS — these are the
    // ports the dev loop actually waits on. The order matches the boot
    // sequence so an older stack drops in reverse.
    // (BLOCK-30 P1: 独立 Python 后端 :3004 已摘除。)
  const rendererPort = Number(new URL(rendererUrl).port) || 3000;
  await stopPidsByPort(rendererPort, 'vite renderer');
  await stopPidsByPort(3001, 'petri-server');
}

async function main() {
  // Auto-clear any Petri dev process from a previous session that still owns
  // the dev ports, then verify the renderer port is actually free. Doing both
  // means a hot-reload dev loop can re-run `npm run dev` without first having
  // to manually `lsof -ti :3000 | xargs kill`.
  await stopWorkspaceDevProcesses();
  if (await urlIsAvailable(rendererUrl)) {
    // A foreign server (not Petri) is holding the port — refuse rather than
    // kill something we don't own.
    throw new Error(
      `${rendererUrl} is already serving a page by a non-Petri process. ` +
        `Stop it manually before running npm run dev again.`
    );
  }

  spawnChild(npmCmd, ['--prefix', 'frontend', 'run', 'dev']);
  await waitForUrl(rendererUrl);

  // petri-server (and later Electron) both need the same DB. env-coordinator
  // pins the main-process DB to <PETRI_LOCAL_DATA_DIR>/petri.db（上面已导出为
  // electronLocalDataDir）。镜像同一路径，petri-server 与迁移子进程打开同一个
  // 已迁移库，而不是各自回落（core/petri-server/petri.db 或 macOS 时代的
  // ~/Library/Application Support/petri-local/petri.db —— 后者在本机会把
  // 后端指到另一个空库，与主进程分裂）。
  process.env.PETRI_DB_PATH = path.join(electronLocalDataDir, 'petri.db');

  // 全新克隆首个 dev boot 的目录自举：迁移与 petri-server 在此之前打开
  // PETRI_DB_PATH，但此前 mkdir 只存在于 darwin 启动分支（449 行）——旧工作区
  // 目录早已存在掩盖了这一点（2026-09-25 全新克隆冷启动测试抓真：
  // migration failed: Cannot open database because the directory does not exist）。
  // recursive 建两层，用户自定义 PETRI_ELECTRON_USER_DATA_DIR 同样受益。
  fs.mkdirSync(electronUserDataDir, { recursive: true });
  fs.mkdirSync(electronLocalDataDir, { recursive: true });

  // Run pending DB migrations against the shared DB before petri-server starts.
  // Uses the same PETRI_BETTER_SQLITE3_ROOT root as main.js:367 so the
  // better-sqlite3 native addon ABI matches.
  const migrationEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PETRI_BETTER_SQLITE3_ROOT: path.join(projectRoot, 'core/petri-server') };
  const migrationResult = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'src', 'migration-runner.js'), process.env.PETRI_DB_PATH, path.join(projectRoot, 'src', 'migrations')],
    { cwd: projectRoot, encoding: 'utf8', env: migrationEnv },
  );
  if (migrationResult.error) throw migrationResult.error;
  if (migrationResult.status !== 0) {
    throw new Error((migrationResult.stderr || migrationResult.stdout || 'migration child failed').trim());
  }
  const migrationOutput = String(migrationResult.stdout || '').trim();
  if (migrationOutput) console.log('[dev-electron] ' + migrationOutput.replace(/\n/g, '\n[dev-electron] '));

  // Start petri-server on :3001 so /api/ai/chat (and other /api/* routes used by
  // the renderer) are reachable from the dev shell. Without this the copilot
  // context-budget ring (UI-190) and other live SSE features stay empty.
  spawnChild(npmCmd, ['--prefix', 'core/petri-server', 'start'], { env: { ...process.env } });
  await waitForUrl('http://127.0.0.1:3001/api/health');

  // Optional extra Electron CLI args for local debugging, e.g.
  //   PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev
  // Empty by default so normal dev runs are unchanged.
  const extraElectronArgs = (process.env.PETRI_DEV_ELECTRON_ARGS || '')
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
    // BLOCK-45：持久化本次启动记录 —— 下次 boot 的清理只认这条记录指向的
    // 实例（token 定向），并存实例不再被无差别击杀。
    writeLaunchRecord(electronUserDataDir, {
      token: launchToken,
      wrapperPid: process.pid,
      startedAt: new Date().toISOString(),
    });
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
      `PETRI_RENDERER_DEV_URL=${rendererUrl}`,
      '--env',
      `PETRI_ELECTRON_USER_DATA_DIR=${electronUserDataDir}`,
      '--env',
      `PETRI_LOCAL_DATA_DIR=${electronLocalDataDir}`,
    ];
    if (process.env.ELECTRON_DISABLE_SANDBOX) {
      openArgs.push('--env', `ELECTRON_DISABLE_SANDBOX=${process.env.ELECTRON_DISABLE_SANDBOX}`);
    }
    openArgs.push('--args', projectRoot, '--dev', `--petri-dev-launch-token=${launchToken}`, ...extraElectronArgs);
    spawnChild('/usr/bin/open', openArgs);
    await waitForWorkspaceElectron();
    console.log(`[dev] Electron started via LaunchServices; main log: ${electronLogPath}`);
    console.log(`[dev] Electron stderr: ${electronErrorLogPath}`);
  } else {
    // Ensure dev data directories exist (macOS does this above; Windows must match).
    fs.mkdirSync(electronUserDataDir, { recursive: true });
    fs.mkdirSync(electronLocalDataDir, { recursive: true });
      // Strip ELECTRON_RUN_AS_NODE before spawning the GUI. That var is set
      // only for the migration-runner child (run as plain Node); if it leaks
      // into the Electron main process, Electron degenerates into a plain Node
      // and require('electron').app becomes undefined — crashing main.js at
      // app.requestSingleInstanceLock(). (2026-09-02 launch fix.)
      const electronEnv = {
        ...process.env,
        ELECTRON_IS_DEV: '1',
        NODE_ENV: 'development',
        PETRI_RENDERER_DEV_URL: rendererUrl,
        PETRI_ELECTRON_USER_DATA_DIR: electronUserDataDir,
        PETRI_LOCAL_DATA_DIR: electronLocalDataDir,
      };
      delete electronEnv.ELECTRON_RUN_AS_NODE;
      spawnChild(npxCmd, ['electron', '.', '--dev', ...extraElectronArgs], {
        shutdownOnExit: 'always',
        env: electronEnv,
        // C-35 — Electron 在 window 创建前崩掉时给出可执行诊断（而不是静默收栈）。
        exitHint:
          `[dev] Electron exited with code {code} before showing a window.\n` +
          '[dev] On Windows this is usually a local security product blocking the Chromium\n' +
          '[dev] sandbox (e.g. 360安全卫士 / 火绒), not an app bug.\n' +
          '[dev] Check:  npx electron --version      (if that also dies, the sandbox is blocked)\n' +
          '[dev] Temp:   PETRI_DEV_ELECTRON_ARGS="--no-sandbox" npm run dev   （降级：渲染进程失去沙箱）',
      });
  }
}

main().catch((error) => {
  console.error('[dev] failed:', error.message);
  shutdown(1);
});
