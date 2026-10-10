import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  enforceHardTimeout,
  isChildProcessAlive,
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
  refreshVerifiedHeartbeat,
  resolveLifecycleDurations,
  scheduleHardTimeout,
  terminateChildProcess,
} = require('../core/petri-server/helpers/process-lifecycle.js');
const { createToolsPlatformRoutes } = require('../core/petri-server/routes/tools-platform.js');
const { _test: toolsExecutorTest } = require('../core/petri-server/helpers/tools-executor.js');

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
  const closed = once(child, 'close');
  await once(child, 'spawn');
  try {
    const result = await terminateChildProcess(child, { graceMs: 100, killConfirmMs: 100 });
    assert.equal(result.terminated, true);
    assert.equal(result.signal, 'SIGTERM');
    assert.equal(isChildProcessAlive(child), false);
  } finally {
    if (isChildProcessAlive(child)) child.kill('SIGKILL');
    await closed;
  }
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

test('P6 async heartbeat advances owner liveness only after SQLite persistence succeeds', async () => {
  let resolveWrite;
  const write = new Promise((resolve) => { resolveWrite = resolve; });
  const active = { process: { pid: 43210 }, lastHeartbeatAt: 10 };
  const db = {
    prepare(sql) {
      assert.match(sql, /UPDATE tool_jobs SET heartbeat_at/);
      return { run: () => write };
    },
  };
  const heartbeat = toolsExecutorTest.persistVerifiedToolJobHeartbeat({
    active,
    jobId: 'job-async-heartbeat',
    db,
    now: () => 20,
    isAlive: () => true,
  });
  assert.equal(active.lastHeartbeatAt, 10);
  resolveWrite({ changes: 1 });
  assert.equal(await heartbeat, true);
  assert.equal(active.lastHeartbeatAt, 20);

  const rejected = toolsExecutorTest.persistVerifiedToolJobHeartbeat({
    active,
    jobId: 'job-async-heartbeat',
    db: {
      prepare() { return { run: () => Promise.reject(new Error('database locked')) }; },
    },
    now: () => 30,
    isAlive: () => true,
  });
  await assert.rejects(rejected, /database locked/);
  assert.equal(active.lastHeartbeatAt, 20);
});

test('P6 hard timeout keeps an unconfirmed child non-terminal and terminalizes only after confirmed exit', async () => {
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
  assert.doesNotMatch(db.writes[0].sql, /status='failed'/);
  assert.match(db.writes[0].sql, /SET error=\?, completed_at=NULL/);
  assert.match(db.writes[0].sql, /status IN \('running','pending'\)/);
  assert.match(db.writes[0].params[0], /1234ms.*终止未确认/);
  assert.deepEqual(db.writes[0].params.slice(1), ['job-timeout']);

  const confirmedDb = recordingDb();
  const confirmed = await enforceHardTimeout({
    active: { process: {}, lastHeartbeatAt: 99 },
    jobId: 'job-timeout-confirmed',
    db: confirmedDb,
    hardTimeoutMs: 1234,
    now: () => 501,
    terminate: async () => ({ terminated: true, signal: 'SIGKILL' }),
  });
  assert.equal(confirmed.terminated, true);
  assert.match(confirmedDb.writes[0].sql, /status='failed'/);
  assert.match(confirmedDb.writes[0].sql, /process_pid=NULL, heartbeat_at=NULL/);
  assert.match(confirmedDb.writes[0].params[0], /1234ms.*已确认子进程终止.*SIGKILL/);
  assert.deepEqual(confirmedDb.writes[0].params.slice(1), [501, 'job-timeout-confirmed']);

  const cancellingDb = recordingDb();
  await enforceHardTimeout({
    active: { process: {}, lastHeartbeatAt: 99, cancelRequested: true },
    jobId: 'job-timeout-cancelling',
    db: cancellingDb,
    hardTimeoutMs: 1234,
    now: () => 502,
    terminate: async () => ({ terminated: true, signal: 'SIGKILL' }),
  });
  assert.doesNotMatch(cancellingDb.writes[0].sql, /status='failed'/);
  assert.match(cancellingDb.writes[0].sql, /completed_at=NULL/);
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
  assert.match(db.writes[0].sql, /status='failed'/);
  assert.match(db.writes[0].params[0], /已确认子进程终止.*SIGKILL/);
  assert.equal(activeJobs.get('fresh').recoveryRequested, undefined);
});

