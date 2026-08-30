// ============================================================
// IPC handlers: terminal:snapshot, terminal:open-log-dir,
//               terminal:open-shell, terminal:session-start,
//               terminal:session-write, terminal:session-resize,
//               terminal:session-stop (7 handlers)
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 4.
// Original location: src/main.js ~line 1134 (setupTerminalIpc).
//
// Dependencies injected via parameter:
//   - mainWindow: for terminal:data / terminal:exit events
//   - getProcs(): { rServerProc, plumberProc }
//   - getLogDir(): log directory path
//   - readLogTail(filePath): tail helper
//   - resolveCore: path resolver (duplicated for self-containment)
//   - node-pty: dynamic require inside session-start handler
//
// The shellProc + disposeShellData + disposeShellExit closures
// stay inside the function (module-internal state per IPC handler
// family). The `app.once("before-quit")` global cleanup is also
// registered inside, matching the original behavior.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ipcMain, app, shell } = require("electron");
const { getRuntimeBinName, getOpenShellPlan, getSessionShellSpec } =
  require("../platform-compat");

// resolveCore mirror (self-contained, identical to main.js logic)
function resolveCore(...parts) {
  const IS_DEV = !app.isPackaged;
  if (IS_DEV) {
    return path.join(__dirname, "..", "..", "core");
  }
  return path.join(process.resourcesPath, "core");
}

function setupTerminalIpc({ mainWindow, getProcs, getLogDir, readLogTail } = {}) {
  let shellProc = null;
  let disposeShellData = null;
  let disposeShellExit = null;

  const sendTerminalEvent = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  ipcMain.handle("terminal:snapshot", async () => {
    try {
      const logDir = getLogDir();
      // Snapshot the procs at handler invocation time so a stale
      // proc that exited during the IPC round-trip is observed.
      // BLOCK-30 P1: py-server 服务已摘除，进程清单不再包含它。
      const { rServerProc, plumberProc } = getProcs();
      const processes = [
        {
          id: "biof3-server",
          label: "R 后端",
          command: `node ${resolveCore("biof3-server", "server.js")}`,
          status: rServerProc && !rServerProc.killed ? "running" : "stopped",
          pid: rServerProc?.pid || null,
          logPath: path.join(logDir, "biof3-server.log"),
          output: readLogTail(path.join(logDir, "biof3-server.log")),
        },
        {
          id: "plumber",
          label: "R plumber",
          command: process.env.BIOF3_R_HOME
            ? `${path.join(
                process.env.BIOF3_R_HOME,
                "bin",
                getRuntimeBinName("r", process.platform),
              )} ${resolveCore("biof3-server", "replot.R")} --port 8787`
            : `${getRuntimeBinName("r", process.platform)} replot.R --port 8787`,
          status: plumberProc && !plumberProc.killed ? "running" : "stopped",
          pid: plumberProc?.pid || null,
          logPath: path.join(logDir, "plumber.log"),
          output: readLogTail(path.join(logDir, "plumber.log")),
        },
      ];
      return {
        ok: true,
        logDir,
        dataDir: process.env.BIOF3_LOCAL_DATA_DIR || null,
        processes,
      };
    } catch (e) {
      return { ok: false, error: e.message, processes: [] };
    }
  });

  ipcMain.handle("terminal:open-log-dir", async () => {
    try {
      const logDir = getLogDir();
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const error = await shell.openPath(logDir);
      return error ? { ok: false, error } : { ok: true, path: logDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:open-shell", async (_event, targetPath) => {
    try {
      const cwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : process.env.BIOF3_LOCAL_DATA_DIR || process.env.BIOF3_PROJECT_ROOT;
      const plan = getOpenShellPlan(cwd, process.platform);
      if (plan.type === "osascript") {
        const { spawn } = require("child_process");
        spawn(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
        }).unref();
        return { ok: true, path: cwd };
      }
      if (plan.type === "cmd") {
        const { spawn } = require("child_process");
        spawn(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
          windowsHide: plan.windowsHide,
        }).unref();
        return { ok: true, path: cwd };
      }
      const { spawn } = require("child_process");
      for (const terminal of plan.candidates) {
        try {
          spawn(terminal, plan.args, {
            detached: plan.detached,
            stdio: plan.stdio,
          }).unref();
          return { ok: true, path: cwd };
        } catch {}
      }
      return { ok: false, error: "未找到可用的系统终端" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:session-start", async (_event, targetPath) => {
    try {
      if (shellProc) {
        return { ok: true, pid: shellProc.pid, reused: true };
      }
      const requestedCwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : "";
      const cwd =
        requestedCwd && fs.existsSync(requestedCwd)
          ? requestedCwd
          : process.env.BIOF3_LOCAL_DATA_DIR || process.env.BIOF3_PROJECT_ROOT;
      const { shellPath, args } = getSessionShellSpec(process.env, process.platform);
      const pty = require("node-pty");
      shellProc = pty.spawn(shellPath, args, {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      disposeShellData = shellProc.onData((data) =>
        sendTerminalEvent("terminal:data", data),
      );
      disposeShellExit = shellProc.onExit(({ exitCode, signal }) => {
        sendTerminalEvent("terminal:exit", { code: exitCode, signal });
        disposeShellData?.dispose();
        disposeShellExit?.dispose();
        disposeShellData = null;
        disposeShellExit = null;
        shellProc = null;
      });
      return { ok: true, pid: shellProc.pid, cwd, shell: shellPath };
    } catch (e) {
      shellProc = null;
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("terminal:session-write", async (_event, input) => {
    if (!shellProc) {
      return { ok: false, error: "终端会话未启动" };
    }
    const text = typeof input === "string" ? input : "";
    if (text.length > 32_768) return { ok: false, error: "输入内容过长" };
    shellProc.write(text);
    return { ok: true };
  });

  ipcMain.handle("terminal:session-resize", async (_event, dimensions) => {
    if (!shellProc) return { ok: false, error: "终端会话未启动" };
    const cols = Math.max(2, Math.min(500, Number(dimensions?.cols) || 80));
    const rows = Math.max(1, Math.min(200, Number(dimensions?.rows) || 24));
    shellProc.resize(cols, rows);
    return { ok: true };
  });

  ipcMain.handle("terminal:session-stop", async () => {
    if (!shellProc) return { ok: true, wasRunning: false };
    shellProc.kill();
    shellProc = null;
    return { ok: true, wasRunning: true };
  });

  app.once("before-quit", () => {
    try {
      shellProc?.kill();
    } catch {}
  });
}

module.exports = { setupTerminalIpc };
