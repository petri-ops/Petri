const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: runtime:status, backend:status
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 2.
// Original location: src/main.js ~line 1278 (setupRuntimeIpc).
//
// Backend procs (rServer) are passed
// in by the caller (main.js) because they live as module-level
// `let ChildProc` variables in src/main.js — see backend-proc-
// manager.js (PHASE 3+ future) for the planned centralized home.
// BLOCK-30 P1: pyServerProc removed with the py-server HTTP service.
// BLOCK-51 P3: plumberProc removed with the plumber shell.
// ============================================================

const { ipcMain } = require("electron");

function setupRuntimeIpc({ rServerProc } = {}) {
  ipcMain.handle(CHANNELS.runtime.status, async () => {
    try {
      const { getRuntimeStatus } = require("../plugin-manager");
      const { mergeRuntimeStatusWithConfiguredHomes } = require("../backend-health");
      return mergeRuntimeStatusWithConfiguredHomes(getRuntimeStatus());
    } catch {
      return { r: { installed: false }, python: { installed: false } };
    }
  });

  // M1-1：后端就绪感知层——聚合 runtime:status + health 探测 + 子进程存活
  // 渲染进程通过 window.biof3Desktop.backend.status() 调用，5s 轮询
  ipcMain.handle(CHANNELS.backend.status, async () => {
    try {
      const { getRuntimeStatus } = require("../plugin-manager");
      const {
        getBackendStatus,
        mergeRuntimeStatusWithConfiguredHomes,
      } = require("../backend-health");
      return await getBackendStatus({
        runtimeStatus: mergeRuntimeStatusWithConfiguredHomes(getRuntimeStatus()),
        procs: {
          rServer: rServerProc,
        },
      });
    } catch (e) {
      // 契约：必须回全字段。缺 rRuntime/pyRuntime 会让渲染进程把
      // undefined 误读成"运行时确认缺失"，从而错弹首次配置引导页。
      // 查询失败属于"状态未知"，用 null 显式表达，前端只在 === false
      // 时才判定缺失。
      return {
        rRuntime: null,
        pyRuntime: null,
        rServerUp: false,
        serverUp: false,
        isReady: false,
        downReason: "状态查询失败: " + e.message,
      };
    }
  });
}

module.exports = { setupRuntimeIpc };
