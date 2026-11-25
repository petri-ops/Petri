/**
 * Petri shared backend — In-process Metrics (BLOCK-520 P1 / OB-003)
 *
 * 零新依赖、纯内存计数（不引 prom-client）。供 /api/_internal/metrics 读取。
 * 只做观测，不改变任何被观测路径的行为；ring 有界避免长跑无界增长。
 */

const startedAt = Date.now();
const RING = 256;

const ipc = { total: 0, failed: 0, byChannel: Object.create(null) };
const db = { writeCount: 0, writeTotalMs: 0, recentMs: [] };
const backend = { restarts: 0 };
const breakers = Object.create(null);

function channelBucket(channel) {
  const key = String(channel || 'unknown');
  if (!ipc.byChannel[key]) ipc.byChannel[key] = { total: 0, failed: 0, lastMs: 0 };
  return ipc.byChannel[key];
}

function recordIpc({ channel, durationMs = 0, ok = true } = {}) {
  const bucket = channelBucket(channel);
  ipc.total += 1;
  bucket.total += 1;
  bucket.lastMs = durationMs;
  if (!ok) {
    ipc.failed += 1;
    bucket.failed += 1;
  }
}

function recordDbWrite(ms = 0) {
  db.writeCount += 1;
  db.writeTotalMs += ms;
  db.recentMs.push(ms);
  if (db.recentMs.length > RING) db.recentMs.shift();
}

function recordBackendRestart() {
  backend.restarts += 1;
}

function setBreakerState(name, state) {
  if (name == null) return;
  breakers[String(name)] = String(state);
}

function getMetricsSnapshot() {
  return {
    capturedAt: new Date().toISOString(),
    uptimeMs: Date.now() - startedAt,
    ipc: {
      total: ipc.total,
      failed: ipc.failed,
      byChannel: { ...ipc.byChannel },
    },
    db: {
      writeCount: db.writeCount,
      writeAvgMs: db.writeCount ? db.writeTotalMs / db.writeCount : 0,
      recentWriteMs: [...db.recentMs],
    },
    backend: { restarts: backend.restarts },
    breakers: { ...breakers },
  };
}

function resetMetrics() {
  ipc.total = 0;
  ipc.failed = 0;
  for (const k of Object.keys(ipc.byChannel)) delete ipc.byChannel[k];
  db.writeCount = 0;
  db.writeTotalMs = 0;
  db.recentMs.length = 0;
  backend.restarts = 0;
  for (const k of Object.keys(breakers)) delete breakers[k];
}

module.exports = {
  recordIpc,
  recordDbWrite,
  recordBackendRestart,
  setBreakerState,
  getMetricsSnapshot,
  resetMetrics,
};
