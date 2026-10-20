const CHANNELS = require('./channels');
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
// BLOCK-59 P2 — 终端独立窗（升格 Tab）：mainWindow 广播之外，把
// terminal:data/exit 同步送达承载该会话的弹出窗（terminal:<sessionId>）。
// 弹出窗是同一 pty 会话的第二活视图，主窗 tab 保活零丢失。
const { forwardToContentWindow } = require("./window-manager");

// resolveCore mirror (self-contained, identical to main.js logic)
function resolveCore(..._parts) {
  const IS_DEV = !app.isPackaged;
  if (IS_DEV) {
    return path.join(__dirname, "..", "..", "core");
  }
  return path.join(process.resourcesPath, "core");
}

const MAX_TERMINAL_TABS = 4;
const DEFAULT_SESSION_ID = "default";

// BLOCK-223 — 退出摘要只读面：主进程持有的终端会话数。
// setup 时把闭包内 Map 的读取器挂上来；未 setup（测试/极早启动）恒 0。
let activeSessionCountProvider = null;

function getActiveTerminalSessionCount() {
  try {
    return activeSessionCountProvider ? Number(activeSessionCountProvider()) || 0 : 0;
  } catch {
    return 0;
  }
}

/** 旧调用（不传 sessionId / 传非字符串）归一到 default tab。 */
function normalizeSessionId(value) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 64);
  return DEFAULT_SESSION_ID;
}

