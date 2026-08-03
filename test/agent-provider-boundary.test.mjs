import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('../core/r-server/agent-tools');

test('bound result edits cannot finish successfully before a real preview-ready candidate exists', () => {
  const guard = createResultEditCompletionGuard({ required: true });
  assert.equal(guard.requiresToolExecution(), false);
  const first = guard.assessTerminal();
  assert.equal(first.action, 'retry');
  assert.match(first.prompt, /尚未成功创建 preview_ready 候选/);
  assert.equal(guard.requiresToolExecution(), true);

  const second = guard.assessTerminal();
  assert.equal(second.action, 'fail');
  assert.match(second.message, /阻止展示伪成功结论/);
});

test('bound result edit completion guard accepts only the sealed create tool success terminal', () => {
  const guard = createResultEditCompletionGuard({ required: true });
  guard.recordToolResult('result_changeset_create_in_context', {
    ok: false,
    changeSet: { status: 'preview_ready' },
  });
  assert.equal(guard.assessTerminal().action, 'retry');

  guard.recordToolResult('result_changeset_create_in_context', {
    ok: true,
    changeSet: { status: 'preview_ready' },
  });
  assert.equal(guard.requiresToolExecution(), false);
  assert.equal(guard.assessTerminal().action, 'accept');
  assert.deepEqual(guard.snapshot(), {
    required: true,
    candidateCreated: true,
    recoveryAttempted: true,
  });

  const ordinary = createResultEditCompletionGuard();
  assert.equal(ordinary.assessTerminal().action, 'accept');
});

function toolCall(id, argumentsValue = '{}', name = 'workspace_read') {
  return { id, type: 'function', function: { name, arguments: argumentsValue } };
}

async function runBoundaryBatch(toolCalls, options = {}) {
  const executed = [];
  const rejected = [];
  const reserved = [];
  let aborted = false;
  const controller = options.controller || createAgentToolCallController();
  const result = await runAgentToolCallBatch({
    controller,
    toolCalls,
    createCallId: (() => {
      let index = 0;
      return () => `fallback-${++index}`;
    })(),
    shouldAbort: () => aborted,
    onReserved: (calls) => reserved.push(...calls),
    execute: async (parsed) => {
      executed.push(parsed);
      if (options.abortAfterFirst && executed.length === 1) aborted = true;
      return parsed;
    },
    reject: async (parsed) => {
      rejected.push(parsed);
      return parsed;
    },
  });
  return { controller, result, executed, rejected, reserved };
}

test('agent work is goal-terminated without a normal iteration or tool-call cap', () => {
  assert.equal(MAX_AGENT_TOOL_ITERS, Infinity);
  assert.equal(MAX_AGENT_ITERS, Infinity);
  assert.equal(MAX_AGENT_TOOL_CALLS, Infinity);
  const controller = createAgentToolCallController();
  assert.equal(shouldFinalizeAgentIteration(100_000, controller), false);
  assert.equal(controller.capHit(), false);
});

test('finalization recovery adds at most one tool-free retry without another agent iteration', () => {
  assert.equal(MAX_FINALIZATION_ATTEMPTS, 2);
  const original = {
    messages: [{ role: 'user', content: 'analyze' }],
    temperature: 0.4,
    tools: [{ type: 'function' }],
    tool_choice: 'auto',
  };
  const retry = buildFinalizationRetryRequest(original);
  assert.equal(retry.temperature, 0.2);
  assert.equal(retry.tools, undefined);
  assert.equal(retry.tool_choice, undefined);
  assert.equal(retry.messages.length, 2);
  assert.equal(original.messages.length, 1);
});

test('finalization recovery retries empty or tool-only output but never duplicates visible text', () => {
  assert.deepEqual(
    assessFinalizationResult({ choices: [{ message: { content: '' } }] }),
    { usable: false, retryable: true, reason: 'empty_final_response', content: '' }
  );
  assert.equal(
    assessFinalizationResult({ choices: [{ message: { tool_calls: [{ id: 'call-1' }] } }] }).reason,
    'unexpected_tool_calls_in_finalization'
  );
  assert.deepEqual(
    assessFinalizationResult({ choices: [{ message: { content: '' } }] }, 'visible answer'),
    { usable: true, retryable: false, reason: null, content: 'visible answer' }
  );
});

test('finalization recovery only retries transient Provider errors', () => {
  assert.equal(assessFinalizationResult({ error: 'timeout' }).retryable, true);
  assert.equal(assessFinalizationResult({ error: 'http_error', status: 503 }).retryable, true);
  assert.equal(assessFinalizationResult({ error: 'http_error', status: 401 }).retryable, false);
  assert.equal(assessFinalizationResult({ error: 'aborted' }).retryable, false);
  assert.match(
    buildFinalizationFallbackMessage({ attempts: 2, reason: 'http_503' }),
    /上游服务暂不可用.*自动尝试最终整理 2 次.*请稍后重试或切换备用模型/s
  );
  assert.deepEqual(
    finalizationFallbackReason({ choices: [{ message: { tool_calls: [{ id: 'call-1' }] } }] }),
    { code: 'unexpected_tool_calls_in_finalization' }
  );
  assert.equal(finalizationFallbackReason({ choices: [{ message: { content: 'done' } }] }), null);
});

