import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-cancel-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'agent-tasks.db');

const require = createRequire(import.meta.url);
const store = require('../core/r-server/agent-task-store');

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('persists an explicit cancellation request and terminal cancelled state', () => {
  store.insertAgentTask({
    taskId: 'task-cancel-1',
    userId: 'user-1',
    params: { conversationId: 'conversation-1' },
  });

  assert.equal(store.requestAgentTaskCancel('task-cancel-1'), true);
  assert.equal(store.isAgentTaskCancellationRequested('task-cancel-1'), true);
  assert.equal(store.getAgentTask('task-cancel-1').agentStatus, 'cancel_requested');

  store.markAgentTaskCancelled('task-cancel-1');
  assert.deepEqual(
    {
      status: store.getAgentTask('task-cancel-1').status,
      agentStatus: store.getAgentTask('task-cancel-1').agentStatus,
    },
    { status: 'cancelled', agentStatus: 'cancelled' }
  );
  assert.equal(store.requestAgentTaskCancel('task-cancel-1'), false);
});