test('P6 owned stale recovery keeps unconfirmed children retryable and excludes them from unowned recovery', async () => {
  const db = recordingDb();
  const activeJobs = new Map([
    ['stale-owned', { process: { id: 'stale-owned' }, lastHeartbeatAt: 10 }],
  ]);
  const recovered = await recoverStaleActiveJobs({
    activeJobs,
    cutoff: 50,
    db,
    now: () => 100,
    terminate: async () => ({ terminated: false, reason: 'sigkill_exit_unconfirmed' }),
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].termination.terminated, false);
  assert.equal(activeJobs.get('stale-owned').lastHeartbeatAt, 0);
  assert.doesNotMatch(db.writes[0].sql, /status='failed'/);
  assert.match(db.writes[0].sql, /SET error=\?, completed_at=NULL/);

  await markUnownedStaleJobs({
    db,
    cutoff: 50,
    now: () => 101,
    ownedJobIds: activeJobs.keys(),
  });
  assert.match(db.writes[1].sql, /id NOT IN \(\?\)/);
  assert.deepEqual(db.writes[1].params, [101, 50, 'stale-owned']);

  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE tool_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        error TEXT,
        completed_at INTEGER,
        heartbeat_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);
    const insert = sqlite.prepare(
      'INSERT INTO tool_jobs (id,status,heartbeat_at,created_at) VALUES (?,?,?,?)',
    );
    insert.run('stale-owned', 'running', 10, 10);
    insert.run('stale-unowned', 'running', 10, 10);
    const marked = await markUnownedStaleJobs({
      db: sqlite,
      cutoff: 50,
      now: () => 102,
      ownedJobIds: activeJobs.keys(),
    });
    assert.equal(marked.changes, 1);
    assert.equal(sqlite.prepare('SELECT status FROM tool_jobs WHERE id=?').get('stale-owned').status, 'running');
    assert.equal(sqlite.prepare('SELECT status FROM tool_jobs WHERE id=?').get('stale-unowned').status, 'failed');
  } finally {
    sqlite.close();
  }
});

test('CHF0 BE-5 unowned restart recovery marks DB truth without signalling an unproven PID', async () => {
  const db = recordingDb();
  const result = await markUnownedStaleJobs({ db, cutoff: 50, now: () => 100 });
  assert.equal(result.changes, 1);
  assert.match(db.writes[0].sql, /进程归属无法证明，未发送信号/);
  assert.deepEqual(db.writes[0].params, [100, 50]);
});

