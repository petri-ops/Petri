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
const pluginLoader = require(path.join(PROJECT_ROOT, 'r-server', 'plugin-loader.js'));

function getInstalledPlugins() {
  try {
    const raw = JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((plug) => {
      if (!plug || typeof plug !== 'object') return plug;
      if (plug.type === 'runtime') {
        return {
          ...plug,
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
          ...plug,
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
          ...plug,
          installedFingerprint,
          currentFingerprint,
          manifestDrift,
          driftReason: manifestDrift ? 'fingerprint_changed' : null,
        };
      } catch {
        return {
          ...plug,
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

module.exports = {
  getInstalledPlugins,
  saveInstalledPlugins,
  addInstalledPlugin,
  removeInstalledPlugin,
};
