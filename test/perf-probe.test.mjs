import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import test, { afterEach } from 'node:test';

const require = createRequire(import.meta.url);
const express = require('../core/petri-server/node_modules/express');
const perfProbe = require('../core/petri-server/helpers/perf-probe');
const { requestTimingMiddleware } = require('../core/petri-server/bootstrap');
const registerPerfProbeRoutes = require('../core/petri-server/routes/perf-probe');

async function withServer(configure, run) {
  const app = express();
  configure(app);
  const server = await new Promise((resolve) => {
    const created = app.listen(0, '127.0.0.1', () => resolve(created));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => { perfProbe.disableProbe(); delete process.env.PETRI_PERF_PROBE; });

test('probe stays off and costs nothing unless PETRI_PERF_PROBE=1', () => {
  delete process.env.PETRI_PERF_PROBE;
  assert.equal(perfProbe.envEnabled(), false);
  assert.equal(perfProbe.enableProbe(), false);
  assert.equal(perfProbe.isProbeActive(), false);

  perfProbe.recordRequestTiming({ method: 'GET', route: '/api/tools/status/:id', status: 200, ttfbMs: 5, totalMs: 9 });
  perfProbe.observeBlock(4200);
  assert.deepEqual(perfProbe.snapshotProbe(), { enabled: false, eventLoop: null, requests: [], blocks: [] });

  process.env.PETRI_PERF_PROBE = '1';
  assert.equal(perfProbe.enableProbe(), true);
  assert.equal(perfProbe.isProbeActive(), true);
});

test('route templates never carry job, project, revision or file identity', () => {
  const cases = [
    ['/api/tools/file/job_1257dae3bfda4aa0/volcano.png', '/api/tools/file/:id/:file.png'],
    ['/api/result-studio/revisions/rev_9f2c41ab/artifact', '/api/result-studio/revisions/:id/artifact'],
    ['/api/tools/status/job_02bb39e189d845f9', '/api/tools/status/:id'],
    ['/api/result-studio/interaction', '/api/result-studio/interaction'],
  ];
  for (const [input, expected] of cases) assert.equal(perfProbe.redactRoute(input), expected);

  perfProbe.enableProbe({ force: true });
  perfProbe.recordRequestTiming({ method: 'get', route: '/api/tools/file/job_1257dae3bfda4aa0/deg.csv', status: 200, ttfbMs: 3, totalMs: 7 });
  const snapshot = perfProbe.snapshotProbe();
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].route, 'GET /api/tools/file/:id/:file.csv');
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes('job_1257dae3bfda4aa0'));
  assert.ok(!serialized.includes('deg.csv'));
});

test('an unsampled histogram reports nothing instead of its sentinel values', () => {
  perfProbe.enableProbe({ force: true });
  const { eventLoop } = perfProbe.snapshotProbe();
  assert.equal(eventLoop.samples, 0);
  for (const key of ['minMs', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs']) {
    assert.equal(eventLoop[key], null, `${key} must stay null until a real sample exists`);
  }
});

test('snapshot reports event-loop percentiles, per-route timings and discrete blocks', async () => {
  perfProbe.enableProbe({ force: true });
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  for (const total of [12, 40, 7, 900, 25]) {
    perfProbe.recordRequestTiming({ method: 'GET', route: '/api/result-studio/interaction', status: 200, ttfbMs: total / 2, totalMs: total });
  }
  perfProbe.recordRequestTiming({ method: 'GET', route: '/api/result-studio/interaction', status: 500, ttfbMs: 1, totalMs: 2 });
  perfProbe.observeBlock(2100);
  perfProbe.observeBlock(8200);

  const snapshot = perfProbe.snapshotProbe();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.eventLoop.resolutionMs, perfProbe.RESOLUTION_MS);
  for (const key of ['minMs', 'meanMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs']) {
    assert.ok(Number.isFinite(snapshot.eventLoop[key]), `${key} must be a real sample`);
  }

  const entry = snapshot.requests.find((item) => item.route === 'GET /api/result-studio/interaction');
  assert.equal(entry.count, 6);
  assert.deepEqual(entry.statuses, { 200: 5, 500: 1 });
  assert.equal(entry.totalMs.max, 900);
  assert.ok(entry.totalMs.p50 <= entry.totalMs.p95);
  assert.deepEqual(snapshot.blocks.map((block) => block.lagMs), [2100, 8200]);
});

test('probe endpoints are absent by default and live once the flag is set', async () => {
  delete process.env.PETRI_PERF_PROBE;
  await withServer((app) => registerPerfProbeRoutes(app), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/__perf/event-loop`);
    assert.equal(response.status, 404, 'probe surface must not exist in a normal run');
  });

  process.env.PETRI_PERF_PROBE = '1';
  await withServer((app) => registerPerfProbeRoutes(app), async (baseUrl) => {
    const snapshot = await (await fetch(`${baseUrl}/api/__perf/event-loop`)).json();
    assert.equal(snapshot.enabled, true);

    const reset = await (await fetch(`${baseUrl}/api/__perf/reset`, { method: 'POST' })).json();
    assert.deepEqual(reset, { reset: true, enabled: true });
  });
});

test('the timing middleware records a real served request as a route template', async () => {
  perfProbe.enableProbe({ force: true });
  await withServer((app) => {
    app.use(requestTimingMiddleware);
    app.get('/api/tools/file/:jobId/:filename', (_req, res) => res.send('bytes'));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tools/file/job_1257dae3bfda4aa0/volcano.png`);
    assert.equal(await response.text(), 'bytes');
  });

  const snapshot = perfProbe.snapshotProbe();
  const entry = snapshot.requests.find((item) => item.route.startsWith('GET /api/tools/file/'));
  assert.ok(entry, `middleware recorded nothing: ${JSON.stringify(snapshot.requests)}`);
  assert.equal(entry.route, 'GET /api/tools/file/:jobId/:filename');
  assert.equal(entry.count, 1);
  assert.ok(Number.isFinite(entry.totalMs.max));
  assert.ok(!JSON.stringify(snapshot).includes('job_1257dae3bfda4aa0'));
});

test('reset clears samples without tearing the probe down', () => {
  perfProbe.enableProbe({ force: true });
  perfProbe.recordRequestTiming({ method: 'GET', route: '/api/result-studio/changesets', status: 200, ttfbMs: 4, totalMs: 8 });
  perfProbe.observeBlock(3000);
  assert.equal(perfProbe.resetProbe(), true);

  const snapshot = perfProbe.snapshotProbe();
  assert.equal(snapshot.enabled, true);
  assert.deepEqual(snapshot.requests, []);
  assert.deepEqual(snapshot.blocks, []);

  perfProbe.disableProbe();
  assert.equal(perfProbe.resetProbe(), false);
});
