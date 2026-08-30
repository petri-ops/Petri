// ============================================================
// IPC handlers: ai-settings:get, ai-settings:save,
//               ai-settings:get-credential, ai-settings:test,
//               ai-settings:list-models
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1215 (setupAiSettingsIpc).
//
// resolveCore is duplicated here (rather than imported) so this
// module stays self-contained and doesn't drag in main.js's
// module-level state. Logic mirrors src/main.js:231-249.
// ============================================================

const path = require("path");
const { ipcMain, app } = require("electron");

function resolveCoreRoot() {
  const IS_DEV = !app.isPackaged;
  if (IS_DEV) {
    return path.join(__dirname, "..", "..", "core");
  }
  return path.join(process.resourcesPath, "core");
}
function resolveCore(...parts) {
  return path.join(resolveCoreRoot(), ...parts);
}

function setupAiSettingsIpc(options = {}) {
  // BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
  const { createSenderGuard } = require("./_sender-guard");
  const assertSender = createSenderGuard(options.mainWindow);
  ipcMain.handle("ai-settings:get", async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getAiSettings } = require(
        resolveCore("biof3-server", "helpers", "ai-settings.js"),
      );
      return getAiSettings();
    } catch (e) {
      return {};
    }
  });

  ipcMain.handle("ai-settings:save", async (event, settings) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { saveAiSettings } = require(
        resolveCore("biof3-server", "helpers", "ai-settings.js"),
      );
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("ai-settings:get-credential", async (event, credentialId) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getApiKey } = require(
        resolveCore("biof3-server", "helpers", "ai-settings.js"),
      );
      const apiKey = getApiKey(String(credentialId || ""));
      return { ok: true, apiKey };
    } catch (e) {
      return { ok: false, apiKey: "", error: e.message };
    }
  });

  ipcMain.handle("ai-settings:test", async (event, providerOrProfile, apiKey) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { testApiKey } = require(
        resolveCore("biof3-server", "helpers", "ai-settings.js"),
      );
      return await testApiKey(providerOrProfile, apiKey);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle("ai-settings:list-models", async (event, providerOrProfile, apiKey) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { listAvailableModels } = require(
        resolveCore("biof3-server", "helpers", "ai-settings.js"),
      );
      return await listAvailableModels(providerOrProfile, apiKey);
    } catch (e) {
      return { ok: false, models: [], message: e.message };
    }
  });
}

module.exports = { setupAiSettingsIpc };
