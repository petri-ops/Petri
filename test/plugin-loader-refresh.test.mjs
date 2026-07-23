import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pluginLoader = require('../core/r-server/plugin-loader.js');
const { renderPluginDemoPathsForPrompt } = require('../core/r-server/helpers/plugin-demo-prompt.js');

test('loadPluginsFromDisk refreshes changed installed plugin metadata and removes deleted plugins', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-refresh-'));
  const pluginDir = path.join(tmpDir, 'demo-tool');
  const scriptsDir = path.join(pluginDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'installed.json'),
    JSON.stringify([{ id: 'demo-tool', type: 'analysis-plugin' }], null, 2),
  );
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(
      {
        id: 'demo-tool',
        pluginManifestVersion: 1,
        title: 'Demo Tool',
        version: '1.0.0',
        language: 'r',
        description: 'first version',
        supportedPlatforms: ['macos-arm64'],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(pluginDir, 'tool-definition.json'),
    JSON.stringify(
      {
        id: 'demo-tool',
        title: 'Demo Tool',
        description: 'first version',
        language: 'r',
        inputs: [{ id: 'input_table', type: 'file', required: true, accept: '.csv' }],
        outputs: [{ id: 'report_html', type: 'html', label: 'HTML Report' }],
        failureModes: [{ code: 'missing_required_file_inputs', title: 'Missing file', suggestedFix: 'fix', detect: 'missing file' }],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(scriptsDir, 'demo-tool.R'), 'cat("first\\n")\n');

  const previousMap = globalThis._biof3Plugins;
  try {
    globalThis._biof3Plugins = new Map();

    pluginLoader.loadPluginsFromDisk(tmpDir);
    let defs = pluginLoader.getAllToolDefinitions();
    assert.equal(defs.length, 1);
    assert.equal(defs[0].description, 'first version');
    const firstFingerprint = defs[0]._manifest.execution.scriptFingerprint;
    assert.ok(firstFingerprint);
    fs.writeFileSync(
      path.join(tmpDir, 'installed.json'),
      JSON.stringify([{ id: 'demo-tool', type: 'analysis-plugin', scriptFingerprint: firstFingerprint }], null, 2),
    );

    fs.writeFileSync(
      path.join(pluginDir, 'tool-definition.json'),
      JSON.stringify(
        {
          id: 'demo-tool',
          title: 'Demo Tool',
          description: 'second version',
          language: 'r',
          inputs: [{ id: 'input_table', type: 'file', required: true, accept: '.csv' }],
          outputs: [{ id: 'report_html', type: 'html', label: 'HTML Report' }],
          failureModes: [{ code: 'missing_required_file_inputs', title: 'Missing file', suggestedFix: 'fix', detect: 'missing file' }],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(scriptsDir, 'demo-tool.R'), 'cat("second\\n")\n');

    pluginLoader.loadPluginsFromDisk(tmpDir);
    defs = pluginLoader.getAllToolDefinitions();
    assert.equal(defs.length, 1);
    assert.equal(defs[0].description, 'second version');
    assert.notEqual(defs[0]._manifest.execution.scriptFingerprint, firstFingerprint);
    assert.equal(defs[0]._manifest.execution.installedFingerprint, firstFingerprint);
    assert.equal(defs[0]._manifest.execution.manifestDrift, true);
    assert.equal(defs[0]._manifest.execution.driftReason, 'fingerprint_changed');

    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(tmpDir, 'installed.json'), JSON.stringify([], null, 2));

    pluginLoader.loadPluginsFromDisk(tmpDir);
    defs = pluginLoader.getAllToolDefinitions();
    assert.equal(defs.length, 0);
  } finally {
    globalThis._biof3Plugins = previousMap;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('legacy disk refresh cannot shadow builtin-canonical DESeq2', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-canonical-refresh-'));
  const pluginDir = path.join(tmpDir, 'deseq2');
  const scriptsDir = path.join(pluginDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'installed.json'),
    JSON.stringify([{ id: 'deseq2', type: 'analysis-plugin' }], null, 2),
  );
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'deseq2',
      pluginManifestVersion: 1,
      title: 'Stale DESeq2',
      version: '0.0.1',
      language: 'r',
    }),
  );
  fs.writeFileSync(
    path.join(pluginDir, 'tool-definition.json'),
    JSON.stringify({ id: 'deseq2', title: 'Stale DESeq2', inputs: [], outputs: [] }),
  );
  fs.writeFileSync(path.join(scriptsDir, 'deseq2.R'), 'stop("stale copy must not run")\n');

  const previousMap = globalThis._biof3Plugins;
  const previousBuiltInDir = process.env.BIOF3_BUILT_IN_PLUGINS_DIR;
  try {
    globalThis._biof3Plugins = new Map();
    process.env.BIOF3_BUILT_IN_PLUGINS_DIR = path.resolve(
      'resources',
      'built-in-plugins',
    );
    pluginLoader.loadPluginsFromDisk(tmpDir);

    const selected = pluginLoader.getPlugin('deseq2');
    assert.equal(selected._sourceType, 'builtin');
    assert.equal(selected.sourcePolicy, 'builtin-canonical');
    assert.equal(
      pluginLoader.getScriptForTool('deseq2'),
      path.resolve('resources', 'built-in-plugins', 'deseq2', 'scripts', 'deseq2.R'),
    );
    const demoPrompt = renderPluginDemoPathsForPrompt();
    assert.match(
      demoPrompt,
      /resources[/\\]built-in-plugins[/\\]deseq2[/\\]demo-data[/\\]demo-counts\.csv/,
    );
    assert.doesNotMatch(demoPrompt, /Documents[/\\]BioF3-Local[/\\]plugins[/\\]deseq2/);
  } finally {
    globalThis._biof3Plugins = previousMap;
    if (previousBuiltInDir === undefined) delete process.env.BIOF3_BUILT_IN_PLUGINS_DIR;
    else process.env.BIOF3_BUILT_IN_PLUGINS_DIR = previousBuiltInDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
