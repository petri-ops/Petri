'use strict';

const path = require('path');

function isManagedResultDir(candidate, jobsDir) {
  if (!candidate || !jobsDir) return false;
  const resolved = path.resolve(String(candidate));
  const roots = [path.resolve(jobsDir), path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs')];
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function parseStoredToolResult(job) {
  if (!job || !job.result_json) return null;
  try {
    const result = typeof job.result_json === 'string'
      ? JSON.parse(job.result_json)
      : job.result_json;
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function mergeFinalOutputMeasurement(resourceUsage, finalOutput) {
  if (!resourceUsage?.peak || !resourceUsage?.sampling || !finalOutput) return resourceUsage;
  const bytes = Number(finalOutput.bytes);
  if (Number.isFinite(bytes) && bytes >= 0) {
    const previous = Number(resourceUsage.peak.outputBytes);
    resourceUsage.peak.outputBytes = Number.isFinite(previous) && previous >= 0
      ? Math.max(previous, bytes)
      : bytes;
  }
  resourceUsage.sampling.outputSampleCount = Number(
    resourceUsage.sampling.outputSampleCount || 0,
  ) + 1;
  resourceUsage.sampling.directoryTruncated ||= finalOutput.truncated === true;
  resourceUsage.sampling.directoryReadErrors = Number(
    resourceUsage.sampling.directoryReadErrors || 0,
  ) + Number(finalOutput.readErrors || 0);
  resourceUsage.sampling.directoryStatErrors = Number(
    resourceUsage.sampling.directoryStatErrors || 0,
  ) + Number(finalOutput.statErrors || 0);
  const complete = finalOutput.complete !== false
    && finalOutput.truncated !== true
    && Number(finalOutput.readErrors || 0) === 0
    && Number(finalOutput.statErrors || 0) === 0;
  resourceUsage.sampling.outputMeasurementStatus = complete
    && resourceUsage.sampling.outputMeasurementStatus !== 'partial'
    ? 'measured'
    : 'partial';
  return resourceUsage;
}

function buildCancelledToolResult({
  existingResult = null,
  jobId,
  resourceUsage,
  executionProvenance = null,
  provenanceRef = null,
} = {}) {
  const result = existingResult && typeof existingResult === 'object' && !Array.isArray(existingResult)
    ? { ...existingResult }
    : {};
  result.toolJobId = jobId;
  result.cancellation = {
    phase: 'execute',
    reason: 'user_stop',
    terminalStatus: 'cancelled',
    processExitConfirmed: true,
  };
  result.resourceUsage = resourceUsage;
  if (executionProvenance) result.executionProvenance = executionProvenance;
  if (provenanceRef) result.provenanceRef = provenanceRef;
  return result;
}

function buildFailedToolResult({
  existingResult = null,
  jobId,
  reason,
  exitCode = null,
  resourceUsage,
  executionProvenance = null,
  provenanceRef = null,
} = {}) {
  const result = existingResult && typeof existingResult === 'object' && !Array.isArray(existingResult)
    ? { ...existingResult }
    : {};
  result.toolJobId = jobId;
  result.failure = { phase: 'execute', reason, exitCode };
  result.resourceUsage = resourceUsage;
  if (executionProvenance) result.executionProvenance = executionProvenance;
  if (provenanceRef) result.provenanceRef = provenanceRef;
  return result;
}


module.exports = {
  isManagedResultDir,
  parseStoredToolResult,
  mergeFinalOutputMeasurement,
  buildCancelledToolResult,
  buildFailedToolResult,
};