function cancellationFixture(termination, killResult = null) {
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
    killLocalToolJob: () => killResult || ({ active: true, termination: Promise.resolve(termination) }),
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

test('P6 an unconfirmed hard timeout remains running so the cancel route can retry termination', async () => {
  const state = {
    id: 'job-1',
    status: 'running',
    error: null,
    completed_at: null,
    process_pid: 43210,
    heartbeat_at: 100,
  };
  const writes = [];
  const db = {
    prepare(sql) {
      return {
        get() { return { ...state }; },
        run(...params) {
          writes.push({ sql, params });
          if (/SET error=\?, completed_at=NULL/.test(sql)) {
            const [error, jobId] = params;
            if (jobId !== state.id || !['pending', 'running'].includes(state.status)) {
              return { changes: 0 };
            }
            state.error = error;
            state.completed_at = null;
            return { changes: 1 };
          }
          if (/SET status=\?, error=\?, completed_at=\?, process_pid=\?, heartbeat_at=\?/.test(sql)) {
            const [status, error, completedAt, processPid, heartbeatAt, jobId, ...allowed] = params;
            if (jobId !== state.id || !allowed.includes(state.status)) return { changes: 0 };
            Object.assign(state, {
              status,
              error,
              completed_at: completedAt,
              process_pid: processPid,
              heartbeat_at: heartbeatAt,
            });
            return { changes: 1 };
          }
          throw new Error(`unexpected lifecycle/cancel SQL: ${sql}`);
        },
      };
    },
  };

  await enforceHardTimeout({
    active: { process: {}, lastHeartbeatAt: 100 },
    jobId: state.id,
    db,
    hardTimeoutMs: 1234,
    now: () => 500,
    terminate: async () => ({ terminated: false, reason: 'sigkill_exit_unconfirmed' }),
  });
  assert.equal(state.status, 'running');
  assert.equal(state.completed_at, null);
  assert.match(state.error, /终止未确认/);

  const routes = new Map();
  createToolsPlatformRoutes({
    db,
    canAccessToolJob: () => true,
    isCancellableJob: (job) => ['pending', 'running'].includes(job.status),
    handleToolRun() {}, handlePrivateFileRead() {}, handlePrivateFileWrite() {},
    handleGenerateFinalReport() {}, cleanupLocalToolJobDir() {},
    handlePublicDemo() {}, handlePublicFile() {}, handleDemoData() {},
    handleLegacyDemoFile() {}, handleLegacyDemoList() {},
    killLocalToolJob: () => ({
      active: true,
      processStarted: true,
      termination: Promise.resolve({ terminated: true, signal: 'SIGKILL' }),
    }),
  })({
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
    get() {}, delete() {}, put() {},
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await routes.get('POST /api/tools/cancel/:id').at(-1)({ params: { id: state.id } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'cancelled');
  assert.equal(state.status, 'cancelled');
  assert.equal(state.error, null);
  assert.equal(state.process_pid, null);
  assert.equal(state.heartbeat_at, null);
  assert.equal(writes.some((write) => /status='failed'/.test(write.sql)), false);
});

test('P6 cancel accepts an owned preparing job without claiming a process termination', async () => {
  const fixture = cancellationFixture(null, {
    active: true,
    killed: false,
    processStarted: false,
    cancellationAccepted: true,
  });
  const response = await invokeCancel(fixture);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'cancelled');
  assert.equal(response.body.local.processStarted, false);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].params[0], 'cancelled');
});

test('P6 cancel refuses to claim a running process when its execution owner is unavailable', async () => {
  const fixture = cancellationFixture(null, {
    active: false,
    killed: false,
    processStarted: false,
  });
  const response = await invokeCancel(fixture);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'execution_owner_unavailable');
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0].sql, /SET error=\?.*status=\?/);
  assert.equal(fixture.writes[0].params[0], 'cancel_owner_unavailable:process_ownership_unproven');
  assert.notEqual(fixture.writes[0].params[0], 'cancelled');
});

