const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: ai-settings:get, ai-settings:save,
//               ai-settings:get-credential, ai-settings:test,
//               ai-settings:list-models
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1215 (setupAiSettingsIpc).
//
// L5-1（蓝图 L-38/BLOCK-409）：resolveCore 统一单源（core-utils）——mirror 退役。
// ============================================================

const { ipcMain } = require("electron");

const { resolveCore } = require("../main/core-utils");

function setupAiSettingsIpc(options = {}) {
  // BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
  const { createSenderGuard } = require("./_sender-guard");
  const assertSender = createSenderGuard(options.mainWindow);
  ipcMain.handle(CHANNELS.aiSettings.get, async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getAiSettings } = require(
        resolveCore("petri-server", "helpers", "ai-settings.js"),
      );
      return getAiSettings();
    } catch {
      return {};
    }
  });

  ipcMain.handle(CHANNELS.aiSettings.save, async (event, settings) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { saveAiSettings } = require(
        resolveCore("petri-server", "helpers", "ai-settings.js"),
      );
      saveAiSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.aiSettings.getCredential, async (event, credentialId) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { getApiKey } = require(
        resolveCore("petri-server", "helpers", "ai-settings.js"),
      );
      const apiKey = getApiKey(String(credentialId || ""));
      return { ok: true, apiKey };
    } catch (e) {
      return { ok: false, apiKey: "", error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.aiSettings.test, async (event, providerOrProfile, apiKey) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { testApiKey } = require(
        resolveCore("petri-server", "helpers", "ai-settings.js"),
      );
      return await testApiKey(providerOrProfile, apiKey);
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle(CHANNELS.aiSettings.listModels, async (event, providerOrProfile, apiKey) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const { listAvailableModels } = require(
        resolveCore("petri-server", "helpers", "ai-settings.js"),
      );
      return await listAvailableModels(providerOrProfile, apiKey);
    } catch (e) {
      return { ok: false, models: [], message: e.message };
    }
  });
}

module.exports = { setupAiSettingsIpc };
