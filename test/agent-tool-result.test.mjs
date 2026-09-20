import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapTestDb } from './helpers/bootstrap-db.mjs';

const require = createRequire(import.meta.url);
const TEST_DB_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-tool-result-'));
process.env.BIOF3_DB_PATH = path.join(TEST_DB_DIR, 'biof3.db');

bootstrapTestDb();
const db = require('../core/biof3-server/db.js');
// 单测绕过 server.js 启动；显式复用真实启动路径的 Plan 表初始化，确保干净工作树可运行。
require('../core/biof3-server/ai-bridge.js');

// BLOCK-104 增量 — run_tool 的工具事实源=已装插件（BLOCK-83 P4 核心树生信内容
// 删除 + BLOCK-86 领域包封存后，deseq2 需装包才存在；ledger 在案「09-13 后即不可
// 本机重采」）。approval 两段式测试依赖真实 run_tool 链，按装包态门控：
// 未装包时 skip（可见计数），装包环境自动恢复运行。
const { getPlugin } = require('../core/biof3-server/plugin-loader');
const DESEQ2_AVAILABLE = !!getPlugin('deseq2');
const DESEQ2_SKIP = DESEQ2_AVAILABLE
  ? false
  : 'run_tool 需已装 deseq2 领域插件（BLOCK-83/86 包生态迁移）；装包后本测试自动恢复';
const {
  createModelResultState,
  createRejectedToolResult,
  dispatchTool,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolResultEvent,
  createToolActivityRecorder,
} = require('../core/biof3-server/agent-tools');
const { createToolTraceStore } = require('../core/biof3-server/agent-tools/tool-trace-store');

