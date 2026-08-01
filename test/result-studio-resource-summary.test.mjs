import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildResultStudioTaskResourceSummary,
} = require('../core/shared-backend/result-studio-resource-summary');

function job(status, resourceUsage) {
  return { status, result: { resourceUsage } };
}

test('P6 task summary aggregates measured Job peaks and keeps unbound Provider usage unavailable', () => {
  const summary = buildResultStudioTaskResourceSummary({
    jobs: [
      job('completed', {
        start: { memory: { availableBytes: 900 }, disk: { availableBytes: 5_000 } },
        end: { memory: { availableBytes: 700 }, disk: { availableBytes: 4_500 } },
        peak: {
          cpuPercent: 42.5,
          rssBytes: 1_024,
          outputBytes: 2_048,
          activeJobs: 2,
          minimumAvailableMemoryBytes: 650,
          minimumAvailableDiskBytes: 4_000,
        },
        sampling: { sampleCount: 4, outputMeasurementStatus: 'measured' },
      }),
      job('failed', {
        peak: {
          cpuPercent: 50,
          rssBytes: 2_048,
          outputBytes: 4_096,
          activeJobs: 3,
          minimumAvailableMemoryBytes: 675,
          minimumAvailableDiskBytes: 4_200,
        },
        sampling: { sampleCount: 2, outputMeasurementStatus: 'measured' },
      }),
    ],
  });

  assert.equal(summary.jobs.total, 2);
  assert.equal(summary.jobs.completed, 1);
  assert.equal(summary.jobs.failed, 1);
  assert.deepEqual(summary.jobs.peakConcurrent, {
    status: 'measured', value: 3, unit: 'jobs', reason: null,
  });
  assert.equal(summary.cpu.peakPercent.value, 50);
  assert.equal(summary.memory.processPeakRssBytes.value, 2_048);
  assert.equal(summary.memory.minimumSystemAvailableBytes.value, 650);
  assert.equal(summary.disk.outputPeakBytes.value, 4_096);
  assert.equal(summary.disk.minimumSystemAvailableBytes.value, 4_000);
  assert.deepEqual(summary.sampling, { status: 'measured', sampleCount: 6 });
  for (const item of Object.values(summary.provider)) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.value, null);
  }
});

test('P6 task summary accepts only exact Provider binding and never presents estimated cost as measured', () => {
  const exact = buildResultStudioTaskResourceSummary({
    providerUsage: {
      binding: 'exact_change_set',
      status: 'measured',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 20,
      cost: 0.002,
      costStatus: 'estimated',
      currency: 'CNY',
    },
  });
  assert.deepEqual(exact.provider.tokens.value, { input: 120, output: 30 });
  assert.deepEqual(exact.provider.cache.value, { read: 20 });
  assert.equal(exact.provider.cost.status, 'unavailable');
  assert.equal(exact.provider.cost.value, null);
  assert.equal(exact.provider.cost.reason, 'estimated_cost_not_presented_as_measurement');

  const measured = buildResultStudioTaskResourceSummary({
    providerUsage: {
      binding: 'exact_change_set', status: 'measured', inputTokens: 1, outputTokens: 2,
      cacheReadTokens: 0, cost: 0.25, costStatus: 'measured', currency: 'USD',
    },
  });
  assert.deepEqual(measured.provider.cost, {
    status: 'measured', value: 0.25, unit: 'USD', reason: null,
  });

  const missingCurrency = buildResultStudioTaskResourceSummary({
    providerUsage: {
      binding: 'exact_change_set', status: 'measured', inputTokens: 1, outputTokens: 2,
      cacheReadTokens: 0, cost: 0.25, costStatus: 'measured',
    },
  });
  assert.deepEqual(missingCurrency.provider.cost, {
    status: 'unavailable', value: null, unit: null, reason: 'provider_cost_currency_missing',
  });
});

test('P6 task summary does not turn absent measurements into zeroes', () => {
  const summary = buildResultStudioTaskResourceSummary({ jobs: [job('cancelled', {})] });
  assert.equal(summary.jobs.cancelled, 1);
  assert.equal(summary.cpu.peakPercent.value, null);
  assert.equal(summary.memory.processPeakRssBytes.value, null);
  assert.equal(summary.disk.outputPeakBytes.value, null);
  assert.equal(summary.jobs.peakConcurrent.value, null);
  assert.equal(summary.sampling.status, 'unavailable');
});

test('P6 task summary marks mixed Job resource coverage as partial instead of measured', () => {
  const summary = buildResultStudioTaskResourceSummary({
    jobs: [
      job('completed', {
        start: { memory: { availableBytes: 900 }, disk: { availableBytes: 5_000 } },
        end: { memory: { availableBytes: 700 }, disk: { availableBytes: 4_500 } },
        peak: {
          cpuPercent: 50,
          rssBytes: 2_048,
          outputBytes: 4_096,
          activeJobs: 2,
          minimumAvailableMemoryBytes: 650,
          minimumAvailableDiskBytes: 4_000,
        },
        sampling: { status: 'measured', sampleCount: 3, outputMeasurementStatus: 'measured' },
      }),
      job('failed', {}),
    ],
  });

  assert.equal(summary.cpu.peakPercent.status, 'partial');
  assert.equal(summary.memory.processPeakRssBytes.status, 'partial');
  assert.equal(summary.memory.minimumSystemAvailableBytes.status, 'partial');
  assert.equal(summary.disk.outputPeakBytes.status, 'partial');
  assert.equal(summary.disk.minimumSystemAvailableBytes.status, 'partial');
  assert.equal(summary.jobs.peakConcurrent.status, 'partial');
  assert.deepEqual(summary.sampling, {
    status: 'partial', sampleCount: 3, reason: 'job_sampling_coverage_incomplete',
  });
});

test('P6 task summary keeps explicit null and partial output facts honest', () => {
  const summary = buildResultStudioTaskResourceSummary({
    jobs: [job('completed', {
      peak: {
        cpuPercent: null,
        rssBytes: null,
        outputBytes: 4096,
        activeJobs: null,
        minimumAvailableMemoryBytes: null,
        minimumAvailableDiskBytes: null,
      },
      start: { memory: { availableBytes: null }, disk: { availableBytes: null } },
      sampling: {
        sampleCount: 1,
        outputMeasurementStatus: 'partial',
        directoryTruncated: true,
      },
    })],
    providerUsage: {
      binding: 'exact_change_set',
      status: 'measured',
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cost: null,
      costStatus: 'measured',
    },
  });
  assert.equal(summary.cpu.peakPercent.status, 'unavailable');
  assert.equal(summary.memory.processPeakRssBytes.status, 'unavailable');
  assert.equal(summary.jobs.peakConcurrent.status, 'unavailable');
  assert.deepEqual(summary.disk.outputPeakBytes, {
    status: 'partial',
    value: 4096,
    unit: 'bytes',
    reason: 'job_output_scan_incomplete_lower_bound',
  });
  assert.equal(summary.provider.tokens.status, 'unavailable');
  assert.equal(summary.provider.cache.status, 'unavailable');
  assert.equal(summary.provider.cost.status, 'unavailable');
});
