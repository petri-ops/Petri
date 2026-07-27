const DEFAULT_TERM_GRACE_MS = 5000;
const DEFAULT_KILL_CONFIRM_MS = 2000;
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000;

function positiveDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveLifecycleDurations(env = process.env) {
  return {
    hardTimeoutMs: positiveDuration(env.BIOF3_TOOL_HARD_TIMEOUT_MS, DEFAULT_HARD_TIMEOUT_MS),
    zombieTimeoutMs: positiveDuration(env.BIOF3_TOOL_ZOMBIE_TIMEOUT_MS, DEFAULT_ZOMBIE_TIMEOUT_MS),
    heartbeatIntervalMs: positiveDuration(env.BIOF3_TOOL_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS),
  };
}

function hasExited(child) {
  return !!child && (
    (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined)
  );
}

/**
 * Verify that the owned child PID still exists. A Node timer firing is not a
 * child heartbeat; callers may persist a heartbeat only after this probe.
 */
function isChildProcessAlive(child, signalProcess = process.kill) {
  if (!child || hasExited(child) || !Number.isInteger(child.pid) || child.pid <= 0) return false;
  try {
    signalProcess(child.pid, 0);
    return true;
  } catch (error) {
    // EPERM still proves that a process occupies the owned PID. Other errors,
    // especially ESRCH, mean liveness is not established.
    return error && error.code === 'EPERM';
  }
}

function terminateChildProcess(child, {
  graceMs = DEFAULT_TERM_GRACE_MS,
  killConfirmMs = DEFAULT_KILL_CONFIRM_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!child || typeof child.kill !== 'function') {
    return Promise.resolve({ terminated: false, reason: 'process_handle_missing' });
  }
  if (hasExited(child)) {
    return Promise.resolve({ terminated: true, signal: child.signalCode || null, alreadyExited: true });
  }

  return new Promise((resolve) => {
    let settled = false;
    let graceTimer = null;
    let confirmTimer = null;
    let escalated = false;
    const cleanup = () => {
      if (graceTimer) clearTimeoutFn(graceTimer);
      if (confirmTimer) clearTimeoutFn(confirmTimer);
      child.removeListener?.('exit', onExit);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(escalated ? { ...result, escalated: true } : result);
    };
    const onExit = (code, signal) => finish({
      terminated: true,
      code: code ?? null,
      signal: signal || child.signalCode || null,
    });
    child.once?.('exit', onExit);

    let termSent = false;
    try {
      termSent = child.kill('SIGTERM') === true;
    } catch (error) {
      finish({ terminated: false, reason: 'sigterm_failed', error: error.message });
      return;
    }
    if (!termSent) {
      if (hasExited(child)) onExit(child.exitCode, child.signalCode);
      else finish({ terminated: false, reason: 'sigterm_not_sent' });
      return;
    }

    graceTimer = setTimeoutFn(() => {
      escalated = true;
      let killSent = false;
      try {
        killSent = child.kill('SIGKILL') === true;
      } catch (error) {
        finish({ terminated: false, reason: 'sigkill_failed', error: error.message });
        return;
      }
      if (!killSent) {
        if (hasExited(child)) onExit(child.exitCode, child.signalCode);
        else finish({ terminated: false, reason: 'sigkill_not_sent' });
        return;
      }
      // SIGKILL being accepted is not the terminal event. Confirm the exit so
      // API/DB state never claims cancellation while the process is alive.
      confirmTimer = setTimeoutFn(() => {
        if (hasExited(child)) onExit(child.exitCode, child.signalCode);
        else finish({ terminated: false, reason: 'sigkill_exit_unconfirmed', signal: 'SIGKILL' });
      }, Math.max(1, killConfirmMs));
    }, Math.max(0, graceMs));
  });
}

function refreshVerifiedHeartbeat({ active, jobId, db, now = Date.now(), isAlive = isChildProcessAlive }) {
  if (!active || !isAlive(active.process)) {
    if (active) active.livenessLostAt ||= now;
    return false;
  }
  active.livenessLostAt = null;
  active.lastHeartbeatAt = now;
  db.prepare('UPDATE tool_jobs SET heartbeat_at=? WHERE id=? AND status=?')
    .run(now, jobId, 'running');
  return true;
}

async function enforceHardTimeout({
  active,
  jobId,
  db,
  hardTimeoutMs,
  now = Date.now,
  terminate = terminateChildProcess,
}) {
  active.timedOut = true;
  if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
  const termination = await terminate(active.process);
  active.terminationResult = termination;
  if (!termination.terminated) {
    active.lastHeartbeatAt = 0;
    await db
      .prepare("UPDATE tool_jobs SET status='failed', error=?, completed_at=? WHERE id=? AND status IN ('running','pending')")
      .run(
        `任务超过最大运行预算 ${hardTimeoutMs}ms；子进程终止未确认（${termination.reason || 'unknown'}）`,
        now(),
        jobId
      );
  }
  return termination;
}

function scheduleHardTimeout({
  active,
  jobId,
  db,
  hardTimeoutMs,
  setTimeoutFn = setTimeout,
  onError = (error) => console.warn('[tools] hard-timeout terminal update failed:', error.message),
}) {
  const timer = setTimeoutFn(() => {
    void enforceHardTimeout({ active, jobId, db, hardTimeoutMs }).catch(onError);
  }, hardTimeoutMs);
  timer.unref?.();
  return timer;
}

async function recoverStaleActiveJobs({
  activeJobs,
  cutoff,
  db,
  now = Date.now,
  terminate = terminateChildProcess,
}) {
  const recovered = [];
  for (const [jobId, active] of activeJobs) {
    if (active.lastHeartbeatAt >= cutoff) continue;
    active.recoveryRequested = true;
    if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
    const termination = await terminate(active.process);
    active.terminationResult = termination;
    const diagnostic = termination.terminated
      ? `任务失活；已确认子进程终止（${termination.signal || 'exit'}）`
      : `任务失活；子进程终止未确认（${termination.reason || 'unknown'}）`;
    await db
      .prepare("UPDATE tool_jobs SET status='failed', error=?, completed_at=? WHERE id=? AND status IN ('running','pending')")
      .run(diagnostic, now(), jobId);
    recovered.push({ jobId, termination, diagnostic });
  }
  return recovered;
}

async function markUnownedStaleJobs({ db, cutoff, now = Date.now }) {
  return db
    .prepare(
      "UPDATE tool_jobs SET status = 'failed', error = '任务心跳失活且无本次进程句柄；进程归属无法证明，未发送信号', completed_at = ? WHERE status IN ('running', 'pending') AND COALESCE(heartbeat_at, created_at) < ?"
    )
    .run(now(), cutoff);
}

module.exports = {
  DEFAULT_HARD_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_KILL_CONFIRM_MS,
  DEFAULT_TERM_GRACE_MS,
  DEFAULT_ZOMBIE_TIMEOUT_MS,
  enforceHardTimeout,
  hasExited,
  isChildProcessAlive,
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
  refreshVerifiedHeartbeat,
  resolveLifecycleDurations,
  scheduleHardTimeout,
  terminateChildProcess,
};
