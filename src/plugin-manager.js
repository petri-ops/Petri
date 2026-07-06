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

// 注册 R/Python 执行器（plugin-manager 在 Electron 主进程跑，不经过 r-server
// 的 init 流程，必须自己调 initSharedBackend 注册执行器，否则 getExecutor 抛
// "未注册执行器" 导致 runtime 校验/装包静默失败）
//
// 路径解析策略（desktop 仓分仓后，断点5）：
//   - core 仓作为 git submodule 在 vendor/biof3-core/
//   - 开发模式 (app.isPackaged=false): shared-backend 在 vendor/biof3-core/shared-backend
//     __dirname = .../src/ → ../vendor/biof3-core/shared-backend
//   - 打包模式 (app.isPackaged=true): core 在 extraResources/core 下
//     process.resourcesPath = .../BioF3.app/Contents/Resources/
function resolveSharedBackendDir() {
  // 开发模式：从 src/ 向上一级到 desktop 仓根，再进 vendor/biof3-core/shared-backend
  if (app && !app.isPackaged) {
    const devPath = path.resolve(__dirname, '..', 'vendor', 'biof3-core', 'shared-backend');
    if (fs.existsSync(devPath)) return devPath;
  }
  // 打包模式：core 在 extraResources/core 下
  if (process.resourcesPath) {
    const pkgPath = path.join(process.resourcesPath, 'core', 'shared-backend');
    if (fs.existsSync(pkgPath)) return pkgPath;
  }
  // 兜底：回退到开发模式路径（即使 fs.existsSync 失败，让 require 抛错更明确）
  return path.resolve(__dirname, '..', 'vendor', 'biof3-core', 'shared-backend');
}

const SHARED_BACKEND_DIR = resolveSharedBackendDir();

// core 仓根（r-server/py-server/shared-backend 平级目录所在）：
// 开发模式 = desktop 仓根/vendor/biof3-core；打包模式 = resourcesPath/core
function resolveProjectRoot() {
  if (app && app.isPackaged && process.resourcesPath) return path.join(process.resourcesPath, 'core');
  return path.resolve(__dirname, '..', 'vendor', 'biof3-core');
}
const PROJECT_ROOT = resolveProjectRoot();
try {
  require(path.join(SHARED_BACKEND_DIR, 'init')).initSharedBackend();
} catch (e) {
  console.warn('[plugin] initSharedBackend failed:', e.message, '| path:', SHARED_BACKEND_DIR);
}

// 断点1（分仓前置）：注入 config 让执行器/storage 读到真 config（不走 env fallback）。
// plugin-manager 在 Electron 主进程跑，调执行器做 runtime 校验/装包，需要正确 execMode/rHome。
// ai-usage 桌面版主进程不写库，不注入（helper no-op）。
try {
  require(SHARED_BACKEND_DIR).configure({
    getConfig: () => require(path.join(PROJECT_ROOT, 'r-server', 'config')),
  });
} catch (e) {
  console.warn('[plugin] shared-backend configure failed:', e.message);
}

// ── 路径 ───────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(app.getPath('documents'), 'BioF3-Local');
const PLUGINS_DIR = path.join(USER_DATA_DIR, 'plugins');
const RUNTIMES_DIR = path.join(USER_DATA_DIR, 'runtimes');
const INSTALLED_FILE = path.join(PLUGINS_DIR, 'installed.json');
// 开发模式：desktop-app/resources/；打包模式：process.resourcesPath
const RESOURCES_PATH =
  app && app.isPackaged && process.resourcesPath
    ? process.resourcesPath
    : path.join(__dirname, '..', 'resources');

// fix-r-paths.sh 路径（打包在 resources/scripts/ 下，开发模式在 scripts/ 下）
function getFixRPathsScript() {
  if (
    process.resourcesPath &&
    fs.existsSync(path.join(process.resourcesPath, 'scripts', 'fix-r-paths.sh'))
  ) {
    return path.join(process.resourcesPath, 'scripts', 'fix-r-paths.sh');
  }
  // 开发模式
  return path.join(__dirname, '..', 'scripts', 'fix-r-paths.sh');
}

// 内置插件目录（打包在 resources/built-in-plugins/）
const BUILT_IN_PLUGINS_DIR = path.join(RESOURCES_PATH, 'built-in-plugins');

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

// ── 远程 manifest（含本地内置 fallback）─────────────────────────

