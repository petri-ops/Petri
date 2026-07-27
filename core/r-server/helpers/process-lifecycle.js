const DEFAULT_TERM_GRACE_MS = 5000;

function terminateChildProcess(child, {
  graceMs = DEFAULT_TERM_GRACE_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!child || typeof child.kill !== 'function') {
    return Promise.resolve({ terminated: false, reason: 'process_handle_missing' });
  }
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve({ terminated: true, signal: child.signalCode || null, alreadyExited: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let escalated = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeoutFn(timer);
      resolve(escalated ? { ...result, escalated: true } : result);
    };
    const onExit = (code, signal) => finish({ terminated: true, code, signal: signal || null });
    child.once?.('exit', onExit);
    try {
      child.kill('SIGTERM');
    } catch (error) {
      finish({ terminated: false, reason: 'sigterm_failed', error: error.message });
      return;
    }
    timer = setTimeoutFn(() => {
      try {
        escalated = true;
        child.kill('SIGKILL');
        finish({ terminated: true, signal: 'SIGKILL', escalated: true });
      } catch (error) {
        finish({ terminated: false, reason: 'sigkill_failed', error: error.message });
      }
    }, graceMs);
    timer.unref?.();
  });
}

module.exports = { terminateChildProcess, DEFAULT_TERM_GRACE_MS };
