import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-concurrency-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'agent-concurrency.db');

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

// BLOCK-51 测试基建修复：projects / copilot_messages 等表 DDL 由 src/migrations/*.sql
// 管理（生产由 Electron migration-runner 应用），core/biof3-server/db.js 模块顶层即
// prepare projects——全新临时库必须先跑同一 migration 链再加载 db.js，否则模块加载即
// 抛 no such table: projects（block-30 后既有损坏，本轮顺带修复）。
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(TEST_DIR, '../src/migrations'));

const db = require('../core/biof3-server/db');
const conv = require('../core/biof3-server/helpers/conversations');
const runtime = require('../core/biof3-server/helpers/runtime');
const agentTaskStore = require('../core/biof3-server/agent-task-store');
const { buildLoopRun } = require('../core/shared-backend/loop-contract');
const sqlite = db.getDatabase();

const PID = 'proj-agent-concurrency';

test.after(() => {
  // BLOCK-104 P2 — Windows 下派生进程持有 SQLite 句柄可在 force-exit 后延迟释放，
// rmSync 重试仍可能 EPERM；清理降级为 best-effort（残留 %TEMP% 由系统回收）。
try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* best-effort cleanup */
  }
});

// Persist a LoopRun with the AGENT-CONCURRENCY identity columns populated.
function persistLoop({
  loopRunId,
  conversationId,
  kind = 'primary',
  parentLoopRunId = null,
  taskId = null,
  loopStatus = 'running',
}) {
  const run = buildLoopRun({
    loopRunId,
    projectId: PID,
    conversationId,
    taskSpecRef: `spec-${loopRunId}`,
    loopStatus,
    kind,
    parentLoopRunId,
  });
  run.taskId = taskId;
  return db.persistLoopRun(run);
}

test('getActiveLoopRunForConversation 仅 resume primary（不拾 subagent）', () => {
  const cid = 'conv-primary-only';
  persistLoop({ loopRunId: 'loop-p1', conversationId: cid, kind: 'primary', taskId: 'task-p1' });
  persistLoop({
    loopRunId: 'loop-s1',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: 'loop-p1',
    taskId: 'task-s1',
  });

  const active = db.getActiveLoopRunForConversation(PID, cid);
  assert.ok(active, '应找到活跃主 loop');
  assert.equal(active.kind, 'primary');
  assert.equal(active.taskId, 'task-p1');

  // 仅存在 subagent 时，不应被当主线 resume
  const cid2 = 'conv-subagent-only';
  persistLoop({
    loopRunId: 'loop-s2',
    conversationId: cid2,
    kind: 'subagent',
    parentLoopRunId: 'loop-p1',
    taskId: 'task-s2',
  });
  assert.equal(db.getActiveLoopRunForConversation(PID, cid2), null);
});

test('sub-agent spawn 数据契约：独立 taskId + 正确 kind/parent_loop_run_id', () => {
  const cid = 'conv-spawn';
  persistLoop({ loopRunId: 'loop-parent', conversationId: cid, kind: 'primary', taskId: 'task-parent' });

  const parent = db.getLoopRunByTaskId('task-parent');
  assert.ok(parent);
  assert.equal(parent.kind, 'primary');

  persistLoop({
    loopRunId: 'loop-child',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: parent.loopRunId,
    taskId: 'task-child',
  });

  const child = db.getLoopRunByTaskId('task-child');
  assert.ok(child);
  assert.equal(child.kind, 'subagent');
  assert.equal(child.parentLoopRunId, parent.loopRunId);
  assert.equal(child.taskId, 'task-child');

  const children = db.getLoopRunsByParentLoopRunId(parent.loopRunId);
  assert.equal(children.length, 1);
  assert.equal(children[0].taskId, 'task-child');

  // 非 primary 的 parent 不应被当作可派生父会话（kind 校验由路由层做，这里确认数据可区分）
  assert.equal(db.getLoopRunByTaskId('task-child').kind, 'subagent');
});

test('runtime 预留 1 槽给主 agent（1 primary + 4 subagent 通过，第 5 个 subagent 拒绝）', () => {
  const user = 'user-cap-1';
  assert.equal(runtime.aiTaskConcurrencyAcquire(user, 'task-primary', { isPrimary: true }).ok, true);
  for (let i = 1; i <= 4; i++) {
    assert.equal(
      runtime.aiTaskConcurrencyAcquire(user, `task-sub-${i}`, { isPrimary: false }).ok,
      true,
      `sub-agent ${i} 应被允许`,
    );
  }
  const fifth = runtime.aiTaskConcurrencyAcquire(user, 'task-sub-5', { isPrimary: false });
  assert.equal(fifth.ok, false);
  assert.equal(fifth.reason, 'user_limit');

  runtime.aiTaskConcurrencyRelease(user, 'task-primary');
  for (let i = 1; i <= 4; i++) runtime.aiTaskConcurrencyRelease(user, `task-sub-${i}`);
});

