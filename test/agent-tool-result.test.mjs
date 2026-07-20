import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const db = require('../core/r-server/db.js');
const {
  dispatchTool,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolResultEvent,
} = require('../core/r-server/agent-tools');
const { createToolTraceStore } = require('../core/r-server/agent-tools/tool-trace-store');

test('executeToolCall wraps a denied unknown tool while dispatchTool stays raw', async () => {
  const raw = await dispatchTool('missing_p7d_tool', {}, {});
  assert.equal(raw.ok, false);
  assert.equal(raw.error, 'unknown_tool');
  assert.equal(raw.contractVersion, undefined);

  const result = await executeToolCall('missing_p7d_tool', {}, {}, {
    traceId: 'trace_test',
    callId: 'call_test',
  });
  assert.equal(result.contractVersion, '1.0.0');
  assert.equal(result.traceId, 'trace_test');
  assert.equal(result.callId, 'call_test');
  assert.equal(result.tool, 'missing_p7d_tool');
  assert.equal(result.status, 'denied');
  assert.equal(result.terminationReason, 'unknown_tool');
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
  assert.deepEqual(result.sideEffects, { type: 'none', riskTier: 'R0', resources: [] });
  assert.equal(result.data.error, 'unknown_tool');
});

test('successful read-only operations report no observed side effects', async () => {
  const runToolList = await executeToolCall('run_tool', { op: 'list' }, { userId: 'local-user' });
  assert.equal(runToolList.status, 'success');
  assert.deepEqual(runToolList.sideEffects, { type: 'none', riskTier: 'R0', resources: [] });

  const planList = await executeToolCall('plan', { op: 'list' }, { userId: 'local-user' });
  assert.equal(planList.status, 'success');
  assert.deepEqual(planList.sideEffects, { type: 'none', riskTier: 'R0', resources: [] });
});

