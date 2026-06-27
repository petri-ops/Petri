/**
 * Plugin Manager — 桌面版插件下载/安装/卸载/更新
 *
 * 每个插件是一个 zip，包含：
 *   plugin.json          — 插件清单（language/packages/platform/...）
 *   tool-definition.json — 工具定义（_data.ts 里的对象）
 *   scripts/             — R/Python 脚本
 *   packages/            — 预编译语言包
 *   demo-data/           — Demo 数据（可选）
 *
 * 安装流程：下载 → SHA256 校验 → 解压 → 版本校验 → 安装包 → 注册 → 记录
 * 卸载流程：删除专属包 → 删除脚本/数据 → 注销 → 记录
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

// ── 路径 ───────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(app.getPath('documents'), 'BioF3-Local');
const PLUGINS_DIR = path.join(USER_DATA_DIR, 'plugins');
const INSTALLED_FILE = path.join(PLUGINS_DIR, 'installed.json');
const RESOURCES_PATH = process.resourcesPath || path.join(__dirname, '..', 'resources');

// 远程 manifest URL（插件商店清单）
const MANIFEST_URL =
  process.env.BIOF3_PLUGIN_MANIFEST_URL ||
  'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/manifest.json';

// ── 已装插件清单 ───────────────────────────────────────────────

function getInstalledPlugins() {
  try {
    return JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveInstalledPlugins(list) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.writeFileSync(INSTALLED_FILE, JSON.stringify(list, null, 2));
}

function addInstalledPlugin(plugin) {
  const list = getInstalledPlugins();
  const idx = list.findIndex((p) => p.id === plugin.id);
  if (idx >= 0) list[idx] = plugin;
  else list.push(plugin);
  saveInstalledPlugins(list);
}

function removeInstalledPlugin(pluginId) {
  const list = getInstalledPlugins().filter((p) => p.id !== pluginId);
  saveInstalledPlugins(list);
}

// ── 远程 manifest ──────────────────────────────────────────────

async function getRemoteManifest() {
  return new Promise((resolve) => {
    let buf = '';
    const req = https.get(MANIFEST_URL, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve({ plugins: {} });
      }
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve({ plugins: {} });
        }
      });
    });
    req.on('error', () => resolve({ plugins: {} }));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {}
      resolve({ plugins: {} });
    });
  });
}

// ── 平台检测 ───────────────────────────────────────────────────

function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64';
  return `${platform}-${arch}`;
}

// ── 下载 ───────────────────────────────────────────────────────

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {}
        return reject(new Error(`下载失败: HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) {
          onProgress(received / total, received, total);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    });
    req.on('error', (e) => {
      file.close();
      try {
        fs.unlinkSync(destPath);
      } catch {}
      reject(e);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

// ── SHA256 校验 ────────────────────────────────────────────────

function verifyChecksum(filePath, expectedSha256) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      resolve(actual === expectedSha256);
    });
    stream.on('error', () => resolve(false));
  });
}

// ── 解压 zip ───────────────────────────────────────────────────
// 使用系统 unzip 命令（macOS/Linux 自带，Windows 需要内置 PowerShell 或 7z）

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const platform = process.platform;
    if (platform === 'win32') {
      // Windows: 用 PowerShell 的 Expand-Archive
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
        ],
        { timeout: 120000 },
        (err) => {
          if (err) reject(new Error('解压失败: ' + err.message));
          else resolve(destDir);
        }
      );
    } else {
      // macOS/Linux: 用系统 unzip
      execFile('unzip', ['-o', zipPath, '-d', destDir], { timeout: 120000 }, (err) => {
        if (err) reject(new Error('解压失败: ' + err.message));
        else resolve(destDir);
      });
    }
  });
}

// ── 安装插件 ───────────────────────────────────────────────────

async function installPlugin(pluginId, onProgress) {
  const platform = detectPlatform();
  const manifest = await getRemoteManifest();
  const plugin = manifest.plugins && manifest.plugins[pluginId];

  if (!plugin) throw new Error(`插件 ${pluginId} 不存在`);
  if (!plugin.platform || !plugin.platform.includes(platform)) {
    throw new Error(`插件不支持当前平台 ${platform}`);
  }

  // 1. 下载
  const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  console.log(`[plugin] downloading ${pluginId} from ${plugin.url}`);
  await downloadFile(plugin.url, zipPath, onProgress);

  // 2. 校验
  if (plugin.checksum) {
    const ok = await verifyChecksum(zipPath, plugin.checksum);
    if (!ok) {
      try {
        fs.unlinkSync(zipPath);
      } catch {}
      throw new Error('校验失败，文件可能损坏');
    }
  }

  // 3. 解压
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
  await extractZip(zipPath, pluginDir);

  // 4. 读取 plugin.json
  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('plugin.json 不存在');
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // 5. 校验 Runtime 版本
  const language = meta.language;
  if (meta.runtime && meta.runtime[language]) {
    const { getExecutor } = require(path.join(RESOURCES_PATH, 'shared-backend', 'executors'));
    const executor = getExecutor(language);
    if (!executor.checkRuntimeVersion(meta.runtime[language])) {
      throw new Error(`需要 ${language} >= ${meta.runtime[language]}，当前版本不满足`);
    }
  }

  // 6. 安装语言包
  const pkgDir = path.join(pluginDir, 'packages', language);
  if (fs.existsSync(pkgDir)) {
    const { getExecutor } = require(path.join(RESOURCES_PATH, 'shared-backend', 'executors'));
    const executor = getExecutor(language);
    executor.installPackages(pkgDir);
    console.log(`[plugin] packages installed for ${pluginId}`);
  }

  // 7. 校验关键包可加载
  if (meta.packages && meta.packages[language]) {
    const { getExecutor } = require(path.join(RESOURCES_PATH, 'shared-backend', 'executors'));
    const executor = getExecutor(language);
    for (const pkgName of Object.keys(meta.packages[language])) {
      if (!executor.checkPackageInstalled(pkgName)) {
        console.warn(`[plugin] 包 ${pkgName} 安装后检查失败（可能需要重启）`);
      }
    }
  }

  // 8. 注册插件到 r-server
  registerPluginInServer(pluginDir, meta);

  // 9. 记录已装
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    language,
  });

  // 10. 清理 zip
  try {
    fs.unlinkSync(zipPath);
  } catch {}

  console.log(`[plugin] installed: ${pluginId} v${plugin.version}`);
}

// ── 注册插件到 r-server ────────────────────────────────────────

function registerPluginInServer(pluginDir, meta) {
  try {
    // 通过 globalThis 桥注册（r-server 的 plugin-loader 会读取）
    if (!globalThis._biof3Plugins) globalThis._biof3Plugins = new Map();
    globalThis._biof3Plugins.set(meta.id, {
      ...meta,
      pluginDir,
      scriptPath: path.join(pluginDir, 'scripts'),
    });
    console.log(`[plugin] registered in server: ${meta.id}`);
  } catch (e) {
    console.warn(`[plugin] register failed: ${e.message}`);
  }
}

// ── 卸载插件 ───────────────────────────────────────────────────

async function uninstallPlugin(pluginId) {
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  if (!fs.existsSync(pluginDir)) {
    throw new Error(`插件 ${pluginId} 未安装`);
  }

  // 读取 plugin.json 获取包列表
  const metaPath = path.join(pluginDir, 'plugin.json');
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {}

  // 删除专属包（不删共享包）
  const language = meta.language;
  if (meta.packages && meta.packages[language]) {
    const { getExecutor } = require(path.join(RESOURCES_PATH, 'shared-backend', 'executors'));
    const executor = getExecutor(language);
    for (const pkgName of Object.keys(meta.packages[language])) {
      removePackage(executor, language, pkgName);
    }
  }

  // 删除插件目录
  fs.rmSync(pluginDir, { recursive: true, force: true });

  // 从服务器注销
  if (globalThis._biof3Plugins) {
    globalThis._biof3Plugins.delete(pluginId);
  }

  // 更新已装清单
  removeInstalledPlugin(pluginId);

  console.log(`[plugin] uninstalled: ${pluginId}`);
}

function removePackage(executor, language, pkgName) {
  try {
    const cfg = require(path.join(RESOURCES_PATH, `${language}-server`, 'config'));
    const libDir =
      language === 'r'
        ? path.join(cfg.rHome || '', 'library')
        : path.join(cfg.pyHome || '', 'site-packages');
    const pkgPath = path.join(libDir, pkgName);
    if (fs.existsSync(pkgPath)) {
      fs.rmSync(pkgPath, { recursive: true, force: true });
      console.log(`[plugin] removed package: ${pkgName}`);
    }
  } catch (e) {
    console.warn(`[plugin] remove package ${pkgName} failed: ${e.message}`);
  }
}

// ── 检查更新 ───────────────────────────────────────────────────

async function checkUpdates() {
  const installed = getInstalledPlugins();
  const manifest = await getRemoteManifest();
  const updates = [];

  for (const plug of installed) {
    const remote = manifest.plugins && manifest.plugins[plug.id];
    if (remote && compareVersions(remote.version, plug.version) > 0) {
      updates.push({
        id: plug.id,
        currentVersion: plug.version,
        latestVersion: remote.version,
        changelog: remote.changelog || '',
        size: remote.size || 0,
      });
    }
  }
  return updates;
}

// ── 加载所有已装插件（启动时调用）──────────────────────────────

async function loadAllPlugins() {
  const installed = getInstalledPlugins();
  for (const plug of installed) {
    const pluginDir = path.join(PLUGINS_DIR, plug.id);
    if (!fs.existsSync(pluginDir)) {
      console.warn(`[plugin] ${plug.id} directory missing, skipping`);
      continue;
    }
    const metaPath = path.join(pluginDir, 'plugin.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      registerPluginInServer(pluginDir, meta);
    } catch (e) {
      console.warn(`[plugin] load ${plug.id} failed: ${e.message}`);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────

function parseVersion(v) {
  return v.split('.').map((x) => parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

module.exports = {
  getInstalledPlugins,
  getRemoteManifest,
  installPlugin,
  uninstallPlugin,
  checkUpdates,
  loadAllPlugins,
  detectPlatform,
  PLUGINS_DIR,
};
