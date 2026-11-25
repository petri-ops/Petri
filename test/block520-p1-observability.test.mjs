/**
 * BLOCK-520 P1 — HK-01 红绿先行契约
 * OB-002 IPC trace 贯穿 / OB-003 进程内 metrics + /api/_internal/metrics /
 * OB-005 health 四端点同 shape（readiness/liveness）。零新依赖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const METRICS = path.join(ROOT, 'core/shared-backend/metrics.js');
const HEALTH = path.join(ROOT, 'core/shared-backend/health.js');
const TRACE = path.join(ROOT, 'core/shared-backend/ipc-trace.js');

// ---- OB-003 metrics ----------------------------------------------------

test('OB-003 metrics 缺位模块已建：纯内存计数/延迟/重启/breaker 状态', () => {
  assert.ok(fs.existsSync(METRICS), 'core/shared-backend/metrics.js 必须新建');
  const m = require(METRICS);
  m.resetMetrics();
  m.recordIpc({ channel: 'app:notify', durationMs: 12, ok: true });
  m.recordIpc({ channel: 'app:notify', durationMs: 20, ok: false });
  m.recordDbWrite(8);
  m.recordDbWrite(16);
  m.recordBackendRestart();
  m.setBreakerState('gateway', 'open');
  const snap = m.getMetricsSnapshot();
  assert.equal(snap.ipc.total, 2);
  assert.equal(snap.ipc.byChannel['app:notify'].total, 2);
  assert.equal(snap.ipc.byChannel['app:notify'].failed, 1);
  assert.ok(snap.db.writeCount === 2 && snap.db.writeAvgMs >= 12);
  assert.equal(snap.backend.restarts, 1);
  assert.equal(snap.breakers.gateway, 'open');
  assert.ok(typeof snap.uptimeMs === 'number' && snap.capturedAt);
});

test('OB-003 /api/_internal/metrics 路由已注册（后端可读快照）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/server-main.js'), 'utf-8');
  assert.match(src, /\/api\/_internal\/metrics/);
});

// ---- OB-005 health -----------------------------------------------------

test('OB-005 health 统一 shape：四端点同构 + readiness/liveness 区分', () => {
  assert.ok(fs.existsSync(HEALTH), 'core/shared-backend/health.js 必须新建');
  const h = require(HEALTH);
  const ready = h.buildHealthShape({ service: 'petri-r', readiness: true, details: { db: true } });
  const live = h.buildHealthShape({ service: 'petri-r', readiness: false, details: { db: false } });
  assert.equal(ready.status, 'ok');
  assert.equal(live.status, 'degraded');
  assert.equal(ready.readiness, true);
  assert.equal(live.readiness, false);
  assert.equal(ready.liveness, true); // 进程能返回即 liveness
  for (const key of ['status', 'service', 'timestamp', 'readiness', 'liveness', 'details']) {
    assert.ok(Object.prototype.hasOwnProperty.call(ready, key), `统一 shape 必须含 ${key}`);
  }
  // 四端点源码均引用统一构造器（保留原字段 additive）
  const files = [
    'core/petri-server/server-main.js',
    'core/petri-server/routes/index.js',
    'core/petri-server/mobile-gateway/index.js',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    assert.match(src, /buildHealthShape|shared-backend\/health/, `${rel} 必须引用统一 health shape`);
  }
});

// ---- OB-002 IPC trace ---------------------------------------------------

test('OB-002 IPC trace 贯穿：rid 生成器 + 全局 handle 包装 + spawn env 注入', () => {
  // rid 模块（纯函数，可单测）
  assert.ok(fs.existsSync(TRACE), 'core/shared-backend/ipc-trace.js 必须新建');
  const t = require(TRACE);
  const rid = t.newRid();
  assert.ok(typeof rid === 'string' && rid.length > 8, 'rid 须为非空串');
  t.traceIpc({ rid, channel: 'app:notify', phase: 'invoke' });
  t.traceIpc({ rid, channel: 'app:notify', phase: 'handler' });
  const timeline = t.getTraceTimeline(rid);
  assert.equal(timeline.length, 2);
  assert.deepEqual(timeline.map((e) => e.phase), ['invoke', 'handler']);

  // main.js 在 handle 注册前装全局包装（rid 可选参数向后兼容）
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf-8');
  assert.match(mainSrc, /installGlobalIpcTrace|_ipc-trace/);

  // preload 自包含：生成/透传 rid（不 require 本地模块）
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf-8');
  assert.match(preload, /petriTraceRid|__petriRid|traceRid/);

  // backend spawn env 注入 rid
  const mgr = fs.readFileSync(path.join(ROOT, 'src/main/backend-proc-manager.js'), 'utf-8');
  assert.match(mgr, /PETRI_TRACE_RID/);
});

test('OB-002 全局 handle 包装：rid 尾参被摘走、handler 参数零漂移、时间轴与计数', async () => {
  const { installGlobalIpcTrace } = require(path.join(ROOT, 'src/ipc/_ipc-trace.js'));
  const trace = require(TRACE);
  const metrics = require(METRICS);
  trace.clearTraces();
  metrics.resetMetrics();
  const fake = { handlers: {}, handle(ch, fn) { this.handlers[ch] = fn; } };
  installGlobalIpcTrace(fake, { trace, metrics });
  let got = null;
  fake.handle('p1:probe', (_event, a, b) => { got = [a, b]; return 'ok'; });
  const rid = trace.newRid();
  const result = await fake.handlers['p1:probe']({ senderId: 7 }, { x: 1 }, 'tail', { __petriRid: rid });
  assert.equal(result, 'ok');
  assert.deepEqual(got, [{ x: 1 }, 'tail'], 'rid 尾参须被摘走，handler 参数零漂移');
  assert.deepEqual(trace.getTraceTimeline(rid).map((e) => e.phase), ['handler', 'done']);
  assert.equal(metrics.getMetricsSnapshot().ipc.total, 1);
});
