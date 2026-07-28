import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
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
  assert.ok(plan.tests.includes('test/p4r-invariants.test.mjs'));
  assert.ok(!plan.tests.includes('test/loop-controller.test.mjs'));
});

test('frontend source changes produce related frontend inputs and required gates', () => {
  const plan = resolveImpact(['frontend/src/components/result-studio/ResultEditPanel.tsx']);
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.frontendRelated, ['src/components/result-studio/ResultEditPanel.tsx']);
  assert.ok(plan.commands.includes('frontend-check'));
  assert.ok(plan.commands.includes('ui-audit'));
});

test('Result Studio Agent production wiring selects binding and prompt regressions', () => {
  for (const file of [
    'core/r-server/agent-runner.js',
    'core/r-server/routes/ai-agent.js',
    'core/r-server/helpers/system-prompt.js',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.tests.includes('test/result-studio-agent-binding.test.mjs'));
    assert.ok(plan.tests.includes('test/system-prompt-result-context.test.mjs'));
  }
});

test('low-level Git and interceptor changes keep their domain-specific test scopes', () => {
  for (const file of ['core/shared-backend/git-adapter.js', 'core/shared-backend/git-repository-binding.js']) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.tests.includes('test/git-adapter.test.mjs'));
    assert.ok(!plan.tests.includes('test/p4r-invariants.test.mjs'));
  }
  const interceptor = resolveImpact(['core/r-server/agent-tools/agent-tool-interceptor.js']);
  assert.deepEqual(interceptor.unknown, []);
  assert.ok(interceptor.tests.includes('test/agent-tool-policy.test.mjs'));
  assert.ok(interceptor.tests.includes('test/result-studio-agent-binding.test.mjs'));
});

test('documentation changes select docs governance without scientific tests', () => {
  const plan = resolveImpact(['docs/next-steps-roadmap.md']);
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.tests, []);
  assert.deepEqual(plan.commands, ['docs-check']);
});

test('stored acceptance evidence selects its reader and never blocks on unmapped paths', () => {
  const trees = readdirSync(new URL('../acceptance/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => `acceptance/${entry.name}/evidence.json`);
  assert.ok(trees.length > 0);
  assert.deepEqual(resolveImpact(trees).unknown, []);

  const resultStudio = resolveImpact(['acceptance/g0-result-studio/rs-p4r-performance.json']);
  assert.deepEqual(resultStudio.unknown, []);
  assert.deepEqual(resultStudio.tests, ['test/result-studio-qualification.test.mjs']);

  assert.deepEqual(resolveImpact(['acceptance/g0-new-tree/evidence.json']).unknown, ['acceptance/g0-new-tree/evidence.json']);
});

test('directly edited tests are included and unknown production paths fail closed', () => {
  assert.ok(resolveImpact(['test/loop-contract.test.mjs']).tests.includes('test/loop-contract.test.mjs'));
  assert.deepEqual(resolveImpact(['new-production-area/engine.js']).unknown, ['new-production-area/engine.js']);
});
