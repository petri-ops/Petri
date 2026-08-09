import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = require('../core/shared-backend/result-studio-plugin-sdk');
const { normalizePluginManifest } = require('../core/r-server/plugin-loader');
const pluginIds = ['deseq2', 'volcano-plot', 'gene-correlation', 'go-kegg'];

function readPlugin(id) {
  const pluginDir = path.join(root, 'resources/built-in-plugins', id);
  return {
    pluginDir,
    plugin: { ...JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'))), pluginDir },
    toolDefinition: JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json'))),
  };
}

test('RS7 four scientific plugin descriptors pass the fail-closed SDK lint', () => {
  for (const id of pluginIds) {
    const input = readPlugin(id);
    const result = sdk.lintResultStudioPlugin(input);
    assert.equal(result.valid, true, `${id}: ${JSON.stringify(result.errors)}`);
    const manifest = normalizePluginManifest(input.plugin, input.toolDefinition);
    assert.equal(manifest.resultStudioValidation.valid, true);
    assert.equal(manifest.resultStudio.contractVersion, 1);
  }
});

test('P6 validates the trusted preview resource model and its numeric parameter bindings', () => {
  const { pluginDir, plugin, toolDefinition } = readPlugin('volcano-plot');
  const valid = sdk.lintResultStudioPlugin({ plugin, toolDefinition, pluginDir });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));
  assert.equal(valid.descriptor.previewResourceModel.raster.dpiParameter, 'export_dpi');

  const forged = structuredClone(toolDefinition);
  forged.resultStudio.previewResourceModel.raster.dpiParameter = 'not_a_declared_parameter';
  forged.resultStudio.previewResourceModel.raster.workingSetMultiplier = 1_000_000;
  const rejected = sdk.lintResultStudioPlugin({ plugin, toolDefinition: forged, pluginDir });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((issue) => issue.code === 'preview_resource_raster_parameter_invalid'));
  assert.ok(rejected.errors.some((issue) => issue.code === 'preview_resource_raster_multiplier_invalid'));
});

test('P5 DESeq2 exposes its reusable VST matrix with a stable non-formal Artifact id', () => {
  const { toolDefinition } = readPlugin('deseq2');
  assert.deepEqual(
    toolDefinition.outputs.find((artifact) => artifact.id === 'vst_matrix'),
    {
      id: 'vst_matrix',
      filename: 'vst_matrix.csv',
      type: 'data',
      label: 'VST 矩阵',
    }
  );
  assert.equal(
    toolDefinition.resultStudio.artifacts.some((artifact) => artifact.id === 'vst_matrix'),
    false,
    'intermediate data must not silently expand the formal editable Revision cohort'
  );
});

test('RS7 descriptors bind every formal table/plot/report to one exact output filename and interaction contract', () => {
  for (const id of pluginIds) {
    const { toolDefinition } = readPlugin(id);
    const formalOutputs = toolDefinition.outputs.filter((item) => ['table', 'plot', 'report'].includes(item.type));
    const editableOutputs = formalOutputs.map((item) => item.id).sort();
    const mappedOutputs = toolDefinition.resultStudio.artifacts.map((item) => item.id).sort();
    assert.deepEqual(mappedOutputs, editableOutputs, id);
    for (const output of formalOutputs) {
      assert.equal(path.basename(output.filename), output.filename, `${id}:${output.id}`);
      const artifact = toolDefinition.resultStudio.artifacts.find((item) => item.id === output.id);
      assert.equal(artifact.filename, output.filename, `${id}:${output.id}`);
      assert.equal(artifact.required === false, output.required === false, `${id}:${output.id}`);
      const mappingCount = toolDefinition.resultStudio.interactionMappings
        .filter((mapping) => mapping.artifactId === artifact.id).length;
      assert.ok(['interactive', 'noninteractive'].includes(artifact.interaction), `${id}:${output.id}`);
      assert.equal(mappingCount, artifact.interaction === 'interactive' ? 1 : 0, `${id}:${output.id}`);
      if (output.type === 'report') assert.equal(artifact.interaction, 'noninteractive', `${id}:${output.id}`);
    }
    const requiredFiles = toolDefinition.inputs.filter((item) => item.type === 'file' && item.required !== false).map((item) => item.id).sort();
    const bindings = toolDefinition.resultStudio.inputBindings.map((item) => item.inputId).sort();
    assert.deepEqual(bindings, requiredFiles, id);
  }
});

test('RS7 golden revisions bind script, input and output contract digests', () => {
  for (const id of pluginIds) {
    const { pluginDir, toolDefinition } = readPlugin(id);
    const descriptor = toolDefinition.resultStudio;
    const golden = JSON.parse(fs.readFileSync(path.join(pluginDir, descriptor.goldenFixture.path)));
    assert.equal(golden.sourceScriptSha256, sdk.digest(fs.readFileSync(path.join(pluginDir, descriptor.source.entryPoint))));
    assert.equal(golden.inputBindingDigest, sdk.digest(descriptor.inputBindings));
    assert.equal(golden.artifactContractDigest, sdk.digest(descriptor.artifacts));
    assert.deepEqual(golden.expectedArtifactIds, descriptor.artifacts.map((artifact) => artifact.id));
    assert.equal(golden.independentScriptPathTemplate, descriptor.independentScriptPathTemplate);
  }
});

