'use strict';

const path = require('path');
const {
  ResultChangeSetError,
  exactArtifact,
  resourceNumber,
  boundedResourceProduct,
  safeSegment,
  trustedFileSize,
} = require('./internal');

const DEFAULT_PREVIEW_BASE_MEMORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_PREVIEW_INPUT_MEMORY_MULTIPLIER = 4;
const DEFAULT_PREVIEW_OUTPUT_DISK_MULTIPLIER = 2;
const PREVIEW_METADATA_RESERVE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_MODEL_MULTIPLIER = 64;

function trustedPreviewResourceModel(descriptor) {
  const raw = descriptor?.previewResourceModel;
  if (raw == null) {
    return {
      baseMemoryBytes: DEFAULT_PREVIEW_BASE_MEMORY_BYTES,
      inputMemoryMultiplier: DEFAULT_PREVIEW_INPUT_MEMORY_MULTIPLIER,
      outputDiskMultiplier: DEFAULT_PREVIEW_OUTPUT_DISK_MULTIPLIER,
      raster: null,
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin preview resource model is invalid.');
  }
  const baseMemoryBytes = resourceNumber(raw.baseMemoryBytes, { minimum: 1 });
  const inputMemoryMultiplier = resourceNumber(raw.inputMemoryMultiplier, {
    minimum: 0,
    maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
  });
  const outputDiskMultiplier = resourceNumber(raw.outputDiskMultiplier, {
    minimum: 1,
    maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
  });
  if (baseMemoryBytes == null || inputMemoryMultiplier == null || outputDiskMultiplier == null) {
    throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin preview resource model has invalid numeric bounds.');
  }
  let raster = null;
  if (raw.raster != null) {
    const candidate = raw.raster;
    const parameterIds = ['widthParameter', 'heightParameter', 'dpiParameter'];
    const bytesPerPixel = resourceNumber(candidate?.bytesPerPixel, { minimum: 1, maximum: 32 });
    const workingSetMultiplier = resourceNumber(candidate?.workingSetMultiplier, {
      minimum: 1,
      maximum: MAX_RESOURCE_MODEL_MULTIPLIER,
    });
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || parameterIds.some((key) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(candidate[key] || ''))
          || !descriptor?.parameters?.[candidate[key]])
        || bytesPerPixel == null || workingSetMultiplier == null) {
      throw new ResultChangeSetError('preview_resource_model_invalid', 'The trusted plugin raster resource model is invalid.');
    }
    raster = {
      widthParameter: candidate.widthParameter,
      heightParameter: candidate.heightParameter,
      dpiParameter: candidate.dpiParameter,
      bytesPerPixel,
      workingSetMultiplier,
    };
  }
  return { baseMemoryBytes, inputMemoryMultiplier, outputDiskMultiplier, raster };
}

