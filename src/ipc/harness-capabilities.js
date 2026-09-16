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

const path = require("path");
const { ipcMain } = require("electron");

// resolveCore is duplicated here (rather than imported) so this
// module stays self-contained and doesn't drag in the rest of
// main.js's module-level state. The logic is identical to the
// IS_DEV/dev/pack resource-path resolution at src/main.js:231-249.
function resolveCoreRoot() {
  const IS_DEV = !require("electron").app.isPackaged;
  if (IS_DEV) {
    return path.join(__dirname, "..", "..", "core");
  }
  return path.join(process.resourcesPath, "core");
}
function resolveCore(...parts) {
  return path.join(resolveCoreRoot(), ...parts);
}

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
