/**
 * BLOCK-235 — registry integration probe (child process).
 * Runs in a fresh Node process so the installed fixture pack is visible before
 * artifact-profiles.js is first required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(HERE, 'helpers', 'block235-registry-probe.mjs');

const CANONICAL = [
  'petri.counts-matrix.v1',
  'petri.sample-metadata.v1',
  'petri.expression-matrix.v1',
  'petri.deg.v1',
  'petri.gene-list.v1',
  'petri.enrichment-table.v1',
];

const result = JSON.parse(execFileSync(process.execPath, [probe], { encoding: 'utf8' }));

test('installed pack extension is registered without losing canonical profiles', () => {
  assert.deepEqual(
    result.profiles,
    [...CANONICAL, 'petri.custom-table.v1'].sort(),
  );
  assert.equal(result.valid, true);
  assert.equal(result.frozen, true);
  assert.deepEqual(result.warnings, []);
});

test('extension profile actors resolve through the existing actor contract', () => {
  assert.equal(result.producer, true);
  assert.equal(result.consumer, true);
});
