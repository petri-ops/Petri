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

test('RS7 descriptors map every formal table/plot and every required file input', () => {
  for (const id of pluginIds) {
    const { toolDefinition } = readPlugin(id);
    const editableOutputs = toolDefinition.outputs.filter((item) => ['table', 'plot'].includes(item.type)).map((item) => item.id).sort();
    const mappedOutputs = toolDefinition.resultStudio.artifacts.map((item) => item.id).sort();
    assert.deepEqual(mappedOutputs, editableOutputs, id);
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
    assert.equal(golden.independentScriptPathTemplate, descriptor.independentScriptPathTemplate);
  }
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