test('RS7 rejects ambiguous formal filenames before Artifact Truth can fall back to same-stem discovery', () => {
  const { pluginDir, plugin, toolDefinition } = readPlugin('volcano-plot');
  const missing = structuredClone(toolDefinition);
  delete missing.outputs.find((output) => output.id === 'volcano').filename;
  const missingResult = sdk.lintResultStudioPlugin({ plugin, toolDefinition: missing, pluginDir });
  assert.equal(missingResult.valid, false);
  assert.equal(missingResult.errors.some((issue) => issue.code === 'formal_output_filename_invalid'), true);

  const drifted = structuredClone(toolDefinition);
  drifted.outputs.find((output) => output.id === 'volcano').filename = 'volcano.pdf';
  const driftedResult = sdk.lintResultStudioPlugin({ plugin, toolDefinition: drifted, pluginDir });
  assert.equal(driftedResult.valid, false);
  assert.equal(driftedResult.errors.some((issue) => issue.code === 'artifact_filename_mismatch'), true);
});

test('RS7 fails closed on missing, duplicate, or forged formal interaction metadata', () => {
  const { pluginDir, plugin, toolDefinition } = readPlugin('gene-correlation');

  const undeclared = structuredClone(toolDefinition);
  delete undeclared.resultStudio.artifacts.find((artifact) => artifact.id === 'heatmap').interaction;
  const undeclaredResult = sdk.lintResultStudioPlugin({ plugin, toolDefinition: undeclared, pluginDir });
  assert.equal(undeclaredResult.valid, false);
  assert.equal(undeclaredResult.errors.some((issue) => issue.code === 'artifact_interaction_contract_invalid'), true);

  const missingMapping = structuredClone(toolDefinition);
  missingMapping.resultStudio.interactionMappings = missingMapping.resultStudio.interactionMappings
    .filter((mapping) => mapping.artifactId !== 'heatmap');
  const missingMappingResult = sdk.lintResultStudioPlugin({ plugin, toolDefinition: missingMapping, pluginDir });
  assert.equal(missingMappingResult.valid, false);
  assert.equal(missingMappingResult.errors.some((issue) => issue.code === 'interactive_artifact_mapping_count_invalid'), true);

  const duplicateMapping = structuredClone(toolDefinition);
  duplicateMapping.resultStudio.interactionMappings.push(structuredClone(
    duplicateMapping.resultStudio.interactionMappings.find((mapping) => mapping.artifactId === 'heatmap')
  ));
  const duplicateMappingResult = sdk.lintResultStudioPlugin({ plugin, toolDefinition: duplicateMapping, pluginDir });
  assert.equal(duplicateMappingResult.valid, false);
  assert.equal(duplicateMappingResult.errors.some((issue) => issue.code === 'interaction_artifact_duplicate'), true);

  const { pluginDir: volcanoDir, plugin: volcanoPlugin, toolDefinition: volcanoDefinition } = readPlugin('volcano-plot');
  const forgedNoninteractive = structuredClone(volcanoDefinition);
  forgedNoninteractive.resultStudio.interactionMappings.push({
    ...structuredClone(forgedNoninteractive.resultStudio.interactionMappings.find((mapping) => mapping.artifactId === 'volcano')),
    artifactId: 'volcano_svg',
  });
  const forgedResult = sdk.lintResultStudioPlugin({
    plugin: volcanoPlugin,
    toolDefinition: forgedNoninteractive,
    pluginDir: volcanoDir,
  });
  assert.equal(forgedResult.valid, false);
  assert.equal(forgedResult.errors.some((issue) => issue.code === 'noninteractive_artifact_mapped'), true);
});

test('RS7 rejects incomplete or forged impact metadata before RS4 can trust it', () => {
  const normalized = normalizePluginManifest(
    { id: 'forged', version: '1.0.0', language: 'r' },
    { id: 'forged', inputs: [], outputs: [], resultStudio: { parameterImpacts: { palette: 'presentation' } } },
  );
  assert.equal(normalized.resultStudio, null);
  assert.equal(normalized.resultStudioValidation.valid, false);
  assert.ok(normalized.resultStudioValidation.errors.length > 0);
});

test('RS7 rejects a descriptor without stable selection or derivation actions', () => {
  const { pluginDir, plugin, toolDefinition } = readPlugin('gene-correlation');
  const invalid = structuredClone(toolDefinition);
  invalid.resultStudio.actions = [];
  const result = sdk.lintResultStudioPlugin({ plugin, toolDefinition: invalid, pluginDir });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === 'actions_invalid'));
});

test('RS7 upgrade policy keeps compatible history readable and fails closed on drift', () => {
  const { plugin, toolDefinition } = readPlugin('volcano-plot');
  const descriptor = toolDefinition.resultStudio;
  const compatibleRevision = {
    pluginVersion: '1.7.0',
    inputBindingDigest: sdk.digest(descriptor.inputBindings),
    artifactContractDigest: sdk.digest(descriptor.artifacts),
  };
  assert.deepEqual(sdk.evaluateRevisionCompatibility({ descriptor, currentPluginVersion: plugin.version, revision: compatibleRevision }), {
    status: 'compatible', reason: 'same_major_and_contract',
  });
  assert.equal(sdk.evaluateRevisionCompatibility({ descriptor, currentPluginVersion: '2.0.0', revision: compatibleRevision }).status, 'migration_required');
  assert.deepEqual(sdk.evaluateRevisionCompatibility({ descriptor, currentPluginVersion: plugin.version, revision: { ...compatibleRevision, artifactContractDigest: '0'.repeat(64) } }), {
    status: 'read_only_legacy', reason: 'contract_drift_without_migration',
  });
});