test('runtime 预留槽与启动顺序无关（先 4 subagent 再 primary 仍可通过）', () => {
  const user = 'user-cap-2';
  for (let i = 1; i <= 4; i++) {
    assert.equal(
      runtime.aiTaskConcurrencyAcquire(user, `task-sub-${i}`, { isPrimary: false }).ok,
      true,
    );
  }
  assert.equal(runtime.aiTaskConcurrencyAcquire(user, 'task-sub-5', { isPrimary: false }).ok, false);
  const primary = runtime.aiTaskConcurrencyAcquire(user, 'task-primary', { isPrimary: true });
  assert.equal(primary.ok, true, '主 agent 在 4 subagent 占满时仍应拿到预留槽');

  runtime.aiTaskConcurrencyRelease(user, 'task-primary');
  for (let i = 1; i <= 4; i++) runtime.aiTaskConcurrencyRelease(user, `task-sub-${i}`);
});

test('并发写会话历史无交错（同步 SQLite + task_id 列）', async () => {
  const conversationId = 'conv-concurrent-' + Date.now();
  const tasks = ['ct-1', 'ct-2', 'ct-3'];
  const writes = [];
  for (const t of tasks) {
    for (let i = 0; i < 100; i++) {
      writes.push(
        Promise.resolve().then(() =>
          conv.appendMessageToConversation(conversationId, 'assistant', `msg-${t}-${i}`, { i }, t),
        ),
      );
    }
  }
  await Promise.all(writes);

  const total = sqlite
    .prepare('SELECT COUNT(*) AS n FROM copilot_messages WHERE conversation_id=?')
    .get(conversationId).n;
  assert.equal(total, 300);
  for (const t of tasks) {
    const n = sqlite
      .prepare('SELECT COUNT(*) AS n FROM copilot_messages WHERE conversation_id=? AND task_id=?')
      .get(conversationId, t).n;
    assert.equal(n, 100, `task ${t} 应有 100 条`);
  }
});

// AGENT-CONCURRENCY A-4：取消级联（主→子）单测。
// 在 agent-task-store.cancelAgentTaskCascade 上验证，无需启动 HTTP 服务。

test('取消主 agent 级联取消其子 sub-agent（A-4）', () => {
  const cid = 'conv-cascade';
  persistLoop({ loopRunId: 'loop-cap', conversationId: cid, kind: 'primary', taskId: 'task-cap' });
  persistLoop({
    loopRunId: 'loop-cap-c1',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: 'loop-cap',
    taskId: 'task-cap-c1',
  });
  persistLoop({
    loopRunId: 'loop-cap-c2',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: 'loop-cap',
    taskId: 'task-cap-c2',
  });

  // 创建对应的 agent task 行（agent_status=running），否则 requestAgentTaskCancel 不会翻转状态。
  for (const t of ['task-cap', 'task-cap-c1', 'task-cap-c2']) {
    agentTaskStore.insertAgentTask({ taskId: t, userId: 'user-cascade', params: {} });
  }
  assert.equal(agentTaskStore.getAgentTask('task-cap').agentStatus, 'running');
  assert.equal(agentTaskStore.getAgentTask('task-cap-c1').agentStatus, 'running');
  assert.equal(agentTaskStore.getAgentTask('task-cap-c2').agentStatus, 'running');

  const { cancelledTaskIds } = agentTaskStore.cancelAgentTaskCascade('task-cap', { dbMod: db });
  assert.deepEqual(
    cancelledTaskIds.sort(),
    ['task-cap', 'task-cap-c1', 'task-cap-c2'].sort(),
    '主 task + 两个子 task 都应被级联取消',
  );
  assert.equal(agentTaskStore.getAgentTask('task-cap').agentStatus, 'cancel_requested');
  assert.equal(agentTaskStore.getAgentTask('task-cap-c1').agentStatus, 'cancel_requested');
  assert.equal(agentTaskStore.getAgentTask('task-cap-c2').agentStatus, 'cancel_requested');
});

test('父任务尚无 LoopRun 时仍按 task parent identity 级联取消', () => {
  agentTaskStore.insertAgentTask({
    taskId: 'task-preloop-primary',
    userId: 'user-preloop',
    params: { kind: 'primary' },
  });
  agentTaskStore.insertAgentTask({
    taskId: 'task-preloop-child',
    userId: 'user-preloop',
    params: { kind: 'subagent', parentTaskId: 'task-preloop-primary' },
  });

  assert.equal(db.getLoopRunByTaskId('task-preloop-primary'), null);
  const { cancelledTaskIds } = agentTaskStore.cancelAgentTaskCascade('task-preloop-primary', {
    dbMod: db,
  });
  assert.deepEqual(
    cancelledTaskIds.sort(),
    ['task-preloop-primary', 'task-preloop-child'].sort(),
  );
  assert.equal(agentTaskStore.getAgentTask('task-preloop-child').agentStatus, 'cancel_requested');
});