function setupTerminalIpc({ mainWindow, getProcs, getLogDir, readLogTail } = {}) {
  // sessionId → { proc, disposeData, disposeExit, cwd, pid }
  const sessions = new Map();
  activeSessionCountProvider = () => sessions.size;

  const sendTerminalEvent = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
    // BLOCK-59 P2 — 独立终端窗转发（无弹出窗时 no-op）。
    if (payload && typeof payload.sessionId === "string") {
      forwardToContentWindow(`terminal:${payload.sessionId}`, channel, payload);
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

  ipcMain.handle(CHANNELS.terminal.snapshot, async () => {
    try {
      const logDir = getLogDir();
      // Snapshot the procs at handler invocation time so a stale
      // proc that exited during the IPC round-trip is observed.
      // BLOCK-30 P1: py-server 服务已摘除，进程清单不再包含它。
      // BLOCK-51 P3: plumber 空壳已清理，进程清单不再包含它。
      const { rServerProc } = getProcs();
      const processes = [
        {
          id: "petri-server",
          label: "R 后端",
          command: `node ${resolveCore("petri-server", "server.js")}`,
          status: rServerProc && !rServerProc.killed ? "running" : "stopped",
          pid: rServerProc?.pid || null,
          logPath: path.join(logDir, "petri-server.log"),
          output: readLogTail(path.join(logDir, "petri-server.log")),
        },
      ];
      return {
        ok: true,
        logDir,
        dataDir: process.env.PETRI_LOCAL_DATA_DIR || null,
        processes,
      };
    } catch (e) {
      return { ok: false, error: e.message, processes: [] };
    }
  });

  ipcMain.handle(CHANNELS.terminal.openLogDir, async () => {
    try {
      const logDir = getLogDir();
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const error = await shell.openPath(logDir);
      return error ? { ok: false, error } : { ok: true, path: logDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.terminal.openShell, async (_event, targetPath) => {
    try {
      const cwd =
        typeof targetPath === "string" && targetPath.trim()
          ? targetPath.trim()
          : process.env.PETRI_LOCAL_DATA_DIR || process.env.PETRI_PROJECT_ROOT;
      const plan = getOpenShellPlan(cwd, process.platform);
      // BLOCK-102 P1 — spawn 的 ENOENT 是异步 error 事件，同步 try/catch 拦不住、
      // 也不能立刻报 ok。等一小窗让 error 事件到达后再如实回执（错误不再静默、
      // 不再产生无监听 error 事件的主进程 uncaughtException）。
      const spawnDetached = (command, args, opts) => new Promise((resolve) => {
        const { spawn } = require("child_process");
        let child;
        try {
          child = spawn(command, args, opts);
        } catch (e) {
          resolve({ ok: false, error: e.message });
          return;
        }
        let settled = false;
        child.once("error", (err) => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, error: err.message });
        });
        setTimeout(() => {
          if (settled) return;
          settled = true;
          child.unref();
          resolve({ ok: true });
        }, 150);
      });
      if (plan.type === "osascript") {
        const r = await spawnDetached(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
        });
        return r.ok ? { ok: true, path: cwd } : r;
      }
      if (plan.type === "cmd") {
        const r = await spawnDetached(plan.command, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
          windowsHide: plan.windowsHide,
        });
        return r.ok ? { ok: true, path: cwd } : r;
      }
      for (const terminal of plan.candidates) {
        const r = await spawnDetached(terminal, plan.args, {
          detached: plan.detached,
          stdio: plan.stdio,
        });
        if (r.ok) return { ok: true, path: cwd };
      }
      return { ok: false, error: "未找到可用的系统终端" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // BLOCK-54 P2 — args 兼容两种形态：string（旧，targetPath，default tab）/
  // { sessionId, targetPath }（新）。
  ipcMain.handle(CHANNELS.terminal.sessionStart, async (_event, args) => {
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
      // BLOCK-67 P3：SSH 远程项目终端 —— pty 直挂 `ssh -tt <alias>`，
      // 远端先 cd 到项目 remote_path 再进登录 shell（远程唯一工作目录语义）。
      if (isObject && args.ssh && args.ssh.alias && args.ssh.remotePath) {
        const alias = String(args.ssh.alias).replace(/[^A-Za-z0-9._-]/g, "");
        const remotePath = String(args.ssh.remotePath).replace(/[^A-Za-z0-9._/@ +-]/g, "");
        const pty = require("node-pty");
        // Windows 实测教训：ssh.exe 作为 conpty 直接 shell 会让 node-pty 的
        // conpty_console_list_agent（getConsoleProcessList）崩掉整个主进程——
        // 改经 cmd.exe 包装（console 归 cmd，ssh 为其子进程）。
        const isWin = process.platform === "win32";
        // BLOCK-154 终端保活（2026-10-09 用户反馈 SSH 频繁断连又自动恢复）：
        // 三层链路（Win→ECS ProxyJump→frps 隧道→dell sshd）任一环 NAT/防火墙
        // 空闲超时都会静默掐掉无心跳的 ssh -tt 连接；任务通道（ssh-multiplexer.js）
        // 已有同款保活（UI-397），终端通道漏了。CountMax=4（判死窗口 60s）比任务
        // 通道 CountMax=2（30s）多一倍窗口——交互式会话断开恢复代价高，多给容忍。
        const sshArgv = [
          "-o", "ServerAliveInterval=15",
          "-o", "ServerAliveCountMax=4",
          "-o", "ConnectTimeout=10",
          "-tt", alias,
          `cd "${remotePath}" && exec $SHELL -l`,
        ];
        const proc = isWin
          ? pty.spawn("cmd.exe", ["/c", "ssh", ...sshArgv], {
          name: "xterm-256color",
          cols: 100,
          rows: 28,
          cwd: process.env.PETRI_LOCAL_DATA_DIR || process.env.PETRI_PROJECT_ROOT || ".",
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        })
          : pty.spawn("ssh", sshArgv, {
          name: "xterm-256color",
          cols: 100,
          rows: 28,
          cwd: process.env.PETRI_LOCAL_DATA_DIR || process.env.PETRI_PROJECT_ROOT || ".",
          env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        });
        const disposeData = proc.onData((data) =>
          sendTerminalEvent(CHANNELS.terminal.data, { sessionId, data }),
        );
        const disposeExit = proc.onExit(({ exitCode, signal }) => {
          sendTerminalEvent(CHANNELS.terminal.exit, { sessionId, code: exitCode, signal });
          disposeData?.dispose();
          disposeExit?.dispose();
          sessions.delete(sessionId);
        });
        sessions.set(sessionId, {
          proc, disposeData, disposeExit,
          cwd: `${alias}:${remotePath}`,
          pid: proc.pid,
          ssh: { alias, remotePath },
        });
        return { ok: true, pid: proc.pid, cwd: `${alias}:${remotePath}`, shell: `ssh:${alias}`, sessionId };
      }
      const cwd =
        requestedCwd && fs.existsSync(requestedCwd)
          ? requestedCwd
          : process.env.PETRI_LOCAL_DATA_DIR || process.env.PETRI_PROJECT_ROOT;
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
        sendTerminalEvent(CHANNELS.terminal.data, { sessionId, data }),
      );
      const disposeExit = proc.onExit(({ exitCode, signal }) => {
        sendTerminalEvent(CHANNELS.terminal.exit, { sessionId, code: exitCode, signal });
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
  ipcMain.handle(CHANNELS.terminal.sessionWrite, async (_event, input) => {
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
  ipcMain.handle(CHANNELS.terminal.sessionResize, async (_event, dimensions) => {
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
  ipcMain.handle(CHANNELS.terminal.sessionStop, async (_event, args) => {
    const sessionId = normalizeSessionId(
      typeof args === "string" ? args : args && typeof args === "object" ? args.sessionId : null
    );
    if (!sessions.has(sessionId)) return { ok: true, wasRunning: false };
    killSession(sessionId);
    return { ok: true, wasRunning: true };
  });

  // BLOCK-54 P2 — tab 清单（id/cwd/pid/存活），供 renderer 恢复与展示。
  ipcMain.handle(CHANNELS.terminal.sessionList, async () => {
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

module.exports = { setupTerminalIpc, getActiveTerminalSessionCount };
