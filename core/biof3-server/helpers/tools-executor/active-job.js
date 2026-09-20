'use strict';

const {
  isChildProcessAlive,
  scheduleHardTimeout,
  terminateChildProcess,
} = require('../process-lifecycle');

function claimActiveToolJob(activeToolJobs, { jobId, toolId, now = Date.now } = {}) {
  if (activeToolJobs.has(jobId)) return null;
  const observedAt = now();
  const owner = {
    process: null,
    phase: 'preparing',
    cancelRequested: false,
    startedAt: observedAt,
    lastHeartbeatAt: observedAt,
    toolId,
  };
  activeToolJobs.set(jobId, owner);
  return owner;
}

function releaseActiveToolJob(activeToolJobs, jobId, owner) {
  if (activeToolJobs.get(jobId) !== owner) return false;
  activeToolJobs.delete(jobId);
  return true;
}

function terminateOwnedToolJobProcess(
  owner,
  { terminate = terminateChildProcess } = {},
) {
  if (!owner?.process) {
    return Promise.resolve({ terminated: false, reason: 'process_handle_missing' });
  }
  if (owner.terminationPromise) return owner.terminationPromise;

  const ownedProcess = owner.process;
  const attempt = Promise.resolve()
    .then(() => terminate(ownedProcess))
    .then((termination) => (
      termination && typeof termination === 'object'
        ? termination
        : { terminated: false, reason: 'termination_result_invalid' }
    ))
    .catch((error) => ({
      terminated: false,
      reason: 'termination_attempt_failed',
      error: error?.message || String(error),
    }));
  owner.terminationPromise = attempt;
  void attempt.then((termination) => {
    owner.lastTerminationResult = termination;
    if (owner.terminationPromise === attempt) owner.terminationPromise = null;
  });
  return attempt;
}

function requestActiveToolJobCancellation(
  activeToolJobs,
  jobId,
  { terminate = terminateChildProcess } = {},
) {
  const active = activeToolJobs.get(jobId);
  if (!active) return { active: false, killed: false, processStarted: false };
  active.cancelRequested = true;
  if (!active.process) {
    return {
      active: true,
      killed: false,
      processStarted: false,
      cancellationAccepted: true,
    };
  }
  const result = { active: true, killed: false, processStarted: true };
  result.termination = terminateOwnedToolJobProcess(active, { terminate })
    .then((termination) => {
      result.killed = termination.terminated;
      if (termination.signal) result.signal = termination.signal;
      else if (termination.terminated && termination.escalated) result.signal = 'SIGKILL';
      return termination;
    });
  return result;
}

async function canLaunchOwnedToolJob({ activeToolJobs, db, jobId, owner }) {
  if (activeToolJobs.get(jobId) !== owner || owner.cancelRequested) return false;
  const stored = await db.prepare('SELECT status FROM tool_jobs WHERE id=?').get(jobId);
  return activeToolJobs.get(jobId) === owner
    && owner.cancelRequested !== true
    && stored?.status === 'running';
}

function persistVerifiedToolJobHeartbeat({
  active,
  jobId,
  db,
  now = Date.now,
  isAlive = isChildProcessAlive,
} = {}) {
  if (!active || !isAlive(active.process)) {
    if (active) active.livenessLostAt ||= now();
    return false;
  }
  const observedAt = now();
  const commitHeartbeat = (persisted) => {
    if (!persisted || persisted.changes < 1) return false;
    if (!isAlive(active.process)) {
      active.livenessLostAt ||= observedAt;
      return false;
    }
    active.livenessLostAt = null;
    active.lastHeartbeatAt = observedAt;
    return true;
  };
  const persisted = db
    .prepare('UPDATE tool_jobs SET heartbeat_at=? WHERE id=? AND status=?')
    .run(observedAt, jobId, 'running');
  return persisted && typeof persisted.then === 'function'
    ? persisted.then(commitHeartbeat)
    : commitHeartbeat(persisted);
}

