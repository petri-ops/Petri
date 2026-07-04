/**
 * Electron 主进程入口 — BioF3 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版环境变量（BIOF3_EXEC_MODE=local 等）
 * 2. 启动 r-server + py-server（子进程 spawn，避免原生模块 V8 版本冲突）
 * 3. 启动 R plumber replot 服务（spawn 子进程）
 * 4. 加载已安装插件
 * 5. 内容增量同步（后台）
 * 6. 创建 webview 窗口加载内嵌静态站
 * 7. 外部链接走系统浏览器
 */

const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ── 自动更新（electron-updater）─────────────────────────────
// 打包模式下加载 electron-updater；开发模式下跳过（npm start 无打包元数据）
let autoUpdater = null;
if (!process.env.ELECTRON_IS_DEV && app.isPackaged) {
  try {
    autoUpdater = require('electron-updater');
    if (autoUpdater.autoUpdater) autoUpdater = autoUpdater.autoUpdater;
  } catch (e) {
    console.warn('[desktop] electron-updater not installed — auto-update disabled');
  }
}

// ── 日志收集（诊断包用）──────────────────────────────────────
// 子进程 stdout/stderr 同时写入 logs/ 下的滚动日志文件
const _logStreams = {}; // { r-server: WriteStream, py-server: WriteStream, main: WriteStream }