test('P6 cancel owns preparation before capability work and suppresses a later launch', async () => {
  const activeToolJobs = new Map();
  const owner = toolsExecutorTest.claimActiveToolJob(activeToolJobs, {
    jobId: 'job-preparing',
    toolId: 'deseq2',
    now: () => 100,
  });
  assert.equal(activeToolJobs.get('job-preparing'), owner);
  assert.equal(owner.phase, 'preparing');

  let releaseStatusRead;
  const statusRead = new Promise((resolve) => { releaseStatusRead = resolve; });
  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT status/);
      return { get: () => statusRead };
    },
  };
  const launch = toolsExecutorTest.canLaunchOwnedToolJob({
    activeToolJobs,
    db,
    jobId: 'job-preparing',
    owner,
  });
  const cancellation = toolsExecutorTest.requestActiveToolJobCancellation(
    activeToolJobs,
    'job-preparing',
  );
  assert.deepEqual(cancellation, {
    active: true,
    killed: false,
    processStarted: false,
    cancellationAccepted: true,
  });
  releaseStatusRead({ status: 'running' });
  assert.equal(await launch, false, 'the owner flag must win even if the durable read was already in flight');

  assert.equal(
    toolsExecutorTest.releaseActiveToolJob(activeToolJobs, 'job-preparing', owner),
    true,
  );
  const durableOwner = toolsExecutorTest.claimActiveToolJob(activeToolJobs, {
    jobId: 'job-preparing',
    toolId: 'deseq2',
    now: () => 101,
  });
  const cancelledDb = {
    prepare() { return { get: () => ({ status: 'cancelled' }) }; },
  };
  assert.equal(await toolsExecutorTest.canLaunchOwnedToolJob({
    activeToolJobs,
    db: cancelledDb,
    jobId: 'job-preparing',
    owner: durableOwner,
  }), false, 'durable cancelled state must suppress launch even without an in-memory flag');
});

test('P6 concurrent cancellation requests share one in-flight termination attempt', async () => {
  const activeToolJobs = new Map();
  const owner = toolsExecutorTest.claimActiveToolJob(activeToolJobs, {
    jobId: 'job-concurrent-cancel',
    toolId: 'deseq2',
  });
  owner.process = { pid: 43210 };
  owner.phase = 'running';

  let terminateCalls = 0;
  let finishTermination;
  const pendingTermination = new Promise((resolve) => { finishTermination = resolve; });
  const terminate = async () => {
    terminateCalls += 1;
    return pendingTermination;
  };
  const first = toolsExecutorTest.requestActiveToolJobCancellation(
    activeToolJobs,
    'job-concurrent-cancel',
    { terminate },
  );
  const second = toolsExecutorTest.requestActiveToolJobCancellation(
    activeToolJobs,
    'job-concurrent-cancel',
    { terminate },
  );
  await Promise.resolve();
  assert.equal(terminateCalls, 1);
  finishTermination({ terminated: true, signal: 'SIGTERM' });
  assert.equal((await first.termination).terminated, true);
  assert.equal((await second.termination).terminated, true);
  assert.equal(first.killed, true);
  assert.equal(second.killed, true);
});

test('P6 spawned owners arm the hard kill budget before heartbeat monitoring', () => {
  const order = [];
  const hardTimeoutTimer = { kind: 'hard-timeout' };
  const heartbeatTimer = { kind: 'heartbeat', unref() { order.push('heartbeat-unref'); } };
  let heartbeatCallback = null;
  const active = { process: { pid: 43210 } };
  const armed = toolsExecutorTest.armActiveToolJobLifecycle({
    active,
    jobId: 'job-arm-lifecycle',
    db: recordingDb(),
    heartbeatIntervalMs: 30,
    hardTimeoutMs: 300,
    scheduleHardTimeoutFn(args) {
      order.push('hard-timeout');
      assert.equal(args.active, active);
      assert.equal(args.hardTimeoutMs, 300);
      return hardTimeoutTimer;
    },
    setIntervalFn(callback, delay) {
      order.push('heartbeat');
      heartbeatCallback = callback;
      assert.equal(delay, 30);
      return heartbeatTimer;
    },
    refreshHeartbeat(args) {
      order.push('heartbeat-refresh');
      assert.equal(args.active, active);
    },
  });
  assert.deepEqual(order, ['hard-timeout', 'heartbeat', 'heartbeat-unref']);
  assert.deepEqual(armed, { hardTimeoutTimer, heartbeatTimer });
  assert.equal(active.hardTimeoutTimer, hardTimeoutTimer);
  assert.equal(active.heartbeatTimer, heartbeatTimer);
  heartbeatCallback();
  assert.equal(order.at(-1), 'heartbeat-refresh');

  const source = readFileSync(
    new URL('../core/petri-server/helpers/tools-executor.js', import.meta.url),
    'utf8',
  );
  const spawnedOwner = source.indexOf('owner.process = child;');
  const lifecycleArmed = source.indexOf('armActiveToolJobLifecycle({', spawnedOwner);
  const samplerStarted = source.indexOf('resourceSampler.start();', spawnedOwner);
  const processIdentityPersisted = source.indexOf(
    'UPDATE tool_jobs SET process_pid=?, heartbeat_at=?',
    spawnedOwner,
  );
  assert.ok(spawnedOwner >= 0);
  assert.ok(lifecycleArmed > spawnedOwner);
  assert.ok(samplerStarted > lifecycleArmed);
  assert.ok(processIdentityPersisted > samplerStarted);
});

