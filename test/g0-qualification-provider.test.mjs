import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProductTargets,
  runLive,
} from '../scripts/g0-qualification-provider.mjs';

const settings = {
  model_profiles: [
    {
      id: 'deepseek-a',
      provider: 'deepseek',
      model: 'model-a',
      credentialRef: 'credential:deepseek-a',
      capabilities: ['chat', 'tools'],
    },
    {
      id: 'compat-a',
      provider: 'openai-compatible',
      model: 'model-b',
      baseUrl: 'https://provider-a.example.test/v1',
      credentialRef: 'credential:compat-a',
      capabilities: ['chat', 'tools'],
    },
    {
      id: 'compat-b',
      provider: 'openai-compatible',
      model: 'model-c',
      baseUrl: 'https://provider-b.example.test/v1',
      credentialRef: 'credential:compat-b',
      capabilities: ['chat', 'tools'],
    },
  ],
};

const passingProbes = {
  intent: { ok: true },
  tool_select: { ok: true },
  param_fill: { ok: true },
  tool_calling: { ok: true },
  failure_recovery: { ok: true },
  result_interpret: { ok: true },
};

test('product target discovery keeps later profiles of the same provider class', () => {
  const targets = resolveProductTargets(settings, () => 'secret-present');
  assert.equal(targets.length, 3);
  assert.deepEqual(targets.map((item) => item.name), [
    'qualification-target-1',
    'qualification-target-2',
    'qualification-target-3',
  ]);
  assert.deepEqual(targets.map((item) => item.provider), [
    'deepseek',
    'openai-compatible',
    'openai-compatible',
  ]);
});

test('live qualification tries later candidates until each provider class passes', async () => {
  const attempted = [];
  const report = await runLive({
    settings,
    getCredential: () => 'secret-present',
    probeRunner: async (target) => {
      attempted.push(target.name);
      if (target.name === 'qualification-target-2') {
        return { ...passingProbes, tool_calling: { ok: false, failure: 'api_error' } };
      }
      return passingProbes;
    },
  });

  assert.equal(report.passed, true);
  assert.deepEqual(report.passedProviderClasses, ['deepseek', 'openai-compatible']);
  assert.deepEqual(attempted, [
    'qualification-target-1',
    'qualification-target-2',
    'qualification-target-3',
  ]);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /provider-a|provider-b|model-[abc]|secret-present/);
});