function _getLogDir() {
  const dir = process.env.BIOF3_LOCAL_DATA_DIR
    ? path.join(process.env.BIOF3_LOCAL_DATA_DIR, 'logs')
    : path.join(app.getPath('documents'), 'BioF3-Local', 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function _createLogStream(name) {
  const dir = _getLogDir();
  const file = path.join(dir, `${name}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  _logStreams[name] = stream;
  // 写入分隔线标记新会话
  stream.write(`\n=== ${new Date().toISOString()} — session start ===\n`);
  return stream;
}

function _writeLog(name, text) {
  const stream = _logStreams[name];
  if (stream) {
    try {
      stream.write(text + '\n');
    } catch {}
  }
}

// ── 路径解析（开发模式 vs 打包模式）────────────────────────────
// 开发模式（npm start）：r-server/py-server/shared-backend 在项目根目录
// 打包模式（.exe/.dmg）：在 process.resourcesPath 下
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const IS_DEV = !app.isPackaged;

function resolveResource(...parts) {
  if (IS_DEV) {
    return path.join(PROJECT_ROOT, ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
}

// ── 解析用来跑 r-server/py-server 的 node 可执行文件 ────────────
// 开发模式：用系统 node（如 v23），避免 Electron 内置 node（v20/131）
// 与 better-sqlite3（按系统 node 编译，137）版本不匹配导致崩溃。
// PATH 查找不可靠（Electron 子进程 PATH 不含用户自定义 node 路径），
// 所以用 execFileSync('which node') 拿绝对路径。
// 打包模式：用 Electron 自带 node（better-sqlite3 在打包时按 Electron node 重编译）。
function resolveNodeBin() {
  if (!IS_DEV) return process.execPath;
  try {
    const { execFileSync } = require('child_process');
    const bin = execFileSync('which', ['node'], { encoding: 'utf-8', timeout: 3000 }).trim();
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* fallback */
  }
  return 'node'; // 兜底走 PATH（可能命中 Electron node，但至少不崩 spawn）
}
const NODE_BIN = resolveNodeBin();

// ── 系统检测：开发模式下找系统安装的 R / Python ────────────────
function _detectSystemR() {
  const { execFileSync } = require('child_process');
  try {
    const rHome = execFileSync('Rscript', ['-e', 'cat(R.home())'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (rHome && fs.existsSync(rHome)) return rHome;
  } catch {}
  // macOS 常见路径
  const macPaths = ['/Library/Frameworks/R.framework/Resources', '/usr/local/lib/R'];
  for (const p of macPaths) {
    if (fs.existsSync(path.join(p, 'bin', 'Rscript'))) return p;
  }
  return null;
}

function _detectSystemPython() {
  const { execFileSync } = require('child_process');
  try {
    const pyHome = execFileSync('python3', ['-c', 'import sys; print(sys.prefix)'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (pyHome && fs.existsSync(path.join(pyHome, 'bin', 'python3'))) return pyHome;
  } catch {}
  return null;
}

// ── 环境变量（桌面版模式）──────────────────────────────────────

// Runtime 解析两级优先：
//   1. 用户安装的独立 Runtime（~/Documents/BioF3-Local/runtimes/{R|Python}）— 最高优先
//   2. 开发模式：检测系统 R/Python（仅 dev，打包模式不检测，保持独立）
//   3. 都没有 → 返回 null，R/Python 功能不可用，提示从插件商店安装
function resolveRuntime(lang, userDataDir) {
  const runtimeName = lang === 'r' ? 'R' : 'Python';
  const binName = lang === 'r' ? 'Rscript' : 'python3';

  // 1. 用户安装的独立 Runtime
  const userRuntime = path.join(userDataDir, 'runtimes', runtimeName);
  if (fs.existsSync(path.join(userRuntime, 'bin', binName))) {
    return userRuntime;
  }

  // 2. 开发模式：检测系统 R/Python（仅 dev，打包模式不检测，保持独立）
  if (IS_DEV) {
    if (lang === 'r') {
      const sysR = _detectSystemR();
      if (sysR) return sysR;
    } else {
      const sysPy = _detectSystemPython();
      if (sysPy) return sysPy;
    }
  }

  return null;
}

function setupDesktopEnv() {
  process.env.BIOF3_EXEC_MODE = 'local';
  process.env.BIOF3_STORAGE = 'local';
  process.env.BIOF3_LOCAL_MODE = '1';
  process.env.BIOF3_DESKTOP = '1';
  process.env.BIOF3_SITE_DIR = resolveResource('build');

  // 用户数据目录（先确定，resolveRuntime 要用）
  const userDataDir = path.join(app.getPath('documents'), 'BioF3-Local');
  process.env.BIOF3_LOCAL_DATA_DIR = userDataDir;
  process.env.BIOF3_LOCAL_RESULTS_DIR = path.join(userDataDir, 'results');
  process.env.BIOF3_LOCAL_UPLOADS_DIR = path.join(userDataDir, 'uploads');
  process.env.BIOF3_TEMP_DIR = path.join(userDataDir, 'tmp');
  process.env.BIOF3_PY_TEMP_DIR = path.join(userDataDir, 'tmp', 'py');
  process.env.BIOF3_DB_PATH = path.join(userDataDir, 'biof3.db');

  // 确保目录存在
  for (const dir of [
    userDataDir,
    process.env.BIOF3_LOCAL_RESULTS_DIR,
    process.env.BIOF3_LOCAL_UPLOADS_DIR,
    process.env.BIOF3_TEMP_DIR,
    process.env.BIOF3_PY_TEMP_DIR,
    path.join(userDataDir, 'plugins'),
    path.join(userDataDir, 'runtimes'),
    path.join(userDataDir, 'logs'),
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  // R/Python Runtime 解析（三级优先）
  const rHome = resolveRuntime('r', userDataDir);
  if (rHome) {
    process.env.BIOF3_R_HOME = rHome;
    console.log('[desktop] R runtime:', rHome);
  } else {
    console.warn('[desktop] R runtime not installed — install "R 运行时" from plugin store');
  }

  const pyHome = resolveRuntime('python', userDataDir);
  if (pyHome) {
    process.env.BIOF3_PY_HOME = pyHome;
    console.log('[desktop] Python runtime:', pyHome);
  } else {
    console.warn(
      '[desktop] Python runtime not installed — install "Python 运行时" from plugin store'
    );
  }

  // 端口（避免和 web 版开发端口冲突）
  process.env.R_SERVER_PORT = '3001';
  process.env.PY_SERVER_PORT = '3004';
}

// ── 启动 r-server（子进程 spawn，避免原生模块 V8 版本冲突）─────
let rServerProc = null;
function startRServer() {
  // Runtime 未安装时跳过启动（不崩溃，前端会提示安装）
  if (!process.env.BIOF3_R_HOME || !fs.existsSync(process.env.BIOF3_R_HOME)) {
    console.warn('[desktop] r-server skipped — R runtime not installed');
    return;
  }

  const rServerPath = resolveResource('r-server', 'server.js');
  if (!fs.existsSync(rServerPath)) {
    console.error('[desktop] r-server not found:', rServerPath);
    return;
  }

  rServerProc = spawn(NODE_BIN, [rServerPath], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _createLogStream('r-server');
  rServerProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) {
      console.log(`[r-server] ${text}`);
      _writeLog('r-server', `[r-server] ${text}`);
    }
  });
  rServerProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) {
      console.error(`[r-server] ${text}`);
      _writeLog('r-server', `[r-server:ERR] ${text}`);
    }
  });
  rServerProc.on('exit', (code) => {
    console.log(`[desktop] r-server exited: ${code}`);
    rServerProc = null;
  });

  console.log('[desktop] r-server spawned (pid=' + rServerProc.pid + ') on :3001');
}

// ── 启动 py-server（子进程 spawn，按需启停）──────────────────
// M2-7：py-server 改为 lazy——仅在用 Python 工具时通过 IPC py:start 启动，
// 5 分钟无调用自动 stop，释放内存（idle 超时）。
let pyServerProc = null;
let pyIdleTimer = null;
const PY_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无调用自动停

function _clearPyIdleTimer() {
  if (pyIdleTimer) {
    clearTimeout(pyIdleTimer);
    pyIdleTimer = null;
  }
}

function _resetPyIdleTimer() {
  _clearPyIdleTimer();
  pyIdleTimer = setTimeout(() => {
    console.log('[desktop] py-server idle timeout (5min), stopping');
    stopPyServer('idle-timeout');
  }, PY_IDLE_TIMEOUT_MS);
}

/**
 * 启动 py-server（若已运行则不重复 spawn）。
 * @param {string} reason - 调用来源（'ipc' / 'manual' 等，仅日志）
 * @returns {{ ok: boolean, alreadyRunning?: boolean, error?: string, pid?: number }}
 */
function startPyServer(reason = 'ipc') {
  // 已在运行 — 重置 idle 计时并返回
  if (pyServerProc && !pyServerProc.killed) {
    _resetPyIdleTimer();
    return { ok: true, alreadyRunning: true, pid: pyServerProc.pid };
  }

  // Runtime 未安装时跳过启动（不崩溃，前端会提示安装）
  if (!process.env.BIOF3_PY_HOME || !fs.existsSync(process.env.BIOF3_PY_HOME)) {
    console.warn('[desktop] py-server skipped — Python runtime not installed');
    return { ok: false, error: 'Python runtime not installed' };
  }

  const pyServerPath = resolveResource('py-server', 'server.js');
  if (!fs.existsSync(pyServerPath)) {
    console.error('[desktop] py-server not found:', pyServerPath);
    return { ok: false, error: 'py-server script not found' };
  }

  try {
    pyServerProc = spawn(NODE_BIN, [pyServerPath], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('[desktop] py-server spawn failed:', e.message);
    pyServerProc = null;
    return { ok: false, error: e.message };
  }

  _createLogStream('py-server');
  pyServerProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) {
      console.log(`[py-server] ${text}`);
      _writeLog('py-server', `[py-server] ${text}`);
    }
  });
  pyServerProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) {
      console.error(`[py-server] ${text}`);
      _writeLog('py-server', `[py-server:ERR] ${text}`);
    }
  });
  pyServerProc.on('exit', (code) => {
    console.log(`[desktop] py-server exited: ${code}`);
    pyServerProc = null;
    _clearPyIdleTimer();
  });

  _resetPyIdleTimer();
  console.log(`[desktop] py-server spawned (pid=${pyServerProc.pid}) on :3004 — reason=${reason}`);
  return { ok: true, pid: pyServerProc.pid };
}

/**
 * 停止 py-server（kill 子进程，清 idle 计时）。
 * @param {string} reason - 调用来源（'ipc' / 'idle-timeout' / 'shutdown' 等）
 * @returns {{ ok: boolean, wasRunning?: boolean }}
 */
function stopPyServer(reason = 'ipc') {
  _clearPyIdleTimer();
  if (!pyServerProc || pyServerProc.killed) {
    pyServerProc = null;
    return { ok: true, wasRunning: false };
  }
  try {
    pyServerProc.kill();
    console.log(`[desktop] py-server stopped — reason=${reason}`);
  } catch (e) {
    console.error('[desktop] py-server stop failed:', e.message);
  }
  // 注意：exit handler 会把 pyServerProc 置 null，这里不重复清
  return { ok: true, wasRunning: true };
}

// ── 启动 R plumber replot 服务（按需启停）──────────────────────
// M2-7：plumber 改为 lazy——仅在 figcode 重绘时通过 IPC plumber:start 启动。
let plumberProc = null;
let plumberIdleTimer = null;
const PLUMBER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无调用自动停

function _clearPlumberIdleTimer() {
  if (plumberIdleTimer) {
    clearTimeout(plumberIdleTimer);
    plumberIdleTimer = null;
  }
}

function _resetPlumberIdleTimer() {
  _clearPlumberIdleTimer();
  plumberIdleTimer = setTimeout(() => {
    console.log('[desktop] plumber idle timeout (5min), stopping');
    stopPlumber('idle-timeout');
  }, PLUMBER_IDLE_TIMEOUT_MS);
}

/**
 * 启动 plumber（若已运行则不重复 spawn）。
 * @param {string} reason - 调用来源（仅日志）
 * @returns {{ ok: boolean, alreadyRunning?: boolean, error?: string, pid?: number }}
 */
function startPlumber(reason = 'ipc') {
  if (plumberProc && !plumberProc.killed) {
    _resetPlumberIdleTimer();
    return { ok: true, alreadyRunning: true, pid: plumberProc.pid };
  }

  if (!process.env.BIOF3_R_HOME || !fs.existsSync(process.env.BIOF3_R_HOME)) {
    console.warn('[desktop] plumber skipped — R runtime not installed');
    return { ok: false, error: 'R runtime not installed' };
  }

  const rBin = path.join(process.env.BIOF3_R_HOME, 'bin', 'Rscript');
  if (!fs.existsSync(rBin)) {
    console.warn('[desktop] Rscript not found, plumber skipped:', rBin);
    return { ok: false, error: 'Rscript not found' };
  }

  // plumber 脚本路径（r-server 里有 replot 服务脚本）
  const plumberScript = resolveResource('r-server', 'replot.R');
  if (!fs.existsSync(plumberScript)) {
    console.warn('[desktop] plumber script not found, replot disabled');
    return { ok: false, error: 'plumber script not found' };
  }

  try {
    plumberProc = spawn(rBin, [plumberScript, '--port', '8787'], {
      env: { ...process.env, R_HOME: process.env.BIOF3_R_HOME },
      stdio: 'pipe',
    });
  } catch (e) {
    console.error('[desktop] plumber spawn failed:', e.message);
    plumberProc = null;
    return { ok: false, error: e.message };
  }

  plumberProc.stdout.on('data', (d) => console.log('[plumber]', d.toString().trim()));
  plumberProc.stderr.on('data', (d) => console.error('[plumber]', d.toString().trim()));
  plumberProc.on('exit', (code) => {
    console.log(`[desktop] plumber exited: ${code}`);
    plumberProc = null;
    _clearPlumberIdleTimer();
  });

  _resetPlumberIdleTimer();
  console.log(`[desktop] plumber started on :8787 — reason=${reason}`);
  return { ok: true, pid: plumberProc.pid };
}

/**
 * 停止 plumber。
 * @param {string} reason - 调用来源
 * @returns {{ ok: boolean, wasRunning?: boolean }}
 */
function stopPlumber(reason = 'ipc') {
  _clearPlumberIdleTimer();
  if (!plumberProc || plumberProc.killed) {
    plumberProc = null;
    return { ok: true, wasRunning: false };
  }
  try {
    plumberProc.kill();
    console.log(`[desktop] plumber stopped — reason=${reason}`);
  } catch (e) {
    console.error('[desktop] plumber stop failed:', e.message);
  }
  return { ok: true, wasRunning: true };
}

// ── 加载已安装插件 ─────────────────────────────────────────────
async function loadInstalledPlugins() {
  try {
    const { loadAllPlugins } = require('./plugin-manager');
    await loadAllPlugins();
    console.log('[desktop] plugins loaded');
  } catch (e) {
    console.warn('[desktop] plugin load failed:', e.message);
  }
}

// ── 内容增量同步（后台，不阻塞启动）────────────────────────────
function startContentSync() {
  try {
    const { syncContent } = require('./content-sync');
    // 启动后 5 秒开始首次同步
    setTimeout(() => {
      syncContent().catch((e) => console.warn('[desktop] content sync failed:', e.message));
    }, 5000);
    // 每 4 小时同步一次
    setInterval(
      () => {
        syncContent().catch((e) => console.warn('[desktop] content sync failed:', e.message));
      },
      4 * 60 * 60 * 1000
    );
  } catch (e) {
    console.warn('[desktop] content sync module not available:', e.message);
  }
}

// ── 主窗口 ─────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  // 阶段 3（desktop-spa）：主窗口加载 Vite SPA build 产物
  // Vite SPA 在 frontend/dist，base './'，无 baseUrl 前缀
  const spaBuildDir = resolveResource('desktop-app', 'frontend', 'dist');
  const spaIndexPath = path.join(spaBuildDir, 'index.html');
  const spaServerUrl = 'http://localhost:3002/';

  // Docusaurus build 产物（docs/blog iframe 过渡用）
  const docusaurusBuildDir = resolveResource('build');
  const docusaurusServerUrl = 'http://localhost:3003/BioF3/';

  // 启动 Vite SPA 静态服务器（:3002，无 baseUrl 前缀，SPA fallback）
  try {
    const { startStaticServer } = require('./static-server');
    startStaticServer(spaBuildDir, {
      port: 3002,
      baseUrl: '/',
      label: 'spa-server',
      spaFallback: true,
    });
  } catch (e) {
    console.warn('[desktop] SPA static server failed:', e.message);
  }

  // 启动 Docusaurus 静态服务器（:3003，baseUrl=/BioF3/，供 docs/blog iframe）
  if (fs.existsSync(docusaurusBuildDir)) {
    try {
      const { startStaticServer } = require('./static-server');
      startStaticServer(docusaurusBuildDir, {
        port: 3003,
        baseUrl: '/BioF3/',
        label: 'docs-server',
        spaFallback: true,
      });
    } catch (e) {
      console.warn('[desktop] docs static server failed:', e.message);
    }
  }

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    title: 'BioF3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载 Vite SPA（优先）；不存在则回退 Docusaurus build；再否则 dev server
  if (fs.existsSync(spaIndexPath)) {
    mainWindow.loadURL(spaServerUrl);
  } else if (fs.existsSync(path.join(docusaurusBuildDir, 'index.html'))) {
    // 兼容：SPA 未构建时回退 Docusaurus build
    mainWindow.loadURL(docusaurusServerUrl);
  } else {
    // 开发模式：加载 Docusaurus dev server
    mainWindow.loadURL('http://localhost:3000');
  }

  // 外部链接走系统浏览器；所有 window.open 一律 deny，避免 Electron 创建
  // 新原生窗口（非 http URL 用 allow 会导致弹窗风暴：新窗口不继承 handler，
  // 加载失败后 SPA fallback 又加载完整应用，级联弹窗直到卡死）。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    // 非 http URL（相对路径、blob:、about:blank 等）全部 deny
    return { action: 'deny' };
  });

  // 拦截主窗口导航：只允许在本地服务器范围内跳转，防止意外导航到
  // 外部 URL 或 file:// 导致白屏/弹窗
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = ['http://localhost:3002', 'http://localhost:3003', 'http://localhost:3000'];
    if (!allowed.some((a) => url.startsWith(a))) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  // 开发模式打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 捕获渲染进程 console 消息（调试用）
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[renderer:${tag}] ${message}`);
  });

  // 捕获页面加载失败
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] load failed: ${errorCode} ${errorDescription} url=${validatedURL}`);
  });

  // 页面加载完成
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[renderer] page loaded');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC：AI 设置 ───────────────────────────────────────────────
function setupAiSettingsIpc() {
  ipcMain.handle('ai-settings:get', async () => {
    try {
      const { getAiSettings } = require(resolveResource('r-server', 'helpers', 'ai-settings.js'));
      return getAiSettings();
    } catch (e) {
      return {};
    }
  });

  ipcMain.handle('ai-settings:save', async (event, settings) => {
    try {
      const { saveAiSettings } = require(resolveResource('r-server', 'helpers', 'ai-settings.js'));
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai-settings:test', async (event, provider, apiKey) => {
    try {
      const { testApiKey } = require(resolveResource('r-server', 'helpers', 'ai-settings.js'));
      return await testApiKey(provider, apiKey);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
}

// ── IPC：M2-3 可选错误遥测（V3）─────────────────────────────────
// 默认关闭；用户在设置页主动开启后才会上报。payload 仅含 category/version/摘要。
function setupTelemetryIpc() {
  ipcMain.handle('telemetry:report', async (_event, payload) => {
    try {
      const { reportError } = require('./telemetry');
      return await reportError(payload);
    } catch (e) {
      // 遥测自身异常绝不能影响业务——静默
      return { ok: false, reason: 'internal' };
    }
  });
}

// ── IPC：插件管理 ──────────────────────────────────────────────
function setupPluginIpc() {
  ipcMain.handle('plugin:list-installed', async () => {
    try {
      const { getInstalledPlugins } = require('./plugin-manager');
      return getInstalledPlugins();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('plugin:list-remote', async () => {
    try {
      const { getRemoteManifest } = require('./plugin-manager');
      return await getRemoteManifest();
    } catch (e) {
      return { plugins: {} };
    }
  });

  ipcMain.handle('plugin:install', async (event, pluginId) => {
    try {
      const { installPlugin } = require('./plugin-manager');
      // 下载进度通过 event.sender.send 实时推给渲染进程
      const onProgress = (ratio, received, total) => {
        try {
          event.sender.send('plugin:install-progress', { pluginId, ratio, received, total });
        } catch {}
      };
      await installPlugin(pluginId, onProgress);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plugin:uninstall', async (event, pluginId) => {
    try {
      const { uninstallPlugin } = require('./plugin-manager');
      await uninstallPlugin(pluginId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plugin:check-updates', async () => {
    try {
      const { checkUpdates } = require('./plugin-manager');
      return await checkUpdates();
    } catch (e) {
      return [];
    }
  });

  // ── M2-9：content-plugin 文档桥 ──────────────────────────────
  // docs.tsx 运行时通过这些 IPC 拉取已装 content-plugin 的文档树与正文
  ipcMain.handle('content-plugin:list', async () => {
    try {
      const { listAllContentPlugins } = require('./plugin-manager');
      return listAllContentPlugins();
    } catch (e) {
      console.warn('[desktop] content-plugin:list failed:', e.message);
      return [];
    }
  });

  ipcMain.handle('content-plugin:list-docs', async (_event, pluginId) => {
    try {
      const { listContentPluginDocs } = require('./plugin-manager');
      return listContentPluginDocs(pluginId);
    } catch (e) {
      console.warn('[desktop] content-plugin:list-docs failed:', e.message);
      return [];
    }
  });

  ipcMain.handle('content-plugin:read', async (_event, pluginId, relativePath) => {
    try {
      const { readContentPluginDoc } = require('./plugin-manager');
      return { ok: true, content: readContentPluginDoc(pluginId, relativePath) };
    } catch (e) {
      console.warn('[desktop] content-plugin:read failed:', e.message);
      return { ok: false, error: e.message };
    }
  });
}

// ── M1-2：CSP 加固 ─────────────────────────────────────────────
// 禁用 unsafe-eval，限制资源来源。connect-src 放开 localhost:* 覆盖
// r-server(3001)/py-server(3004)/plumber(8787)/dev server(3000)/SSE。
// frame-src 放开 localhost:* 供 figcode iframe 用。
// 不回退 unsafe-eval——Vite 生产构建已无 eval 需求。
function setupCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: http://localhost:* ; " +
            "connect-src 'self' http://localhost:* ws://localhost:* ; " +
            "frame-src 'self' http://localhost:* ; " +
            "font-src 'self' data: ; " +
            "worker-src 'self' blob: ; " +
            "object-src 'none';",
        ],
      },
    });
  });
  console.log('[desktop] CSP hardened (unsafe-eval disabled)');
}

// ── IPC：Runtime 状态查询 ──────────────────────────────────────
function setupRuntimeIpc() {
  ipcMain.handle('runtime:status', async () => {
    try {
      const { getRuntimeStatus } = require('./plugin-manager');
      return getRuntimeStatus();
    } catch (e) {
      return { r: { installed: false }, python: { installed: false } };
    }
  });

  // M1-1：后端就绪感知层——聚合 runtime:status + health 探测 + 子进程存活
  // 渲染进程通过 window.biof3Desktop.backend.status() 调用，5s 轮询
  ipcMain.handle('backend:status', async () => {
    try {
      const { getRuntimeStatus } = require('./plugin-manager');
      const { getBackendStatus } = require('./backend-health');
      return await getBackendStatus({
        runtimeStatus: getRuntimeStatus(),
        procs: { rServer: rServerProc, pyServer: pyServerProc, plumber: plumberProc },
      });
    } catch (e) {
      return { isReady: false, downReason: '状态查询失败: ' + e.message };
    }
  });
}

// ── IPC：M2-7 按需启停 py-server / plumber ──────────────────────
// 前端在用 Python 工具前调 biof3Desktop.py.start()，用完调 .stop()；
// plumber 在 figcode 重绘前调 .start()。未调用时 5min idle 自动 stop。
function setupBackendLifecycleIpc() {
  ipcMain.handle('py:start', async () => {
    try {
      return startPyServer('ipc');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('py:stop', async () => {
    try {
      return stopPyServer('ipc');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plumber:start', async () => {
    try {
      return startPlumber('ipc');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('plumber:stop', async () => {
    try {
      return stopPlumber('ipc');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：FigCode 包检测 ───────────────────────────────────────
// 检查一张卡片的依赖包是否已安装（通过已装 figcode-card 插件或基础 runtime 覆盖）
// 返回 missing 包列表 + 对应的 figcode-card 插件推荐
function setupFigcodeIpc() {
  ipcMain.handle('figcode:check-packages', async (event, { language, packages, cardId }) => {
    try {
      if (!Array.isArray(packages) || packages.length === 0) {
        return { ok: true, missing: [], missingPlugins: [], cardInstalled: true };
      }

      const { getInstalledPlugins, getRemoteManifest } = require('./plugin-manager');
      const installed = getInstalledPlugins();
      const remote = await getRemoteManifest().catch(() => ({ plugins: {} }));
      const allPlugins = remote.plugins || {};

      // 收集已装 figcode-card / figcode-data 插件提供的包
      const installedFigcode = installed.filter((p) => {
        const meta = allPlugins[p.id];
        return meta && (meta.type === 'figcode-card' || meta.type === 'figcode-data');
      });

      const providedPackages = new Set();
      for (const plug of installedFigcode) {
        const meta = allPlugins[plug.id];
        if (!meta) continue;
        const pkgList = meta.packages?.[language] || [];
        for (const pkg of pkgList) providedPackages.add(pkg);
      }

      // 基础 runtime 自带的包
      const baseR = new Set([
        'ggplot2',
        'dplyr',
        'tidyr',
        'reshape2',
        'data.table',
        'pheatmap',
        'ggrepel',
        'RColorBrewer',
        'patchwork',
        'cowplot',
        'plotly',
        'igraph',
        'ggraph',
        'tidygraph',
        'circlize',
        'ComplexHeatmap',
        'UpSetR',
        'ggalluvial',
        'treemap',
        'networkD3',
        'Seurat',
        'SingleCellExperiment',
        'MOFA2',
        'CellChat',
        'WGCNA',
        'maftools',
        'clusterProfiler',
        'enrichplot',
        'DOSE',
        'org.Hs.eg.db',
        'survival',
        'survminer',
        'rms',
        'pROC',
        'glmnet',
        'caret',
        'timeROC',
        'PRROC',
        'dcurves',
        'scatterpie',
        'Rtsne',
        'STRINGdb',
        'gganimate',
      ]);
      const basePy = new Set([
        'matplotlib',
        'numpy',
        'pandas',
        'scanpy',
        'anndata',
        'scikit-learn',
        'seaborn',
        'scipy',
      ]);
      const baseSet = language === 'python' ? basePy : baseR;

      // 检查每个包
      const missing = [];
      for (const pkg of packages) {
        if (!providedPackages.has(pkg) && !baseSet.has(pkg)) {
          missing.push(pkg);
        }
      }

      // 检查这张卡片对应的插件是否已安装
      const cardPluginId = cardId ? 'figcode-' + cardId : null;
      const cardInManifest = cardPluginId && allPlugins[cardPluginId];
      // 卡片已安装 = 插件已装 OR 卡片不在 manifest 中（只用基础包，不需要插件）
      // OR 卡片在 manifest 中但所有包都在基础 runtime 中（edge case）
      const cardInstalled = cardPluginId
        ? installed.some((i) => i.id === cardPluginId) || !cardInManifest
        : true;

      // 找出哪些 figcode-card / figcode-data 插件能补齐 missing
      const missingPlugins = [];
      if (missing.length > 0 || !cardInstalled) {
        for (const [pid, meta] of Object.entries(allPlugins)) {
          if (meta.type !== 'figcode-card' && meta.type !== 'figcode-data') continue;
          if (meta.language !== language) continue;

          // 如果是按 cardId 精确匹配
          if (cardId && meta.figcodeCardId === cardId) {
            const alreadyInstalled = installed.some((i) => i.id === pid);
            if (!alreadyInstalled) {
              missingPlugins.push({
                id: pid,
                title: meta.title,
                description: meta.description,
                size: meta.size,
                type: meta.type,
                dependencies: meta.dependencies || [],
              });
            }
            continue;
          }

          // 按 package 覆盖匹配（fallback）
          const pkgList = meta.packages?.[language] || [];
          const provides = new Set(pkgList);
          const covers = missing.some((p) => provides.has(p));
          const alreadyInstalled = installed.some((i) => i.id === pid);
          if (covers && !alreadyInstalled) {
            missingPlugins.push({
              id: pid,
              title: meta.title,
              description: meta.description,
              size: meta.size,
              type: meta.type,
              dependencies: meta.dependencies || [],
            });
          }
        }
      }

      // 检查依赖的数据包是否也安装了
      const allMissingIds = new Set(missingPlugins.map((p) => p.id));
      for (const plug of missingPlugins) {
        for (const depId of plug.dependencies || []) {
          if (!installed.some((i) => i.id === depId) && !allMissingIds.has(depId)) {
            const depMeta = allPlugins[depId];
            if (depMeta) {
              missingPlugins.push({
                id: depId,
                title: depMeta.title,
                description: depMeta.description,
                size: depMeta.size,
                type: depMeta.type,
              });
              allMissingIds.add(depId);
            }
          }
        }
      }

      return { ok: true, missing, missingPlugins, cardInstalled };
    } catch (e) {
      console.error('[figcode] check-packages error:', e.message);
      return { ok: false, error: e.message, missing: [], missingPlugins: [], cardInstalled: false };
    }
  });

  // 查询所有 figcode-card 插件的安装状态（供前端灰显用）
  ipcMain.handle('figcode:card-status', async (event, cardIds) => {
    try {
      if (!Array.isArray(cardIds)) return { ok: true, statuses: {} };

      const { getInstalledPlugins, getRemoteManifest } = require('./plugin-manager');
      const installed = getInstalledPlugins();
      const remote = await getRemoteManifest().catch(() => ({ plugins: {} }));
      const allPlugins = remote.plugins || {};

      // 已装插件 ID 集合
      const installedIds = new Set(installed.map((p) => p.id));

      // 基础 runtime 包集合
      const baseR = new Set([
        'ggplot2',
        'dplyr',
        'tidyr',
        'reshape2',
        'data.table',
        'pheatmap',
        'ggrepel',
        'RColorBrewer',
        'patchwork',
        'cowplot',
        'plotly',
        'igraph',
        'ggraph',
        'tidygraph',
        'circlize',
        'ComplexHeatmap',
        'UpSetR',
        'ggalluvial',
        'treemap',
        'networkD3',
        'Seurat',
        'SingleCellExperiment',
        'MOFA2',
        'CellChat',
        'WGCNA',
        'maftools',
        'clusterProfiler',
        'enrichplot',
        'DOSE',
        'org.Hs.eg.db',
        'survival',
        'survminer',
        'rms',
        'pROC',
        'glmnet',
        'caret',
        'timeROC',
        'PRROC',
        'dcurves',
        'scatterpie',
        'Rtsne',
        'STRINGdb',
        'gganimate',
      ]);
      const basePy = new Set([
        'matplotlib',
        'numpy',
        'pandas',
        'scanpy',
        'anndata',
        'scikit-learn',
        'seaborn',
        'scipy',
      ]);

      const statuses = {};
      for (const cardId of cardIds) {
        const pluginId = 'figcode-' + cardId;
        const meta = allPlugins[pluginId];

        if (!meta) {
          // 不在 manifest 中 = 只用基础包 = 总是可用
          statuses[cardId] = { installed: true, needsPlugin: false };
          continue;
        }

        const isInstalled = installedIds.has(pluginId);
        if (isInstalled) {
          statuses[cardId] = { installed: true, needsPlugin: true, pluginId };
        } else {
          // 检查依赖的数据包
          const deps = meta.dependencies || [];
          const missingDeps = deps.filter((d) => !installedIds.has(d));
          statuses[cardId] = {
            installed: false,
            needsPlugin: true,
            pluginId,
            title: meta.title,
            size: meta.size,
            language: meta.language,
            missingDeps,
          };
        }
      }

      return { ok: true, statuses };
    } catch (e) {
      console.error('[figcode] card-status error:', e.message);
      return { ok: false, error: e.message, statuses: {} };
    }
  });
}

// ── IPC：自动更新（electron-updater）──────────────────────────
function setupAutoUpdateIpc() {
  if (!autoUpdater) {
    // 打包时未安装 electron-updater：所有 IPC 返回 disabled
    ipcMain.handle('updater:check', async () => ({ ok: false, error: 'auto-update disabled' }));
    ipcMain.handle('updater:download', async () => ({ ok: false, error: 'auto-update disabled' }));
    ipcMain.handle('updater:install', async () => ({ ok: false, error: 'auto-update disabled' }));
    return;
  }

  autoUpdater.autoDownload = false; // 手动控制下载（用户点"下载"才下）
  autoUpdater.autoInstallOnAppQuit = true;

  let _updateInfo = null;

  autoUpdater.on('update-available', (info) => {
    _updateInfo = info;
    if (mainWindow)
      mainWindow.webContents.send('updater:update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('updater:update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow)
      mainWindow.webContents.send('updater:download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('updater:update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
    if (mainWindow) mainWindow.webContents.send('updater:error', err.message);
  });

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, hasUpdate: !!_updateInfo, info: _updateInfo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('updater:install', async () => {
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：文件对话框（preload 暴露的 files.saveDialog/openDialog）─────────
function setupFileDialogIpc() {
  ipcMain.handle('file:save-dialog', async (event, defaultName) => {
    if (!mainWindow) return null;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
      });
      return canceled ? null : filePath;
    } catch (e) {
      console.error('[desktop] save dialog failed:', e.message);
      return null;
    }
  });

  ipcMain.handle('file:open-dialog', async (event, filters) => {
    if (!mainWindow) return null;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        filters: Array.isArray(filters) ? filters : [],
        properties: ['openFile'],
      });
      return canceled ? null : filePaths[0];
    } catch (e) {
      console.error('[desktop] open dialog failed:', e.message);
      return null;
    }
  });
}

// ── IPC：诊断日志导出 / 数据备份（M2-8）─────────────────────────
function setupDiagnosticIpc() {
  // 导出包：收集 r-server/py-server/main 日志 + 系统信息 + 整个数据目录
  // （db + results + uploads），打包成 zip 供用户备份。
  ipcMain.handle('diagnostic:export', async (event, targetPath) => {
    try {
      const logDir = _getLogDir();
      const { createWriteStream } = fs;
      const zlib = require('zlib');

      // M2-8 备份/导出闭环：默认保存对话框提示用户选导出路径
      let outPath = targetPath;
      if (!outPath && mainWindow) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
          title: '导出我的数据',
          defaultPath: `biof3-backup-${ts}.zip`,
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (canceled) return { ok: false, error: 'cancelled' };
        outPath = filePath;
      }
      if (!outPath) return { ok: false, error: 'no output path' };

      // M2-8：数据目录（db + results + uploads）
      const dataDir =
        process.env.BIOF3_LOCAL_DATA_DIR || path.join(app.getPath('documents'), 'BioF3-Local');

      // 先 flush 日志流
      for (const s of Object.values(_logStreams)) {
        try {
          s.write('');
        } catch {}
      }

      // 收集系统信息
      const sysInfo = {
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        timestamp: new Date().toISOString(),
        rHome: process.env.BIOF3_R_HOME || '(not set)',
        pyHome: process.env.BIOF3_PY_HOME || '(not set)',
        dataDir: process.env.BIOF3_LOCAL_DATA_DIR || '(not set)',
      };

      // 用简单的方式打包：逐文件写入 zip（避免额外依赖）
      // 如果有 archiver 就用，没有就用 tar.gz
      let usedArchiver = false;
      try {
        const archiver = require('archiver');
        const output = createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', () => {});
        archive.pipe(output);

        // 添加日志文件
        for (const name of ['r-server', 'py-server']) {
          const logFile = path.join(logDir, `${name}.log`);
          if (fs.existsSync(logFile)) {
            archive.file(logFile, { name: `${name}.log` });
          }
        }
        // 添加系统信息
        archive.append(JSON.stringify(sysInfo, null, 2), { name: 'system-info.json' });
        // 添加 installed plugins
        try {
          const { getInstalledPlugins } = require('./plugin-manager');
          archive.append(JSON.stringify(getInstalledPlugins(), null, 2), {
            name: 'installed-plugins.json',
          });
        } catch {}

        // M2-8 备份/导出闭环：打包整个数据目录（db + results + uploads）
        // 跳过 tmp 目录避免打包临时文件
        if (fs.existsSync(dataDir)) {
          try {
            for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
              if (entry.name === 'tmp') continue; // 临时目录不打包
              const full = path.join(dataDir, entry.name);
              if (entry.isDirectory()) {
                archive.directory(full, entry.name);
              } else if (entry.isFile()) {
                archive.file(full, { name: entry.name });
              }
            }
          } catch (e) {
            console.warn('[diagnostic] add data dir failed:', e.message);
          }
        }

        await archive.finalize();
        usedArchiver = true;
      } catch {
        // archiver 不可用 — 用 tar.gz fallback
      }

      if (!usedArchiver) {
        // fallback: 写一个简单的 .txt 包（日志拼接 + 系统信息）
        const lines = [];
        lines.push('=== BioF3 Diagnostic Package ===');
        lines.push(JSON.stringify(sysInfo, null, 2));
        lines.push('');
        for (const name of ['r-server', 'py-server']) {
          const logFile = path.join(logDir, `${name}.log`);
          lines.push(`\n=== ${name}.log ===`);
          try {
            lines.push(fs.readFileSync(logFile, 'utf8').slice(-5000)); // 最后 5000 字符
          } catch {
            lines.push('(log file not found)');
          }
        }
        try {
          const { getInstalledPlugins } = require('./plugin-manager');
          lines.push('\n=== installed-plugins.json ===');
          lines.push(JSON.stringify(getInstalledPlugins(), null, 2));
        } catch {}
        lines.push('\n=== data-dir note ===');
        lines.push(`数据目录位于 ${dataDir}（archiver 不可用，未打包；请手动复制该目录进行备份）`);
        fs.writeFileSync(outPath, lines.join('\n'));
      }

      return { ok: true, path: outPath };
    } catch (e) {
      console.error('[diagnostic] export failed:', e.message);
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC：数据目录管理（卸载数据保留）──────────────────────────
// 用户可能在操作系统卸载应用后仍想保留 ~/Documents/BioF3-Local/ 数据，
// 或主动清理。这里提供查看数据目录大小 + 在文件管理器中打开的能力。
function setupDataManagementIpc() {
  // 递归计算目录大小（字节）
  function getDirSize(dir) {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const walk = (d) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isSymbolicLink()) continue; // 跳过符号链接避免循环
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            try {
              total += fs.statSync(full).size;
            } catch {}
          }
        }
      } catch {}
    };
    walk(dir);
    return total;
  }

  // 返回数据目录路径 + 各子目录大小（runtimes / plugins / results / uploads / logs / db）
  ipcMain.handle('data:info', async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: '数据目录未配置' };
      const breakdown = {};
      const subdirs = ['runtimes', 'plugins', 'results', 'uploads', 'logs', 'tmp'];
      for (const sub of subdirs) {
        const subPath = path.join(dataDir, sub);
        if (fs.existsSync(subPath)) breakdown[sub] = getDirSize(subPath);
      }
      // biof3.db 单独算
      const dbPath = path.join(dataDir, 'biof3.db');
      if (fs.existsSync(dbPath)) {
        try {
          breakdown['biof3.db'] = fs.statSync(dbPath).size;
        } catch {}
      }
      // ai-settings.json 等
      const aiPath = path.join(dataDir, 'ai-settings.json');
      if (fs.existsSync(aiPath)) {
        try {
          breakdown['ai-settings.json'] = fs.statSync(aiPath).size;
        } catch {}
      }
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return { ok: true, dataDir, total, breakdown };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 在系统文件管理器中打开数据目录
  ipcMain.handle('data:open-dir', async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: '数据目录未配置' };
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      await shell.openPath(dataDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  setupDesktopEnv();

  // M1-4 (H3)：启动 r-server 前跑 db migration，防升级 schema 错乱
  try {
    const { runMigrations, getAppliedVersion } = require('./migration-runner');
    const migDir = path.join(__dirname, 'migrations');
    const dbPath = process.env.BIOF3_DB_PATH;
    if (dbPath) {
      // 确保 db 目录存在
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const ver = await runMigrations(dbPath, migDir);
      console.log('[desktop] migrations applied, version =', ver);
    }
  } catch (e) {
    console.error('[desktop] migration failed:', e.message);
    // 不阻断启动——r-server 的 initSchema() 仍会兜底建表
  }

  // 1. 启动后端服务
  // M2-7：r-server 是硬底座常驻；py-server / plumber 改为 lazy 按需启停
  // （通过 IPC py:start / plumber:start 触发，5min idle 自动 stop）
  await startRServer();
  // startPyServer / startPlumber 不在启动时调用 — 由前端按需触发

  // 2. 加载已安装插件
  await loadInstalledPlugins();

  // 3. 内容增量同步（后台）
  startContentSync();

  // 4. 设置 IPC
  setupAiSettingsIpc();
  setupPluginIpc();
  setupRuntimeIpc();
  setupBackendLifecycleIpc();
  setupFileDialogIpc();
  setupAutoUpdateIpc();
  setupDiagnosticIpc();
  setupFigcodeIpc();
  setupDataManagementIpc();
  setupTelemetryIpc();

  // 5. 创建窗口
  // M1-2：CSP 加固——禁用 unsafe-eval，限制资源来源到 self + localhost（后端/SSE/dev server）
  setupCsp();

  // 6. 创建窗口
  createWindow();
}

app.whenReady().then(main);

app.on('window-all-closed', () => {
  // 清理 idle 计时 + 所有子进程（M2-7：py/plumber 按需起的也要 stop）
  _clearPyIdleTimer();
  _clearPlumberIdleTimer();
  for (const proc of [rServerProc, pyServerProc, plumberProc]) {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  for (const proc of [rServerProc, pyServerProc, plumberProc]) {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }
});