test('P6 a late confirmed exit converges an unconfirmed cancel from running to cancelled', async () => {
  const state = {
    status: 'running',
    error: 'cancel_termination_unconfirmed:sigkill_exit_unconfirmed',
    result_json: null,
    completed_at: null,
    process_pid: 43210,
    heartbeat_at: 100,
  };
  const db = {
    prepare(sql) {
      assert.match(sql, /status=\?, error=\?, result_json=\?/);
      return {
        run(status, error, resultJson, completedAt, processPid, heartbeatAt, jobId, ...allowedStatuses) {
          assert.equal(jobId, 'job-late-exit');
          if (!allowedStatuses.includes(state.status)) return { changes: 0 };
          Object.assign(state, {
            status,
            error,
            result_json: resultJson,
            completed_at: completedAt,
            process_pid: processPid,
            heartbeat_at: heartbeatAt,
          });
          return { changes: 1 };
        },
      };
    },
  };
  const result = toolsExecutorTest.buildCancelledToolResult({
    jobId: 'job-late-exit',
    resourceUsage: { sampling: { status: 'measured' }, peak: {} },
  });
  const settled = await toolsExecutorTest.settleConfirmedToolCancellation({
    db,
    jobId: 'job-late-exit',
    result,
    completedAt: 200,
  });
  assert.equal(settled.changes, 1);
  assert.equal(state.status, 'cancelled');
  assert.equal(state.error, null);
  assert.equal(state.completed_at, 200);
  assert.equal(state.process_pid, null);
  assert.equal(state.heartbeat_at, null);
  assert.equal(JSON.parse(state.result_json).cancellation.processExitConfirmed, true);
});

test('P6 completed and failed terminal CAS cannot overwrite cancellation', async () => {
  const writes = [];
  const db = {
    prepare(sql) {
      return {
        run(...params) {
          writes.push({ sql, params });
          return { changes: 0 };
        },
      };
    },
  };
  const completed = await toolsExecutorTest.transitionToolJobToCompleted({
    db,
    jobId: 'job-cancel-won',
    result: { shouldNotPersist: true },
    completedAt: 200,
  });
  const failed = await toolsExecutorTest.transitionToolJobToFailed({
    db,
    jobId: 'job-cancel-won',
    error: 'should not persist',
    completedAt: 201,
  });
  assert.equal(completed.changes, 0);
  assert.equal(failed.changes, 0);
  assert.match(writes[0].sql, /WHERE id=\? AND status=\?/);
  assert.deepEqual(writes[0].params.slice(-2), ['job-cancel-won', 'running']);
  assert.match(writes[1].sql, /WHERE id=\? AND status IN \(\?,\?\)/);
  assert.deepEqual(writes[1].params.slice(-3), ['job-cancel-won', 'pending', 'running']);
});

