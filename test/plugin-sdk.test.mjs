import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pluginLoader = require('../core/r-server/plugin-loader.js');
const { inspectPluginSources } = require('../core/shared-backend/plugin-sdk.js');

function writePlugin(root, id, options = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
    id,
    pluginManifestVersion: 1,
    title: id,
    version: '1.0.0',
    language: 'r',
    supportedPlatforms: ['linux-x64'],
    runtime: { r: '>=4.3.0' },
    ...options.plugin,
  }));
  fs.writeFileSync(path.join(dir, 'tool-definition.json'), JSON.stringify({
    id,
    title: id,
    inputs: [{ id: 'input_table', type: 'file', required: true, accept: '.csv' }],
    outputs: [{ id: 'report', type: 'html', label: 'Report' }],
    failureModes: [{ code: 'bad_input', title: 'Bad input', suggestedFix: 'Fix it', detect: 'bad input' }],
    ...options.toolDefinition,
  }));
  if (options.script !== false) fs.writeFileSync(path.join(dir, 'scripts', `${id}.R`), 'cat("ok\\n")\n');
  return dir;
}

function inspect(sources) {
  return inspectPluginSources({ sources, normalizeManifest: pluginLoader.normalizePluginManifest });
}

test('Plugin SDK discovers built-in, installed, and development sources with explicit precedence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-sdk-'));
  try {
    const builtin = path.join(tmp, 'builtin');
    const installed = path.join(tmp, 'installed');
    const development = path.join(tmp, 'development');
    writePlugin(builtin, 'shared-tool', { plugin: { version: '1.0.0' } });
    writePlugin(installed, 'shared-tool', { plugin: { version: '2.0.0' } });
    writePlugin(development, 'shared-tool', { plugin: { version: '3.0.0' } });
    fs.writeFileSync(path.join(installed, 'installed.json'), JSON.stringify([{ id: 'shared-tool' }]));

    const result = inspect([
      { type: 'builtin', root: builtin },
      { type: 'installed', root: installed },
      { type: 'development', root: development },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.manifests.length, 1);
    assert.equal(result.manifests[0].version, '3.0.0');
    assert.equal(result.candidates[0].sourceType, 'development');
    assert.equal(result.diagnostics.filter((item) => item.code === 'plugin_source_shadowed').length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('builtin-canonical blocks installed shadowing but allows explicit development override', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-sdk-canonical-'));
  try {
    const builtin = path.join(tmp, 'builtin');
    const installed = path.join(tmp, 'installed');
    const development = path.join(tmp, 'development');
    writePlugin(builtin, 'canonical-tool', {
      plugin: { version: '1.0.0', sourcePolicy: 'builtin-canonical' },
    });
    writePlugin(installed, 'canonical-tool', { plugin: { version: '2.0.0' } });
    fs.writeFileSync(path.join(installed, 'installed.json'), JSON.stringify([{ id: 'canonical-tool' }]));

    const withoutDevelopment = inspect([
      { type: 'builtin', root: builtin },
      { type: 'installed', root: installed },
    ]);
    assert.equal(withoutDevelopment.ok, true);
    assert.equal(withoutDevelopment.candidates[0].sourceType, 'builtin');
    assert.equal(withoutDevelopment.manifests[0].version, '1.0.0');
    assert.ok(
      withoutDevelopment.diagnostics.some((item) => item.code === 'plugin_source_ignored')
    );

    writePlugin(development, 'canonical-tool', { plugin: { version: '3.0.0' } });
    const withDevelopment = inspect([
      { type: 'builtin', root: builtin },
      { type: 'installed', root: installed },
      { type: 'development', root: development },
    ]);
    assert.equal(withDevelopment.ok, true);
    assert.equal(withDevelopment.candidates[0].sourceType, 'development');
    assert.equal(withDevelopment.manifests[0].version, '3.0.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Plugin SDK returns structured diagnostics for incomplete plugins', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-sdk-invalid-'));
  try {
    writePlugin(tmp, 'broken-tool', { script: false });
    const result = inspect([{ type: 'development', root: tmp }]);
    assert.equal(result.ok, false);
    const issue = result.diagnostics.find((item) => item.code === 'plugin_script_missing');
    assert.ok(issue);
    assert.equal(issue.pluginSdkDiagnosticVersion, 1);
    assert.equal(issue.sourceType, 'development');
    assert.equal(issue.pluginId, 'broken-tool');
    assert.equal(issue.severity, 'error');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Plugin SDK rejects duplicate failure modes before normalization hides them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-sdk-duplicate-'));
  try {
    writePlugin(tmp, 'duplicate-tool', {
      toolDefinition: {
        failureModes: [
          { code: 'bad_input', title: 'Bad', suggestedFix: 'Fix', detect: 'bad' },
          { code: 'bad_input', title: 'Bad again', suggestedFix: 'Fix', detect: 'bad again' },
        ],
      },
    });
    const result = inspect([{ type: 'development', root: tmp }]);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === 'duplicate_failure_mode'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
