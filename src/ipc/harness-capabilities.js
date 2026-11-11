const CHANNELS = require('./channels');
// ============================================================
// IPC handler: harness-capabilities:list
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 2327 (setupHarnessCapabilitiesIpc).
//
// Pure forwarder to core/shared-backend/capability-provisioning.js.
// On any failure, returns empty capabilities list so the UI can
// degrade gracefully.
// ============================================================

const { ipcMain } = require("electron");

// L5-1（蓝图 L-38/BLOCK-409）：resolveCore 统一单源（core-utils）——mirror 退役。
const { resolveCore } = require("../main/core-utils");

function setupHarnessCapabilitiesIpc() {
  ipcMain.handle(CHANNELS.harnessCapabilities.list, async () => {
    try {
      const cp = require(resolveCore("shared-backend", "capability-provisioning.js"));
      return { ok: true, capabilities: cp.listProvisionedCapabilities() };
    } catch (e) {
      return { ok: false, capabilities: [], error: e.message };
    }
  });
}

module.exports = { setupHarnessCapabilitiesIpc };
