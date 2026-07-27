import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  enforceHardTimeout,
  isChildProcessAlive,
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
  refreshVerifiedHeartbeat,
  resolveLifecycleDurations,
  scheduleHardTimeout,
  terminateChildProcess,
} = require('../core/r-server/helpers/process-lifecycle.js');
const { createToolsPlatformRoutes } = require('../core/r-server/routes/tools-platform.js');

function fakeChild(killImpl) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 43210;
  child.kill = killImpl.bind(child);
  return child;
}

test('CHF0 BE-5 termination confirms TERM exit and does not escalate', async () => {
  const signals = [];
  const child = fakeChild(function kill(signal) {
    signals.push(signal);
    queueMicrotask(() => {
      this.signalCode = signal;
      this.emit('exit', null, signal);
    });
    return true;
  });
  const result = await terminateChildProcess(child, { graceMs: 10, killConfirmMs: 10 });
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGTERM');
});

test('CHF0 BE-5 termination observes a real child process exit', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const result = await terminateChildProcess(child, { graceMs: 100, killConfirmMs: 100 });
  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(isChildProcessAlive(child), false);
});

test('CHF0 BE-5 termination reports false when SIGKILL is refused', async () => {
  const signals = [];
  const child = fakeChild((signal) => {
    signals.push(signal);
    return signal === 'SIGTERM';
  });
  const result = await terminateChildProcess(child, { graceMs: 1, killConfirmMs: 2 });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.terminated, false);
  assert.equal(result.reason, 'sigkill_not_sent');
});

test('CHF0 BE-5 termination does not claim success until SIGKILL exit is observed', async () => {
  const child = fakeChild(() => true);
  const result = await terminateChildProcess(child, { graceMs: 1, killConfirmMs: 2 });
  assert.equal(result.terminated, false);
  assert.equal(result.reason, 'sigkill_exit_unconfirmed');
  assert.equal(result.escalated, true);
});

test('CHF0 BE-5 heartbeat liveness is gated by the child PID, not the Node event loop', () => {
  const child = fakeChild(() => true);
  assert.equal(isChildProcessAlive(child, () => undefined), true);
  assert.equal(isChildProcessAlive(child, () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }), false);
  child.exitCode = 1;
  assert.equal(isChildProcessAlive(child, () => undefined), false);
});

function recordingDb() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        run(...params) { writes.push({ sql, params }); return { changes: 1 }; },
      };
    },
  };
}

test('CHF0 BE-5 verified heartbeat persists only after child liveness succeeds', () => {
  const db = recordingDb();
  const active = { process: {}, lastHeartbeatAt: 10 };
  assert.equal(refreshVerifiedHeartbeat({ active, jobId: 'job-1', db, now: 20, isAlive: () => false }), false);
  assert.equal(active.lastHeartbeatAt, 10);
  assert.equal(db.writes.length, 0);
  assert.equal(refreshVerifiedHeartbeat({ active, jobId: 'job-1', db, now: 30, isAlive: () => true }), true);
  assert.equal(active.lastHeartbeatAt, 30);
  assert.deepEqual(db.writes[0].params, [30, 'job-1', 'running']);
});

test('CHF0 BE-5 hard timeout is separate from heartbeat and records unconfirmed termination', async () => {
  const defaults = resolveLifecycleDurations({});
  assert.ok(defaults.hardTimeoutMs > 5 * 60 * 1000);
  assert.ok(defaults.hardTimeoutMs > defaults.zombieTimeoutMs);
  assert.ok(defaults.heartbeatIntervalMs < defaults.zombieTimeoutMs);

  const db = recordingDb();
  const active = { process: {}, lastHeartbeatAt: 99 };
  const result = await enforceHardTimeout({
    active,
    jobId: 'job-timeout',
    db,
    hardTimeoutMs: 1234,
    now: () => 500,
    terminate: async () => ({ terminated: false, reason: 'sigkill_exit_unconfirmed' }),
  });
  assert.equal(result.terminated, false);
  assert.equal(active.timedOut, true);
  assert.equal(active.lastHeartbeatAt, 0);
  assert.match(db.writes[0].sql, /status='failed'/);
  assert.match(db.writes[0].params[0], /1234ms.*终止未确认/);
});