function deriveTrustedPreviewResourceEstimate({
  descriptor,
  sourceResult,
  workspaceRoot,
  trustedExecution,
  sourceOutputPath,
  sourceRevision,
  proposedParameterPatch = {},
  downstreamPlan = [],
} = {}) {
  const model = trustedPreviewResourceModel(descriptor);
  const provenanceInputs = Array.isArray(sourceResult?.executionProvenance?.inputs)
    ? sourceResult.executionProvenance.inputs
    : [];
  let inputBytes = 0;
  for (const input of provenanceInputs) {
    const inputId = safeSegment(input?.id, 'source_input_id');
    const physical = trustedExecution?.runtime?.[inputId];
    if (typeof physical !== 'string' || !path.isAbsolute(physical)) {
      throw new ResultChangeSetError('preview_resource_estimate_unavailable', 'A verified source input is unavailable for resource estimation.');
    }
    inputBytes += trustedFileSize(workspaceRoot, physical, 'preview_resource_estimate_unavailable');
  }

  const descriptorArtifactIds = Array.isArray(descriptor?.artifacts)
    ? descriptor.artifacts.map((artifact) => String(artifact?.id || '').trim()).filter(Boolean)
    : [];
  const selectedOutputBytes = trustedFileSize(workspaceRoot, sourceOutputPath, 'preview_resource_estimate_unavailable');
  let sourceOutputBytes = selectedOutputBytes;
  let sourceOutputMeasurement = 'selected_revision_artifact';
  if (descriptorArtifactIds.length > 0) {
    const descriptorArtifacts = descriptorArtifactIds.map((artifactId) => exactArtifact(sourceResult, artifactId));
    // Historical Revisions may predate complete formal-output cohort registration.
    // Their selected Revision has already passed the exact physical hash check
    // above, so it is a trusted conservative floor. Only use all descriptor
    // outputs when every one has a concrete current physical path; a partial
    // list must never manufacture an estimate from missing artifacts.
    if (descriptorArtifacts.every((artifact) => artifact?.path)) {
      sourceOutputBytes = descriptorArtifacts.reduce((total, artifact) => total + trustedFileSize(
        workspaceRoot,
        artifact.path,
        'preview_resource_estimate_unavailable',
      ), 0);
      sourceOutputMeasurement = 'complete_descriptor_artifacts';
    }
  }
  const downstreamOutputBytes = (Array.isArray(downstreamPlan) ? downstreamPlan : [])
    .reduce((total, entry) => total + trustedFileSize(
      workspaceRoot,
      entry.sourceOutputPath,
      'preview_resource_estimate_unavailable',
    ), 0);

  const usage = sourceResult?.resourceUsage;
  const historicalRssBytes = Number(usage?.sampling?.processSampleCount) > 0
    ? resourceNumber(usage?.peak?.rssBytes, { minimum: 1 })
    : null;
  const inputWorkingSet = boundedResourceProduct(inputBytes, model.inputMemoryMultiplier);
  let memoryBytes = Math.max(
    model.baseMemoryBytes + inputWorkingSet,
    historicalRssBytes == null ? 0 : boundedResourceProduct(historicalRssBytes, 1.25),
  );
  let rasterBytes = 0;
  let rasterParameterSource = null;
  if (model.raster) {
    const parameters = { ...(trustedExecution?.normalized || {}), ...(proposedParameterPatch || {}) };
    const defaultParameter = (parameterId) => resourceNumber(
      descriptor?.parameters?.[parameterId]?.default,
      { minimum: 1 },
    );
    const exactWidth = resourceNumber(parameters[model.raster.widthParameter], { minimum: 1 });
    const exactHeight = resourceNumber(parameters[model.raster.heightParameter], { minimum: 1 });
    const exactDpi = resourceNumber(parameters[model.raster.dpiParameter], { minimum: 1 });
    const width = exactWidth ?? defaultParameter(model.raster.widthParameter);
    const height = exactHeight ?? defaultParameter(model.raster.heightParameter);
    const dpi = exactDpi ?? defaultParameter(model.raster.dpiParameter);
    if (width != null && height != null && dpi != null) {
      rasterParameterSource = exactWidth != null && exactHeight != null && exactDpi != null
        ? 'trusted_execution_parameters'
        : 'trusted_descriptor_defaults_for_legacy_revision';
      rasterBytes = boundedResourceProduct(width, dpi, height, dpi, model.raster.bytesPerPixel);
      memoryBytes = Math.max(memoryBytes, boundedResourceProduct(rasterBytes, model.raster.workingSetMultiplier));
    } else {
      // A pre-descriptor historical revision has no user-provided dimensions to
      // trust. The base/input/output model remains a deterministic server-side
      // guard while the response records that no raster term was available.
      rasterParameterSource = 'not_available_in_legacy_revision';
    }
  }
  const diskBytes = Math.max(
    PREVIEW_METADATA_RESERVE_BYTES,
    boundedResourceProduct(sourceOutputBytes + downstreamOutputBytes, model.outputDiskMultiplier)
      + rasterBytes + PREVIEW_METADATA_RESERVE_BYTES,
  );
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0
      || !Number.isSafeInteger(diskBytes) || diskBytes <= 0) {
    throw new ResultChangeSetError('preview_resource_estimate_unavailable', 'A finite trusted preview resource estimate could not be derived.');
  }
  return {
    estimateVersion: 1,
    source: 'server_job_descriptor_input_truth',
    memoryBytes,
    diskBytes,
    inputBytes,
    sourceOutputBytes,
    sourceOutputMeasurement,
    selectedRevisionId: sourceRevision?.revisionId || null,
    downstreamOutputBytes,
    historicalRssBytes,
    rasterBytes,
    rasterParameterSource,
  };
}

module.exports = {
  trustedPreviewResourceModel,
  deriveTrustedPreviewResourceEstimate,
};
