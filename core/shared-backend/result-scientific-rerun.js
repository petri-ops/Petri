'use strict';

const SCIENTIFIC_RERUN_VERSION = 1;

const DEG_THRESHOLD_PARAMETER_ALIASES = Object.freeze({
  adjusted_p_value_cutoff: Object.freeze(['padj_cutoff', 'padj_threshold']),
  absolute_log2_fold_change_cutoff: Object.freeze(['lfc_cutoff', 'lfc_threshold']),
});

function own(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function parameterNames(descriptor, aliases) {
  const parameters = descriptor?.parameters && typeof descriptor.parameters === 'object'
    ? descriptor.parameters : {};
  return aliases.filter((name) => own(parameters, name));
}

function validDescriptorValue(specification, value) {
  if (!specification || typeof specification !== 'object') return false;
  if (specification.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      && (specification.minimum == null || value >= Number(specification.minimum))
      && (specification.maximum == null || value <= Number(specification.maximum));
  }
  return false;
}

function failure(code, message, detail = null) {
  return { ok: false, code, message, ...(detail == null ? {} : { detail }) };
}

/**
 * Project scientific DEG threshold changes into a downstream descriptor.
 * Both descriptors must name exactly one alias for a changed semantic value;
 * preserving an old child value or guessing an undeclared name is forbidden.
 */
function propagateDegThresholds({
  sourceDescriptor,
  downstreamDescriptor,
  sourceParameterPatch,
  downstreamNormalizedParams,
  downstreamRawParams,
} = {}) {
  const normalized = cloneObject(downstreamNormalizedParams);
  const raw = cloneObject(downstreamRawParams);
  if (!normalized || !raw || !sourceParameterPatch || typeof sourceParameterPatch !== 'object'
      || Array.isArray(sourceParameterPatch)) {
    return failure('downstream_parameter_context_invalid', 'Downstream scientific parameters are not safely serializable objects.');
  }
  const propagated = [];
  for (const [semantic, aliases] of Object.entries(DEG_THRESHOLD_PARAMETER_ALIASES)) {
    const sourceNames = parameterNames(sourceDescriptor, aliases)
      .filter((name) => own(sourceParameterPatch, name));
    if (sourceNames.length === 0) continue;
    if (sourceNames.length !== 1) {
      return failure('source_parameter_mapping_ambiguous', 'A DEG threshold patch maps to more than one declared source parameter.', { semantic, sourceNames });
    }
    const downstreamNames = parameterNames(downstreamDescriptor, aliases);
    if (downstreamNames.length !== 1) {
      return failure('downstream_parameter_mapping_missing', 'A changed DEG threshold has no unique declared downstream parameter.', { semantic, downstreamNames });
    }
    const sourceName = sourceNames[0];
    const downstreamName = downstreamNames[0];
    const value = sourceParameterPatch[sourceName];
    if (!validDescriptorValue(downstreamDescriptor.parameters[downstreamName], value)) {
      return failure('downstream_parameter_value_invalid', 'A propagated DEG threshold violates the downstream descriptor.', { semantic, downstreamName });
    }
    normalized[downstreamName] = value;
    raw[downstreamName] = value;
    propagated.push({ semantic, sourceName, downstreamName, value });
  }
  return {
    ok: true,
    scientificRerunVersion: SCIENTIFIC_RERUN_VERSION,
    normalizedParams: normalized,
    rawParams: raw,
    propagated,
  };
}

module.exports = {
  SCIENTIFIC_RERUN_VERSION,
  DEG_THRESHOLD_PARAMETER_ALIASES,
  propagateDegThresholds,
};
