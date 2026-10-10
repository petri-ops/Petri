import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createToolResourceSampler,
  directoryBytes,
} = require('../core/shared-backend/tool-resource-sampler');

test('P6 tool sampler records independent process, output, system and Job peaks', async () => {
  let sample = 0;
  const sampler = createToolResourceSampler({
    pid: 123,
    jobDir: '/not-observed-by-test',
    activeJobs: () => sample + 1,
    sampleProcess: async () => ({ cpuPercent: 10 + sample, rssBytes: 1_000 + sample }),
    sampleDirectory: async () => ({
      bytes: 2_000 + sample,
      truncated: sample === 1,
      complete: sample !== 1,
    }),
    sampleDisk: () => ({ availableBytes: 5_000 - sample, totalBytes: 10_000, usePercent: 50 }),
    createSnapshot: ({ disk, activeJobs }) => ({
      activeJobs,
      memory: { availableBytes: 8_000 - sample },
      disk,
    }),
  });

  await sampler.sample();
  sample = 1;
  await sampler.sample();
  const result = await sampler.stop();
  assert.equal(result.peakStatus, 'measured');
  assert.deepEqual(result.peak, {
    cpuPercent: 11,
    rssBytes: 1_001,
    outputBytes: 2_001,
    activeJobs: 2,
    minimumAvailableMemoryBytes: 7_999,
    minimumAvailableDiskBytes: 4_999,
  });
  assert.equal(result.sampling.sampleCount, 3);
  assert.equal(result.sampling.processSampleCount, 3);
  assert.equal(result.sampling.directoryTruncated, true);
  assert.equal(result.sampling.outputMeasurementStatus, 'partial');
});

test('P6 tool sampler keeps system/output evidence when process sampling is unavailable', async () => {
  const sampler = createToolResourceSampler({
    pid: null,
    jobDir: '/not-observed-by-test',
    sampleProcess: async () => null,
    sampleDirectory: async () => ({ bytes: 8, truncated: false }),
    sampleDisk: () => null,
    createSnapshot: () => ({ activeJobs: 1, memory: { availableBytes: 99 }, disk: {} }),
  });
  const result = await sampler.stop();
  assert.equal(result.peakStatus, 'partial_process_peak_unavailable');
  assert.equal(result.peak.cpuPercent, null);
  assert.equal(result.peak.rssBytes, null);
  assert.equal(result.peak.outputBytes, 8);
  assert.equal(result.peak.activeJobs, 1);
  assert.equal(result.sampling.outputMeasurementStatus, 'measured');
});

test('P6 tool sampler never turns explicit null observations into measured zeroes', async () => {
  const sampler = createToolResourceSampler({
    pid: 123,
    jobDir: '/not-observed-by-test',
    sampleProcess: async () => ({ cpuPercent: null, rssBytes: null }),
    sampleDirectory: async () => ({ bytes: null, truncated: false, complete: true }),
    sampleDisk: () => ({ availableBytes: null }),
    createSnapshot: () => ({
      activeJobs: null,
      memory: { availableBytes: null },
      disk: { availableBytes: null },
    }),
  });
  const result = await sampler.stop();
  assert.deepEqual(result.peak, {
    cpuPercent: null,
    rssBytes: null,
    outputBytes: null,
    activeJobs: null,
    minimumAvailableMemoryBytes: null,
    minimumAvailableDiskBytes: null,
  });
});

test('P6 directory sampler measures physical job bytes without following paths outside the tree', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-resource-sampler-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'output'));
  writeFileSync(path.join(root, 'input.csv'), '12345');
  writeFileSync(path.join(root, 'output', 'result.csv'), '1234567');
  const measured = await directoryBytes(root);
  assert.equal(measured.bytes, 12);
  assert.equal(measured.truncated, false);
  assert.equal(measured.complete, true);
  assert.equal(measured.readErrors, 0);
  assert.equal(measured.statErrors, 0);
});
