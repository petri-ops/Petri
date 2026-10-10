// ============================================================
// src/plugin/paths.js — path resolution helpers + constants
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 33-102, 80-110.
//
// Path resolution is tightly coupled to Electron's app lifecycle:
// - resolveSharedBackendDir: dev mode vs packaged (process.resourcesPath)
// - resolveProjectRoot: same dual-mode resolution
// - getFixRPathsScript: picks scripts/fix-r-paths.mjs from packaged or dev
//
// Constants exposed:
// - USER_DATA_DIR / PLUGINS_DIR / RUNTIMES_DIR / INSTALLED_FILE
// - RESOURCES_PATH / BUILT_IN_PLUGINS_DIR
// - SHARED_BACKEND_DIR / PROJECT_ROOT (resolved at module load by main.js
//   to keep these heavy disk probes single-shot; helpers below re-resolve
//   on demand)
// ============================================================

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveSharedBackendDir() {
  // 开发模式：从 src/ 向上一级到 desktop 仓根，再进 core/shared-backend（去 submodule 后内嵌）
  if (app && !app.isPackaged) {
    const devPath = path.resolve(__dirname, '..', '..', 'core', 'shared-backend');
    if (fs.existsSync(devPath)) return devPath;
  }
  // 打包模式：core 在 extraResources/core 下
  if (process.resourcesPath) {
    const pkgPath = path.join(process.resourcesPath, 'core', 'shared-backend');
    if (fs.existsSync(pkgPath)) return pkgPath;
  }
  // 兜底：回退到开发模式路径（即使 fs.existsSync 失败，让 require 抛错更明确）
  return path.resolve(__dirname, '..', '..', 'core', 'shared-backend');
}

function resolveProjectRoot() {
  if (app && app.isPackaged && process.resourcesPath) return path.join(process.resourcesPath, 'core');
  return path.resolve(__dirname, '..', '..', 'core');
}

// Constants module-level so install/teardown code reads them once.
const SHARED_BACKEND_DIR = resolveSharedBackendDir();
const PROJECT_ROOT = resolveProjectRoot();

const USER_DATA_DIR =
  process.env.BIOF3_LOCAL_DATA_DIR || path.join(app.getPath('documents'), 'Gewu-Local');
const PLUGINS_DIR = path.join(USER_DATA_DIR, 'plugins');
const RUNTIMES_DIR = path.join(USER_DATA_DIR, 'runtimes');
const INSTALLED_FILE = path.join(PLUGINS_DIR, 'installed.json');

// 开发模式：desktop-app/resources/；打包模式：process.resourcesPath
const RESOURCES_PATH =
  app && app.isPackaged && process.resourcesPath
    ? process.resourcesPath
    : path.join(__dirname, '..', '..', 'resources');

function getFixRPathsScript() {
  if (
    process.resourcesPath &&
    fs.existsSync(path.join(process.resourcesPath, 'scripts', 'fix-r-paths.mjs'))
  ) {
    return path.join(process.resourcesPath, 'scripts', 'fix-r-paths.mjs');
  }
  // 开发模式
  return path.resolve(__dirname, '..', '..', 'scripts', 'fix-r-paths.mjs');
}

const BUILT_IN_PLUGINS_DIR = path.join(RESOURCES_PATH, 'built-in-plugins');

// BLOCK-158 商店面退役 — 远程插件清单 URL 随商店通道退役（OSS bucket 基建不动，
// G1 恢复在线商店时在此挂点恢复 BIOF3_PLUGIN_MANIFEST_URL 语义）。

// Init shared backend (was in plugin-manager.js L63-67). Idempotent; safe to
// require at module load.
try {
  require(path.join(SHARED_BACKEND_DIR, 'init')).initSharedBackend();
} catch (e) {
  console.warn('[plugin] initSharedBackend failed:', e.message, '| path:', SHARED_BACKEND_DIR);
}

// 注入 config 让执行器/storage 读到真 config（plugin-manager 在 Electron 主进程跑，
// 调执行器做 runtime 校验/装包，需要正确 rHome）。
try {
  require(SHARED_BACKEND_DIR).configure({
    getConfig: () => require(path.join(PROJECT_ROOT, 'biof3-server', 'config')),
  });
} catch (e) {
  console.warn('[plugin] shared-backend configure failed:', e.message);
}

module.exports = {
  getFixRPathsScript,
  SHARED_BACKEND_DIR,
  PROJECT_ROOT,
  PLUGINS_DIR,
  RUNTIMES_DIR,
  INSTALLED_FILE,
  BUILT_IN_PLUGINS_DIR,
};
