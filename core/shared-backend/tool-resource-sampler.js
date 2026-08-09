'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createRuntimeResourceSnapshot } = require('./runtime-resource-snapshot');

const DEFAULT_INTERVAL_MS = 500;
const MAX_DIRECTORY_ENTRIES = 20_000;

function finiteNonNegative(value) {
  if (value == null || typeof value === 'boolean'
      || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function directoryBytes(root, maxEntries = MAX_DIRECTORY_ENTRIES) {
  let bytes = 0;
  let entries = 0;
  let readErrors = 0;
  let statErrors = 0;
  const queue = [path.resolve(root)];
  while (queue.length > 0 && entries < maxEntries) {
    const current = queue.pop();
    let children;
    try {
      children = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      readErrors += 1;
      continue;
    }
    for (const child of children) {
      entries += 1;
      if (entries > maxEntries) break;
      const target = path.join(current, child.name);
      if (child.isDirectory()) queue.push(target);
      else if (child.isFile()) {
        try { bytes += (await fs.promises.stat(target)).size; } catch { statErrors += 1; }
      }
    }
  }
  const truncated = entries >= maxEntries;
  return {
    bytes,
    entries,
    truncated,
    readErrors,
    statErrors,
    complete: !truncated && readErrors === 0 && statErrors === 0,
  };
}

function diskSnapshot(target) {
  try {
    const stat = fs.statfsSync(target, { bigint: true });
    const blockSize = stat.bsize;
    const totalBytes = Number(stat.blocks * blockSize);
    const availableBytes = Number(stat.bavail * blockSize);
    return {
      totalBytes,
      availableBytes,
      usePercent: totalBytes > 0 ? ((totalBytes - availableBytes) / totalBytes) * 100 : 0,
    };
  } catch {
    return null;
  }
}

function samplePosixProcess(pid, exec = execFile) {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform === 'win32') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    exec('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], {
      timeout: 1_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) return resolve(null);
      const match = String(stdout || '').trim().match(/^([0-9.]+)\s+([0-9]+)$/);
      if (!match) return resolve(null);
      resolve({ cpuPercent: Number(match[1]), rssBytes: Number(match[2]) * 1024 });
    });
  });
}

function createToolResourceSampler(options = {}) {
  const pid = Number(options.pid);
  const jobDir = path.resolve(String(options.jobDir || '.'));
  const intervalMs = Math.max(100, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const readProcess = options.sampleProcess || ((targetPid) => samplePosixProcess(targetPid));
  const readDirectory = options.sampleDirectory || ((target) => directoryBytes(target));
  const readDisk = options.sampleDisk || diskSnapshot;
  const activeJobs = typeof options.activeJobs === 'function' ? options.activeJobs : () => 0;
  const snapshot = options.createSnapshot || createRuntimeResourceSnapshot;
  let timer = null;
  let pending = null;
  let stopped = false;
  const peak = {
    cpuPercent: null,
    rssBytes: null,
    outputBytes: null,
    activeJobs: null,
    minimumAvailableMemoryBytes: null,
    minimumAvailableDiskBytes: null,
  };
  const sampling = {
    status: 'unavailable',
    intervalMs,
    sampleCount: 0,
    processSampleCount: 0,
    outputSampleCount: 0,
    systemSampleCount: 0,
    directoryTruncated: false,
    directoryReadErrors: 0,
    directoryStatErrors: 0,
    outputMeasurementStatus: 'unavailable',
  };

  const keepMaximum = (field, value) => {
    const measured = finiteNonNegative(value);
    if (measured == null) return;
    peak[field] = peak[field] == null ? measured : Math.max(peak[field], measured);
  };
  const keepMinimum = (field, value) => {
    const measured = finiteNonNegative(value);
    if (measured == null) return;
    peak[field] = peak[field] == null ? measured : Math.min(peak[field], measured);
  };

  async function observe() {
    if (pending) return pending;
    pending = (async () => {
      const [processSample, outputSample] = await Promise.all([
        Promise.resolve(readProcess(pid)).catch(() => null),
        Promise.resolve(readDirectory(jobDir)).catch(() => null),
      ]);
      const disk = readDisk(jobDir);
      const system = snapshot({ disk, activeJobs: activeJobs(), observedAt: new Date().toISOString() });
      sampling.sampleCount += 1;
      sampling.status = 'measured';
      if (processSample) {
        sampling.processSampleCount += 1;
        keepMaximum('cpuPercent', processSample.cpuPercent);
        keepMaximum('rssBytes', processSample.rssBytes);
      }
      if (outputSample) {
        sampling.outputSampleCount += 1;
        keepMaximum('outputBytes', outputSample.bytes);
        sampling.directoryTruncated ||= outputSample.truncated === true;
        sampling.directoryReadErrors += Number(outputSample.readErrors || 0);
        sampling.directoryStatErrors += Number(outputSample.statErrors || 0);
        const complete = outputSample.complete !== false
          && outputSample.truncated !== true
          && Number(outputSample.readErrors || 0) === 0
          && Number(outputSample.statErrors || 0) === 0;
        sampling.outputMeasurementStatus = complete
          && sampling.outputMeasurementStatus !== 'partial'
          ? 'measured'
          : 'partial';
      }
      sampling.systemSampleCount += 1;
      keepMaximum('activeJobs', system.activeJobs);
      keepMinimum('minimumAvailableMemoryBytes', system.memory?.availableBytes);
      keepMinimum('minimumAvailableDiskBytes', system.disk?.availableBytes);
    })().finally(() => { pending = null; });
    return pending;
  }

  function start() {
    if (timer || stopped) return;
    void observe();
    timer = setInterval(() => { void observe(); }, intervalMs);
    timer.unref?.();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!stopped) {
      if (pending) await pending;
      await observe();
      stopped = true;
    }
    return {
      peak: { ...peak },
      sampling: { ...sampling },
      peakStatus: sampling.processSampleCount > 0
        ? 'measured'
        : sampling.sampleCount > 0 ? 'partial_process_peak_unavailable' : 'unavailable',
    };
  }

  return { start, stop, sample: observe };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  createToolResourceSampler,
  directoryBytes,
  diskSnapshot,
  samplePosixProcess,
};
