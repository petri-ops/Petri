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

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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

  rServerProc = spawn(
    process.execPath.includes('Electron') ? 'node' : process.execPath,
    [rServerPath],
    {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  rServerProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`[r-server] ${text}`);
  });
  rServerProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`[r-server] ${text}`);
  });
  rServerProc.on('exit', (code) => {
    console.log(`[desktop] r-server exited: ${code}`);
    rServerProc = null;
  });

  console.log('[desktop] r-server spawned (pid=' + rServerProc.pid + ') on :3001');
}

// ── 启动 py-server（子进程 spawn）──────────────────────────────
let pyServerProc = null;
function startPyServer() {
  // Runtime 未安装时跳过启动（不崩溃，前端会提示安装）
  if (!process.env.BIOF3_PY_HOME || !fs.existsSync(process.env.BIOF3_PY_HOME)) {
    console.warn('[desktop] py-server skipped — Python runtime not installed');
    return;
  }

  const pyServerPath = resolveResource('py-server', 'server.js');
  if (!fs.existsSync(pyServerPath)) {
    console.error('[desktop] py-server not found:', pyServerPath);
    return;
  }

  pyServerProc = spawn('node', [pyServerPath], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pyServerProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`[py-server] ${text}`);
  });
  pyServerProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`[py-server] ${text}`);
  });
  pyServerProc.on('exit', (code) => {
    console.log(`[desktop] py-server exited: ${code}`);
    pyServerProc = null;
  });

  console.log('[desktop] py-server spawned (pid=' + pyServerProc.pid + ') on :3004');
}

// ── 启动 R plumber replot 服务（spawn 子进程）──────────────────
let plumberProc = null;
function startPlumber() {
  const rBin = path.join(process.env.BIOF3_R_HOME, 'bin', 'Rscript');

  if (!fs.existsSync(rBin)) {
    console.warn('[desktop] Rscript not found, plumber skipped:', rBin);
    return;
  }

  // plumber 脚本路径（r-server 里有 replot 服务脚本）
  const plumberScript = resolveResource('r-server', 'replot.R');
  if (!fs.existsSync(plumberScript)) {
    console.warn('[desktop] plumber script not found, replot disabled');
    return;
  }

  plumberProc = spawn(rBin, [plumberScript, '--port', '8787'], {
    env: { ...process.env, R_HOME: process.env.BIOF3_R_HOME },
    stdio: 'pipe',
  });
  plumberProc.stdout.on('data', (d) => console.log('[plumber]', d.toString().trim()));
  plumberProc.stderr.on('data', (d) => console.error('[plumber]', d.toString().trim()));
  plumberProc.on('exit', (code) => console.log('[desktop] plumber exited:', code));

  console.log('[desktop] plumber started on :8787');
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
  const buildDir = resolveResource('build');
  const sitePath = path.join(buildDir, 'index.html');

  // 启动本地静态文件服务器（Docusaurus 的 baseUrl=/BioF3/ 需要 HTTP 协议）
  const staticServerUrl = 'http://localhost:3002/BioF3/';
  try {
    const { startStaticServer } = require('./static-server');
    startStaticServer(buildDir);
  } catch (e) {
    console.warn('[desktop] static server failed:', e.message);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BioF3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载本地静态站（通过 HTTP 服务器，解决 baseUrl=/BioF3/ 路径问题）
  if (fs.existsSync(sitePath)) {
    mainWindow.loadURL(staticServerUrl);
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

  // 拦截主窗口导航：只允许在 static-server 范围内跳转，防止意外导航到
  // 外部 URL 或 file:// 导致白屏/弹窗
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = staticServerUrl.replace(/\/$/, '');
    if (!url.startsWith(allowed) && !url.startsWith('http://localhost:3000')) {
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

// ── 应用生命周期 ───────────────────────────────────────────────
async function main() {
  setupDesktopEnv();

  // 1. 启动后端服务
  await startRServer();
  await startPyServer();
  startPlumber();

  // 2. 加载已安装插件
  await loadInstalledPlugins();

  // 3. 内容增量同步（后台）
  startContentSync();

  // 4. 设置 IPC
  setupAiSettingsIpc();
  setupPluginIpc();
  setupRuntimeIpc();
  setupFileDialogIpc();

  // 5. 创建窗口
  createWindow();
}

app.whenReady().then(main);

app.on('window-all-closed', () => {
  // 清理所有子进程
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
