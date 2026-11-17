import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  reasoningEvidenceFromResult,
  probeVerdictFromResult,
} = require('../core/petri-server/helpers/model-capability-probe.js');

test('reasoningEvidenceFromResult — 从 OpenAI 兼容响应抽取思考证据', () => {
  const ev = reasoningEvidenceFromResult({
    request_id: 'req-1',
    model: 'glm-4.6',
    choices: [{ message: { content: '', reasoning_content: '先算再答' } }],
    usage: { completion_tokens_details: { reasoning_tokens: 4 } },
  });
  assert.equal(ev.reasoningContent, true);
  assert.equal(ev.reasoningTokens, 4);
  assert.equal(ev.requestId, 'req-1');
  assert.equal(ev.model, 'glm-4.6');
});

test('probeVerdictFromResult — 有思考证据=supported，无证据=unknown，不冒充 false', () => {
  assert.equal(probeVerdictFromResult({
    choices: [{ message: { reasoning_content: 'x' } }],
    usage: { completion_tokens_details: { reasoning_tokens: 1 } },
  }), 'supported');
  assert.equal(probeVerdictFromResult({
    choices: [{ message: { content: '42' } }],
    usage: {},
  }), 'unknown');
});

test('probeVerdictFromResult — 明确未知参数错误=unsupported，其他错误=error', () => {
  assert.equal(probeVerdictFromResult({ error: 'unknown_parameter', message: 'Unknown parameter: thinking' }), 'unsupported');
  assert.equal(probeVerdictFromResult({ error: 'no_credential' }), 'error');
});