// 读取本地内置 manifest（打包在 resources/built-in-plugins/manifest.json）
function getBuiltInManifest() {
  try {
    const p = path.join(BUILT_IN_PLUGINS_DIR, 'manifest.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.warn('[plugin] built-in manifest read failed:', e.message);
  }
  return { plugins: {} };
}

// 合并远程 + 内置 manifest（内置插件标记 _builtIn: true）
async function getRemoteManifest() {
  const builtIn = getBuiltInManifest();
  const builtInPlugins = {};
  if (builtIn.plugins) {
    for (const [id, info] of Object.entries(builtIn.plugins)) {
      builtInPlugins[id] = { ...info, _builtIn: true };
    }
  }
  // 尝试远程
  const remote = await new Promise((resolve) => {
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
  // 合并：远程优先（同 id 时远程覆盖内置，便于未来推送更新）
  const merged = { plugins: { ...builtInPlugins, ...(remote.plugins || {}) } };
  return merged;
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
  // 兼容 "sha256:<hex>" 和纯 "<hex>" 两种格式
  const expected = String(expectedSha256)
    .replace(/^sha256:/i, '')
    .trim()
    .toLowerCase();
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actual = hash.digest('hex').toLowerCase();
      resolve(actual === expected);
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
        { timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
        (err) => {
          if (err) reject(new Error('解压失败: ' + err.message));
          else resolve(destDir);
        }
      );
    } else {
      // macOS/Linux: 用系统 unzip（-q 安静模式，避免大插件 stdout 撑爆默认 1MB maxBuffer）
      execFile(
        'unzip',
        ['-q', '-o', zipPath, '-d', destDir],
        { timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
        (err) => {
          if (err) reject(new Error('解压失败: ' + err.message));
          else resolve(destDir);
        }
      );
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

  // Runtime 类型走特殊安装路径（下载 → 解压到 runtimes/ → R 修路径 → 更新 env）
  if (plugin.type === 'runtime') {
    return installRuntime(pluginId, plugin, onProgress);
  }

  // FigCode 卡片/数据包类型：下载 → 解压 → 装包到 runtime library，不走工具注册
  if (plugin.type === 'figcode-card' || plugin.type === 'figcode-data') {
    return installFigcodePack(pluginId, plugin, onProgress);
  }

  // Content 插件类型：下载/解压 → 注册 docsDir → 不装包不走工具注册
  if (plugin.type === 'content-plugin') {
    return installContentPlugin(pluginId, plugin, onProgress);
  }

  const isBuiltIn = !!plugin._builtIn;
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  if (isBuiltIn) {
    // 内置插件：从 resources/built-in-plugins/{id} 复制（不下载）
    const srcDir = path.join(BUILT_IN_PLUGINS_DIR, pluginId);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`内置插件源目录不存在: ${srcDir}`);
    }
    console.log(`[plugin] copying built-in ${pluginId} from ${srcDir}`);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    copyDirSync(srcDir, pluginDir);
  } else {
    // 远程插件：下载 → 校验 → 解压
    const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
    console.log(`[plugin] downloading ${pluginId} from ${plugin.url}`);
    await downloadFile(plugin.url, zipPath, onProgress);

    if (plugin.checksum) {
      const ok = await verifyChecksum(zipPath, plugin.checksum);
      if (!ok) {
        try {
          fs.unlinkSync(zipPath);
        } catch {}
        throw new Error('校验失败，文件可能损坏');
      }
    }

    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    await extractZip(zipPath, pluginDir);
    try {
      fs.unlinkSync(zipPath);
    } catch {}

    // zip 内顶层目录通常是 <plugin-id>-plugin/，解压后会多套一层。
    // 检测单一嵌套子目录，把内容上提到 pluginDir 根。
    const entries = fs.readdirSync(pluginDir);
    if (
      entries.length === 1 &&
      fs.statSync(path.join(pluginDir, entries[0])).isDirectory() &&
      !fs.existsSync(path.join(pluginDir, 'plugin.json'))
    ) {
      const nested = path.join(pluginDir, entries[0]);
      const nestedEntries = fs.readdirSync(nested);
      for (const e of nestedEntries) {
        fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
      }
      fs.rmdirSync(nested);
      console.log(`[plugin] flattened nested dir: ${entries[0]}`);
    }
  }

  // 读取 plugin.json
  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('plugin.json 不存在: ' + metaPath);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  console.log(`[plugin] read plugin.json: id=${meta.id} lang=${meta.language}`);

  // 校验 Runtime 版本
  const language = meta.language;
  if (meta.runtime && meta.runtime[language]) {
    console.log(`[plugin] checking runtime ${language} >= ${meta.runtime[language]}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    if (!executor.checkRuntimeVersion(meta.runtime[language])) {
      throw new Error(`需要 ${language} >= ${meta.runtime[language]}，当前版本不满足`);
    }
    console.log(`[plugin] runtime OK`);
  }

  // 校验 builtAgainst：插件包给哪个 major.minor 编译的，必须与当前 Runtime 一致
  // （R 4.4 编译的包装到 R 4.5 会报 "package built under R 4.4"；Python C 扩展跨 minor ABI 不兼容）
  if (meta.builtAgainst && meta.builtAgainst[language]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    if (typeof executor.checkBuiltAgainst === 'function') {
      const req = meta.builtAgainst[language];
      console.log(`[plugin] checking builtAgainst ${language} = ${req}`);
      const result = executor.checkBuiltAgainst(req);
      if (!result.ok) {
        const langLabel = language === 'r' ? 'R' : 'Python';
        throw new Error(
          `插件需要 ${langLabel} ${req} 编译的包，当前是 ${langLabel} ${result.current}（major.minor 不匹配）。` +
            `请等插件更新，或安装匹配的 ${langLabel} ${req} Runtime。`
        );
      }
      console.log(`[plugin] builtAgainst OK (current ${result.current})`);
    }
  }

  // 安装语言包（内置插件通常不带 packages/，跳过）
  const pkgDir = path.join(pluginDir, 'packages', language);
  if (fs.existsSync(pkgDir)) {
    console.log(`[plugin] installing packages from ${pkgDir}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    executor.installPackages(pkgDir);
    console.log(`[plugin] packages installed for ${pluginId}`);
  } else {
    console.log(`[plugin] no packages dir at ${pkgDir}, skipping`);
  }

  // 校验关键包可加载
  if (meta.packages && meta.packages[language]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    for (const pkgName of Object.keys(meta.packages[language])) {
      if (!executor.checkPackageInstalled(pkgName)) {
        console.warn(`[plugin] 包 ${pkgName} 安装后检查失败（可能需要重启）`);
      }
    }
  }

  // 注册插件到 r-server
  registerPluginInServer(pluginDir, meta);

  // 记录已装
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    language,
    builtIn: isBuiltIn,
  });

  console.log(
    `[plugin] installed: ${pluginId} v${plugin.version}${isBuiltIn ? ' (built-in)' : ''}`
  );
}

// ── 安装 Content 插件（教程/文档）──────────────────────────────
// Content 插件安装路径：
//   1. 内置则从 resources/built-in-plugins/{id} 复制；远程则下载 zip 校验解压
//   2. 读取 plugin.json 校验 type === 'content-plugin' + contentType + omics
//   3. 注册 docsDir 到 globalThis._biof3ContentPlugins
//   4. 不装语言包、不走工具注册、不需要重启

async function installContentPlugin(pluginId, plugin, onProgress) {
  const platform = detectPlatform();
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  const isBuiltIn = !!plugin._builtIn;
  if (isBuiltIn) {
    const srcDir = path.join(BUILT_IN_PLUGINS_DIR, pluginId);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`内置插件源目录不存在: ${srcDir}`);
    }
    console.log(`[plugin] copying built-in content-plugin ${pluginId} from ${srcDir}`);
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    copyDirSync(srcDir, pluginDir);
  } else {
    const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
    console.log(`[plugin] downloading content-plugin ${pluginId} from ${plugin.url}`);
    await downloadFile(plugin.url, zipPath, onProgress);
    if (plugin.checksum) {
      const ok = await verifyChecksum(zipPath, plugin.checksum);
      if (!ok) {
        try {
          fs.unlinkSync(zipPath);
        } catch {}
        throw new Error('校验失败，文件可能损坏');
      }
    }
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    await extractZip(zipPath, pluginDir);
    try {
      fs.unlinkSync(zipPath);
    } catch {}
    // 展开嵌套顶层目录
    const entries = fs.readdirSync(pluginDir);
    if (
      entries.length === 1 &&
      fs.statSync(path.join(pluginDir, entries[0])).isDirectory() &&
      !fs.existsSync(path.join(pluginDir, 'plugin.json'))
    ) {
      const nested = path.join(pluginDir, entries[0]);
      for (const e of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
      }
      fs.rmdirSync(nested);
      console.log(`[plugin] flattened nested dir: ${entries[0]}`);
    }
  }

  // 读取 plugin.json
  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('plugin.json 不存在: ' + metaPath);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.type !== 'content-plugin') {
    throw new Error(`plugin.json type 不是 content-plugin: ${meta.type}`);
  }
  if (!meta.contentType || !meta.omics) {
    throw new Error('content-plugin manifest 必须包含 contentType 与 omics');
  }
  console.log(
    `[plugin] content-plugin meta: id=${meta.id} contentType=${meta.contentType} omics=${meta.omics}`
  );

  // 注册 docsDir 到全局桥
  registerContentPlugin(pluginDir, meta);

  // 记录已装
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    type: 'content-plugin',
    contentType: meta.contentType,
    omics: meta.omics,
    builtIn: isBuiltIn,
  });

  console.log(`[plugin] content-plugin installed: ${pluginId} v${plugin.version}`);
}

