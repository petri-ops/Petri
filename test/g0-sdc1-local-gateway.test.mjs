import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSdc1GatewayResponse } from '../scripts/g0-sdc1-local-gateway.mjs';

function user(content) { return { role: 'user', content }; }
function call(args) {
  return { role: 'assistant', tool_calls: [{ function: { name: 'run_tool', arguments: JSON.stringify(args) } }] };
}
function result(data) {
  return {
    role: 'tool',
    name: 'run_tool',
    content: JSON.stringify({
      tool: 'run_tool',
      status: 'success',
      terminationReason: 'success',
      data,
    }),
  };
}
function next(messages) {
  return buildSdc1GatewayResponse({ messages }, {
    countsPath: '/tmp/project/data/counts.csv',
    metadataPath: '/tmp/project/data/metadata.csv',
    requestIndex: messages.length + 1,
  });
}

test('asks for the minimum scientific confirmation before execution', () => {
  const value = next([user('Data Profiler 已识别两个文件')]);
  assert.equal(value.phase, 'scientific_confirmation');
  assert.match(value.response.choices[0].message.content, /condition/);
});

test('lists catalog, reads the exact contract, then runs DESeq2', () => {
  const confirmed = user('确认：design=condition，对照组=WT，实验组=KO');
  assert.equal(next([confirmed]).phase, 'catalog');
  assert.equal(next([confirmed, call({ op: 'list' }), result({ ok: true, tools: [] })]).phase, 'contract');
  const execution = next([
    confirmed,
    call({ op: 'list' }), result({ ok: true }),
    call({ op: 'list', toolId: 'deseq2' }), result({ ok: true }),
  ]);
  assert.equal(execution.phase, 'execute');
  const args = JSON.parse(execution.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(args.params.design, 'condition');
  assert.equal(args.params.counts, '/tmp/project/data/counts.csv');
});

test('finishes only after a successful ToolResult with a concrete ToolJob', () => {
  const messages = [
    user('确认：design=condition，对照组=WT，实验组=KO'),
    call({ op: 'list' }), result({ ok: true }),
    call({ op: 'list', toolId: 'deseq2' }), result({ ok: true }),
    call({ op: 'run', toolId: 'deseq2' }),
  ];
  assert.equal(next([...messages, result({ toolJobId: 'tj_1', artifactTruth: { status: 'valid' } })]).phase, 'final');
  assert.equal(next([...messages, {
    role: 'tool',
    name: 'run_tool',
    content: JSON.stringify({
      tool: 'run_tool',
      status: 'success',
      terminationReason: 'success',
      toolJobId: 'tj_real_envelope',
      data: { preview: '{"ok":true}' },
    }),
  }]).phase, 'final');
  assert.equal(next([...messages, {
    role: 'tool',
    name: 'run_tool',
    content: JSON.stringify({
      tool: 'run_tool',
      status: 'success',
      terminationReason: 'success',
      truncated: true,
      dataSummary: '{"ok":true,"result":{"toolJobId":"tj_compacted_envelope",',
    }),
  }]).phase, 'final');
  assert.equal(next([...messages, result({ ok: false, error: 'bad_input' })]).phase, 'blocked');
});
