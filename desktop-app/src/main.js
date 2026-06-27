/**
 * Electron 主进程入口 — BioF3 本地桌面版
 *
 * 职责：
 * 1. 设置桌面版环境变量（BIOF3_EXEC_MODE=local 等）
 * 2. 启动 r-server + py-server（同进程 require，不 spawn）
 * 3. 启动 R plumber replot 服务（spawn 子进程）
 * 4. 加载已安装插件
 * 5. 内容增量同步（后台）
 * 6. 创建 webview 窗口加载内嵌静态站
 * 7. 外部链接走系统浏览器
 */

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ── 环境变量（桌面版模式）──────────────────────────────────────
function setupDesktopEnv() {
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');

  process.env.BIOF3_EXEC_MODE = 'local';
  process.env.BIOF3_STORAGE = 'local';
  process.env.BIOF3_LOCAL_MODE = '1';
  process.env.BIOF3_DESKTOP = '1';
  process.env.BIOF3_R_HOME = path.join(resourcesPath, 'R');
  process.env.BIOF3_PY_HOME = path.join(resourcesPath, 'Python');
  process.env.BIOF3_SITE_DIR = path.join(resourcesPath, 'site');

  // 用户数据目录
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
    path.join(userDataDir, 'logs'),
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  // 端口（避免和 web 版开发端口冲突）
  process.env.R_SERVER_PORT = '3001';
  process.env.PY_SERVER_PORT = '3004';
}

// ── 启动 r-server（同进程 require）──────────────────────────────
let rServerStarted = false;
async function startRServer() {
  try {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');
    const rServerPath = path.join(resourcesPath, 'r-server', 'server.js');
    if (!fs.existsSync(rServerPath)) {
      console.error('[desktop] r-server not found:', rServerPath);
      return;
    }
    // require r-server（它自己启动 Express）
    require(rServerPath);
    rServerStarted = true;
    console.log('[desktop] r-server started on :3001');
  } catch (e) {
    console.error('[desktop] r-server start failed:', e.message);
  }
}

// ── 启动 py-server（同进程 require）─────────────────────────────
let pyServerStarted = false;
async function startPyServer() {
  try {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');
    const pyServerPath = path.join(resourcesPath, 'py-server', 'server.js');
    if (!fs.existsSync(pyServerPath)) {
      console.error('[desktop] py-server not found:', pyServerPath);
      return;
    }
    require(pyServerPath);
    pyServerStarted = true;
    console.log('[desktop] py-server started on :3004');
  } catch (e) {
    console.error('[desktop] py-server start failed:', e.message);
  }
}

// ── 启动 R plumber replot 服务（spawn 子进程）──────────────────
let plumberProc = null;
function startPlumber() {
  const { spawn } = require('child_process');
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');
  const rBin = path.join(process.env.BIOF3_R_HOME, 'bin', 'Rscript');

  if (!fs.existsSync(rBin)) {
    console.warn('[desktop] Rscript not found, plumber skipped:', rBin);
    return;
  }

  // plumber 脚本路径（r-server 里有 replot 服务脚本）
  const plumberScript = path.join(resourcesPath, 'r-server', 'replot.R');
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
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');
  const sitePath = path.join(resourcesPath, 'site', 'index.html');

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

  // 加载本地静态站
  if (fs.existsSync(sitePath)) {
    mainWindow.loadFile(sitePath);
  } else {
    // 开发模式：加载 Docusaurus dev server
    mainWindow.loadURL('http://localhost:3000');
  }

  // 外部链接走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 开发模式打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC：AI 设置 ───────────────────────────────────────────────
function setupAiSettingsIpc() {
  ipcMain.handle('ai-settings:get', async () => {
    try {
      const { getAiSettings } = require(
        path.join(
          process.resourcesPath || path.join(__dirname, '..', 'resources'),
          'r-server',
          'helpers',
          'ai-settings.js'
        )
      );
      return getAiSettings();
    } catch (e) {
      return {};
    }
  });

  ipcMain.handle('ai-settings:save', async (event, settings) => {
    try {
      const { saveAiSettings } = require(
        path.join(
          process.resourcesPath || path.join(__dirname, '..', 'resources'),
          'r-server',
          'helpers',
          'ai-settings.js'
        )
      );
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai-settings:test', async (event, provider, apiKey) => {
    try {
      const { testApiKey } = require(
        path.join(
          process.resourcesPath || path.join(__dirname, '..', 'resources'),
          'r-server',
          'helpers',
          'ai-settings.js'
        )
      );
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
      await installPlugin(pluginId);
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

  // 5. 创建窗口
  createWindow();
}

app.whenReady().then(main);

app.on('window-all-closed', () => {
  // 清理 plumber 进程
  if (plumberProc) {
    try {
      plumberProc.kill();
    } catch {}
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
  if (plumberProc) {
    try {
      plumberProc.kill();
    } catch {}
  }
});
