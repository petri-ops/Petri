import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// BLOCK-33 P3 — workspace_exec 流式输出：spawn 增量 onOutput / tool_output 节流封顶 /
// handlerOptions 透传。环境自举同 agent-workspace-exec-cwd-shell.test.mjs。
const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-exec-stream-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try {
      fssync.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  });
}
const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools.js');
const {
  buildToolOutputEvent,
  createToolOutputStream,
} = require('../core/petri-server/agent-tools/tool-events.js');
const { createAgentToolInterceptor } = require('../core/petri-server/agent-tools/agent-tool-interceptor.js');
const { executeToolCall } = require('../core/petri-server/agent-tools/tool-execution.js');

const isWindows = process.platform === 'win32';
const maybeSkipShell = isWindows ? test.skip : test;

let sandboxRoot;
let workspaceRoot;
let tools;

const ctx = { projectId: 'p_exec_stream', userId: 'u_owner', accessMode: 'full' };

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-exec-stream-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_exec_stream') return null;
      return {
        id: projectId,
        user_id: 'u_owner',
        status: 'active',
        workspace_path: workspaceRoot,
      };
    },
    getUserById(userId) {
      return { id: userId, role: 'user' };
    },
  };
  tools = createWorkspaceTools({ dbProvider: () => fakeDb });
});

after(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

maybeSkipShell('executeCommand 经 onOutput 增量外抛 stdout 且最终结果形状不变', async () => {
  const chunks = [];
  const result = await tools.executeCommand(
    { command: 'printf line1; sleep 0.15; printf line2', timeoutMs: 5000 },
    ctx,
    { onOutput: (chunk) => chunks.push(chunk) }
  );
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.ok(result.stdout.includes('line1'));
  assert.ok(result.stdout.includes('line2'));
  assert.ok(chunks.length >= 1, '至少收到一次增量');
  const joined = chunks.map((chunk) => chunk.text).join('');
  assert.ok(joined.includes('line1'));
  assert.ok(joined.includes('line2'));
  for (const chunk of chunks) {
    assert.ok(['stdout', 'stderr'].includes(chunk.stream));
    assert.equal(typeof chunk.text, 'string');
  }
});

maybeSkipShell('stderr 增量以 stream=stderr 外抛并进入最终 stderr', async () => {
  const chunks = [];
  const result = await tools.executeCommand(
    { command: 'printf boom 1>&2', timeoutMs: 5000 },
    ctx,
    { onOutput: (chunk) => chunks.push(chunk) }
  );
  // 非零退出：stderr 输出但仍应携带最终 stderr
  assert.ok(result.stderr.includes('boom'));
  assert.ok(chunks.some((chunk) => chunk.stream === 'stderr' && chunk.text.includes('boom')));
});

maybeSkipShell('执行失败（命令不存在）时结果形状与旧 execFile 路径对齐', async () => {
  const result = await tools.executeCommand(
    { command: 'definitely-not-a-real-command-xyz', timeoutMs: 5000 },
    ctx
  );
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 127, 'shell 返回 command not found 退出码');
  assert.equal(typeof result.stderr, 'string');
  assert.ok(result.stderr.length > 0);
  assert.equal(result.signal, null);
});

test('buildToolOutputEvent 事件形状与字段透传', () => {
  const event = buildToolOutputEvent({
    name: 'workspace_exec',
    callId: 'call_1',
    traceId: 'trace_1',
    iteration: 2,
    text: 'hello\n',
  });
  assert.equal(event.event, 'tool_output');
  assert.equal(event.name, 'workspace_exec');
  assert.equal(event.callId, 'call_1');
  assert.equal(event.traceId, 'trace_1');
  assert.equal(event.iteration, 2);
  assert.equal(event.text, 'hello\n');
  assert.equal(event.truncated, undefined);
  const truncated = buildToolOutputEvent({
    name: 'workspace_exec', callId: 'call_1', text: 'x', truncated: true,
  });
  assert.equal(truncated.truncated, true);
});

