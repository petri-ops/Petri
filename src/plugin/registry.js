// ============================================================
// src/plugin/registry.js — petri-server plugin registration
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 1050-1063.
//
// Forwards plugin metadata to petri-server via globalThis._petriPlugins
// (the plugin-loader side reads from this Map at HTTP request time).
// Idempotent — overwrite by plugin id.
// ============================================================

const path = require('path');

function registerPluginInServer(pluginDir, meta) {
  try {
    // 通过 globalThis 桥注册（petri-server 的 plugin-loader 会读取）
    if (!globalThis._petriPlugins) globalThis._petriPlugins = new Map();
    globalThis._petriPlugins.set(meta.id, {
      ...meta,
      pluginDir,
      scriptPath: path.join(pluginDir, 'scripts'),
    });
    console.log(`[plugin] registered in server: ${meta.id}`);
  } catch (e) {
    console.warn(`[plugin] register failed: ${e.message}`);
  }
}

module.exports = {
  registerPluginInServer,
};
