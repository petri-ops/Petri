'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { fork } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120000;
const WRITE_COMPLETION_GRACE_MS = 60000;
const TERMINATION_GRACE_MS = 2000;
const IDLE_SHUTDOWN_MS = 10000;
const MAX_PENDING = 32;
const childPath = path.join(__dirname, 'result-studio-background-child.js');

let generationSequence = 0;
let requestSequence = 0;
let currentGeneration = null;
const pending = new Map();

class ResultStudioBackgroundError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioBackgroundError';
    this.code = code;
    this.detail = detail;
  }
}

const errorOf = (code, message) => new ResultStudioBackgroundError(code, message);
const isWriteOperation = (operation) => operation === 'ensure-baseline' || operation === 'recover-workspace';

function settleClient(task, method, value) {
  if (task.clientSettled) return;
  task.clientSettled = true;
  task[method](value);
}

function clearTaskTimers(task) {
  if (task.timer) clearTimeout(task.timer);
  if (task.finalTimer) clearTimeout(task.finalTimer);
  task.timer = null;
  task.finalTimer = null;
}

function removeQueued(generation, requestId) {
  const index = generation.queue.indexOf(requestId);
  if (index >= 0) generation.queue.splice(index, 1);
}

function removeTask(task) {
  pending.delete(task.requestId);
  removeQueued(task.generation, task.requestId);
  if (task.generation.activeRequestId === task.requestId) {
    task.generation.activeRequestId = null;
  }
  clearTaskTimers(task);
}

function terminateProcessTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    // taskkill /T includes descendants. Arguments are fixed and never pass
    // through a shell.
    execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      timeout: TERMINATION_GRACE_MS,
    }, () => {});
    return;
  }
  try {
    // The helper is forked detached on POSIX, so its Git descendants share this
    // private process group and cannot survive as orphans.
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
  if (signal === 'SIGTERM') {
    const hardKill = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      }
    }, TERMINATION_GRACE_MS);
    hardKill.unref?.();
  }
}

function rejectQueued(generation, error) {
  for (const requestId of [...generation.queue]) {
    const task = pending.get(requestId);
    if (!task || task === pending.get(generation.activeRequestId)) continue;
    removeTask(task);
    settleClient(task, 'reject', error);
  }
}

function finishGeneration(generation) {
  if (currentGeneration === generation) currentGeneration = null;
  if (generation.idleTimer) clearTimeout(generation.idleTimer);
  generation.idleTimer = null;
  if (!generation.closeRequested) {
    generation.child.unref();
    generation.child.channel?.unref?.();
  }
  try { generation.child.disconnect(); } catch { /* already disconnected */ }
}

function failGeneration(generation, error, { terminate = false } = {}) {
  if (currentGeneration === generation) currentGeneration = null;
  if (generation.idleTimer) clearTimeout(generation.idleTimer);
  generation.idleTimer = null;
  for (const task of [...pending.values()]) {
    if (task.generation !== generation) continue;
    removeTask(task);
    settleClient(task, 'reject', error);
  }
  if (terminate) terminateProcessTree(generation.child);
}

function scheduleIdleShutdown(generation) {
  if (generation.activeRequestId || generation.queue.length > 0 || generation.draining) return;
  if (generation.idleTimer) clearTimeout(generation.idleTimer);
  generation.child.unref();
  generation.child.channel?.unref?.();
  generation.idleTimer = setTimeout(() => {
    generation.idleTimer = null;
    if (generation.activeRequestId || generation.queue.length > 0 || generation.draining) return;
    finishGeneration(generation);
  }, IDLE_SHUTDOWN_MS);
  generation.idleTimer.unref?.();
}

function dispatchNext(generation) {
  if (generation !== currentGeneration || generation.draining || generation.activeRequestId) return;
  const requestId = generation.queue.shift();
  if (!requestId) {
    scheduleIdleShutdown(generation);
    return;
  }
  const task = pending.get(requestId);
  if (!task) {
    dispatchNext(generation);
    return;
  }
  generation.activeRequestId = requestId;
  generation.child.ref();
  generation.child.channel?.ref?.();
  generation.child.send({
    requestId,
    operation: task.operation,
    payload: task.payload,
  }, (error) => {
    if (!error) return;
    if (!pending.has(requestId)) return;
    failGeneration(generation, errorOf(
      'background_child_send_failed',
      error.message || 'Result Studio background child could not receive work.',
    ), { terminate: true });
  });
}

function handleTimeout(task) {
  if (!pending.has(task.requestId)) return;
  const generation = task.generation;
  const timeoutError = errorOf(
    'background_timeout',
    'Result Studio background work exceeded its bounded timeout.',
  );

  if (generation.activeRequestId !== task.requestId) {
    // Work not yet sent has no side effects and can be removed safely.
    removeTask(task);
    settleClient(task, 'reject', timeoutError);
    return;
  }

  if (!isWriteOperation(task.operation)) {
    // Read-only Git/hash work has no canonical mutation to complete. Kill the
    // private process group so synchronous Git descendants cannot become orphans.
    failGeneration(generation, timeoutError, { terminate: true });
    return;
  }

  // A canonical write that has begun is never killed at its request timeout.
  // Isolate the generation, reject unsent work, and let the service reach its
  // own transaction/finally boundary. Only a separate, bounded final watchdog
  // may terminate the whole private process group.
  generation.draining = true;
  settleClient(task, 'reject', timeoutError);
  rejectQueued(generation, errorOf(
    'background_generation_draining',
    'Result Studio background generation is completing a timed-out canonical write.',
  ));
  task.finalTimer = setTimeout(() => {
    if (!pending.has(task.requestId)) return;
    failGeneration(generation, errorOf(
      'background_write_final_timeout',
      'Timed-out Result Studio write did not reach a canonical completion boundary.',
    ), { terminate: true });
  }, WRITE_COMPLETION_GRACE_MS);
  task.finalTimer.unref?.();
}

