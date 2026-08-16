// ============================================================
// IPC handlers: plugin:* (8 handlers), content-plugin:* (3 handlers)
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 2.
// Original location: src/main.js ~line 1139 (setupPluginIpc).
//
// Self-contained: only depends on plugin-manager via require. No
// mainWindow injection needed (the 8 plugin:* handlers are pure
// proxy functions that don't render-process.send progress events;
// the content-plugin:* family similarly is read-only).
// ============================================================

const { ipcMain } = require("electron");

function setupPluginIpc() {
  ipcMain.handle("plugin:list-installed", async () => {
    try {
      const { listInstalledPlugins } = require("../plugin-manager");
      return listInstalledPlugins();
    } catch (e) {
      console.warn("[desktop] plugin:list-installed failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("plugin:list-remote", async () => {
    try {
      const { listRemotePlugins } = require("../plugin-manager");
      return await listRemotePlugins();
    } catch (e) {
      console.warn("[desktop] plugin:list-remote failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("plugin:check-updates", async () => {
    try {
      const { checkPluginUpdates } = require("../plugin-manager");
      return await checkPluginUpdates();
    } catch (e) {
      console.warn("[desktop] plugin:check-updates failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("plugin:install", async (_event, pluginId) => {
    try {
      const { installPlugin } = require("../plugin-manager");
      return await installPlugin(pluginId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plugin:uninstall", async (_event, pluginId) => {
    try {
      const { uninstallPlugin } = require("../plugin-manager");
      return await uninstallPlugin(pluginId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── M2-9：content-plugin 文档桥 ──────────────────────────────
  // docs.tsx 运行时通过这些 IPC 拉取已装 content-plugin 的文档树与正文
  ipcMain.handle("content-plugin:list", async () => {
    try {
      const { listAllContentPlugins } = require("../plugin-manager");
      return listAllContentPlugins();
    } catch (e) {
      console.warn("[desktop] content-plugin:list failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("content-plugin:list-docs", async (_event, pluginId) => {
    try {
      const { listContentPluginDocs } = require("../plugin-manager");
      return listContentPluginDocs(pluginId);
    } catch (e) {
      console.warn("[desktop] content-plugin:list-docs failed:", e.message);
      return [];
    }
  });

  ipcMain.handle(
    "content-plugin:read",
    async (_event, pluginId, relativePath) => {
      try {
        const { readContentPluginDoc } = require("../plugin-manager");
        return {
          ok: true,
          content: readContentPluginDoc(pluginId, relativePath),
        };
      } catch (e) {
        console.warn("[desktop] content-plugin:read failed:", e.message);
        return { ok: false, error: e.message };
      }
    },
  );
}

module.exports = { setupPluginIpc };
