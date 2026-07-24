'use strict';

const os = require('os');
const { probeAvailableMemoryBytes } = require('./runtime-resource-probe');

const SNAPSHOT_VERSION = 1;

function positiveNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
}

function classifyResourceState({ availableMemoryBytes, diskAvailableBytes, estimatedMemoryBytes = 0 } = {}) {
  const memory = positiveNumber(availableMemoryBytes);
  const disk = positiveNumber(diskAvailableBytes);
  const estimated = positiveNumber(estimatedMemoryBytes);
  if ((memory > 0 && memory < 512 * 1024 * 1024) || (estimated > 0 && memory > 0 && estimated > memory) || (disk > 0 && disk < 512 * 1024 * 1024)) {
    return 'unavailable';
  }
  if ((memory > 0 && memory < 2 * 1024 * 1024 * 1024) || (estimated > 0 && memory > 0 && estimated > memory * 0.7) || (disk > 0 && disk < 5 * 1024 * 1024 * 1024)) {
    return 'warning';
  }
  return 'ready';
}

function createRuntimeResourceSnapshot({ disk = null, runtime = {}, activeJobs = 0, estimatedMemoryBytes = 0, totalMemoryBytes: totalMemoryOverride, availableMemoryBytes: availableMemoryOverride, observedAt = new Date().toISOString() } = {}) {
  const totalMemoryBytes = positiveNumber(totalMemoryOverride, os.totalmem());
  const availableMemoryBytes = positiveNumber(availableMemoryOverride, probeAvailableMemoryBytes());
  const cpuCount = os.cpus().length;
  const snapshot = {
    schemaVersion: SNAPSHOT_VERSION,
    observedAt,
    expiresAt: new Date(new Date(observedAt).getTime() + 30_000).toISOString(),
    platform: `${process.platform}-${process.arch}`,
    cpu: { logicalCores: cpuCount, load1m: Array.isArray(os.loadavg()) ? os.loadavg()[0] : null },
    memory: { totalBytes: totalMemoryBytes, availableBytes: availableMemoryBytes, estimatedBytes: positiveNumber(estimatedMemoryBytes) },
    disk: disk && typeof disk === 'object' ? {
      availableBytes: positiveNumber(disk.availableBytes),
      totalBytes: positiveNumber(disk.totalBytes),
      usePercent: positiveNumber(disk.usePercent),
    } : { availableBytes: null, totalBytes: null, usePercent: null },
    runtime: {
      r: runtime.r === true,
      python: runtime.python === true,
      details: typeof runtime.details === 'string' ? runtime.details.slice(0, 200) : null,
    },
    activeJobs: Math.max(0, Math.floor(Number(activeJobs) || 0)),
  };
  snapshot.state = classifyResourceState({
    availableMemoryBytes,
    diskAvailableBytes: snapshot.disk.availableBytes,
    estimatedMemoryBytes,
  });
  return snapshot;
}

function isResourceSnapshotFresh(snapshot, now = Date.now()) {
  const expires = Date.parse(snapshot?.expiresAt || '');
  return Number.isFinite(expires) && expires > now;
}

module.exports = { SNAPSHOT_VERSION, classifyResourceState, createRuntimeResourceSnapshot, isResourceSnapshotFresh };