function backgroundChildForkOptions(env = process.env, electronVersion = process.versions.electron) {
  return {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    detached: process.platform !== 'win32',
    // In a packaged Electron process child_process.fork() reuses the Electron
    // executable. Without this flag it launches another app instance instead
    // of executing the CommonJS worker as Node.
    env: electronVersion ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : { ...env },
  };
}

function startGeneration() {
  if (currentGeneration && currentGeneration.child.connected) return currentGeneration;
  const child = fork(childPath, [], backgroundChildForkOptions());
  const generation = {
    id: ++generationSequence,
    child,
    queue: [],
    activeRequestId: null,
    draining: false,
    closeRequested: false,
    idleTimer: null,
  };
  currentGeneration = generation;
  child.unref();
  child.channel?.unref?.();

  child.on('message', (message) => {
    const task = pending.get(message && message.requestId);
    if (!task || task.generation !== generation) return;
    const wasDraining = generation.draining;
    removeTask(task);
    if (!task.clientSettled) {
      if (message && message.ok === true) {
        settleClient(task, 'resolve', message.result);
      } else {
        const error = message && message.error || {};
        settleClient(task, 'reject', new ResultStudioBackgroundError(
          error.code || 'result_studio_background_failed',
          error.message || 'Result Studio background work failed.',
          error.detail ?? null,
        ));
      }
    }
    if (wasDraining) {
      // Do not reuse a generation that exceeded a write deadline. It completed
      // cooperatively, so disconnecting now is safe and leaves no queued work.
      finishGeneration(generation);
    } else {
      dispatchNext(generation);
    }
  });
  child.once('error', (error) => {
    failGeneration(generation, errorOf(
      'background_child_failed',
      error && error.message || 'Result Studio background child failed.',
    ));
  });
  child.once('exit', (code, signal) => {
    failGeneration(generation, errorOf(
      'background_child_exited',
      `Result Studio background child exited before completing work (${signal || code}).`,
    ));
  });
  return generation;
}

function runResultStudioBackground(operation, payload, options = {}) {
  if (pending.size >= MAX_PENDING) {
    return Promise.reject(errorOf(
      'background_queue_full',
      `Result Studio background queue reached its ${MAX_PENDING}-request limit.`,
    ));
  }
  if (currentGeneration?.draining) {
    return Promise.reject(errorOf(
      'background_generation_draining',
      'Result Studio background generation is completing a timed-out canonical write.',
    ));
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const generation = startGeneration();
  if (generation.idleTimer) clearTimeout(generation.idleTimer);
  generation.idleTimer = null;
  const requestId = `${process.pid}-${++requestSequence}`;

  return new Promise((resolve, reject) => {
    const task = {
      requestId,
      operation,
      payload,
      generation,
      resolve,
      reject,
      clientSettled: false,
      timer: null,
      finalTimer: null,
    };
    task.timer = setTimeout(() => handleTimeout(task), timeoutMs);
    task.timer.unref?.();
    pending.set(requestId, task);
    generation.queue.push(requestId);
    dispatchNext(generation);
  });
}

function createDeduplicatedBackgroundRunner(run = runResultStudioBackground) {
  const work = new Map();
  return {
    run(key, operation, payload, options) {
      const stableKey = String(key);
      const active = work.get(stableKey);
      if (active) return active;
      const pendingWork = run(operation, payload, options);
      work.set(stableKey, pendingWork);
      pendingWork.finally(() => {
        if (work.get(stableKey) === pendingWork) work.delete(stableKey);
      }).catch(() => {});
      return pendingWork;
    },
    get size() {
      return work.size;
    },
  };
}

function closeResultStudioBackground() {
  const generation = currentGeneration;
  if (!generation) return Promise.resolve();
  if (generation.activeRequestId) {
    const active = pending.get(generation.activeRequestId);
    if (active && isWriteOperation(active.operation)) {
      generation.draining = true;
      generation.closeRequested = true;
      generation.child.ref();
      generation.child.channel?.ref?.();
      settleClient(active, 'reject', errorOf(
        'background_closed',
        'Result Studio background child is closing after its canonical write completes.',
      ));
      rejectQueued(generation, errorOf(
        'background_closed',
        'Result Studio background child was closed.',
      ));
      active.finalTimer = setTimeout(() => {
        if (!pending.has(active.requestId)) return;
        failGeneration(generation, errorOf(
          'background_write_final_timeout',
          'Closing Result Studio write did not reach a canonical completion boundary.',
        ), { terminate: true });
      }, WRITE_COMPLETION_GRACE_MS);
      active.finalTimer.unref?.();
      return new Promise((resolve) => {
        generation.child.once('exit', resolve);
      });
    }
  }
  failGeneration(generation, errorOf(
    'background_closed',
    'Result Studio background child was closed.',
  ), { terminate: true });
  return new Promise((resolve) => {
    if (generation.child.exitCode != null || generation.child.signalCode != null) resolve();
    else generation.child.once('exit', resolve);
  });
}

module.exports = {
  backgroundChildForkOptions,
  DEFAULT_TIMEOUT_MS,
  IDLE_SHUTDOWN_MS,
  MAX_PENDING,
  ResultStudioBackgroundError,
  TERMINATION_GRACE_MS,
  WRITE_COMPLETION_GRACE_MS,
  closeResultStudioBackground,
  createDeduplicatedBackgroundRunner,
  runResultStudioBackground,
};
