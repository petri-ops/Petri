import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { bindVerifiedArtifact, createAgentWorkflowPlan, projectWorkflowPlan } = require(
  '../core/shared-backend/agent-workflow.js'
);
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'harness-workflow-cases.json'
);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('workflow fixture contract is versioned and identifiers are unique', () => {
  assert.equal(fixtures.fixtureVersion, 1);
  assert.equal(new Set(fixtures.cases.map((fixture) => fixture.id)).size, fixtures.cases.length);
});

for (const fixture of fixtures.cases) {
  test(`workflow quality gate: ${fixture.id}`, () => {
    let plan = createAgentWorkflowPlan({
      templateId: fixture.templateId,
      availableToolIds: fixture.availableToolIds,
    });
    plan = {
      ...plan,
      steps: plan.steps.map((step) => {
        const job = fixture.jobs.find((item) => item.stepId === step.id);
        return job ? { ...step, toolJobId: job.id } : step;
      }),
    };
    for (const binding of fixture.bindings || []) {
      plan = bindVerifiedArtifact(plan, binding);
    }
    const projected = projectWorkflowPlan(plan, fixture.jobs);
    for (const [stepId, expectedStatus] of Object.entries(fixture.expected.stepStatuses)) {
      assert.equal(projected.steps.find((step) => step.id === stepId)?.status, expectedStatus);
    }
    assert.deepEqual(projected.readyStepIds.sort(), [...fixture.expected.readyStepIds].sort());
    assert.equal(projected.recoverable, fixture.expected.recoverable);
    assert.equal(projected.terminal, fixture.expected.terminal);
    if (fixture.expected.nextActionIds) {
      assert.deepEqual(
        projected.nextActions.map((action) => action.id).sort(),
        [...fixture.expected.nextActionIds].sort()
      );
    }
    assert.equal(projected.autoExecute, false);
  });
}