function armActiveToolJobLifecycle({
  active,
  jobId,
  db,
  heartbeatIntervalMs,
  hardTimeoutMs,
  setIntervalFn = setInterval,
  scheduleHardTimeoutFn = scheduleHardTimeout,
  refreshHeartbeat = persistVerifiedToolJobHeartbeat,
} = {}) {
  if (!active?.process) throw new Error('active_tool_job_process_missing');
  if (active.hardTimeoutTimer || active.heartbeatTimer) {
    throw new Error('active_tool_job_lifecycle_already_armed');
  }

  // Arm the independent kill budget first. Any later sampler/SQLite setup
  // failure still has a bounded retry path if the immediate TERM/KILL result
  // cannot be confirmed.
  active.hardTimeoutTimer = scheduleHardTimeoutFn({
    active,
    jobId,
    db,
    hardTimeoutMs,
  });
  active.heartbeatTimer = setIntervalFn(() => {
    try {
      const refreshed = refreshHeartbeat({ active, jobId, db });
      if (refreshed && typeof refreshed.then === 'function') {
        void refreshed.catch((error) => {
          console.warn('[tools] heartbeat update failed:', error.message);
        });
      }
    } catch (error) {
      console.warn('[tools] heartbeat update failed:', error.message);
    }
  }, heartbeatIntervalMs);
  active.heartbeatTimer.unref?.();
  return {
    hardTimeoutTimer: active.hardTimeoutTimer,
    heartbeatTimer: active.heartbeatTimer,
  };
}

function clearActiveToolJobLifecycleTimers(active) {
  if (!active) return;
  if (active.hardTimeoutTimer) clearTimeout(active.hardTimeoutTimer);
  if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
  active.hardTimeoutTimer = null;
  active.heartbeatTimer = null;
}

async function transitionToolJobToFailed({
  db,
  jobId,
  error,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare('UPDATE tool_jobs SET status=?, error=?, completed_at=? WHERE id=? AND status IN (?,?)')
    .run('failed', error, completedAt, jobId, 'pending', 'running');
}

async function transitionToolJobToCompleted({
  db,
  jobId,
  result,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare('UPDATE tool_jobs SET status=?, result_json=?, completed_at=? WHERE id=? AND status=?')
    .run('completed', JSON.stringify(result), completedAt, jobId, 'running');
}

async function settleConfirmedToolCancellation({
  db,
  jobId,
  result,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare(
      'UPDATE tool_jobs SET status=?, error=?, result_json=?, completed_at=?, process_pid=?, heartbeat_at=? '
      + 'WHERE id=? AND status IN (?,?,?)',
    )
    .run(
      'cancelled',
      null,
      JSON.stringify(result),
      completedAt,
      null,
      null,
      jobId,
      'pending',
      'running',
      'cancelled',
    );
}

async function handleActiveToolJobSetupFailure({
  activeToolJobs,
  jobId,
  error,
  markFailed,
  terminate = terminateChildProcess,
} = {}) {
  const owner = activeToolJobs.get(jobId);
  const message = error?.message || String(error || 'unknown executor setup failure');
  if (!owner) {
    await markFailed(jobId, `Executor setup failed: ${message}`, 'setup');
    return { active: false, processStarted: false };
  }
  owner.setupFailure = { phase: 'setup', reason: 'executor_setup_failure', message };
  if (!owner.process) {
    try {
      await markFailed(jobId, `Executor setup failed: ${message}`, 'setup');
    } finally {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    }
    return { active: true, processStarted: false };
  }

  if (owner.heartbeatTimer) clearInterval(owner.heartbeatTimer);
  owner.heartbeatTimer = null;
  const termination = await terminateOwnedToolJobProcess(owner, { terminate });
  owner.setupTerminationResult = termination;
  if (!termination.terminated) {
    // Make the existing periodic owner scan retry this handle on its next pass.
    // The independently armed hard timeout is deliberately retained as a
    // second bounded termination path.
    owner.lastHeartbeatAt = 0;
    return { active: true, processStarted: true, termination };
  }

  clearActiveToolJobLifecycleTimers(owner);
  if (!owner.cancelRequested) {
    try {
      await markFailed(
        jobId,
        `Executor setup failed: ${message}; child termination confirmed (${termination.signal || 'exit'})`,
        'setup',
      );
    } finally {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    }
  }
  return { active: true, processStarted: true, termination };
}


module.exports = {
  claimActiveToolJob,
  releaseActiveToolJob,
  terminateOwnedToolJobProcess,
  requestActiveToolJobCancellation,
  canLaunchOwnedToolJob,
  persistVerifiedToolJobHeartbeat,
  armActiveToolJobLifecycle,
  clearActiveToolJobLifecycleTimers,
  transitionToolJobToFailed,
  transitionToolJobToCompleted,
  settleConfirmedToolCancellation,
  handleActiveToolJobSetupFailure,
};
