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

function partialMeasurement(value, unit, incomplete, unavailableReason, partialReason) {
  if (value == null) return measurement(null, unit, unavailableReason);
  return incomplete
    ? { status: 'partial', value, unit, reason: partialReason }
    : measurement(value, unit, unavailableReason);
}

function jobMetricCoverage(values) {
  const normalized = values.map(finiteNonNegative);
  return {
    values: normalized.filter((value) => value != null),
    incomplete: normalized.some((value) => value == null),
  };
}

function aggregateJobMetric(values, { mode = 'maximum', unit, unavailableReason, partialReason }) {
  const coverage = jobMetricCoverage(values);
  const value = coverage.values.length === 0
    ? null
    : mode === 'minimum'
      ? Math.min(...coverage.values)
      : Math.max(...coverage.values);
  return partialMeasurement(value, unit, coverage.incomplete, unavailableReason, partialReason);
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
  const statuses = authoritativeJobs.map((job) => String(job.status || '').toLowerCase());
  const sampleCount = usages.reduce((total, usage) => (
    total + (Number.isInteger(usage?.sampling?.sampleCount) ? usage.sampling.sampleCount : 0)
  ), 0);
  const samplingCoverage = usages.map((usage) => {
    const sampling = usage?.sampling || {};
    return Number.isInteger(sampling.sampleCount)
      && sampling.sampleCount > 0
      && (sampling.status == null || sampling.status === 'measured');
  });
  const anySampling = samplingCoverage.some(Boolean);
  const samplingIncomplete = samplingCoverage.some((measured) => !measured);
  const outputScanIncomplete = usages.some((usage) => {
    const sampling = usage?.sampling || {};
    return finiteNonNegative(usage?.peak?.outputBytes) == null
      || sampling.outputMeasurementStatus !== 'measured'
      || sampling.directoryTruncated === true
      || Number(sampling.directoryReadErrors || 0) > 0
      || Number(sampling.directoryStatErrors || 0) > 0;
  });
  const jobMinimumMemory = usages.map((usage) => minimum([
    usage?.start?.memory?.availableBytes,
    usage?.end?.memory?.availableBytes,
    usage?.peak?.minimumAvailableMemoryBytes,
  ]));
  const jobMinimumDisk = usages.map((usage) => minimum([
    usage?.start?.disk?.availableBytes,
    usage?.end?.disk?.availableBytes,
    usage?.peak?.minimumAvailableDiskBytes,
  ]));

  return {
    resultStudioResourceSummaryVersion: RESULT_STUDIO_RESOURCE_SUMMARY_VERSION,
    scope: 'change_set_candidate_jobs',
    jobs: {
      total: authoritativeJobs.length,
      completed: statuses.filter((status) => ['completed', 'done'].includes(status)).length,
      failed: statuses.filter((status) => status === 'failed').length,
      cancelled: statuses.filter((status) => status === 'cancelled').length,
      peakConcurrent: aggregateJobMetric(peaks.map((peak) => peak.activeJobs), {
        unit: 'jobs',
        unavailableReason: 'job_concurrency_peak_not_sampled',
        partialReason: 'job_resource_coverage_incomplete_lower_bound',
      }),
    },
    cpu: {
      peakPercent: aggregateJobMetric(peaks.map((peak) => peak.cpuPercent), {
        unit: 'percent',
        unavailableReason: 'process_cpu_peak_not_sampled',
        partialReason: 'job_resource_coverage_incomplete_lower_bound',
      }),
    },
    memory: {
      processPeakRssBytes: aggregateJobMetric(peaks.map((peak) => peak.rssBytes), {
        unit: 'bytes',
        unavailableReason: 'process_memory_peak_not_sampled',
        partialReason: 'job_resource_coverage_incomplete_lower_bound',
      }),
      minimumSystemAvailableBytes: aggregateJobMetric(jobMinimumMemory, {
        mode: 'minimum',
        unit: 'bytes',
        unavailableReason: 'system_memory_snapshot_unavailable',
        partialReason: 'job_resource_coverage_incomplete_bound',
      }),
    },
    disk: {
      outputPeakBytes: partialMeasurement(
        maximum(peaks.map((peak) => peak.outputBytes)),
        'bytes',
        outputScanIncomplete,
        'job_output_peak_not_sampled',
        'job_output_scan_incomplete_lower_bound',
      ),
      minimumSystemAvailableBytes: aggregateJobMetric(jobMinimumDisk, {
        mode: 'minimum',
        unit: 'bytes',
        unavailableReason: 'system_disk_snapshot_unavailable',
        partialReason: 'job_resource_coverage_incomplete_bound',
      }),
    },
    sampling: anySampling
      ? samplingIncomplete
        ? { status: 'partial', sampleCount, reason: 'job_sampling_coverage_incomplete' }
        : { status: 'measured', sampleCount }
      : { status: 'unavailable', sampleCount: null, reason: 'process_sampler_unavailable' },
    provider: providerProjection(providerUsage),
  };
}

module.exports = {
  RESULT_STUDIO_RESOURCE_SUMMARY_VERSION,
  buildResultStudioTaskResourceSummary,
};