test('P6 setup failures release pre-spawn owners and retain unconfirmed live children', async () => {
  const failures = [];
  const markFailed = async (...args) => { failures.push(args); };

  const preparingJobs = new Map();
  const preparingOwner = toolsExecutorTest.claimActiveToolJob(preparingJobs, {
    jobId: 'job-mkdir-failure',
    toolId: 'deseq2',
  });
  const beforeSpawn = await toolsExecutorTest.handleActiveToolJobSetupFailure({
    activeToolJobs: preparingJobs,
    jobId: 'job-mkdir-failure',
    error: new Error('mkdir denied'),
    markFailed,
    terminate: async () => { throw new Error('must not terminate before spawn'); },
  });
  assert.deepEqual(beforeSpawn, { active: true, processStarted: false });
  assert.equal(preparingJobs.has('job-mkdir-failure'), false);
  assert.equal(preparingOwner.setupFailure.reason, 'executor_setup_failure');
  assert.match(failures[0][1], /mkdir denied/);

  const spawnedJobs = new Map();
  const spawnedOwner = toolsExecutorTest.claimActiveToolJob(spawnedJobs, {
    jobId: 'job-pid-write-failure',
    toolId: 'deseq2',
  });
  spawnedOwner.process = { pid: 43210 };
  spawnedOwner.phase = 'running';
  const hardTimeoutTimer = { kind: 'hard-timeout' };
  toolsExecutorTest.armActiveToolJobLifecycle({
    active: spawnedOwner,
    jobId: 'job-pid-write-failure',
    db: recordingDb(),
    heartbeatIntervalMs: 30,
    hardTimeoutMs: 300,
    scheduleHardTimeoutFn: () => hardTimeoutTimer,
    setIntervalFn: () => ({ kind: 'heartbeat', unref() {} }),
  });
  const afterSpawn = await toolsExecutorTest.handleActiveToolJobSetupFailure({
    activeToolJobs: spawnedJobs,
    jobId: 'job-pid-write-failure',
    error: new Error('process_pid write failed'),
    markFailed,
    terminate: async () => ({ terminated: false, reason: 'sigkill_exit_unconfirmed' }),
  });
  assert.equal(afterSpawn.processStarted, true);
  assert.equal(afterSpawn.termination.terminated, false);
  assert.equal(spawnedJobs.get('job-pid-write-failure'), spawnedOwner);
  assert.equal(spawnedOwner.setupFailure.message, 'process_pid write failed');
  assert.equal(spawnedOwner.hardTimeoutTimer, hardTimeoutTimer);
  assert.equal(spawnedOwner.heartbeatTimer, null);
  assert.equal(spawnedOwner.lastHeartbeatAt, 0);
  assert.equal(failures.length, 1, 'unconfirmed child exit must not write terminal failed');

  const retryCancellation = toolsExecutorTest.requestActiveToolJobCancellation(
    spawnedJobs,
    'job-pid-write-failure',
    { terminate: async () => ({ terminated: true, signal: 'SIGKILL' }) },
  );
  const retryFixture = cancellationFixture(null, retryCancellation);
  const retryResponse = await invokeCancel(retryFixture);
  assert.equal(retryResponse.statusCode, 200);
  assert.equal(retryResponse.body.status, 'cancelled');
  assert.equal(retryCancellation.killed, true);
  assert.equal(spawnedOwner.cancelRequested, true);
  assert.equal(failures.length, 1, 'confirmed cancellation must converge through cancelled, not failed');

  const confirmedJobs = new Map();
  const confirmedOwner = toolsExecutorTest.claimActiveToolJob(confirmedJobs, {
    jobId: 'job-confirmed-setup-failure',
    toolId: 'deseq2',
  });
  confirmedOwner.process = { pid: 43211 };
  confirmedOwner.phase = 'running';
  const confirmedSetupFailure = await toolsExecutorTest.handleActiveToolJobSetupFailure({
    activeToolJobs: confirmedJobs,
    jobId: 'job-confirmed-setup-failure',
    error: new Error('sampler setup failed'),
    markFailed,
    terminate: async () => ({ terminated: true, signal: 'SIGTERM' }),
  });
  assert.equal(confirmedSetupFailure.termination.terminated, true);
  assert.equal(confirmedJobs.has('job-confirmed-setup-failure'), false);
  assert.equal(failures.length, 2);
  assert.match(failures[1][1], /termination confirmed.*SIGTERM/);
});
