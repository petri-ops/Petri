// ============================================================
// IPC handlers: terminal:snapshot, terminal:open-log-dir,
//               terminal:open-shell, terminal:session-start,
//               terminal:session-write, terminal:session-resize,
//               terminal:session-stop, terminal:session-list (8 handlers)
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 4.
// Original location: src/main.js ~line 1134 (setupTerminalIpc).
//
// Dependencies injected via parameter:
//   - mainWindow: for terminal:data / terminal:exit events
//   - getProcs(): { rServerProc }
//   - getLogDir(): log directory path
//   - readLogTail(filePath): tail helper
//   - resolveCore: path resolver (duplicated for self-containment)
//   - node-pty: dynamic require inside session-start handler
//
// BLOCK-54 P2 — 多 Tab 用户终端：单例 shellProc → sessions Map（上限
// MAX_TERMINAL_TABS=4，对齐 codex 64 上限哲学取 GUI 小值）。IPC 全量
// additive 兼容：旧调用不带 sessionId = 'default' tab（既有单会话语义
// 不变）；新调用带 sessionId 各自成会话。terminal:data / terminal:exit
// 事件 payload 带 sessionId 供 renderer 按 tab 路由。before-quit 遍历
// Map 全量 kill（对齐 codex terminate_all_processes）。
// ============================================================

const fs = require("fs");
const path = require("path");
const { ipcMain, app, shell } = require("electron");
const { getOpenShellPlan, getSessionShellSpec } =
  require("../platform-compat");

// resolveCore mirror (self-contained, identical to main.js logic)
function resolveCore(...parts) {
  const IS_DEV = !app.isPackaged;
  if (IS_DEV) {
    return path.join(__dirname, "..", "..", "core");
  }
  return path.join(process.resourcesPath, "core");
}

const MAX_TERMINAL_TABS = 4;
const DEFAULT_SESSION_ID = "default";

/** 旧调用（不传 sessionId / 传非字符串）归一到 default tab。 */
function normalizeSessionId(value) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 64);
  return DEFAULT_SESSION_ID;
}

function setupTerminalIpc({ mainWindow, getProcs, getLogDir, readLogTail } = {}) {
  // sessionId → { proc, disposeData, disposeExit, cwd, pid }
  const sessions = new Map();

  const sendTerminalEvent = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  const killSession = (sessionId) => {
    const session = sessions.get(sessionId);
    if (!session) return false;
    sessions.delete(sessionId);
    try {
      session.proc.kill();
    } catch {}
    session.disposeData?.dispose();
    session.disposeExit?.dispose();
    return true;
  };

  const killAllSessions = () => {
    for (const sessionId of [...sessions.keys()]) {
      killSession(sessionId);
    }
  };

  ipcMain.handle("terminal:snapshot", async () => {
    try {
      const logDir = getLogDir();
      // Snapshot the procs at handler invocation time so a stale
      // proc that exited during the IPC round-trip is observed.
      // BLOCK-30 P1: py-server 服务已摘除，进程清单不再包含它。
      // BLOCK-51 P3: plumber 空壳已清理，进程清单不再包含它。
      const { rServerProc } = getProcs();
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

  // BLOCK-54 P2 — args 兼容两种形态：string（旧，targetPath，default tab）/
  // { sessionId, targetPath }（新）。
  ipcMain.handle("terminal:session-start", async (_event, args) => {
    try {
      const isObject = args && typeof args === "object";
      const sessionId = normalizeSessionId(isObject ? args.sessionId : null);
      const targetPath = isObject ? args.targetPath : args;
      const existing = sessions.get(sessionId);
      if (existing) {
        return { ok: true, pid: existing.pid, reused: true, sessionId };
      }
      if (sessions.size >= MAX_TERMINAL_TABS) {
        return {
          ok: false,
          error: `终端标签已达上限 ${MAX_TERMINAL_TABS} 个，请先关闭不用的标签`,
          limitReached: true,
        };
      }
      const requestedCwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : "";
      const cwd =
        requestedCwd && fs.existsSync(requestedCwd)
          ? requestedCwd
          : process.env.BIOF3_LOCAL_DATA_DIR || process.env.BIOF3_PROJECT_ROOT;
      const { shellPath, args: shellArgs } = getSessionShellSpec(process.env, process.platform);
      const pty = require("node-pty");
      const proc = pty.spawn(shellPath, shellArgs, {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      const disposeData = proc.onData((data) =>
        sendTerminalEvent("terminal:data", { sessionId, data }),
      );
      const disposeExit = proc.onExit(({ exitCode, signal }) => {
        sendTerminalEvent("terminal:exit", { sessionId, code: exitCode, signal });
        disposeData?.dispose();
        disposeExit?.dispose();
        sessions.delete(sessionId);
      });
      sessions.set(sessionId, {
        proc,
        disposeData,
        disposeExit,
        cwd,
        pid: proc.pid,
      });
      return { ok: true, pid: proc.pid, cwd, shell: shellPath, sessionId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // BLOCK-54 P2 — input 兼容两种形态：string（旧，default tab）/ { sessionId, text }。
  ipcMain.handle("terminal:session-write", async (_event, input) => {
    const isObject = input && typeof input === "object";
    const sessionId = normalizeSessionId(isObject ? input.sessionId : null);
    const text = isObject ? String(input.text ?? "") : typeof input === "string" ? input : "";
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "终端会话未启动" };
    }
    if (text.length > 32_768) return { ok: false, error: "输入内容过长" };
    session.proc.write(text);
    return { ok: true };
  });

  // BLOCK-54 P2 — dimensions 兼容两种形态：{ cols, rows }（旧，default）/
  // { cols, rows, sessionId }。
  ipcMain.handle("terminal:session-resize", async (_event, dimensions) => {
    const sessionId = normalizeSessionId(dimensions && typeof dimensions === "object" ? dimensions.sessionId : null);
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, error: "终端会话未启动" };
    const cols = Math.max(2, Math.min(500, Number(dimensions?.cols) || 80));
    const rows = Math.max(1, Math.min(200, Number(dimensions?.rows) || 24));
    session.proc.resize(cols, rows);
    return { ok: true };
  });

  // BLOCK-54 P2 — args 兼容三种形态：undefined（旧，default）/ string sessionId /
  // { sessionId }。
  ipcMain.handle("terminal:session-stop", async (_event, args) => {
    const sessionId = normalizeSessionId(
      typeof args === "string" ? args : args && typeof args === "object" ? args.sessionId : null
    );
    if (!sessions.has(sessionId)) return { ok: true, wasRunning: false };
    killSession(sessionId);
    return { ok: true, wasRunning: true };
  });

  // BLOCK-54 P2 — tab 清单（id/cwd/pid/存活），供 renderer 恢复与展示。
  ipcMain.handle("terminal:session-list", async () => {
    const list = [...sessions.entries()].map(([sessionId, session]) => ({
      sessionId,
      pid: session.pid,
      cwd: session.cwd,
      running: true,
    }));
    return { ok: true, sessions: list, maxTabs: MAX_TERMINAL_TABS };
  });

  app.once("before-quit", () => {
    try {
      killAllSessions();
    } catch {}
  });
}

module.exports = { setupTerminalIpc, MAX_TERMINAL_TABS, DEFAULT_SESSION_ID };
