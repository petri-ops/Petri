import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateVisualEvidence } from '../scripts/g0-qualification-visual.mjs';

function evidence(overrides = {}) {
  const specs = [
    ['chat-summary-light-wide', 'light', 'wide'],
    ['chat-summary-dark-wide', 'dark', 'wide'],
    ['result-light-wide', 'light', 'wide'],
    ['chat-summary-dark-narrow', 'dark', 'narrow'],
    ['restart-restored-light-wide', 'light', 'wide'],
  ];
  return {
    states: specs.map(([id, theme, viewport]) => ({
      id, theme, viewport, width: 1200, height: 800, bytes: 20000, imageSha256: 'a'.repeat(64),
    })),
    inspection: {
      method: 'computer-use-accessibility-and-screenshot-review',
      visibleSurfaces: ['chat', 'summary', 'task', 'files', 'result'],
      terminalStateTruthful: true,
      stageConclusionsOnly: true,
      hiddenReasoningAbsent: true,
      narrowLayoutUsable: true,
      pageHorizontalOverflow: false,
      restartRestoredConversation: true,
      restartRestoredTask: true,
      restartRestoredFiles: true,
      restartRestoredResult: true,
    },
    ...overrides,
  };
}

test('visual evidence requires packaged theme, viewport, surface and restart convergence matrices', () => {
  const verdict = evaluateVisualEvidence(evidence());
  assert.equal(verdict.passed, true, JSON.stringify(verdict.checks));
});

test('visual evidence rejects hidden reasoning or missing restart result projection', () => {
  const value = evidence();
  value.inspection.hiddenReasoningAbsent = false;
  value.inspection.restartRestoredResult = false;
  const verdict = evaluateVisualEvidence(value);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.truthfulStates, false);
  assert.equal(verdict.checks.restartConvergence, false);
});
