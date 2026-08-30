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
  const plan = resolveImpact(['core/shared-backend/result-edit-intent.js', 'core/shared-backend/result-edit-controls.js', 'core/biof3-server/routes/result-studio.js']);
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

test('frontend Vitest inputs stay out of the Node impact bundle', () => {
  const plan = resolveImpact([
    'frontend/src/components/copilot/copilotClient.ts',
    'frontend/src/components/desktop/TitleBar.tsx',
  ]);
  assert.deepEqual(plan.unknown, []);
  assert.ok(plan.tests.every((file) => !file.startsWith('frontend/')));
  assert.ok(plan.tests.includes('test/tool-job-conversation.test.mjs'));
  assert.ok(plan.tests.includes('test/g0-api-route.test.mjs'));
  assert.deepEqual(plan.frontendRelated, [
    'src/components/copilot/copilotClient.ts',
    'src/components/desktop/TitleBar.tsx',
  ]);
});

test('SDC1 scripts have one maintained classification and select the focused data contract bundle', () => {
  for (const file of [
    'scripts/g0-sdc1-local-gateway.mjs',
    'scripts/g0-sdc1-electron-driver.cjs',
    'scripts/g0-sdc1-acceptance.mjs',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('script-g0-maintained'));
    assert.ok(plan.reasons[file].includes('sdc1-data-to-first-result'));
    assert.ok(plan.tests.includes('test/g0-sdc1-local-gateway.test.mjs'));
    assert.ok(plan.tests.includes('test/data-profiler.test.mjs'));
    assert.ok(plan.tests.includes('test/workspace-data-import.test.mjs'));
  }
});

test('Result Studio Agent production wiring selects binding and prompt regressions', () => {
  for (const file of [
    'core/biof3-server/agent-runner.js',
    'core/biof3-server/routes/ai-agent.js',
    'core/biof3-server/helpers/system-prompt.js',
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
  const interceptor = resolveImpact(['core/biof3-server/agent-tools/agent-tool-interceptor.js']);
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

test('P5 producer and source-bound evidence select the complete scientific-editing contract bundle', () => {
  const required = [
    'test/g0-rs-p5-acceptance.test.mjs',
    'test/result-plugin-validator.test.mjs',
    'test/result-workflow-graph.test.mjs',
    'test/result-scientific-rerun.test.mjs',
    'test/result-scientific-compare.test.mjs',
    'test/result-revision-replay-package.test.mjs',
  ];
  for (const file of [
    'scripts/g0-rs-p5-acceptance.mjs',
    'acceptance/g0-result-studio/rs-p5-scientific-editing.json',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('p5-real-scientific-editing'));
    for (const testFile of required) assert.ok(plan.tests.includes(testFile), `${file} must select ${testFile}`);
  }
});

test('P6 UI-110 producer and evidence select direct trace, transport, and redaction regressions', () => {
  const required = [
    'test/g0-rs-p6-ui110-observation.test.mjs',
    'test/g0-rs-p6-ui110-local-gateway.test.mjs',
    'test/result-studio-agent-binding.test.mjs',
    'test/result-studio-context.test.mjs',
    'test/agent-tool-result.test.mjs',
    'test/diagnostic-redaction.test.mjs',
  ];
  for (const file of [
    'scripts/g0-rs-p6-ui110-observation.mjs',
    'scripts/g0-rs-p6-ui110-driver.cjs',
    'scripts/g0-rs-p6-ui110-local-gateway.mjs',
    'acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json',
    'acceptance/g0-result-studio/rs-p6-ui110-electron/frame.png',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('p6-ui110-electron-scientific-trace'));
    for (const testFile of required) assert.ok(plan.tests.includes(testFile), `${file} must select ${testFile}`);
  }

  const redaction = resolveImpact(['core/shared-backend/redaction.js']);
  assert.deepEqual(redaction.unknown, []);
  assert.ok(redaction.reasons['core/shared-backend/redaction.js'].includes('diagnostic-redaction'));
  assert.ok(redaction.tests.includes('test/diagnostic-redaction.test.mjs'));
  assert.ok(redaction.tests.includes('test/agent-tool-result.test.mjs'));
});

test('P6 runtime durability and resource paths select their direct regressions', () => {
  const cases = new Map([
    ['core/shared-backend/result-studio-runtime-lease.js', [
      'test/result-studio-lifecycle.test.mjs',
      'test/result-studio-background.test.mjs',
    ]],
    ['core/shared-backend/result-studio-resource-summary.js', [
      'test/result-studio-resource-summary.test.mjs',
    ]],
    ['core/shared-backend/tool-resource-sampler.js', [
      'test/tool-resource-sampler.test.mjs',
      'test/tools-executor-job-context.test.mjs',
    ]],
  ]);
  for (const [file, required] of cases) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('p6-runtime-durability-resources'));
    for (const testFile of required) assert.ok(plan.tests.includes(testFile), `${file} must select ${testFile}`);
  }
});

test('P6 real restart and Electron prototypes select their own bounded regressions', () => {
  const cases = new Map([
    ['scripts/g0-rs-p6-real-restart-prototype.mjs', [
      'p6-real-restart-prototype', 'test/g0-rs-p6-real-restart-prototype.test.mjs',
    ]],
    ['scripts/g0-rs-p6-electron-pressure-prototype.mjs', [
      'p6-electron-pressure-prototype', 'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
    ]],
    ['scripts/g0-rs-p6-electron-pressure-driver.cjs', [
      'p6-electron-pressure-prototype', 'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
    ]],
    ['acceptance/g0-result-studio/rs-p6-electron-pressure-multirevision.json', [
      'p6-electron-pressure-prototype', 'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
    ]],
    ['scripts/g0-rs-p6-recovery-electron-prototype.mjs', [
      'p6-recovery-electron-prototype', 'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
    ]],
    ['scripts/g0-rs-p6-recovery-electron-driver.cjs', [
      'p6-recovery-electron-prototype', 'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
    ]],
  ]);
  for (const [file, [reason, testFile]] of cases) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes(reason));
    assert.ok(plan.tests.includes(testFile), `${file} must select ${testFile}`);
  }
});

