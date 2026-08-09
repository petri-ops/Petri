import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS,
  propagateDegThresholds,
} = require('../core/shared-backend/result-scientific-rerun');

function parameter(type = 'number', extra = {}) {
  return { type, ...extra };
}

test('P6 exposes only the admitted direct DEG child primary artifacts as a frozen mapping', () => {
  assert.deepEqual(DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS, {
    'go-kegg': 'go_bp_results',
    'volcano-plot': 'volcano',
  });
  assert.equal(Object.isFrozen(DEG_DIRECT_CHILD_PRIMARY_ARTIFACTS), true);
});

test('P5 propagates changed DEG thresholds into the exact GO/KEGG descriptor names', () => {
  const result = propagateDegThresholds({
    sourceDescriptor: { parameters: {
      padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }),
      lfc_cutoff: parameter('number', { minimum: 0 }),
    } },
    downstreamDescriptor: { parameters: {
      padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }),
      lfc_cutoff: parameter('number', { minimum: 0 }),
      enrich_qvalue: parameter('number', { minimum: 0, maximum: 1 }),
    } },
    sourceParameterPatch: { padj_cutoff: 0.01, lfc_cutoff: 1.5 },
    downstreamNormalizedParams: { padj_cutoff: 0.05, lfc_cutoff: 1, enrich_qvalue: 0.2 },
    downstreamRawParams: { padj_cutoff: 0.05, lfc_cutoff: 1, enrich_qvalue: 0.2 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.normalizedParams.padj_cutoff, 0.01);
  assert.equal(result.normalizedParams.lfc_cutoff, 1.5);
  assert.equal(result.rawParams.padj_cutoff, 0.01);
  assert.equal(result.rawParams.lfc_cutoff, 1.5);
  assert.equal(result.rawParams.enrich_qvalue, 0.2);
  assert.deepEqual(result.propagated.map((entry) => [entry.sourceName, entry.downstreamName]), [
    ['padj_cutoff', 'padj_cutoff'],
    ['lfc_cutoff', 'lfc_cutoff'],
  ]);
});

test('P5 maps a declared legacy DEG threshold alias to the downstream canonical descriptor name', () => {
  const result = propagateDegThresholds({
    sourceDescriptor: { parameters: { padj_threshold: parameter('number', { minimum: 0, maximum: 1 }) } },
    downstreamDescriptor: { parameters: { padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }) } },
    sourceParameterPatch: { padj_threshold: 0.025 },
    downstreamNormalizedParams: { padj_cutoff: 0.05 },
    downstreamRawParams: { padj_cutoff: 0.05 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.rawParams.padj_cutoff, 0.025);
  assert.deepEqual(result.propagated[0], {
    semantic: 'adjusted_p_value_cutoff',
    sourceName: 'padj_threshold',
    downstreamName: 'padj_cutoff',
    value: 0.025,
  });
});

test('P6 maps a DEG LFC cutoff to volcano fc_threshold without changing pval_threshold', () => {
  const result = propagateDegThresholds({
    sourceDescriptor: { parameters: { lfc_cutoff: parameter('number', { minimum: 0 }) } },
    downstreamDescriptor: { parameters: {
      fc_threshold: parameter('number', { minimum: 0 }),
      pval_threshold: parameter('number', { minimum: 0 }),
    } },
    sourceParameterPatch: { lfc_cutoff: 1.75 },
    downstreamNormalizedParams: { fc_threshold: 1, pval_threshold: 1.301 },
    downstreamRawParams: { fc_threshold: 1, pval_threshold: 1.301 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.normalizedParams.fc_threshold, 1.75);
  assert.equal(result.rawParams.fc_threshold, 1.75);
  assert.equal(result.rawParams.pval_threshold, 1.301);
  assert.deepEqual(result.propagated, [{
    semantic: 'absolute_log2_fold_change_cutoff',
    sourceName: 'lfc_cutoff',
    downstreamName: 'fc_threshold',
    value: 1.75,
  }]);
});

test('P6 does not treat volcano pval_threshold as an adjusted p-value identity alias', () => {
  const result = propagateDegThresholds({
    sourceDescriptor: { parameters: { padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }) } },
    downstreamDescriptor: { parameters: { pval_threshold: parameter('number', { minimum: 0 }) } },
    sourceParameterPatch: { padj_cutoff: 0.01 },
    downstreamNormalizedParams: { pval_threshold: 1.301 },
    downstreamRawParams: { pval_threshold: 1.301 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'downstream_parameter_mapping_missing');
  assert.deepEqual(result.detail, {
    semantic: 'adjusted_p_value_cutoff',
    downstreamNames: [],
  });
});

test('P5 blocks changed thresholds when the child mapping is missing, ambiguous or out of range', () => {
  const base = {
    sourceDescriptor: { parameters: { padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }) } },
    sourceParameterPatch: { padj_cutoff: 0.01 },
    downstreamNormalizedParams: { padj_cutoff: 0.05 },
    downstreamRawParams: { padj_cutoff: 0.05 },
  };
  const missing = propagateDegThresholds({ ...base, downstreamDescriptor: { parameters: {} } });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'downstream_parameter_mapping_missing');

  const ambiguous = propagateDegThresholds({
    ...base,
    downstreamDescriptor: { parameters: {
      padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }),
      padj_threshold: parameter('number', { minimum: 0, maximum: 1 }),
    } },
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'downstream_parameter_mapping_missing');

  const invalid = propagateDegThresholds({
    ...base,
    sourceParameterPatch: { padj_cutoff: 2 },
    downstreamDescriptor: { parameters: { padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }) } },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'downstream_parameter_value_invalid');
});

test('P5 leaves unrelated downstream scientific parameters unchanged', () => {
  const result = propagateDegThresholds({
    sourceDescriptor: { parameters: {
      contrast_treat: { type: 'text' },
      padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }),
    } },
    downstreamDescriptor: { parameters: {
      padj_cutoff: parameter('number', { minimum: 0, maximum: 1 }),
      enrich_qvalue: parameter('number', { minimum: 0, maximum: 1 }),
    } },
    sourceParameterPatch: { contrast_treat: 'KO2' },
    downstreamNormalizedParams: { padj_cutoff: 0.05, enrich_qvalue: 0.2 },
    downstreamRawParams: { padj_cutoff: 0.05, enrich_qvalue: 0.2 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.propagated, []);
  assert.deepEqual(result.rawParams, { padj_cutoff: 0.05, enrich_qvalue: 0.2 });
});