test('finalization fallback explains captured loop anomaly and last safe stage', () => {
  const message = buildFinalizationFallbackMessage({
    attempts: 2,
    reason: 'unexpected_tool_calls_in_finalization',
    anomaly: {
      code: 'repeated_tool_call',
      message: '检测到 run_tool 使用相同参数连续调用 3 次，系统已停止异常循环',
    },
    lastStageConclusion: 'QC 工具返回 blocked，输入数据需要检查。',
  });
  assert.match(message, /停止位置：QC 工具返回 blocked/);
  assert.match(message, /相同参数连续调用 3 次/);
  assert.match(message, /系统已处理：停止异常调用、保留已有工具结果、自动尝试最终整理 2 次/);
  assert.doesNotMatch(message, /发送“继续/);
});

test('user-facing progress is bounded and deduplicated', () => {
  const recorder = createAgentProgressRecorder({ maxItems: 2, maxContentLength: 200 });
  assert.deepEqual(recorder.record('正在核对输入文件。', 1), {
    iteration: 1,
    content: '正在核对输入文件。',
  });
  assert.equal(recorder.record('正在核对输入文件。', 2), null);
  recorder.record('样本分组已经确认。', 2);
  recorder.record('开始检查矩阵维度。', 3);
  assert.deepEqual(recorder.snapshot(), [
    { iteration: 2, content: '样本分组已经确认。' },
    { iteration: 3, content: '开始检查矩阵维度。' },
  ]);
});

test('malformed, array, and null arguments are rejected without executing handlers', async () => {
  const batch = await runBoundaryBatch([
    toolCall('bad-json', '{'),
    toolCall('array-json', '[]'),
    toolCall('null-json', 'null'),
  ]);
  assert.equal(batch.executed.length, 0);
  assert.deepEqual(batch.rejected.map((item) => item.error), [
    'invalid_arguments',
    'invalid_arguments',
    'invalid_arguments',
  ]);
});

test('single-key Provider arguments envelopes are decoded before normal execution', async () => {
  const inner = { contextToken: 'a'.repeat(64), intent: { intentId: 'rei_1' } };
  const batch = await runBoundaryBatch([
    toolCall('wrapped-json', JSON.stringify({ arguments: JSON.stringify(inner) }), 'result_changeset_create_in_context'),
  ]);
  assert.equal(batch.executed.length, 1);
  assert.deepEqual(batch.executed[0].args, inner);
});

test('single-key Provider envelopes repair only a bare redacted context token placeholder', async () => {
  const wrapped = '{"contextToken": [REDACTED], "intent": {"intentId": "rei_1"}}';
  const batch = await runBoundaryBatch([
    toolCall('wrapped-redacted-token', JSON.stringify({ arguments: wrapped }), 'result_changeset_create_in_context'),
  ]);
  assert.equal(batch.executed.length, 1);
  assert.deepEqual(batch.executed[0].args, {
    contextToken: '[REDACTED]',
    intent: { intentId: 'rei_1' },
  });

  const malformed = await runBoundaryBatch([
    toolCall('wrapped-other-bare-token', JSON.stringify({ arguments: '{"path": [REDACTED]}' })),
  ]);
  assert.equal(malformed.executed.length, 1);
  assert.deepEqual(malformed.executed[0].args, { arguments: '{"path": [REDACTED]}' });
});

test('direct Provider arguments repair only a bare redacted context token placeholder', async () => {
  const batch = await runBoundaryBatch([
    toolCall(
      'direct-redacted-token',
      '{"contextToken": [REDACTED], "intent": {"intentId": "rei_1"}}',
      'result_changeset_create_in_context'
    ),
  ]);
  assert.equal(batch.executed.length, 1);
  assert.deepEqual(batch.executed[0].args, {
    contextToken: '[REDACTED]',
    intent: { intentId: 'rei_1' },
  });

  const malformed = await runBoundaryBatch([
    toolCall('direct-other-bare-token', '{"path": [REDACTED]}'),
  ]);
  assert.equal(malformed.executed.length, 0);
  assert.equal(malformed.rejected[0].error, 'invalid_arguments');
});

test('malformed Result Studio create envelopes recover only the sealed intent capability', async () => {
  const malformedInner = '{"contextToken": [REDACTED], "scientificConfirmed": false, "intent": {'
    + '"intentId": "rei_sealed_1", "source": {"inputs": [], "sourceNodeId": "job:1"}}';
  const batch = await runBoundaryBatch([
    toolCall(
      'malformed-sealed-intent',
      JSON.stringify({ arguments: malformedInner }),
      'result_changeset_create_in_context'
    ),
  ]);
  assert.equal(batch.executed.length, 1);
  assert.deepEqual(batch.executed[0].args, {
    contextToken: '[REDACTED]',
    intent: { intentId: 'rei_sealed_1' },
    scientificConfirmed: false,
  });

  const foreignTool = await runBoundaryBatch([
    toolCall('foreign-malformed', malformedInner, 'workspace_read'),
  ]);
  assert.equal(foreignTool.executed.length, 0);
  assert.equal(foreignTool.rejected[0].error, 'invalid_arguments');
});

