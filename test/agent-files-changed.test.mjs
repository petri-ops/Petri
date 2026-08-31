import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-files-changed-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'agent-tasks.db');

const require = createRequire(import.meta.url);
const store = require('../core/biof3-server/agent-task-store');
const { aggregateFilesChanged, collectFilesChangedForTask } = require('../core/biof3-server/agent-files-changed');

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});

// ---------- aggregateFilesChanged（纯聚合） ----------

test('aggregates created + modified writes and dedupes by path', () => {
  const events = [
    {
      seq: 1,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_write',
          status: 'success',
          callId: 'c1',
          data: { ok: true, path: 'a.md', created: true, dryRun: false },
        },
      },
    },
    {
      seq: 2,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_replace',
          status: 'success',
          callId: 'c2',
          data: { ok: true, path: 'b.py', created: false, dryRun: false },
        },
      },
    },
    {
      seq: 3,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_write',
          status: 'success',
          callId: 'c3',
          data: { ok: true, path: 'a.md', created: false, dryRun: false },
        },
      },
    },
  ];
  const result = aggregateFilesChanged(events);
  assert.deepEqual(result.files, [
    { path: 'a.md', status: 'modified' }, // 后写覆盖先写：created → modified
    { path: 'b.py', status: 'modified' },
  ]);
  assert.equal(result.attributionComplete, true);
});

test('skips dryRun, failed writes and approval-required results', () => {
  const events = [
    {
      seq: 1,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_write',
          status: 'success',
          callId: 'c1',
          data: { ok: true, path: 'dry.md', created: true, dryRun: true },
        },
      },
    },
    {
      seq: 2,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_write',
          status: 'error',
          callId: 'c2',
          data: { ok: false, error: 'overwrite_required', path: 'fail.md' },
        },
      },
    },
    {
      seq: 3,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_replace',
          terminationReason: 'approval_required',
          callId: 'c3',
          data: null,
        },
      },
    },
  ];
  const result = aggregateFilesChanged(events);
  assert.deepEqual(result.files, []);
});

test('falls back to tool_call args.path when the result data is preview-truncated', () => {
  const events = [
    {
      seq: 1,
      eventType: 'tool_call',
      payload: {
        event: 'tool_call',
        name: 'workspace_write',
        callId: 'c1',
        args: { path: 'big-file.md', dryRun: false },
      },
    },
    {
      seq: 2,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: {
          tool: 'workspace_write',
          status: 'success',
          callId: 'c1',
          previewTruncated: true,
          // publicData 截断后 data 变成 { preview: '…' }
          data: { preview: '{"ok":true,"path":"big-file.md","created":true,…' },
        },
      },
    },
  ];
  const result = aggregateFilesChanged(events);
  assert.deepEqual(result.files, [{ path: 'big-file.md', status: 'modified' }]);
  assert.equal(result.attributionComplete, false);
});

test('ignores unrelated tools and empty events', () => {
  assert.deepEqual(aggregateFilesChanged([]).files, []);
  const result = aggregateFilesChanged([
    {
      seq: 1,
      eventType: 'tool_result',
      payload: {
        event: 'tool_result',
        toolResult: { tool: 'workspace_read', status: 'success', callId: 'c1', data: { ok: true } },
      },
    },
  ]);
  assert.deepEqual(result.files, []);
});

// ---------- store 终态持久化（round-trip） ----------

test('markAgentTaskDone persists the authoritative filesChanged list', () => {
  store.insertAgentTask({ taskId: 'task-fc-1', userId: 'user-fc', params: { conversationId: 'conv-1' } });
  store.appendAgentTaskEvent(
    'task-fc-1',
    1,
    'tool_result',
    {
      event: 'tool_result',
      toolResult: {
        tool: 'workspace_write',
        status: 'success',
        callId: 'c1',
        data: { ok: true, path: 'report.md', created: true, dryRun: false },
      },
    }
  );

  const aggregated = collectFilesChangedForTask(store, 'task-fc-1');
  assert.deepEqual(aggregated.files, [{ path: 'report.md', status: 'created' }]);

  store.markAgentTaskDone('task-fc-1', aggregated.files);
  const task = store.getAgentTask('task-fc-1');
  assert.equal(task.agentStatus, 'done');
  assert.equal(task.status, 'completed');
  assert.deepEqual(task.filesChanged, [{ path: 'report.md', status: 'created' }]);
});

test('terminal marks without filesChanged keep the list empty; resetTaskForRetry clears it', () => {
  store.insertAgentTask({ taskId: 'task-fc-2', userId: 'user-fc', params: {} });
  store.markAgentTaskDone('task-fc-2', [{ path: 'x.md', status: 'created' }]);
  assert.equal(store.getAgentTask('task-fc-2').filesChanged.length, 1);

  store.markAgentTaskFailed('task-fc-2', 'boom'); // 缺省 → COALESCE 保留
  assert.equal(store.getAgentTask('task-fc-2').filesChanged.length, 1);

  store.resetTaskForRetry('task-fc-2'); // 重试前清除
  assert.deepEqual(store.getAgentTask('task-fc-2').filesChanged, []);
});