after(() => {
  try {
    db.db.close();
  } catch {}
  fsSync.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

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

test('initial ToolResult truncation is measured from raw data before redaction', () => {
  const rawCredentialMessage = `GITHUB_TOKEN=${'x'.repeat(7000)}`;
  const result = createRejectedToolResult(
    'workspace_read',
    'invalid_arguments',
    rawCredentialMessage,
    { projectId: 'project-truncation' },
    { traceId: 'trace_raw_truncation', callId: 'call_raw_truncation' }
  );

  assert.equal(result.truncated, true);
  assert.equal(result.data.message, rawCredentialMessage);

  const transformed = replaceToolResultData(result, {
    ...result.data,
    message: '[REDACTED]',
  });
  assert.equal(transformed.truncated, true);
  assert.equal(buildToolResultEvent(transformed, {}).toolResult.truncated, true);

  const projected = serializeToolResultForModel(transformed, 10_000);
  assert.equal(projected.includes(rawCredentialMessage), false);
});

test('successful large results expose neutral truncation metadata', () => {
  const envelope = {
    contractVersion: '1.0.0',
    traceId: 'trace_preview_summary',
    callId: 'call_preview_summary',
    tool: 'workspace_list',
    status: 'success',
    terminationReason: 'success',
    durationMs: 4,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data: { entries: Array.from({ length: 100 }, (_, index) => ({ path: `file-${index}.txt` })) },
  };
  const event = buildToolResultEvent(envelope, {});
  assert.equal(event.toolResult.status, 'success');
  assert.equal(event.toolResult.previewTruncated, true);
  assert.equal(event.toolResult.sourceTruncated, false);
  assert.equal(event.toolResult.truncated, true);
});

test('large run_tool results keep promoted tool_job lineage outside bounded preview', () => {
  const event = buildToolResultEvent({
    contractVersion: '1.0.0',
    traceId: 'trace_large_run_tool',
    callId: 'call_large_run_tool',
    tool: 'run_tool',
    status: 'success',
    terminationReason: 'success',
    durationMs: 12,
    truncated: true,
    sideEffects: { type: 'execution', riskTier: 'R2', resources: ['tool_jobs'] },
    data: {
      ok: true,
      toolId: 'sample-metadata-validator',
      toolJobId: 'tj_exact_lineage',
      result: { files: Array.from({ length: 200 }, (_, index) => `artifact-${index}`) },
    },
  }, {});
  assert.equal(event.toolResult.previewTruncated, true);
  assert.equal(event.toolResult.data.toolJobId, undefined);
  assert.equal(event.toolJobId, 'tj_exact_lineage');
  assert.equal(event.toolId, 'sample-metadata-validator');
});

test('tool activity recorder keeps safe summaries for conversation restore', () => {
  const recorder = createToolActivityRecorder();
  recorder.recordCall({
    name: 'workspace_write',
    args: { path: 'notes/result.txt', content: 'secret content must not persist' },
    traceId: 'trace_activity',
    callId: 'call_activity',
    iteration: 3,
  });
  recorder.recordResult(buildToolResultEvent({
    contractVersion: '1.0.0',
    traceId: 'trace_activity',
    callId: 'call_activity',
    tool: 'workspace_write',
    status: 'success',
    terminationReason: 'success',
    durationMs: 8,
    truncated: false,
    sideEffects: { type: 'workspace-write', riskTier: 'R2', resources: ['notes/result.txt'] },
    data: { ok: true },
  }, {}, { iteration: 3 }));

  const snapshot = recorder.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].status, 'success');
  assert.equal(snapshot[0].iteration, 3);
  assert.equal(snapshot[0].actionDetail, 'notes/result.txt');
  assert.equal(JSON.stringify(snapshot).includes('secret content must not persist'), false);
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

test('executeToolCall keeps pending run_tool approval truthful and records only the created job', { skip: DESEQ2_SKIP }, async () => {
  const inputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-tool-approval-'));
  const countsPath = path.join(inputDir, 'counts.csv');
  const coldataPath = path.join(inputDir, 'coldata.csv');
  await fs.writeFile(countsPath, 'gene,sample\ngene1,1\n');
  await fs.writeFile(coldataPath, 'sample,condition\nsample,control\n');
  const result = await executeToolCall('run_tool', {
    op: 'run',
    toolId: 'deseq2',
    params: { counts: countsPath, coldata: coldataPath },
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
    await fs.rm(inputDir, { recursive: true, force: true });
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
  const limited = JSON.parse(serialized);
  assert.ok(serialized.length <= 120);
  assert.equal(limited.truncated, true);

  const rawTruncatedEnvelope = { ...envelope, truncated: true };
  const replaced = replaceToolResultData(rawTruncatedEnvelope, { value: 'localized' });
  assert.equal(replaced.truncated, true);
  assert.deepEqual(replaced.data, { value: 'localized' });
});

test('model serialization redacts Result Studio context tokens in every supported key form', () => {
  const tokenValues = {
    camel: 'context-token-camel-must-not-leak',
    title: 'context-token-title-must-not-leak',
    snake: 'context-token-snake-must-not-leak',
    kebab: 'context-token-kebab-must-not-leak',
    text: 'context-token-text-must-not-leak',
  };
  const serialized = serializeToolResultForModel(modelEnvelope('result_studio_context', {
    ok: true,
    contextToken: tokenValues.camel,
    ContextToken: tokenValues.title,
    context_token: tokenValues.snake,
    'context-token': tokenValues.kebab,
    diagnostic: `contextToken=${tokenValues.text}`,
  }), 10_000);

  for (const value of Object.values(tokenValues)) {
    assert.equal(serialized.includes(value), false);
  }
  const projected = JSON.parse(serialized);
  assert.equal(projected.data.contextToken, '[REDACTED]');
  assert.equal(projected.data.ContextToken, '[REDACTED]');
  assert.equal(projected.data.context_token, '[REDACTED]');
  assert.equal(projected.data['context-token'], '[REDACTED]');
  assert.equal(projected.data.diagnostic.includes('[REDACTED]'), true);
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

function modelEnvelope(tool, data, overrides = {}) {
  return {
    contractVersion: '1.0.0',
    traceId: 'trace_projection',
    callId: `call_${tool}`,
    tool,
    status: 'success',
    terminationReason: 'success',
    durationMs: 1,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data,
    ...overrides,
  };
}

test('model projection compacts workspace result types without changing the source envelope', () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({
    name: `file-${index}.txt`,
    path: `data/file-${index}.txt`,
    type: 'file',
    noisyMetadata: 'x'.repeat(200),
  }));
  const cases = [
    ['workspace_list', { ok: true, path: 'data', entries }],
    ['workspace_find', { ok: true, pattern: '*.txt', matches: entries, filesScanned: 90 }],
    ['workspace_search', {
      ok: true,
      query: 'TP53',
      matches: entries.map((entry, index) => ({ ...entry, line: index + 1, text: `TP53 ${'x'.repeat(500)}` })),
      filesScanned: 60,
    }],
    ['workspace_write', {
      ok: true,
      path: 'notes/new.txt',
      created: true,
      sha256: 'a'.repeat(64),
      sizeBytes: 12,
      changeSummary: { addedLines: 1, preview: 'must stay' },
      content: 'must not enter model context'.repeat(200),
    }],
    ['workspace_replace', {
      ok: true,
      path: 'notes/new.txt',
      replacements: 1,
      previousSha256: 'a'.repeat(64),
      sha256: 'b'.repeat(64),
      changeSummary: { changedLines: 1 },
      content: 'must not enter model context'.repeat(200),
    }],
    ['workspace_exec', {
      ok: true,
      command: 'npm test',
      cwd: '/Users/private/project',
      exitCode: 0,
      stdout: 'x'.repeat(8_000),
      stderr: 'warning\n'.repeat(500),
    }],
  ];

  for (const [tool, data] of cases) {
    const envelope = modelEnvelope(tool, data);
    const source = JSON.stringify(envelope);
    const serialized = serializeToolResultForModel(envelope, 6000);
    const projected = JSON.parse(serialized);
    assert.ok(serialized.length < source.length, `${tool} should compact model context`);
    assert.equal(projected.modelContext.sourceChars, source.length);
    assert.equal(projected.modelContext.projectedChars, serialized.length);
    assert.equal(projected.modelContext.compacted, true);
    assert.equal(envelope.data, data, `${tool} source envelope must stay unchanged`);
  }

  const list = JSON.parse(serializeToolResultForModel(modelEnvelope('workspace_list', {
    ok: true, path: 'data', entries,
  }), 6000));
  assert.equal(list.data.entries.length, 40);
  assert.equal(list.data.totalReturnedByTool, 60);
  assert.equal(list.data.truncated, true);

  const search = JSON.parse(serializeToolResultForModel(modelEnvelope('workspace_search', {
    ok: true,
    query: 'TP53',
    matches: [{ path: 'data/genes.csv', line: 3, text: 'x'.repeat(500) }],
  }), 6000));
  assert.deepEqual(Object.keys(search.data.matches[0]).sort(), ['line', 'path', 'text']);
  assert.ok(search.data.matches[0].text.length <= 120);

  const exec = JSON.parse(serializeToolResultForModel(modelEnvelope('workspace_exec', {
    ok: true,
    command: 'pwd',
    cwd: '/Users/private/project',
    exitCode: 0,
    stdout: '/Users/private/project\n',
    stderr: '',
  }), 6000));
  assert.equal(exec.data.cwd, '[project workspace]');
  assert.equal(exec.data.stdoutTail, '[project workspace]\n');
  assert.equal(serializedContains(exec, '/Users/private/project'), false);
});

function serializedContains(value, needle) {
  return JSON.stringify(value).includes(needle);
}

test('workspace_read deduplicates only within one project, trace, and path scope', () => {
  const data = {
    ok: true,
    path: 'data/genes.csv',
    content: 'gene,value\nTP53,1\nBRCA1,2',
    startLine: 1,
    endLine: 3,
    totalLines: 3,
    sizeBytes: 31,
    sha256: 'c'.repeat(64),
  };
  const envelope = modelEnvelope('workspace_read', data, { traceId: 'trace_read' });
  const stateA = createModelResultState({ projectId: 'project-a', traceId: 'trace_read' });
  const first = JSON.parse(serializeToolResultForModel(envelope, 6000, { state: stateA }));
  const repeated = JSON.parse(serializeToolResultForModel(envelope, 6000, { state: stateA }));
  assert.equal(first.data.segments.length, 1);
  assert.equal(repeated.data.segments.length, 0);
  assert.equal(repeated.data.omittedPreviouslyReadLines, 3);

  const projectB = createModelResultState({ projectId: 'project-b', traceId: 'trace_read' });
  const otherProject = JSON.parse(serializeToolResultForModel(envelope, 6000, { state: projectB }));
  assert.equal(otherProject.data.segments.length, 1);
  assert.equal(otherProject.data.omittedPreviouslyReadLines, 0);

  const otherTraceEnvelope = { ...envelope, traceId: 'trace_other' };
  const otherTrace = JSON.parse(serializeToolResultForModel(otherTraceEnvelope, 6000, { state: stateA }));
  assert.equal(otherTrace.data.segments.length, 1);
  assert.equal(otherTrace.data.omittedPreviouslyReadLines, 0);
});

test('trace store isolates identical trace ids by project including global scope', () => {
  const store = createToolTraceStore();
  const append = (projectId, callId) => store.append({
    traceId: 'trace_shared',
    projectId,
    callId,
    tool: 'workspace_read',
    status: 'success',
    terminationReason: 'success',
    durationMs: 1,
    args: {},
    result: { ok: true },
  });
  append('project-a', 'call-a');
  append('project-b', 'call-b');
  append(null, 'call-global');

  assert.deepEqual(store.getTrace('trace_shared', 'project-a').map((entry) => entry.callId), ['call-a']);
  assert.deepEqual(store.getTrace('trace_shared', 'project-b').map((entry) => entry.callId), ['call-b']);
  assert.deepEqual(store.getTrace('trace_shared').map((entry) => entry.callId), ['call-global']);
});

test('hard-capped workspace_read does not mark omitted lines as already read', () => {
  const content = Array.from({ length: 200 }, (_, index) => `line-${index + 1}-${'x'.repeat(80)}`).join('\n');
  const envelope = modelEnvelope('workspace_read', {
    ok: true,
    path: 'data/large.txt',
    content,
    startLine: 1,
    endLine: 200,
    totalLines: 200,
    sizeBytes: Buffer.byteLength(content),
    sha256: 'd'.repeat(64),
  }, { traceId: 'trace_large_read' });
  const state = createModelResultState({ projectId: 'project-a', traceId: 'trace_large_read' });

  const capped = JSON.parse(serializeToolResultForModel(envelope, 600, { state }));
  assert.equal(capped.truncated, true);
  assert.equal(state.readRanges.size, 0);

  const retried = JSON.parse(serializeToolResultForModel(envelope, 30_000, { state }));
  assert.equal(retried.data.segments.length, 1);
  assert.equal(retried.data.omittedPreviouslyReadLines, 0);
  assert.equal(state.readRanges.size, 1);
});