test('取消 sub-agent 不级联到父/兄弟（A-4 反向）', () => {
  const cid = 'conv-cascade-rev';
  persistLoop({ loopRunId: 'loop-rev', conversationId: cid, kind: 'primary', taskId: 'task-rev' });
  persistLoop({
    loopRunId: 'loop-rev-s1',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: 'loop-rev',
    taskId: 'task-rev-s1',
  });
  persistLoop({
    loopRunId: 'loop-rev-s2',
    conversationId: cid,
    kind: 'subagent',
    parentLoopRunId: 'loop-rev',
    taskId: 'task-rev-s2',
  });

  for (const t of ['task-rev', 'task-rev-s1', 'task-rev-s2']) {
    agentTaskStore.insertAgentTask({ taskId: t, userId: 'user-cascade-rev', params: {} });
  }

  // 取消一个子 agent：不应影响父 agent 或另一个兄弟子 agent。
  const { cancelledTaskIds } = agentTaskStore.cancelAgentTaskCascade('task-rev-s1', { dbMod: db });
  assert.deepEqual(cancelledTaskIds, ['task-rev-s1'], '仅被取消的子 agent 自身应出现在结果中');

  assert.equal(agentTaskStore.getAgentTask('task-rev-s1').agentStatus, 'cancel_requested');
  assert.equal(agentTaskStore.getAgentTask('task-rev').agentStatus, 'running', '父 agent 不应被级联');
  assert.equal(agentTaskStore.getAgentTask('task-rev-s2').agentStatus, 'running', '兄弟子 agent 不应被级联');
});

// ============================================================
// BLOCK-51 M1 — 路由层调用形状契约（堵「纯函数层测试掩盖路由层契约漂移」盲区）
// 生产调用点仅两处：chat.js（按 wantKind 区分）/ resume.js（恒 primary）。
// 静态形状断言 + 路由语义最小复现，旧形状（两参调用，isPrimary 缺省 false）出现即失败。
// ============================================================

test('BLOCK-51 M1 — 路由层 acquire 调用形状契约（isPrimary 必传）', () => {
  const chatSrc = fs.readFileSync(path.join(TEST_DIR, '../core/biof3-server/routes/ai-agent/chat.js'), 'utf8');
  const resumeSrc = fs.readFileSync(path.join(TEST_DIR, '../core/biof3-server/routes/ai-agent/resume.js'), 'utf8');

  // chat.js：primary/subagent 按 wantKind 区分（M1 修复形状）
  assert.match(
    chatSrc,
    /aiTaskConcurrencyAcquire\(userId,\s*tasks?[A-Za-z]*,\s*\{\s*isPrimary:\s*wantKind\s*===\s*'primary'\s*\}\)/,
    'chat.js 必须按 wantKind 传 isPrimary',
  );
  // resume.js：恢复用户主动对话，恒为 primary
  assert.match(
    resumeSrc,
    /aiTaskConcurrencyAcquire\(userId,\s*newTaskId,\s*\{\s*isPrimary:\s*true\s*\}\)/,
    'resume.js 必须恒传 isPrimary: true',
  );
  // 旧形状回归警戒：两参 acquire 调用（isPrimary 缺省 → 永远按 subagent 计数）都是缺陷
  const OLD_SHAPE = /aiTaskConcurrencyAcquire\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)/;
  assert.doesNotMatch(chatSrc, OLD_SHAPE, 'chat.js 存在未传 isPrimary 的旧形状调用');
  assert.doesNotMatch(resumeSrc, OLD_SHAPE, 'resume.js 存在未传 isPrimary 的旧形状调用');
});

test('BLOCK-51 M1 — 路由语义复现：4 subagent 占满后主对话不被拒、第 5 subagent 拒绝', () => {
  // 与 chat.js L229 完全一致的调用形状（最小复现，不启 HTTP 服务）
  const acquireAsRoute = (user, taskId, wantKind) =>
    runtime.aiTaskConcurrencyAcquire(user, taskId, { isPrimary: wantKind === 'primary' });

  const user = 'user-route-shape';
  for (let i = 1; i <= 4; i++) {
    assert.equal(acquireAsRoute(user, `rs-sub-${i}`, 'subagent').ok, true, `sub-agent ${i} 应被允许`);
  }
  const fifth = acquireAsRoute(user, 'rs-sub-5', 'subagent');
  assert.equal(fifth.ok, false, '第 5 个 subagent 应被拒绝');
  assert.equal(fifth.reason, 'user_limit');
  assert.equal(
    acquireAsRoute(user, 'rs-primary', 'primary').ok,
    true,
    'M1 修复核心：4 个 subagent 占满时新主对话必须能拿到预留槽（修复前此处被拒且文案误导）',
  );

  runtime.aiTaskConcurrencyRelease(user, 'rs-primary');
  for (let i = 1; i <= 4; i++) runtime.aiTaskConcurrencyRelease(user, `rs-sub-${i}`);
});