test('Provider arguments compatibility never unwraps envelopes with extra keys', async () => {
  const batch = await runBoundaryBatch([
    toolCall('ambiguous-wrapper', JSON.stringify({ arguments: '{"path":"a.txt"}', extra: true })),
  ]);
  assert.equal(batch.executed.length, 1);
  assert.deepEqual(batch.executed[0].args, { arguments: '{"path":"a.txt"}', extra: true });
});

test('repeated-call protection compares decoded and native argument forms identically', async () => {
  const controller = createAgentToolCallController();
  const inner = { path: 'a.txt' };
  const first = await runBoundaryBatch([toolCall('native-1', JSON.stringify(inner))], { controller });
  const second = await runBoundaryBatch([
    toolCall('wrapped-2', JSON.stringify({ arguments: JSON.stringify(inner) })),
  ], { controller });
  const third = await runBoundaryBatch([toolCall('native-3', JSON.stringify(inner))], { controller });
  assert.equal(first.executed.length, 1);
  assert.equal(second.executed.length, 1);
  assert.equal(third.executed.length, 0);
  assert.equal(third.rejected[0].error, 'repeated_tool_call');
});

test('duplicate Provider tool call ids are rejected without duplicating protocol history ids', async () => {
  const controller = createAgentToolCallController();
  const first = await runBoundaryBatch([toolCall('same-id', '{"path":"a.txt"}')], { controller });
  const second = await runBoundaryBatch([toolCall('same-id', '{"path":"b.txt"}')], { controller });
  assert.equal(first.executed.length, 1);
  assert.equal(second.executed.length, 0);
  assert.equal(second.rejected[0].error, 'duplicate_tool_call');
  assert.equal(second.rejected[0].providerCallId, 'same-id');
  assert.notEqual(second.reserved[0].id, first.reserved[0].id);
  assert.equal(second.rejected[0].callId, second.reserved[0].id);
});

test('generated protocol ids remain unique when a later Provider round reuses one', async () => {
  const controller = createAgentToolCallController();
  const first = await runBoundaryBatch([toolCall('duplicate-id')], { controller });
  const second = await runBoundaryBatch([toolCall('duplicate-id')], { controller });
  const generatedId = second.reserved[0].id;
  const third = await runBoundaryBatch([toolCall(generatedId)], { controller });

  assert.equal(first.executed.length, 1);
  assert.equal(second.rejected[0].error, 'duplicate_tool_call');
  assert.equal(third.executed.length, 0);
  assert.equal(third.rejected[0].error, 'duplicate_tool_call');
  assert.equal(third.rejected[0].providerCallId, generatedId);
  assert.equal(new Set([
    first.reserved[0].id,
    second.reserved[0].id,
    third.reserved[0].id,
  ]).size, 3);
});

test('an explicitly injected finite test cap is still enforced by the controller', async () => {
  const calls = Array.from(
    { length: 30 },
    (_, index) => toolCall(`call-${index + 1}`, JSON.stringify({ path: `file-${index + 1}.txt` }))
  );
  const batch = await runBoundaryBatch(calls, {
    controller: createAgentToolCallController({ maxToolCalls: 24 }),
  });
  assert.equal(batch.reserved.length, 24);
  assert.equal(batch.executed.length, 24);
  assert.equal(batch.result.omitted, 6);
  assert.equal(batch.controller.totalToolCalls, 24);
  assert.equal(batch.controller.capHit(), true);
});

test('the third identical semantic tool call is rejected as an abnormal loop', async () => {
  assert.equal(MAX_IDENTICAL_TOOL_CALLS, 3);
  const controller = createAgentToolCallController();
  const first = await runBoundaryBatch([
    toolCall('repeat-1', '{"path":"counts.csv","startLine":1}'),
  ], { controller });
  const second = await runBoundaryBatch([
    toolCall('repeat-2', '{"startLine":1,"path":"counts.csv"}'),
  ], { controller });
  const third = await runBoundaryBatch([
    toolCall('repeat-3', '{"path":"counts.csv","startLine":1}'),
  ], { controller });

  assert.equal(first.executed.length, 1);
  assert.equal(second.executed.length, 1);
  assert.equal(third.executed.length, 0);
  assert.equal(third.rejected[0].error, 'repeated_tool_call');
  assert.equal(controller.anomalyHit(), true);
  assert.equal(shouldFinalizeAgentIteration(3, controller), true);
});

test('cancellation observed between calls rejects the remainder without starting handlers', async () => {
  const batch = await runBoundaryBatch([
    toolCall('call-1'),
    toolCall('call-2'),
    toolCall('call-3'),
  ], { abortAfterFirst: true });
  assert.deepEqual(batch.executed.map((item) => item.callId), ['call-1']);
  assert.deepEqual(batch.rejected.map((item) => item.error), ['request_canceled', 'request_canceled']);
  assert.equal(batch.result.outcomes.length, batch.reserved.length);
});