test('future canonical P6 product producer and evidence fail closed into the complete component bundle', () => {
  const required = [
    'test/g0-rs-p6-real-restart-prototype.test.mjs',
    'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
    'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
    'test/g0-rs-p6-recovery-acceptance.test.mjs',
    'test/result-studio-resource-summary.test.mjs',
    'test/tool-resource-sampler.test.mjs',
  ];
  for (const file of [
    'scripts/g0-rs-p6-product-acceptance.mjs',
    'acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('p6-product-durability-recovery-performance'));
    for (const testFile of required) assert.ok(plan.tests.includes(testFile), `${file} must select ${testFile}`);
  }
});

test('every representative P6 bound runtime ancestor selects the canonical source verifier', () => {
  for (const file of [
    'core/shared-backend/result-changeset-service.js',
    'core/shared-backend/result-studio-table-query.js',
    'core/shared-backend/llm-providers/index.js',
    'core/shared-backend/ai-usage-helper.js',
    'src/migration-runner.js',
    'src/migrations/001_result_studio.sql',
    'frontend/src/components/result-studio/ScientificInteractionViewer.module.css',
    'frontend/package-lock.json',
    'package-lock.json',
  ]) {
    const plan = resolveImpact([file]);
    assert.deepEqual(plan.unknown, []);
    assert.ok(plan.reasons[file].includes('p6-canonical-source-binding'));
    assert.ok(plan.tests.includes('test/g0-rs-p6-product-acceptance.test.mjs'),
      `${file} must select the canonical P6 verifier`);
  }
});

test('directly edited tests are included and unknown production paths fail closed', () => {
  assert.ok(resolveImpact(['test/loop-contract.test.mjs']).tests.includes('test/loop-contract.test.mjs'));
  assert.deepEqual(resolveImpact(['new-production-area/engine.js']).unknown, ['new-production-area/engine.js']);
});
