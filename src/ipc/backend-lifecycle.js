// ============================================================
// IPC handlers: plumber:start, plumber:stop
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 2.
// Original location: src/main.js ~line 1328 (setupBackendLifecycleIpc).
//
// BLOCK-30 P1: py:start / py:stop removed with the py-server HTTP
// service — Python tool execution runs inside r-server via the
// shared-backend executor registry, no standalone Python backend.
//
// startPlumber / stopPlumber are passed in by main.js — they live as
// module-level functions in backend-proc-manager.js and depend on the
// r-server supervisor and plumber child-process state.
// ============================================================

const { ipcMain } = require("electron");

function setupBackendLifecycleIpc({ startPlumber, stopPlumber } = {}) {
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