// ── 安装 Runtime（R/Python 基础运行时）──────────────────────────
// Runtime 赟特殊路径：
//   1. 下载 zip → 校验 → 解压到 runtimes/{R|Python}/
//   2. R 需要跑 fix-r-paths.sh 修 dylib 路径；Python 不需要
//   3. 更新 process.env 让当前 r-server/py-server 立即用上新 Runtime
//   4. 记录到 installed.json（type: 'runtime'）
//   5. 不走 registerPluginInServer（Runtime 不是工具插件）

async function installRuntime(pluginId, plugin, onProgress) {
  const lang = plugin.language; // 'r' or 'python'
  if (!lang) throw new Error('Runtime 插件缺少 language 字段');

  const runtimeName = lang === 'r' ? 'R' : 'Python';
  const runtimeDir = path.join(RUNTIMES_DIR, runtimeName);
  fs.mkdirSync(RUNTIMES_DIR, { recursive: true });

  // 下载 zip
  const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  console.log(`[plugin] downloading runtime ${pluginId} from ${plugin.url}`);
  await downloadFile(plugin.url, zipPath, onProgress);

  // SHA256 校验
  if (plugin.checksum) {
    const ok = await verifyChecksum(zipPath, plugin.checksum);
    if (!ok) {
      try {
        fs.unlinkSync(zipPath);
      } catch {}
      throw new Error('校验失败，文件可能损坏');
    }
  }

  // 清旧 Runtime
  if (fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  // 解压到 runtimes/{R|Python}/
  await extractZip(zipPath, runtimeDir);
  try {
    fs.unlinkSync(zipPath);
  } catch {}

  // 检测并展开嵌套顶层目录（zip 内可能套一层 R/ 或 Python/）
  const entries = fs.readdirSync(runtimeDir);
  if (
    entries.length === 1 &&
    fs.statSync(path.join(runtimeDir, entries[0])).isDirectory() &&
    !fs.existsSync(path.join(runtimeDir, 'bin'))
  ) {
    const nested = path.join(runtimeDir, entries[0]);
    const nestedEntries = fs.readdirSync(nested);
    for (const e of nestedEntries) {
      fs.renameSync(path.join(nested, e), path.join(runtimeDir, e));
    }
    fs.rmdirSync(nested);
    console.log(`[plugin] flattened nested runtime dir: ${entries[0]}`);
  }

  // R 需要修 dylib 路径
  if (lang === 'r') {
    const fixScript = getFixRPathsScript();
    if (!fs.existsSync(fixScript)) {
      console.warn('[plugin] fix-r-paths.sh not found, R may not start:', fixScript);
    } else {
      console.log('[plugin] running fix-r-paths.sh for R runtime...');
      await new Promise((resolve, reject) => {
        execFile(
          'bash',
          [fixScript, runtimeDir],
          {
            timeout: 120000,
            maxBuffer: 8 * 1024 * 1024,
          },
          (err, stdout, stderr) => {
            if (stdout) console.log(stdout.trim());
            if (stderr) console.error(stderr.trim());
            if (err) reject(new Error('R 路径修正失败: ' + err.message));
            else resolve();
          }
        );
      });
      console.log('[plugin] R runtime paths fixed');
    }
  }

  // 更新当前进程环境变量（让 r-server/py-server 立即用上新 Runtime）
  if (lang === 'r') {
    process.env.BIOF3_R_HOME = runtimeDir;
  } else {
    process.env.BIOF3_PY_HOME = runtimeDir;
  }

  // 记录到 installed.json
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform: detectPlatform(),
    language: lang,
    type: 'runtime',
  });

  console.log(`[plugin] runtime installed: ${pluginId} v${plugin.version} → ${runtimeDir}`);
  console.log('[plugin] ⚠️  restart app to activate new runtime');
}

