// ============================================================
// IPC handler: telemetry:report
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1297 (setupTelemetryIpc).
//
// Telemetry self-failures MUST NOT affect business logic — the
// underlying `./telemetry` module throws are caught and silenced
// with `{ ok: false, reason: "internal" }`.
// ============================================================

const { ipcMain } = require("electron");

function setupTelemetryIpc() {
  ipcMain.handle("telemetry:report", async (_event, payload) => {
    try {
      const { reportError } = require("../telemetry");
      return await reportError(payload);
    } catch (e) {
      // 遥测自身异常绝不能影响业务——静默
      return { ok: false, reason: "internal" };
    }
  });
}

module.exports = { setupTelemetryIpc };