test('CHF0 BE-5 healthy work is not scheduled for the obsolete five-minute wall', () => {
  const defaults = resolveLifecycleDurations({});
  let scheduledDelay = null;
  let invoked = false;
  const timer = { unref() {} };
  const returned = scheduleHardTimeout({
    active: { process: {} },
    jobId: 'healthy-long-job',
    db: recordingDb(),
    hardTimeoutMs: defaults.hardTimeoutMs,
    setTimeoutFn(callback, delay) {
      scheduledDelay = delay;
      // A fake clock advancing to the old five-minute boundary does not run
      // the callback because the registered deadline is still in the future.
      if (delay <= 5 * 60 * 1000) { invoked = true; callback(); }
      return timer;
    },
  });
  assert.equal(returned, timer);
  assert.equal(scheduledDelay, 30 * 60 * 1000);
  assert.equal(invoked, false);
});

test('CHF0 BE-5 zombie recovery terminates owned stale children and records the observed result', async () => {
  const db = recordingDb();
  const activeJobs = new Map([
    ['stale', { process: { id: 'stale' }, lastHeartbeatAt: 10 }],
    ['fresh', { process: { id: 'fresh' }, lastHeartbeatAt: 90 }],
  ]);
  const recovered = await recoverStaleActiveJobs({
    activeJobs,
    cutoff: 50,
    db,
    now: () => 100,
    terminate: async (child) => ({ terminated: child.id === 'stale', signal: 'SIGKILL' }),
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].jobId, 'stale');
  assert.match(db.writes[0].params[0], /已确认子进程终止.*SIGKILL/);
  assert.equal(activeJobs.get('fresh').recoveryRequested, undefined);
});

test('CHF0 BE-5 unowned restart recovery marks DB truth without signalling an unproven PID', async () => {
  const db = recordingDb();
  const result = await markUnownedStaleJobs({ db, cutoff: 50, now: () => 100 });
  assert.equal(result.changes, 1);
  assert.match(db.writes[0].sql, /进程归属无法证明，未发送信号/);
  assert.deepEqual(db.writes[0].params, [100, 50]);
});

function cancellationFixture(termination) {
  const routes = new Map();
  const writes = [];
  const db = {
    prepare(sql) {
      return {
        get() { return { id: 'job-1', status: 'running' }; },
        run(...params) { writes.push({ sql, params }); return { changes: 1 }; },
      };
    },
  };
  const routeFactory = createToolsPlatformRoutes({
    db,
    canAccessToolJob: () => true,
    isCancellableJob: () => true,
    handleToolRun() {}, handlePrivateFileRead() {}, handlePrivateFileWrite() {},
    handleGenerateFinalReport() {}, cleanupLocalToolJobDir() {},
    handlePublicDemo() {}, handlePublicFile() {}, handleDemoData() {},
    handleLegacyDemoFile() {}, handleLegacyDemoList() {},
    killLocalToolJob: () => ({ active: true, termination: Promise.resolve(termination) }),
  });
  routeFactory({
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
    get() {}, delete() {}, put() {},
  });
  return { handlers: routes.get('POST /api/tools/cancel/:id'), writes };
}

async function invokeCancel(fixture) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await fixture.handlers.at(-1)({ params: { id: 'job-1' } }, response);
  return response;
}

test('CHF0 BE-5 cancel writes cancelled only after termination is confirmed', async () => {
  const fixture = cancellationFixture({ terminated: true, signal: 'SIGTERM' });
  const response = await invokeCancel(fixture);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'cancelled');
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].params[0], 'cancelled');
});

test('CHF0 BE-5 cancel keeps the job retryable when termination is unconfirmed', async () => {
  const fixture = cancellationFixture({ terminated: false, reason: 'sigkill_exit_unconfirmed' });
  const response = await invokeCancel(fixture);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'termination_unconfirmed');
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0].sql, /error=/);
  assert.notEqual(fixture.writes[0].params[0], 'cancelled');
});
