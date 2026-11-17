"use strict";

const DEFAULT_RESTART_DELAYS_MS = Object.freeze([
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
]);

function createOwnedBackendSupervisor({
  name,
  spawnProcess,
  onProcessChange = () => {},
  log = () => {},
  warn = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
  restartDelaysMs = DEFAULT_RESTART_DELAYS_MS,
  stableAfterMs = 30_000,
  // BLOCK-457 P2 — 不可重试退出码：绑定类永久失败（port-guard exit 77）重试也是
  // 同样结果，重试链只会产出 30s 噪音循环（实机 749 次 boot）。命中名单 → 不排程
  // 重启，单行诚实日志。未传名单时行为逐字不变（旧调用方零漂移）。
  noRetryExitCodes,
}) {
  if (!name || typeof spawnProcess !== "function") {
    throw new TypeError("name and spawnProcess are required");
  }
  const noRetrySet = new Set(noRetryExitCodes ?? []);

  let processHandle = null;
  let restartTimer = null;
  let stableTimer = null;
  let restartAttempt = 0;
  let shuttingDown = false;

  const clearTimer = (timer) => {
    if (timer !== null) cancel(timer);
    return null;
  };

  const publishProcess = (nextProcess) => {
    processHandle = nextProcess;
    onProcessChange(nextProcess);
  };

  const restartDelay = () => {
    const index = Math.min(restartAttempt, restartDelaysMs.length - 1);
    return restartDelaysMs[index];
  };

  const scheduleRestart = (detail) => {
    if (shuttingDown || restartTimer !== null) return;
    const delayMs = restartDelay();
    restartAttempt += 1;
    warn(`[desktop] ${name} stopped unexpectedly (${detail}); restarting in ${delayMs}ms`);
    restartTimer = schedule(() => {
      restartTimer = null;
      start("unexpected-exit");
    }, delayMs);
  };

  function start(reason = "boot") {
    if (shuttingDown) return { ok: false, error: "supervisor_shutting_down" };
    if (processHandle && !processHandle.killed) {
      return { ok: true, alreadyRunning: true, pid: processHandle.pid };
    }

    let child;
    try {
      child = spawnProcess(reason);
      if (!child || typeof child.once !== "function") {
        throw new TypeError("spawnProcess must return a ChildProcess-like object");
      }
    } catch (error) {
      scheduleRestart(`spawn error: ${error.message}`);
      return { ok: false, error: error.message };
    }

    publishProcess(child);
    let stopped = false;
    const handleStopped = (detail) => {
      if (stopped) return;
      stopped = true;
      stableTimer = clearTimer(stableTimer);
      if (processHandle === child) publishProcess(null);
      log(`[desktop] ${name} exited: ${detail}`);
      scheduleRestart(detail);
    };
    child.once("exit", (code, signal) => {
      // BLOCK-457 P2 — 不可重试退出码：单行诚实日志后直接收桩（publishProcess(null)
      // 照旧，进程句柄不悬挂），绝不 scheduleRestart。
      if (typeof code === "number" && noRetrySet.has(code)) {
        stopped = true;
        stableTimer = clearTimer(stableTimer);
        if (processHandle === child) publishProcess(null);
        warn(
          `[desktop] ${name} exited with code=${code} (no-retry exit code) — won't restart; ` +
            `likely a permanent condition (e.g. port already in use by another instance)`,
        );
        return;
      }
      handleStopped(`code=${code ?? "null"}, signal=${signal || "none"}`);
    });
    child.once("error", (error) => {
      handleStopped(`error=${error.message}`);
    });

    stableTimer = clearTimer(stableTimer);
    stableTimer = schedule(() => {
      stableTimer = null;
      if (processHandle === child && !child.killed) restartAttempt = 0;
    }, stableAfterMs);

    return { ok: true, pid: child.pid };
  }

  function shutdown(reason = "shutdown") {
    shuttingDown = true;
    restartTimer = clearTimer(restartTimer);
    stableTimer = clearTimer(stableTimer);
    const child = processHandle;
    if (child && !child.killed) {
      try {
        child.kill();
      } catch (error) {
        warn(`[desktop] ${name} stop failed (${reason}): ${error.message}`);
      }
    }
  }

  return {
    start,
    shutdown,
    getProcess: () => processHandle,
    getState: () => ({
      restartAttempt,
      restartScheduled: restartTimer !== null,
      shuttingDown,
    }),
  };
}

module.exports = {
  createOwnedBackendSupervisor,
};
