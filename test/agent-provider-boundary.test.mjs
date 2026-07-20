import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_CALLS,
  shouldFinalizeAgentIteration,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('../core/r-server/agent-tools');

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

test('agent Provider boundary uses five total rounds with a tool-free final round', () => {
  assert.equal(MAX_AGENT_ITERS, 5);
  assert.equal(MAX_AGENT_TOOL_CALLS, 12);
  const controller = createAgentToolCallController();
  assert.deepEqual(
    Array.from({ length: MAX_AGENT_ITERS }, (_, iteration) => shouldFinalizeAgentIteration(iteration, controller)),
    [false, false, false, false, true]
  );

  controller.reserve(Array.from({ length: MAX_AGENT_TOOL_CALLS }, (_, index) => toolCall(`cap-${index}`)));
  assert.equal(shouldFinalizeAgentIteration(1, controller), true);
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

test('a Provider batch is strictly reserved at the 12-call cap', async () => {
  const calls = Array.from({ length: 15 }, (_, index) => toolCall(`call-${index + 1}`));
  const batch = await runBoundaryBatch(calls);
  assert.equal(batch.reserved.length, 12);
  assert.equal(batch.executed.length, 12);
  assert.equal(batch.result.omitted, 3);
  assert.equal(batch.controller.totalToolCalls, 12);
  assert.equal(batch.controller.capHit(), true);
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