test('workspace dry-run reports no side effects while a real write remains R2', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-tool-result-'));
  const project = db.createProject({
    name: 'ToolResult dry-run',
    description: '',
    modality: 'single-cell',
    userId: 'tool-result-user',
    workspacePath: workspaceRoot,
  });
  db.setProjectUserId(project.id, 'tool-result-user');

  try {
    const args = { path: 'preview/new.txt', content: 'preview\n', dryRun: true };
    const preview = await executeToolCall('workspace_write', args, {
      projectId: project.id,
      userId: 'tool-result-user',
      accessMode: 'read',
      allowExecution: false,
    });

    assert.equal(preview.status, 'success');
    assert.equal(preview.terminationReason, 'success');
    assert.equal(preview.data.dryRun, true);
    assert.deepEqual(preview.sideEffects, { type: 'none', riskTier: 'R0', resources: [] });
    await assert.rejects(fs.access(path.join(workspaceRoot, 'preview')));

    const written = await executeToolCall(
      'workspace_write',
      { path: 'written.txt', content: 'written\n' },
      {
        projectId: project.id,
        userId: 'tool-result-user',
        accessMode: 'full',
        allowExecution: true,
      }
    );
    assert.equal(written.status, 'success');
    assert.equal(written.data.dryRun, false);
    assert.equal(written.sideEffects.type, 'workspace-write');
    assert.equal(written.sideEffects.riskTier, 'R2');
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'written.txt'), 'utf8'), 'written\n');
  } finally {
    db.deleteProject(project.id);
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('executeToolCall keeps pending run_tool approval truthful and records only the created job', async () => {
  const result = await executeToolCall('run_tool', {
    op: 'run',
    toolId: 'deseq2',
    params: { counts: '/fake/counts.csv' },
  }, { userId: 'local-user', allowExecution: true }, {
    traceId: 'trace_approval',
    callId: 'call_approval',
  });

  try {
    assert.equal(result.status, 'success');
    assert.equal(result.terminationReason, 'approval_required');
    assert.equal(result.data.needApproval, true);
    assert.ok(result.data.ackToken);
    assert.ok(result.data.toolJobId);
    assert.deepEqual(result.sideEffects, {
      type: 'state-write',
      riskTier: 'R1',
      resources: ['tool_job'],
    });
    assert.equal(db.getToolJob(result.data.toolJobId).ack_status, 'pending');
  } finally {
    if (result.data.toolJobId) {
      db.getDatabase().prepare('DELETE FROM tool_jobs WHERE id=?').run(result.data.toolJobId);
    }
  }
});

test('tool SSE events expose structured results and retain legacy approval fields', () => {
  const call = buildToolCallEvent({
    name: 'run_tool',
    args: { op: 'run', apiKey: 'must-not-leak' },
    traceId: 'trace_sse',
    callId: 'call_sse',
  });
  assert.equal(call.traceId, 'trace_sse');
  assert.equal(call.callId, 'call_sse');
  assert.equal(call.args.apiKey, '[REDACTED]');

  const event = buildToolResultEvent({
    contractVersion: '1.0.0',
    traceId: 'trace_sse',
    callId: 'call_sse',
    tool: 'run_tool',
    status: 'success',
    terminationReason: 'approval_required',
    durationMs: 4.2,
    truncated: false,
    sideEffects: { type: 'state-write', riskTier: 'R1', resources: ['tool_job'] },
    data: {
      needApproval: true,
      ackToken: 'ack-safe-id',
      toolJobId: 'job-safe-id',
      toolId: 'deseq2',
      params: { accessToken: 'must-not-leak' },
      message: '需要确认',
    },
  }, { op: 'run' });

  assert.equal(event.event, 'tool_result');
  assert.equal(event.name, 'run_tool');
  assert.equal(event.needApproval, true);
  assert.equal(event.ackToken, 'ack-safe-id');
  assert.equal(event.toolJobId, 'job-safe-id');
  assert.equal(event.toolId, 'deseq2');
  assert.equal(event.params.accessToken, '[REDACTED]');
  assert.equal(event.toolResult.status, 'success');
  assert.equal(event.toolResult.terminationReason, 'approval_required');
  assert.equal(event.toolResult.sideEffects.type, 'state-write');
});

test('model serialization recursively redacts credential variants and preserves shared aliases', () => {
  const shared = { value: 'safe' };
  const envelope = {
    contractVersion: '1.0.0',
    traceId: 'trace_model',
    callId: 'call_model',
    tool: 'query',
    status: 'success',
    terminationReason: 'success',
    durationMs: 1,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data: {
      authorization: 'Bearer must-not-leak',
      GITHUB_TOKEN: 'plain-provider-token',
      OPENAI_API_KEY: 'another-provider-key',
      token: 'generic-token',
      nested: {
        text: [
          'AWS_SECRET_ACCESS_KEY=aws-secret',
          'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
          'hf_abcdefghijklmnopqrstuvwxyz123456',
          'glpat-abcdefghijklmnopqrstuvwxyz123456',
          'AIzaabcdefghijklmnopqrstuvwxyz123456',
          'sk_live_abcdefghijklmnopqrstuvwxyz',
        ].join(' '),
        first: shared,
        second: shared,
        value: 'x'.repeat(200),
      },
    },
  };
  const full = serializeToolResultForModel(envelope, 10_000);
  assert.equal(full.includes('must-not-leak'), false);
  assert.equal(full.includes('plain-provider-token'), false);
  assert.equal(full.includes('another-provider-key'), false);
  assert.equal(full.includes('generic-token'), false);
  assert.equal(full.includes('aws-secret'), false);
  assert.equal(full.includes('ghp_abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(full.includes('hf_abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(full.includes('glpat-abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(full.includes('AIzaabcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(full.includes('sk_live_abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(full.includes('[Circular]'), false);
  assert.equal(JSON.parse(full).data.nested.second.value, 'safe');

  const serialized = serializeToolResultForModel(envelope, 120);
  assert.ok(serialized.endsWith('... (truncated)'));

  const replaced = replaceToolResultData(envelope, { value: 'x'.repeat(7000) });
  assert.equal(replaced.truncated, true);
});

test('trace store keeps only redacted summaries within capacity and TTL', () => {
  let now = 1_000;
  const store = createToolTraceStore({ maxEntries: 2, ttlMs: 50, now: () => now });
  const append = (callId, secret) => store.append({
    traceId: 'trace_store',
    callId,
    tool: 'query',
    status: 'success',
    terminationReason: 'success',
    durationMs: 1,
    args: { apiKey: secret },
    result: { text: `Authorization: Bearer ${secret}` },
  });

  append('call_1', 'secret-one');
  now += 10;
  append('call_2', 'secret-two');
  now += 10;
  append('call_3', 'secret-three');

  const retained = store.getTrace('trace_store');
  assert.deepEqual(retained.map((entry) => entry.callId), ['call_2', 'call_3']);
  for (const entry of retained) {
    assert.equal(entry.argsSummary.includes('secret-'), false);
    assert.equal(entry.resultSummary.includes('secret-'), false);
    assert.ok(entry.argsSummary.includes('[REDACTED]'));
  }

  now += 51;
  assert.equal(store.size(), 0);
  assert.deepEqual(store.getTrace('trace_store'), []);
});
