import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHarnessManifests } from '../scripts/check-harness-manifests.mjs';

test('built-in runnable plugins expose normalized Harness manifest v1', () => {
  const result = validateHarnessManifests();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.manifests.length >= 3);

  const volcano = result.manifests.find((manifest) => manifest.id === 'volcano-plot');
  assert.ok(volcano);
  assert.equal(volcano.pluginManifestVersion, 1);
  assert.equal(volcano.artifactSchemaVersion, 1);
  assert.ok(volcano.artifacts.some((artifact) => artifact.type === 'plot'));
  assert.ok(volcano.failureModes.some((mode) => mode.code === 'missing_required_columns'));
});
