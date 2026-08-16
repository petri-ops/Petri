// ============================================================
// IPC handlers: py:start, py:stop, plumber:start, plumber:stop
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 2.
// Original location: src/main.js ~line 1328 (setupBackendLifecycleIpc).
//
// The four backend lifecycle functions (startPyServer / stopPyServer /
// startPlumber / stopPlumber) are passed in by main.js — they live as
// module-level functions in src/main.js and depend on the r-server
// supervisor, gateway, and plumber child-process state.
// ============================================================

const { ipcMain } = require("electron");

function setupBackendLifecycleIpc({
  startPyServer,
  stopPyServer,
  startPlumber,
  stopPlumber,
} = {}) {
  ipcMain.handle("py:start", async () => {
    try {
      return startPyServer("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("py:stop", async () => {
    try {
      return stopPyServer("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plumber:start", async () => {
    try {
      return startPlumber("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("plumber:stop", async () => {
    try {
      return stopPlumber("ipc");
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupBackendLifecycleIpc };
