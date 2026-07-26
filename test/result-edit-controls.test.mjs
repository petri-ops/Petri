import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const controls = require('../core/shared-backend/result-edit-controls');
const { classifyParameterPatch } = require('../core/shared-backend/result-edit-intent');

const root = path.join(import.meta.dirname, '..');

function descriptorFor(pluginId) {
  const file = path.join(root, 'resources/built-in-plugins', pluginId, 'tool-definition.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).resultStudio;
}

test('RS-P4 control schema is projected only from declared plugin parameters', () => {
  const descriptor = descriptorFor('volcano-plot');
  const schema = controls.buildEditControlSchema(descriptor);
  const declared = Object.keys(descriptor.parameters).sort();
  assert.deepEqual(schema.controls.map((c) => c.name), declared);
  assert.equal(schema.controlsVersion, 1);
  // 每个控件的 impact 必须逐字来自 descriptor，不得由本层推断。
  for (const control of schema.controls) {
    assert.equal(control.impact, descriptor.parameterImpacts[control.name]);
  }
});

test('RS-P4 first control batch covers colour, font, size, legend, label and export', () => {
  const schema = controls.buildEditControlSchema(descriptorFor('volcano-plot'));
  const presentation = schema.controls.filter((c) => c.group === 'presentation').map((c) => c.name);
  for (const required of [
    'color_up', 'color_down', 'color_ns',
    'base_font_size', 'label_size',
    'point_size', 'plot_width', 'plot_height',
    'legend_position', 'plot_title', 'export_dpi',
  ]) {
    assert.ok(presentation.includes(required), `missing presentation control: ${required}`);
  }
});

test('RS-P4 colour parameters become colour controls without weakening validation', () => {
  const schema = controls.buildEditControlSchema(descriptorFor('volcano-plot'));
  const colour = schema.controls.find((c) => c.name === 'color_up');
  assert.equal(colour.controlType, 'color');
  assert.equal(colour.impact, 'presentation');
  assert.equal(controls.validateControlValue(colour, '#123abc').ok, true);
  assert.equal(controls.validateControlValue(colour, 'red').ok, false);
  assert.equal(controls.validateControlValue(colour, '#12345').ok, false);
});

test('RS-P4 a parameter without a declared impact never becomes an editable control', () => {
  const schema = controls.buildEditControlSchema({
    parameters: { mystery: { type: 'number', default: 1 } },
    parameterImpacts: {},
  });
  assert.deepEqual(schema.controls, []);
  assert.equal(schema.diagnostics.some((d) => d.code === 'control_impact_undeclared'), true);
});

test('RS-P4 numeric bounds fail closed instead of silently clamping', () => {
  const schema = controls.buildEditControlSchema(descriptorFor('volcano-plot'));
  const alpha = schema.controls.find((c) => c.name === 'point_alpha');
  assert.equal(alpha.minimum, 0.05);
  assert.equal(alpha.maximum, 1);
  const high = controls.validateControlValue(alpha, 5);
  assert.equal(high.ok, false);
  assert.equal(high.diagnostics[0].code, 'control_value_above_maximum');
  const low = controls.validateControlValue(alpha, 0);
  assert.equal(low.ok, false);
  assert.equal(low.diagnostics[0].code, 'control_value_below_minimum');
  assert.equal(controls.validateControlValue(alpha, 0.4).value, 0.4);
});

test('RS-P4 select controls only accept declared options', () => {
  const schema = controls.buildEditControlSchema(descriptorFor('volcano-plot'));
  const legend = schema.controls.find((c) => c.name === 'legend_position');
  assert.equal(legend.controlType, 'select');
  assert.equal(controls.validateControlValue(legend, 'bottom').ok, true);
  assert.equal(controls.validateControlValue(legend, 'diagonal').ok, false);
});

test('RS-P4 manual and agent submissions produce an identical trusted patch', () => {
  const descriptor = descriptorFor('volcano-plot');
  const proposed = { color_up: '#00FF00', label_size: 4 };
  const manual = controls.normalizeEditSubmission({ descriptor, proposedValues: proposed, origin: 'manual' });
  const agent = controls.normalizeEditSubmission({ descriptor, proposedValues: proposed, origin: 'agent' });
  assert.deepEqual(manual.patch, agent.patch);
  assert.deepEqual(manual.patch, { color_up: '#00ff00', label_size: 4 });
  assert.equal(manual.classification.editClass, agent.classification.editClass);
  assert.equal(manual.origin, 'manual');
  assert.equal(agent.origin, 'agent');
});

test('RS-P4 a presentation-only patch never escalates to scientific recompute', () => {
  const descriptor = descriptorFor('volcano-plot');
  const result = controls.normalizeEditSubmission({
    descriptor,
    proposedValues: { color_up: '#00ff00', plot_title: 'Treated vs Control', export_dpi: 600 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification.editClass, 'presentation_rerender');
  assert.equal(result.classification.requiresScientificConfirmation, false);
  const explanation = controls.explainEditImpact(result.classification);
  assert.equal(explanation.rerunsScience, false);
  assert.match(explanation.headline, /不重新计算科学结论/);
});

test('RS-P4 a scientific threshold change requires confirmation and reruns science', () => {
  const descriptor = descriptorFor('volcano-plot');
  const result = controls.normalizeEditSubmission({
    descriptor,
    proposedValues: { fc_threshold: 2 },
  });
  assert.equal(result.classification.editClass, 'scientific_recompute');
  assert.equal(result.classification.requiresScientificConfirmation, true);
  const explanation = controls.explainEditImpact(result.classification, { affectedNodeIds: ['volcano', 'enrichment'] });
  assert.equal(explanation.rerunsScience, true);
  assert.equal(explanation.requiresJob, true);
  assert.equal(explanation.affectedNodeCount, 2);
});

test('RS-P4 a workflow parameter is classified as workflow replan, not styling', () => {
  const result = controls.normalizeEditSubmission({
    descriptor: descriptorFor('deseq2'),
    proposedValues: { design: 'condition + batch' },
  });
  assert.equal(result.classification.editClass, 'workflow_replan');
  assert.equal(controls.explainEditImpact(result.classification).rerunsScience, true);
});

test('RS-P4 an undeclared parameter is rejected, not silently dropped or accepted', () => {
  const result = controls.normalizeEditSubmission({
    descriptor: descriptorFor('volcano-plot'),
    proposedValues: { color_up: '#111111', secret_flag: true },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, ['secret_flag']);
  assert.equal(Object.prototype.hasOwnProperty.call(result.patch, 'secret_flag'), false);
  assert.equal(result.diagnostics.some((d) => d.code === 'control_unknown_parameter'), true);
});

test('RS-P4 the caller cannot downgrade a scientific parameter to presentation', () => {
  const descriptor = descriptorFor('volcano-plot');
  const forged = {
    ...descriptor,
    parameterImpacts: { ...descriptor.parameterImpacts },
  };
  // 模拟调用方伪造更低影响：normalizeEditSubmission 只信传入的受信 descriptor，
  // 因此这里改的是"如果 descriptor 本身被替换"的场景，用真实 descriptor 对照。
  const trustedResult = controls.normalizeEditSubmission({
    descriptor,
    proposedValues: { pval_threshold: 2 },
  });
  assert.equal(trustedResult.classification.editClass, 'scientific_recompute');
  // 直接用 result-edit-intent 复核：模型自称 view_only 也不能降级。
  const classified = classifyParameterPatch({
    proposedParameterPatch: { pval_threshold: 2 },
    parameterImpactRules: forged.parameterImpacts,
    requestedEditClass: 'view_only',
  });
  assert.equal(classified.editClass, 'scientific_recompute');
});

test('RS-P4 unchanged values are excluded so no empty ChangeSet is created', () => {
  const descriptor = descriptorFor('volcano-plot');
  const result = controls.normalizeEditSubmission({
    descriptor,
    proposedValues: { color_up: '#dc2626', label_size: 5 },
    currentValues: { color_up: '#dc2626', label_size: 3 },
  });
  assert.deepEqual(result.changed, ['label_size']);
  assert.deepEqual(result.unchanged, ['color_up']);
  assert.deepEqual(result.patch, { label_size: 5 });
});

test('RS-P4 an entirely unchanged submission yields no patch and no classification', () => {
  const descriptor = descriptorFor('volcano-plot');
  const result = controls.normalizeEditSubmission({
    descriptor,
    proposedValues: { color_up: '#dc2626' },
    currentValues: { color_up: '#dc2626' },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.patch, {});
  assert.equal(result.classification, null);
  const explanation = controls.explainEditImpact(result.classification);
  assert.equal(explanation.requiresJob, false);
  assert.match(explanation.headline, /没有需要执行的参数变化/);
});

test('RS-P4 every admitted plugin projects a usable schema with declared impacts only', () => {
  for (const pluginId of ['deseq2', 'volcano-plot', 'gene-correlation', 'go-kegg']) {
    const descriptor = descriptorFor(pluginId);
    const schema = controls.buildEditControlSchema(descriptor);
    assert.ok(schema.controls.length > 0, pluginId);
    for (const control of schema.controls) {
      assert.ok(controls.SUPPORTED_CONTROL_TYPES.includes(control.controlType), `${pluginId}.${control.name}`);
      assert.equal(control.scientificallyNeutral, control.group === 'presentation');
    }
    assert.deepEqual(
      schema.groups.map((g) => g.group),
      controls.GROUP_ORDER.filter((group) => schema.controls.some((c) => c.group === group)),
      pluginId,
    );
  }
});
