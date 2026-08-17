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

function setupPluginIpc(options = {}) {
  // BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
  const { createSenderGuard } = require("./_sender-guard");
  const assertSender = createSenderGuard(options.mainWindow);
  // BLOCK-9.2 PHASE 0.5: fixed dangling IPC contract bug inherited
  // from BLOCK-9.1 PHASE 2. The original main.js (2d94732^) used
  // `getInstalledPlugins` from plugin-manager; the worker that
  // extracted setupPluginIpc into src/ipc/plugin.js renamed it
  // to `listInstalledPlugins` (which doesn't exist), causing the
  // try/catch to silently swallow the error and return `[]`.
  // Restored to the actual export names from plugin-manager.
  ipcMain.handle("plugin:list-installed", async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getInstalledPlugins } = require("../plugin-manager");
      return getInstalledPlugins();
    } catch (e) {
      console.warn("[desktop] plugin:list-installed failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("plugin:list-remote", async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getRemoteManifest } = require("../plugin-manager");
      return await getRemoteManifest();
    } catch (e) {
      console.warn("[desktop] plugin:list-remote failed:", e.message);
      return { plugins: {} };
    }
  });

  ipcMain.handle("plugin:check-updates", async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { checkUpdates } = require("../plugin-manager");
      return await checkUpdates();
    } catch (e) {
      console.warn("[desktop] plugin:check-updates failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("plugin:install", async (event, pluginId) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { installPlugin } = require("../plugin-manager");
      return await installPlugin(pluginId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plugin:uninstall", async (event, pluginId) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { uninstallPlugin } = require("../plugin-manager");
      return await uninstallPlugin(pluginId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── M2-9：content-plugin 文档桥 ──────────────────────────────
  // docs.tsx 运行时通过这些 IPC 拉取已装 content-plugin 的文档树与正文
  ipcMain.handle("content-plugin:list", async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { listAllContentPlugins } = require("../plugin-manager");
      return listAllContentPlugins();
    } catch (e) {
      console.warn("[desktop] content-plugin:list failed:", e.message);
      return [];
    }
  });

  ipcMain.handle("content-plugin:list-docs", async (event, pluginId) => {
    const deny = assertSender(event); if (deny) return deny;
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
    async (event, pluginId, relativePath) => {
      const deny = assertSender(event); if (deny) return deny;
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
