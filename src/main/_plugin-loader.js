// ============================================================
// Plugin loader
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L127-135 (loadInstalledPlugins).
//
// Calls loadAllPlugins from the plugin-manager singleton.
// Failures are non-fatal — the app boots without plugins.
// ============================================================

/**
 * Load all installed plugins via the plugin-manager singleton.
 *
 * @param {object} deps
 * @param {function} deps.require — Node require (injected for testability)
 */
async function loadInstalledPlugins({ require } = require) {
  try {
    const { loadAllPlugins } = require("./plugin-manager");
    await loadAllPlugins();
    console.log("[desktop] plugins loaded");
  } catch (e) {
    console.warn("[desktop] plugin load failed:", e.message);
  }
}

module.exports = { loadInstalledPlugins };
