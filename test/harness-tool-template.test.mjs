import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHarnessToolScaffold, writeHarnessToolScaffold } from '../scripts/scaffold-harness-tool.mjs';

test('buildHarnessToolScaffold creates a valid starter scaffold', () => {
  const scaffold = buildHarnessToolScaffold({
    id: 'demo-tool',
    title: 'Demo Tool',
    language: 'python',
    targetRoot: path.join(os.tmpdir(), 'petri-harness-scaffold-test'),
  });

  assert.equal(scaffold.id, 'demo-tool');
  assert.equal(scaffold.language, 'python');
  assert.ok(scaffold.files.some((file) => file.path.endsWith('plugin.json')));
  assert.ok(scaffold.files.some((file) => file.path.endsWith('tool-definition.json')));
  assert.ok(scaffold.files.some((file) => file.path.endsWith('demo-tool.py')));

  const toolDefinition = JSON.parse(
    scaffold.files.find((file) => file.path.endsWith('tool-definition.json')).content
  );
  assert.equal(toolDefinition.inputs.length, 1);
  assert.equal(toolDefinition.outputs.length, 1);
  assert.ok(toolDefinition.failureModes.length >= 5);
});

test('writeHarnessToolScaffold writes files to disk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-harness-scaffold-'));
  try {
    const scaffold = writeHarnessToolScaffold({
      id: 'disk-tool',
      title: 'Disk Tool',
      language: 'r',
      targetRoot: tmpDir,
    });

    assert.ok(fs.existsSync(path.join(scaffold.toolDir, 'plugin.json')));
    assert.ok(fs.existsSync(path.join(scaffold.toolDir, 'tool-definition.json')));
    assert.ok(fs.existsSync(path.join(scaffold.toolDir, 'scripts', 'disk-tool.R')));
    assert.ok(fs.existsSync(path.join(scaffold.toolDir, 'fixtures', 'input.csv')));
    const fixture = JSON.parse(fs.readFileSync(path.join(scaffold.toolDir, 'fixtures', 'fixture.json'), 'utf8'));
    assert.equal(fixture.fixtureVersion, 1);
    assert.equal(fixture.toolId, 'disk-tool');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
