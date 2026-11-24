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
    states: specs.map(([id, theme, viewport], index) => ({
      // 2026-11-24：五态须逐态唯一 sha（理想夹具），重复 sha 由负测单独覆盖。
      id, theme, viewport, width: 1200, height: 800, bytes: 20000,
      imageSha256: String(index + 1).repeat(64),
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

test('visual evidence rejects duplicated screenshots (5 states must be distinct)', () => {
  const value = evidence();
  // 把第 5 张改成与第 1 张同 sha（复刻真实证据缺口：5 张 PNG / 4 唯一态）。
  value.states[4].imageSha256 = value.states[0].imageSha256;
  const verdict = evaluateVisualEvidence(value);
  assert.equal(verdict.checks.distinctStates, false);
  assert.equal(verdict.passed, false);
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
