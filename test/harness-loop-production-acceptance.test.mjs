import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeProviderReport } from '../scripts/harness-loop-production-acceptance.mjs';

test('production Provider evidence keeps only bounded classifications', () => {
  const evidence = sanitizeProviderReport({
    generatedAt: '2026-07-24T00:00:00.000Z',
    workflow: 'GO/KEGG',
    targets: [{
      name: 'provider-a',
      passed: 5,
      total: 6,
      passedBar: true,
      requiredFailures: [],
      failures: [{ probe: 'result_interpret', failure: 'ungrounded', detail: 'raw text' }],
      apiKey: 'secret',
      baseUrl: 'https://private.example',
      model: 'private-model',
      probes: { raw: { response: 'provider response' } },
    }, {
      name: 'provider-b',
      passed: 6,
      total: 6,
      passedBar: true,
      requiredFailures: [],
      failures: [],
    }],
  }, 'abc123');
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.passed, true);
  assert.equal(evidence.passedProviders, 2);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(serialized.includes('private-model'), false);
  assert.equal(serialized.includes('provider response'), false);
  assert.equal(serialized.includes('raw text'), false);
});
