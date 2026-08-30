// ============================================================
// src/plugin/uninstall.js — uninstall / update-check / startup reload
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 1204-1283 (uninstallPlugin + uninstallRuntime
// + removePackage), 1304-1322 (checkUpdates), 1326-1398 (loadAllPlugins).
//
// Three startup/teardown lifecycle flows:
//   uninstallPlugin(id): removes a plugin directory + its packages;
//     special cases for runtime/content-plugin/plugin-types.
//   checkUpdates(): compares installed versions vs latest remote manifest
//     and returns an updates[] list. Read-only.
//   loadAllPlugins(): startup-time restore — rehydrates runtime env
//     vars, registers content-plugin docs in globalThis, and pushes
//     tool plugin metadata to biof3-server via registerPluginInServer.
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getRuntimeBinCandidates, getPythonSitePackagesDir } = require('../platform-compat');
// BLOCK-10-audit-closeout: getPythonRuntimeExecutable lives in
// core/shared-backend/runtime-paths.js, NOT in src/platform-compat.js.
// L21 of this file previously tried to destructure it from '../platform-compat'
// and called the missing export as a function — this broke uninstallPlugin
// and surfaced as "[desktop] plugin load failed: getPythonRuntimeExecutable is not a function"
// during the dev Electron boot (loadAllPlugins → uninstallPlugin → runtime check).
// Mirror src/plugin/runtime.js L20: pull it from runtime-paths via __dirname.
const { getPythonRuntimeExecutable } = require(path.join(__dirname, '..', '..', 'core', 'shared-backend', 'runtime-paths'));
const {
  PLUGINS_DIR,
  RUNTIMES_DIR,
  PROJECT_ROOT,
  SHARED_BACKEND_DIR,
} = require('./paths');
const pluginLoader = require(path.join(PROJECT_ROOT, 'biof3-server', 'plugin-loader.js'));
const {
  getInstalledPlugins,
  removeInstalledPlugin,
  addInstalledPlugin,
} = require('./installed');
const { getRemoteManifest } = require('./manifest-source');
const { compareVersions, detectPlatform } = require('./runtime');
const { registerContentPlugin, unregisterContentPlugin } = require('./content-plugin');
const { registerPluginInServer } = require('./registry');

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
        : getPythonSitePackagesDir(cfg.pyHome || '');
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
      const platformMatch =
        !plug.platform ||
        (Array.isArray(plug.platform)
          ? plug.platform.includes(detectPlatform())
          : String(plug.platform).split(',').map((s) => s.trim()).includes(detectPlatform()));
      const binExists =
        plug.language === 'r'
          ? getRuntimeBinCandidates('r', process.platform).some((name) =>
              fs.existsSync(path.join(runtimeDir, 'bin', name)),
            )
          : getPythonRuntimeExecutable(runtimeDir, process.platform) !== null;
      if (fs.existsSync(runtimeDir) && platformMatch && binExists) {
        if (plug.language === 'r') process.env.BIOF3_R_HOME = runtimeDir;
        else process.env.BIOF3_PY_HOME = runtimeDir;
        console.log(`[plugin] runtime loaded: ${plug.id} → ${runtimeDir}`);
      } else {
        console.warn(
          `[plugin] runtime ${plug.id} incompatible with ${detectPlatform()} or missing executable, skipping`,
        );
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
      if (plug.type !== 'runtime') {
        const scriptFingerprint = pluginLoader.computePluginFingerprint(
          { ...meta, pluginDir, scriptPath: path.join(pluginDir, 'scripts') },
          fs.existsSync(path.join(pluginDir, 'tool-definition.json'))
            ? JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json'), 'utf8'))
            : null
        );
        if (scriptFingerprint && !plug.scriptFingerprint) {
          addInstalledPlugin({ ...plug, scriptFingerprint });
        }
      }
      registerPluginInServer(pluginDir, meta);
    } catch (e) {
      console.warn(`[plugin] load ${plug.id} failed: ${e.message}`);
    }
  }
}

// Suppress unused-import lint for execFile (kept for future helper expansion)
void execFile;

module.exports = {
  uninstallPlugin,
  uninstallRuntime,
  removePackage,
  checkUpdates,
  loadAllPlugins,
};
