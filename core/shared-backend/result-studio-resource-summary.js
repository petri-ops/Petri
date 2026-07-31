'use strict';

const RESULT_STUDIO_RESOURCE_SUMMARY_VERSION = 1;

function finiteNonNegative(value) {
  if (value == null || typeof value === 'boolean'
      || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseResult(job) {
  const value = job?.result ?? job?.result_json ?? null;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function maximum(values) {
  const measured = values.map(finiteNonNegative).filter((value) => value != null);
  return measured.length > 0 ? Math.max(...measured) : null;
}

function minimum(values) {
  const measured = values.map(finiteNonNegative).filter((value) => value != null);
  return measured.length > 0 ? Math.min(...measured) : null;
}

function measurement(value, unit, unavailableReason) {
  return value == null
    ? { status: 'unavailable', value: null, unit, reason: unavailableReason }
    : { status: 'measured', value, unit, reason: null };
}

function boundedMeasurement(value, unit, incomplete, unavailableReason) {
  if (value == null) return measurement(null, unit, unavailableReason);
  return incomplete
    ? { status: 'partial', value, unit, reason: 'job_output_scan_incomplete_lower_bound' }
    : measurement(value, unit, unavailableReason);
}

function providerProjection(providerUsage) {
  const exact = providerUsage?.binding === 'exact_change_set'
    && providerUsage?.status === 'measured';
  if (!exact) {
    const unavailable = {
      status: 'unavailable',
      value: null,
      reason: 'provider_usage_not_bound_to_change_set',
    };
    return {
      tokens: { ...unavailable, unit: 'tokens' },
      cache: { ...unavailable, unit: 'tokens' },
      cost: { ...unavailable, unit: providerUsage?.currency || null },
    };
  }

  const inputTokens = finiteNonNegative(providerUsage.inputTokens);
  const outputTokens = finiteNonNegative(providerUsage.outputTokens);
  const cacheReadTokens = finiteNonNegative(providerUsage.cacheReadTokens);
  const tokensMeasured = inputTokens != null && outputTokens != null;
  const cacheMeasured = cacheReadTokens != null;
  const currency = typeof providerUsage.currency === 'string' && providerUsage.currency.trim()
    ? providerUsage.currency.trim()
    : null;
  const measuredCost = providerUsage.costStatus === 'measured'
    ? finiteNonNegative(providerUsage.cost)
    : null;
  const exactCost = measuredCost != null && currency ? measuredCost : null;
  return {
    tokens: tokensMeasured
      ? {
        status: 'measured',
        value: { input: inputTokens, output: outputTokens },
        unit: 'tokens',
        reason: null,
      }
      : {
        status: 'unavailable', value: null, unit: 'tokens', reason: 'provider_token_usage_incomplete',
      },
    cache: cacheMeasured
      ? { status: 'measured', value: { read: cacheReadTokens }, unit: 'tokens', reason: null }
      : {
        status: 'unavailable', value: null, unit: 'tokens', reason: 'provider_cache_usage_incomplete',
      },
    cost: exactCost != null
      ? {
        status: 'measured', value: exactCost, unit: currency, reason: null,
      }
      : {
        status: 'unavailable',
        value: null,
        unit: currency,
        reason: providerUsage.costStatus === 'estimated'
          ? 'estimated_cost_not_presented_as_measurement'
          : measuredCost != null && !currency
            ? 'provider_cost_currency_missing'
          : 'provider_cost_usage_incomplete',
      },
  };
}

function buildResultStudioTaskResourceSummary({ jobs = [], providerUsage = null } = {}) {
  const authoritativeJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  const results = authoritativeJobs.map(parseResult);
  const usages = results.map((result) => result.resourceUsage || {});
  const peaks = usages.map((usage) => usage.peak || {});
  const snapshots = usages.flatMap((usage) => [usage.start, usage.end].filter(Boolean));
  const statuses = authoritativeJobs.map((job) => String(job.status || '').toLowerCase());
  const sampleCount = usages.reduce((total, usage) => (
    total + (Number.isInteger(usage?.sampling?.sampleCount) ? usage.sampling.sampleCount : 0)
  ), 0);

  const cpuPeakPercent = maximum(peaks.map((peak) => peak.cpuPercent));
  const processPeakRssBytes = maximum(peaks.map((peak) => peak.rssBytes));
  const outputPeakBytes = maximum(peaks.map((peak) => peak.outputBytes));
  const outputScanIncomplete = usages.some((usage) => {
    const sampling = usage?.sampling || {};
    return sampling.outputMeasurementStatus === 'partial'
      || sampling.directoryTruncated === true
      || Number(sampling.directoryReadErrors || 0) > 0
      || Number(sampling.directoryStatErrors || 0) > 0;
  });
  const concurrentJobPeak = maximum(peaks.map((peak) => peak.activeJobs));
  const minimumAvailableMemoryBytes = minimum([
    ...snapshots.map((snapshot) => snapshot?.memory?.availableBytes),
    ...peaks.map((peak) => peak.minimumAvailableMemoryBytes),
  ]);
  const minimumAvailableDiskBytes = minimum([
    ...snapshots.map((snapshot) => snapshot?.disk?.availableBytes),
    ...peaks.map((peak) => peak.minimumAvailableDiskBytes),
  ]);

  return {
    resultStudioResourceSummaryVersion: RESULT_STUDIO_RESOURCE_SUMMARY_VERSION,
    scope: 'change_set_candidate_jobs',
    jobs: {
      total: authoritativeJobs.length,
      completed: statuses.filter((status) => ['completed', 'done'].includes(status)).length,
      failed: statuses.filter((status) => status === 'failed').length,
      cancelled: statuses.filter((status) => status === 'cancelled').length,
      peakConcurrent: measurement(concurrentJobPeak, 'jobs', 'job_concurrency_peak_not_sampled'),
    },
    cpu: {
      peakPercent: measurement(cpuPeakPercent, 'percent', 'process_cpu_peak_not_sampled'),
    },
    memory: {
      processPeakRssBytes: measurement(processPeakRssBytes, 'bytes', 'process_memory_peak_not_sampled'),
      minimumSystemAvailableBytes: measurement(
        minimumAvailableMemoryBytes,
        'bytes',
        'system_memory_snapshot_unavailable',
      ),
    },
    disk: {
      outputPeakBytes: boundedMeasurement(
        outputPeakBytes,
        'bytes',
        outputScanIncomplete,
        'job_output_peak_not_sampled',
      ),
      minimumSystemAvailableBytes: measurement(
        minimumAvailableDiskBytes,
        'bytes',
        'system_disk_snapshot_unavailable',
      ),
    },
    sampling: sampleCount > 0
      ? { status: 'measured', sampleCount }
      : { status: 'unavailable', sampleCount: null, reason: 'process_sampler_unavailable' },
    provider: providerProjection(providerUsage),
  };
}

module.exports = {
  RESULT_STUDIO_RESOURCE_SUMMARY_VERSION,
  buildResultStudioTaskResourceSummary,
};
