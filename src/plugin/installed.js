// ============================================================
// src/plugin/installed.js — installed plugin registry CRUD
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 127-224.
//
// Reads / writes INSTALLED_FILE (PLUGINS_DIR/installed.json). Reconciles
// disk-side `installedFingerprint` vs runtime `currentFingerprint` on read
// so callers can see whether each installed plugin has drifted since the
// recorded install.
// ============================================================

const fs = require('fs');
const path = require('path');
const {
  PLUGINS_DIR,
  INSTALLED_FILE,
  PROJECT_ROOT,
} = require('./paths');
const pluginLoader = require(path.join(PROJECT_ROOT, 'biof3-server', 'plugin-loader.js'));

function getInstalledPlugins() {
  try {
    const raw = JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    // BLOCK-157 DIST-1 — enabled 规格化：无字段=启用（存量零破坏），仅 false=停用。
    return raw.map((plug) => {
      if (!plug || typeof plug !== 'object') return plug;
      const enabledNormalized = { ...plug, enabled: plug.enabled !== false };
      if (plug.type === 'runtime') {
        return {
          ...enabledNormalized,
          installedFingerprint: plug.scriptFingerprint || plug.manifestFingerprint || plug.fingerprint || null,
          currentFingerprint: null,
          manifestDrift: false,
          driftReason: null,
        };
      }

      const pluginDir = path.join(PLUGINS_DIR, plug.id || '');
      const metaPath = path.join(pluginDir, 'plugin.json');
      if (!plug.id || !fs.existsSync(metaPath)) {
        return {
          ...enabledNormalized,
          installedFingerprint: plug.scriptFingerprint || plug.manifestFingerprint || plug.fingerprint || null,
          currentFingerprint: null,
          manifestDrift: false,
          driftReason: null,
        };
      }

      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        let toolDefinition = null;
        const toolDefPath = path.join(pluginDir, 'tool-definition.json');
        if (fs.existsSync(toolDefPath)) {
          try {
            toolDefinition = JSON.parse(fs.readFileSync(toolDefPath, 'utf8'));
          } catch {}
        }
        const currentFingerprint = pluginLoader.computePluginFingerprint(
          { ...meta, pluginDir, scriptPath: path.join(pluginDir, 'scripts') },
          toolDefinition,
        );
        const installedFingerprint =
          plug.scriptFingerprint || plug.manifestFingerprint || plug.fingerprint || null;
        const manifestDrift = !!(
          installedFingerprint &&
          currentFingerprint &&
          installedFingerprint !== currentFingerprint
        );
        return {
          ...enabledNormalized,
          installedFingerprint,
          currentFingerprint,
          manifestDrift,
          driftReason: manifestDrift ? 'fingerprint_changed' : null,
        };
      } catch {
        return {
          ...enabledNormalized,
          installedFingerprint: plug.scriptFingerprint || plug.manifestFingerprint || plug.fingerprint || null,
          currentFingerprint: null,
          manifestDrift: false,
          driftReason: null,
        };
      }
    });
  } catch {
    return [];
  }
}

function saveInstalledPlugins(list) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const sanitized = Array.isArray(list)
    ? list.map((plug) => {
        if (!plug || typeof plug !== 'object') return plug;
        const next = { ...plug };
        delete next.installedFingerprint;
        delete next.currentFingerprint;
        delete next.manifestDrift;
        delete next.driftReason;
        return next;
      })
    : [];
  fs.writeFileSync(INSTALLED_FILE, JSON.stringify(sanitized, null, 2));
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

// BLOCK-157 DIST-1 — 启停粒度：停用=enabled:false 标志（文件不动，免重装）；
// 核心加载器 loadPluginsFromDisk 尊重该标志（停用即不注册）。
function setPluginEnabled(pluginId, enabled) {
  const list = getInstalledPlugins();
  const row = list.find((p) => p && p.id === pluginId);
  if (!row) {
    return { ok: false, error: 'plugin_not_installed', message: `未安装插件：${pluginId}` };
  }
  if (row.type === 'runtime') {
    return { ok: false, error: 'runtime_not_togglable', message: 'runtime 类型条目不支持启停（由运行时管理）。' };
  }
  saveInstalledPlugins(list.map((p) => (p.id === pluginId ? { ...p, enabled: enabled !== false } : p)));
  return { ok: true, id: pluginId, enabled: enabled !== false, restartRequired: true };
}

module.exports = {
  getInstalledPlugins,
  saveInstalledPlugins,
  addInstalledPlugin,
  removeInstalledPlugin,
  setPluginEnabled,
};