test('createToolOutputStream 聚合节流并按序冲刷', async () => {
  const events = [];
  const stream = createToolOutputStream({
    name: 'workspace_exec',
    callId: 'call_t',
    traceId: 'trace_t',
    iteration: 1,
    emit: (event) => events.push(event),
    intervalMs: 20,
  });
  stream.onOutput({ stream: 'stdout', text: 'a' });
  stream.onOutput({ stream: 'stdout', text: 'b' });
  assert.equal(events.length, 0, '节流窗口内不立即发送');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'ab');
  stream.onOutput({ stream: 'stdout', text: 'c' });
  stream.flush();
  assert.equal(events.length, 2);
  assert.equal(events[1].text, 'c');
  assert.equal(events.reduce((text, event) => text + event.text, ''), 'abc');
});

test('createToolOutputStream 总量封顶后发一次 truncated 标记并丢弃后续增量', async () => {
  const events = [];
  const stream = createToolOutputStream({
    name: 'workspace_exec',
    callId: 'call_c',
    emit: (event) => events.push(event),
    intervalMs: 10,
    maxChars: 300, // 实现下限 256
  });
  for (let i = 0; i < 10; i += 1) {
    stream.onOutput({ stream: 'stdout', text: 'x'.repeat(50) });
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const textEvents = events.filter((event) => !event.truncated);
  const truncatedEvents = events.filter((event) => event.truncated);
  assert.equal(truncatedEvents.length, 1, '只发一次截断标记');
  assert.equal(
    textEvents.reduce((text, event) => text + event.text, '').length,
    300,
    '封顶后只保留 maxChars 字符'
  );
  const before = events.length;
  stream.onOutput({ stream: 'stdout', text: 'late' });
  stream.flush();
  assert.equal(events.length, before, '封顶后增量被丢弃');
});

test('createToolOutputStream 非 workspace_exec / 无 emit 时为 no-op', () => {
  const noop = createToolOutputStream({ name: 'workspace_read', callId: 'call_n', emit: () => {} });
  assert.doesNotThrow(() => {
    noop.onOutput({ stream: 'stdout', text: 'x' });
    noop.flush();
  });
  const silent = createToolOutputStream({ name: 'workspace_exec', callId: 'call_n' });
  assert.doesNotThrow(() => {
    silent.onOutput({ stream: 'stdout', text: 'x' });
    silent.flush();
  });
});

test('handlerOptions.onOutput 经 interceptor 透传到 handler 第 3 参', async () => {
  let seenOptions = null;
  const interceptor = createAgentToolInterceptor({
    getToolEntry: () => ({
      definition: { function: { parameters: { type: 'object', properties: {} } } },
      contract: { category: 'none', sideEffect: 'none', riskTier: 'R0', resources: [] },
      handler: async (args, ctxArg, handlerOptions) => {
        seenOptions = handlerOptions;
        return { ok: true };
      },
    }),
    decideAgentToolCall: () => ({ decision: 'allow' }),
  });
  const onOutput = () => {};
  const result = await interceptor('workspace_exec', {}, ctx, { onOutput });
  assert.equal(result.ok, true);
  assert.equal(typeof seenOptions.onOutput, 'function');
  assert.equal(seenOptions.onOutput, onOutput);
});

maybeSkipShell('executeToolCall 端到端：onOutput 传入不误触、无项目时 fail-closed', async () => {
  let outputCalls = 0;
  const envelope = await executeToolCall(
    'workspace_exec',
    { command: 'pwd' },
    { projectId: 'p_missing', userId: 'u_owner', accessMode: 'full' },
    { onOutput: () => { outputCalls += 1; } }
  );
  // 无有效项目 → handler 抛 project_not_found → 分类为 denied
  assert.equal(envelope.status, 'denied');
  assert.equal(outputCalls, 0);
});
