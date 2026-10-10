import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// BLOCK-83 P4：核心仓零内置插件——manifest 校验指向中性夹具
// （env 必须在模块 import 前生效——check 脚本在模块加载期解析 BUILT_IN_DIR）
process.env.PETRI_HARNESS_MANIFEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'neutral-plugins');
const { validateHarnessManifests } = await import('../scripts/check-harness-manifests.mjs');

test('built-in runnable plugins expose normalized Harness manifest v1', () => {
  const result = validateHarnessManifests();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.manifests.length >= 1);

  const fixture = result.manifests.find((manifest) => manifest.id === 'sample-metrics');
  assert.ok(fixture);
  assert.equal(fixture.pluginManifestVersion, 1);
  assert.equal(fixture.artifactSchemaVersion, 1);
  assert.ok(fixture.artifacts.some((artifact) => artifact.type === 'plot'));
  assert.ok(fixture.failureModes.some((mode) => mode.code === 'missing_input_column'));
});

test('validateHarnessManifests rejects duplicate failure mode codes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-harness-manifest-'));
  try {
    const pluginDir = path.join(tmpDir, 'dup-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(
        {
          id: 'dup-plugin',
          title: 'Duplicate Manifest',
          version: '1.0.0',
          language: 'r',
          type: 'analysis-plugin',
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(pluginDir, 'tool-definition.json'),
      JSON.stringify(
        {
          id: 'dup-plugin',
          title: 'Duplicate Manifest',
          description: 'test',
          inputs: [{ id: 'input_a', type: 'file', required: true, accept: '.csv' }],
          outputs: [{ id: 'plot', type: 'plot', label: 'Plot' }],
          failureModes: [
            { code: 'bad_input', title: 'Bad input', suggestedFix: 'fix', detect: 'bad input' },
            { code: 'bad_input', title: 'Bad input again', suggestedFix: 'fix', detect: 'bad input again' },
          ],
        },
        null,
        2,
      ),
    );

    const result = validateHarnessManifests({ root: tmpDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('duplicate failure mode code "bad_input"')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
