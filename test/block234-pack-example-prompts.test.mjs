import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { describePackExamplePrompts } = require(path.join(ROOT, 'core/shared-backend/pack-registry.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makePack(relative = 'example-prompts.json', content = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-examples-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'pack.json'), JSON.stringify({
    packId: 'fixture-pack',
    provides: { examplePrompts: relative },
  }));
  if (content !== null) {
    fs.writeFileSync(path.join(root, 'example-prompts.json'), JSON.stringify(content));
  }
  return root;
}

test('reads and sanitizes pack-declared example cards', () => {
  const root = makePack('example-prompts.json', [
    { icon: ' bar-chart ', title: ' 分析 ', description: ' 说明 ', prompt: ' 帮我分析 ' },
    { title: '', prompt: 'missing title is dropped' },
  ]);
  assert.deepEqual(describePackExamplePrompts(root), [{
    icon: 'bar-chart',
    title: '分析',
    description: '说明',
    prompt: '帮我分析',
  }]);
});

test('caps the catalog at six cards and falls back to the default icon', () => {
  const root = makePack('example-prompts.json', Array.from({ length: 8 }, (_, index) => ({
    title: `card-${index}`,
    prompt: `prompt-${index}`,
  })));
  const examples = describePackExamplePrompts(root);
  assert.equal(examples.length, 6);
  assert.equal(examples[0].icon, 'zap');
});

test('path escape, missing file, and malformed payload degrade to an empty catalog', () => {
  const escapeRoot = makePack('../escape.json', []);
  fs.writeFileSync(path.join(escapeRoot, '..', 'escape.json'), JSON.stringify([{ title: 'x', prompt: 'y' }]));
  assert.deepEqual(describePackExamplePrompts(escapeRoot), []);

  const missingRoot = makePack('missing.json', null);
  assert.deepEqual(describePackExamplePrompts(missingRoot), []);

  const malformedRoot = makePack('example-prompts.json', { not: 'an array' });
  assert.deepEqual(describePackExamplePrompts(malformedRoot), []);

  const noManifest = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-examples-empty-'));
  tempDirs.push(noManifest);
  assert.deepEqual(describePackExamplePrompts(noManifest), []);
});