// ── 安装 FigCode 卡片/数据包插件 ──────────────────────────────
// FigCode 卡片插件安装路径：
//   1. 下载 zip → 校验 → 解压到 plugins/{pluginId}/
//   2. 把 packages/{language}/ 下的预编译包复制到 runtime library
//      R: runtimes/R/library/  Python: runtimes/Python/site-packages/
//   3. 记录到 installed.json（type: 'figcode-card' 或 'figcode-data'）
//   4. 不走 registerPluginInServer（不是工具插件，不注册 tool-definition）
//   5. 不需要重启 — 包复制到 library 后立即可用

async function installFigcodePack(pluginId, plugin, onProgress) {
  const lang = plugin.language;
  if (!lang) throw new Error('FigCode 插件缺少 language 字段');

  const platform = detectPlatform();
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  // FigCode 扩展包总是从远程下载（包体积大，不内置在 app bundle 中）
  // manifest 中的 _builtIn 标记只让它在插件商店可见，实际包从 OSS 下载
  const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
  console.log(`[plugin] downloading figcode-pack ${pluginId} from ${plugin.url}`);
  await downloadFile(plugin.url, zipPath, onProgress);

  if (plugin.checksum) {
    const ok = await verifyChecksum(zipPath, plugin.checksum);
    if (!ok) {
      try {
        fs.unlinkSync(zipPath);
      } catch {}
      throw new Error('校验失败，文件可能损坏');
    }
  }

  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
  await extractZip(zipPath, pluginDir);
  try {
    fs.unlinkSync(zipPath);
  } catch {}

  // 展开嵌套顶层目录
  const entries = fs.readdirSync(pluginDir);
  if (
    entries.length === 1 &&
    fs.statSync(path.join(pluginDir, entries[0])).isDirectory() &&
    !fs.existsSync(path.join(pluginDir, 'plugin.json'))
  ) {
    const nested = path.join(pluginDir, entries[0]);
    const nestedEntries = fs.readdirSync(nested);
    for (const e of nestedEntries) {
      fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
    }
    fs.rmdirSync(nested);
    console.log(`[plugin] flattened nested dir: ${entries[0]}`);
  }

  // 读取 plugin.json
  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('plugin.json 不存在: ' + metaPath);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  console.log(`[plugin] read plugin.json: id=${meta.id} lang=${meta.language}`);

  // 把预编译包复制到 runtime library
  const pkgDir = path.join(pluginDir, 'packages', lang);
  if (fs.existsSync(pkgDir)) {
    console.log(`[plugin] installing figcode packages from ${pkgDir}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(lang);

    // R: 复制到 runtimes/R/library/  Python: 复制到 runtimes/Python/site-packages/
    let targetDir;
    if (lang === 'r') {
      targetDir = path.join(RUNTIMES_DIR, 'R', 'library');
    } else {
      targetDir = path.join(RUNTIMES_DIR, 'Python', 'site-packages');
    }

    executor.installPackages(pkgDir, targetDir);
    console.log(`[plugin] figcode packages installed → ${targetDir}`);
  } else {
    console.log(`[plugin] no packages dir at ${pkgDir}, skipping`);
  }

  // 校验关键包可加载
  if (meta.packages && meta.packages[lang]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(lang);
    const pkgList = Array.isArray(meta.packages[lang])
      ? meta.packages[lang]
      : Object.keys(meta.packages[lang]);
    for (const pkgName of pkgList) {
      if (!executor.checkPackageInstalled(pkgName)) {
        console.warn(`[plugin] 包 ${pkgName} 安装后检查失败（可能需要重启）`);
      }
    }
  }

  // 记录已装（type: 'figcode-pack'，不走 registerPluginInServer）
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    language: lang,
    type: 'figcode-pack',
  });

  console.log(`[plugin] figcode-pack installed: ${pluginId} v${plugin.version}`);
}

// ── Runtime 状态查询 ───────────────────────────────────────────

function getRuntimeStatus() {
  const rDir = path.join(RUNTIMES_DIR, 'R');
  const pyDir = path.join(RUNTIMES_DIR, 'Python');
  return {
    r: {
      installed: fs.existsSync(path.join(rDir, 'bin', 'Rscript')),
      path: fs.existsSync(rDir) ? rDir : null,
    },
    python: {
      installed: fs.existsSync(path.join(pyDir, 'bin', 'python3')),
      path: fs.existsSync(pyDir) ? pyDir : null,
    },
  };
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

// ── Content 插件注册 ───────────────────────────────────────────
// content-plugin 是教程/文档类插件，不走工具注册（r-server），而是
// 把 docsDir 路径挂到 globalThis._biof3ContentPlugins，供 docs.tsx 在
// 运行时通过 IPC 拉取 md 文本并 react-markdown 渲染。
//
// manifest 约定（plugin.json）：
//   {
//     "id": "single-cell-tutorial",
//     "type": "content-plugin",
//     "contentType": "tutorial",      // 'tutorial' | 'guide' | ...
//     "omics": "single-cell",         // 'single-cell' | 'rna-seq' | ...
//     "version": "1.0.0",
//     "docsDir": "docs",              // 插件内文档子目录（相对 pluginDir），默认 'docs'
//     "title": "单细胞教程"
//   }

function registerContentPlugin(pluginDir, meta) {
  try {
    if (!globalThis._biof3ContentPlugins) globalThis._biof3ContentPlugins = new Map();
    const docsDir = path.join(pluginDir, meta.docsDir || 'docs');
    globalThis._biof3ContentPlugins.set(meta.id, {
      id: meta.id,
      contentType: meta.contentType || 'tutorial',
      omics: meta.omics || 'general',
      version: meta.version,
      title: meta.title || meta.id,
      pluginDir,
      docsDir,
    });
    console.log(`[plugin] content-plugin registered: ${meta.id} → ${docsDir}`);
  } catch (e) {
    console.warn(`[plugin] content-plugin register failed: ${e.message}`);
  }
}

function unregisterContentPlugin(pluginId) {
  if (globalThis._biof3ContentPlugins) {
    globalThis._biof3ContentPlugins.delete(pluginId);
  }
}

// 列出某 content-plugin 的文档树（递归扫 docsDir 下的 .md/.mdx）
// 返回 [{ id, title, position, relativePath }]
function listContentPluginDocs(pluginId) {
  const entry = globalThis._biof3ContentPlugins && globalThis._biof3ContentPlugins.get(pluginId);
  if (!entry) return [];
  const items = [];
  try {
    const walk = (dir, relPrefix) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), relPrefix ? `${relPrefix}/${e.name}` : e.name);
        } else if (/\.mdx?$/.test(e.name) && !e.name.startsWith('_')) {
          const fullPath = path.join(dir, e.name);
          const relativePath = relPrefix ? `${relPrefix}/${e.name}` : e.name;
          const docId = relativePath.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '');
          let raw = '';
          try {
            raw = fs.readFileSync(fullPath, 'utf8');
          } catch {}
          items.push({
            id: `${pluginId}/${docId}`,
            title: extractMdTitle(raw) || docId,
            position: extractSidebarPos(raw),
            relativePath,
            pluginId,
          });
        }
      }
    };
    walk(entry.docsDir, '');
    items.sort((a, b) => a.position - b.position);
  } catch (e) {
    console.warn(`[plugin] listContentPluginDocs ${pluginId} failed: ${e.message}`);
  }
  return items;
}

// 读取 content-plugin 内某文档的 md 文本（按 relativePath）
function readContentPluginDoc(pluginId, relativePath) {
  const entry = globalThis._biof3ContentPlugins && globalThis._biof3ContentPlugins.get(pluginId);
  if (!entry) throw new Error(`content-plugin ${pluginId} 未注册`);
  // 防止路径穿越：解析后必须在 docsDir 内
  const resolved = path.resolve(entry.docsDir, relativePath);
  if (!resolved.startsWith(entry.docsDir + path.sep) && resolved !== entry.docsDir) {
    throw new Error('非法文档路径: ' + relativePath);
  }
  if (!/\.mdx?$/.test(resolved)) throw new Error('仅支持 .md/.mdx');
  if (!fs.existsSync(resolved)) throw new Error('文档不存在: ' + relativePath);
  return fs.readFileSync(resolved, 'utf8');
}

// 列出所有已注册 content-plugin 元数据（供前端 sidebar 顶层分类用）
function listAllContentPlugins() {
  if (!globalThis._biof3ContentPlugins) return [];
  const out = [];
  for (const [, e] of globalThis._biof3ContentPlugins) {
    out.push({
      id: e.id,
      contentType: e.contentType,
      omics: e.omics,
      version: e.version,
      title: e.title,
      pluginDir: e.pluginDir,
      docsDir: e.docsDir,
    });
  }
  return out;
}

// 从 md frontmatter / 首个 H1 提取标题
function extractMdTitle(raw) {
  if (!raw) return '';
  // frontmatter title
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) return t[1].replace(/^["']|["']$/g, '');
  }
  const h1 = raw.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return '';
}

// 从 md frontmatter 提取 sidebar_position（默认 999）
function extractSidebarPos(raw) {
  if (!raw) return 999;
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const p = fm[1].match(/^sidebar_position:\s*(\d+)/m);
    if (p) return parseInt(p[1], 10);
  }
  return 999;
}

// ── 卸载插件 ───────────────────────────────────────────────────

async function uninstallPlugin(pluginId) {
  // Runtime 类型走特殊卸载路径
  const installed = getInstalledPlugins();
  const plug = installed.find((p) => p.id === pluginId);
  if (plug && plug.type === 'runtime') {
    return uninstallRuntime(pluginId, plug);
  }

  // Content 插件类型：删目录 + 注销 globalThis 桥 + 记录
  if (plug && plug.type === 'content-plugin') {
    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    unregisterContentPlugin(pluginId);
    removeInstalledPlugin(pluginId);
    console.log(`[plugin] content-plugin uninstalled: ${pluginId}`);
    return;
  }

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
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    // packages 可能是 array（figcode-pack）或 object（工具插件）
    const pkgList = Array.isArray(meta.packages[language])
      ? meta.packages[language]
      : Object.keys(meta.packages[language]);
    for (const pkgName of pkgList) {
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

// ── 卸载 Runtime ───────────────────────────────────────────────

async function uninstallRuntime(pluginId, plug) {
  const lang = plug.language;
  const runtimeName = lang === 'r' ? 'R' : 'Python';
  const runtimeDir = path.join(RUNTIMES_DIR, runtimeName);

  if (fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    console.log(`[plugin] removed runtime dir: ${runtimeDir}`);
  }

  // 清环境变量（回退到打包内嵌或 null）
  if (lang === 'r') {
    delete process.env.BIOF3_R_HOME;
  } else {
    delete process.env.BIOF3_PY_HOME;
  }

  removeInstalledPlugin(pluginId);
  console.log(`[plugin] runtime uninstalled: ${pluginId}`);
}

function removePackage(executor, language, pkgName) {
  try {
    const cfg = require(path.join(PROJECT_ROOT, `${language}-server`, 'config'));
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
    // Runtime 类型：只恢复环境变量，不走 registerPluginInServer
    if (plug.type === 'runtime') {
      const runtimeName = plug.language === 'r' ? 'R' : 'Python';
      const runtimeDir = path.join(RUNTIMES_DIR, runtimeName);
      if (fs.existsSync(runtimeDir)) {
        if (plug.language === 'r') process.env.BIOF3_R_HOME = runtimeDir;
        else process.env.BIOF3_PY_HOME = runtimeDir;
        console.log(`[plugin] runtime loaded: ${plug.id} → ${runtimeDir}`);
      } else {
        console.warn(`[plugin] runtime ${plug.id} directory missing, skipping`);
      }
      continue;
    }

    // Content 插件：恢复 docsDir 注册到 globalThis._biof3ContentPlugins
    if (plug.type === 'content-plugin') {
      const pluginDir = path.join(PLUGINS_DIR, plug.id);
      if (!fs.existsSync(pluginDir)) {
        console.warn(`[plugin] content-plugin ${plug.id} directory missing, skipping`);
        continue;
      }
      const metaPath = path.join(pluginDir, 'plugin.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        registerContentPlugin(pluginDir, meta);
      } catch (e) {
        console.warn(`[plugin] content-plugin ${plug.id} load failed: ${e.message}`);
      }
      continue;
    }

    // 普通工具插件
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

// 递归复制目录（用于内置插件安装）
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
  getRuntimeStatus,
  PLUGINS_DIR,
  RUNTIMES_DIR,
  listAllContentPlugins,
  listContentPluginDocs,
  readContentPluginDoc,
};
