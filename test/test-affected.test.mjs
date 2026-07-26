import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveImpact } from '../scripts/test-affected.mjs';

test('impact map validates and classifies the current script inventory', () => {
  const plan = resolveImpact(['scripts/test-affected.mjs']);
  assert.deepEqual(plan.unknown, []);
  assert.ok(plan.tests.includes('test/test-affected.test.mjs'));
});

test('result studio backend changes select one deduplicated domain bundle', () => {
  const plan = resolveImpact(['core/shared-backend/result-edit-intent.js', 'core/shared-backend/result-edit-controls.js', 'core/r-server/routes/result-studio.js']);
  assert.deepEqual(plan.unknown, []);
  assert.equal(new Set(plan.tests).size, plan.tests.length);
  assert.ok(plan.tests.includes('test/result-edit-intent.test.mjs'));
  assert.ok(plan.tests.includes('test/result-studio-lifecycle.test.mjs'));
  assert.ok(!plan.tests.includes('test/loop-controller.test.mjs'));
});

test('frontend source changes produce related frontend inputs and required gates', () => {
  const plan = resolveImpact(['frontend/src/components/result-studio/ResultEditPanel.tsx']);
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.frontendRelated, ['src/components/result-studio/ResultEditPanel.tsx']);
  assert.ok(plan.commands.includes('frontend-check'));
  assert.ok(plan.commands.includes('ui-audit'));
});

test('documentation changes select docs governance without scientific tests', () => {
  const plan = resolveImpact(['docs/next-steps-roadmap.md']);
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.tests, []);
  assert.deepEqual(plan.commands, ['docs-check']);
});

test('directly edited tests are included and unknown production paths fail closed', () => {
  assert.ok(resolveImpact(['test/loop-contract.test.mjs']).tests.includes('test/loop-contract.test.mjs'));
  assert.deepEqual(resolveImpact(['new-production-area/engine.js']).unknown, ['new-production-area/engine.js']);
});
