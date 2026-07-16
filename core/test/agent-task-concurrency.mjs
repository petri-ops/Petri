/**
 * Agent task 并发锁 + act ack 跨断线测试（P2-b 阶段 1 场景 3/4）
 *
 * 场景 3：同一用户在已有 running agent task 时，第二个应被 user_limit 拒绝。
 * 场景 4：act ack 是 800ms 短超时设计（不等前端重连）。测：
 *        - 正常 ack 在超时前到达 → resolve {timedOut:false}
 *        - 超时未 ack → resolve {timedOut:true}，loop 走 unhandled 分支
 *        - 已超时 token 再 ack → _ackActToken 返回 false（重连后 ack 无效）
 *        - agent-runner 在 ack 超时后不卡死，继续推进到 done
 *
 * 运行：BIOF3_STORAGE=local node --test test/agent-task-concurrency.mjs
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'module';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

// ============================================================
// 场景 3：agent task 并发锁（runtime.js，纯内存 Map）
// ============================================================

test('场景3: 同一用户第一个 task acquire 成功', () => {
  // 每个测试独立：用唯一 userId 避免跨测试污染
  const runtime = require(path.join(ROOT, 'r-server/helpers/runtime.js'));
  const userId = 'u3a_' + Date.now();
  const t1 = 't3a_' + Math.random();

  const g = runtime.aiTaskConcurrencyAcquire(userId, t1);
  assert.equal(g.ok, true, '第一个 task 应 acquire 成功');

  // 清理
  runtime.aiTaskConcurrencyRelease(userId, t1);
});

test('场景3: 同一用户第二个 task 应被 user_limit 拒绝 (503)', () => {
  const runtime = require(path.join(ROOT, 'r-server/helpers/runtime.js'));
  const userId = 'u3b_' + Date.now();
  const t1 = 't3b1_' + Math.random();
  const t2 = 't3b2_' + Math.random();

  // AI_MAX_CONCURRENT_PER_USER = 3，需先占满 3 个
  const g1 = runtime.aiTaskConcurrencyAcquire(userId, t1);
  assert.equal(g1.ok, true);
  const t2b = 't3b2b_' + Math.random();
  const g2 = runtime.aiTaskConcurrencyAcquire(userId, t2b);
  assert.equal(g2.ok, true);
  const t3 = 't3b3_' + Math.random();
  const g3 = runtime.aiTaskConcurrencyAcquire(userId, t3);
  assert.equal(g3.ok, true, '第 3 个应仍成功（上限 3）');

  // 第 4 个应被拒
  const g4 = runtime.aiTaskConcurrencyAcquire(userId, t2);
  assert.equal(g4.ok, false, '第 4 个应被拒绝');
  assert.equal(g4.reason, 'user_limit', 'reason 应为 user_limit');
  assert.match(g4.message, /多个对话在进行中/, 'message 应提示已有多个对话');

  // 清理
  runtime.aiTaskConcurrencyRelease(userId, t1);
  runtime.aiTaskConcurrencyRelease(userId, t2b);
  runtime.aiTaskConcurrencyRelease(userId, t3);
});

test('场景3: release 后该用户可重新 acquire（锁正确释放）', () => {
  const runtime = require(path.join(ROOT, 'r-server/helpers/runtime.js'));
  const userId = 'u3c_' + Date.now();
  const t1 = 't3c1_' + Math.random();

  const g1 = runtime.aiTaskConcurrencyAcquire(userId, t1);
  assert.equal(g1.ok, true);
  runtime.aiTaskConcurrencyRelease(userId, t1);

  // 释放后立即能再拿
  const t2 = 't3c2_' + Math.random();
  const g2 = runtime.aiTaskConcurrencyAcquire(userId, t2);
  assert.equal(g2.ok, true, 'release 后应能重新 acquire');
  runtime.aiTaskConcurrencyRelease(userId, t2);
});

test('场景3: 不同用户互不影响', () => {
  const runtime = require(path.join(ROOT, 'r-server/helpers/runtime.js'));
  const u1 = 'u3d1_' + Date.now();
  const u2 = 'u3d2_' + Date.now();
  const t1 = 't3d1_' + Math.random();
  const t2 = 't3d2_' + Math.random();

  const g1 = runtime.aiTaskConcurrencyAcquire(u1, t1);
  assert.equal(g1.ok, true);
  // u1 占了一个，u2 应不受影响
  const g2 = runtime.aiTaskConcurrencyAcquire(u2, t2);
  assert.equal(g2.ok, true, '不同用户互不影响');

  runtime.aiTaskConcurrencyRelease(u1, t1);
  runtime.aiTaskConcurrencyRelease(u2, t2);
});

// ============================================================
// 场景 4：act ack 跨断线时序语义（act-tools.js 内存 Map）
// ============================================================

test('场景4a: 超时前 ack → resolve {timedOut:false, info}', async () => {
  const actTools = require(path.join(ROOT, 'r-server/agent-tools/act-tools.js'));
  const {_registerActAck, _ackActToken, _pendingActAcks} = actTools;

  const token = 'ack_test4a_' + Math.random();
  const ackPromise = _registerActAck(token, 500); // 500ms 超时
  assert.equal(_pendingActAcks.has(token), true, 'token 应在 pending map 中');

  // 100ms 后 ack
  setTimeout(() => {
    const ok = _ackActToken(token, {ok: true, info: {applied: true}});
    assert.equal(ok, true, '_ackActToken 应返回 true（找到 pending）');
  }, 100);

  const result = await ackPromise;
  assert.equal(result.timedOut, false, '超时前 ack 应 timedOut=false');
  assert.equal(result.info.info.applied, true, 'info 应透传');
  assert.equal(_pendingActAcks.has(token), false, 'ack 后 token 应从 map 移除');
});

test('场景4b: 超时未 ack → resolve {timedOut:true}（模拟前端断线重连前已超时）', async () => {
  const actTools = require(path.join(ROOT, 'r-server/agent-tools/act-tools.js'));
  const {_registerActAck, _ackActToken, _pendingActAcks} = actTools;

  const token = 'ack_test4b_' + Math.random();
  const ackPromise = _registerActAck(token, 200); // 200ms 超时

  const result = await ackPromise;
  assert.equal(result.timedOut, true, '超时应 timedOut=true');
  assert.equal(_pendingActAcks.has(token), false, '超时后 token 应从 map 移除');

  // 模拟重连后前端才发 ack → 应返回 false（token 已失效）
  const lateAck = _ackActToken(token, {ok: true});
  assert.equal(lateAck, false, '已超时 token 再 ack 应返回 false');
});

test('场景4c: agent-runner 在 ack 超时后走 unhandled 分支不卡死', async () => {
  // 用 require cache 注入 mock，避免真实 DeepSeek / DB / 网络依赖
  const Module = require('module');
  // callDeepSeek 用闭包持有可变状态（agent-runner 加载时解构绑定此函数引用，
  // 闭包内变量在调用时才读，所以 callCount 切换有效）
  let callCount = 0;
  const fakes = {
    'r-server/helpers/llm-client.js': {
      callDeepSeek: async () => {
        callCount++;
        if (callCount === 1) {
          // 第一轮：返回 tool_call(act)，触发 ack 注册
          return {
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_1',
                      function: {
                        name: 'act',
                        arguments: JSON.stringify({type: 'switch_result_tab', tab: 'plots'}),
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        // 第二轮：纯文本收敛
        return {choices: [{message: {content: '已切换到 plots 标签页（前端未响应，标记为 unhandled）'}}]};
      },
    },
    'r-server/task-manager.js': {createTask: () => ({taskId: 'mock'})},
    'r-server/helpers/docs-index.js': {
      fetchDocsIndex: async () => null,
      renderDocsIndexForPrompt: () => '',
      getCachedDocsIndex: () => null,
    },
    'r-server/helpers/site-snapshot.js': {
      buildSiteSnapshotAsync: async () => null,
      renderSiteSnapshotForPrompt: () => '',
    },
    'r-server/helpers/user-facts.js': {
      buildFactsBlockAsync: async () => '',
      backgroundExtractFacts: () => Promise.resolve(),
    },
    'r-server/helpers/chat-summary.js': {
      _getChatSummary: () => null,
      getChatSummaryAsync: async () => null,
      summarizeMessages: () => Promise.resolve(),
    },
    'r-server/helpers/plans.js': {
      getActivePlanForUserAsync: async () => null,
      renderActivePlanForPrompt: () => '',
    },
    'r-server/helpers/memory-vectors.js': {
      dashscopeEmbed: async () => [],
      saveMemoryVector: () => {},
      cosineSim: () => 0,
      MAX_CONTENT_LEN: 1000,
    },
    'r-server/helpers/memory-privacy.js': {logChatAudit: () => {}},
    'r-server/helpers/conversations.js': {
      getOrCreateActiveConversation: () => ({id: 'c4c', title: 't'}),
      appendMessageToConversation: () => {},
      _maybeAutoTitleConversation: () => {},
      _maybeDetectTopicShift: () => Promise.resolve(),
    },
    'r-server/helpers/conversations-async.js': {
      getOrCreateActiveConversation: async () => ({id: 'c4c', title: 't'}),
      appendMessageToConversation: async () => {},
    },
    'r-server/helpers/methods-export.js': {
      _gatherAnalysisContextForMethods: async () => null,
      _renderMethodsParagraph: () => '',
    },
  };
  for (const [rel, exp] of Object.entries(fakes)) {
    const full = path.resolve(ROOT, rel);
    const m = new Module(full, null);
    m.filename = full;
    m.exports = exp;
    Module._cache[full] = m;
  }

  // agent-tools 也 mock：dispatchTool 返回一个带 ackToken + _ackPromise 的 result，
  // 模拟 act 工具的 frontend-side ack 行为。用真实的 _registerActAck（800ms 超时）。
  const actTools = require(path.join(ROOT, 'r-server/agent-tools/act-tools.js'));
  const {_registerActAck} = actTools;
  const agentToolsPath = path.resolve(ROOT, 'r-server/agent-tools/index.js');
  const ackToken = 'ack_runner4c_' + Math.random();
  const ackPromise = _registerActAck(ackToken, 300); // 300ms 超时，不等前端
  const mAgent = new Module(agentToolsPath, null);
  mAgent.filename = agentToolsPath;
  mAgent.exports = {
    getToolDefs: () => [{type: 'function', function: {name: 'act'}}],
    dispatchTool: async (name) => {
      if (name !== 'act') return {ok: true};
      return {
        ok: true,
        type: 'switch_result_tab',
        tab: 'plots',
        ackToken,
        _ackPromise: ackPromise,
      };
    },
  };
  Module._cache[agentToolsPath] = mAgent;

  // 现在加载 agent-runner（会拿到 mock 的依赖，callDeepSeek 闭包已带状态）
  const {runAgentLoop} = require(path.join(ROOT, 'r-server/agent-runner.js'));
  const taskStore = require(path.join(ROOT, 'r-server/task-store.js'));

  // 模拟路由层职责：先 insertAgentTask（runner 不负责创建 task 行，只写事件+标终态）
  const taskId = 'task4c_' + Math.random();
  taskStore.insertAgentTask({taskId, userId: 'u4c', params: {}});

  // 收集所有 emit 的事件
  const events = [];
  await runAgentLoop({
    messages: [{role: 'user', content: '帮我切到 plots 标签'}],
    context: {page: '/single-cell'},
    userId: 'u4c',
    conversationId: 'c4c',
    _activeConv: {id: 'c4c', title: 't'},
    apiKey: 'fake-key',
    providerName: 'deepseek',
    taskId,
    onEvent: (obj) => events.push(obj),
    shouldAbort: () => false,
  });

  // 验证：loop 不卡死，跑到了 done
  const doneEvt = events.find((e) => e.event === 'done');
  assert.ok(doneEvt, '应有 done 事件（loop 收敛未卡死）');

  // 验证：act 的 tool_result 事件里带了 ackToken
  const actResultEvt = events.find(
    (e) => e.event === 'tool_result' && e.actType === 'switch_result_tab'
  );
  assert.ok(actResultEvt, '应有 act 的 tool_result 事件');
  assert.equal(actResultEvt.ackToken, ackToken, 'tool_result 应带 ackToken');

  // 验证：ack 超时后追加了 unhandled 标记的二次 tool_result
  const unhandledEvt = events.find(
    (e) => e.event === 'tool_result' && e.summary === 'unhandled'
  );
  assert.ok(unhandledEvt, 'ack 超时后应 emit unhandled tool_result（loop 走 unhandled 分支）');
  assert.match(unhandledEvt.message, /前端没有响应/, 'unhandled message 应提示前端无响应');

  // 验证：task 终态为 done（agent_status，由 runner finally 的 markAgentDone 写入）
  const task = taskStore.getTask(taskId);
  assert.equal(task.agent_status, 'done', 'task 终态应为 done');

  // 验证：事件已持久化到 task_events（断线重连可回放）
  const persisted = taskStore.getTaskEventsSince(taskId, 0);
  assert.ok(persisted.length >= events.length - 1, 'task_events 应持久化全部事件（供重连回放）');
  const persistedUnhandled = persisted.find(
    (e) => e.eventType === 'tool_result' && e.payload && e.payload.summary === 'unhandled'
  );
  assert.ok(persistedUnhandled, 'unhandled 事件应已落库（重连后可见）');
});

// ============================================================
// 回归：parseRow 必须映射 agent_status / user_id / engine
// （SQLite + PG 双模式，P2-b 订阅端点 isTerminal / 越权校验依赖此字段）
// ============================================================

test('回归: parseRow 映射 agent_status / user_id / engine（防 P2-b 字段漏映射回归）', () => {
  const taskStore = require(path.join(ROOT, 'r-server/task-store.js'));
  const taskId = 'reg_' + Date.now() + '_' + Math.random();
  taskStore.insertAgentTask({taskId, userId: 'u_reg', params: {foo: 'bar'}});

  const t = taskStore.getTask(taskId);
  assert.ok(t, 'task 应存在');
  // 驼峰字段
  assert.equal(t.agentStatus, 'running', 'agentStatus 应为 running');
  assert.equal(t.userId, 'u_reg', 'userId 应正确');
  assert.equal(t.engine, 'agent', 'engine 应为 agent');
  // 下划线别名（ai-agent.js 订阅端点 isTerminal / 越权校验读这两个）
  assert.equal(t.agent_status, 'running', 'agent_status 别名应为 running');
  assert.equal(t.user_id, 'u_reg', 'user_id 别名应正确');

  taskStore.markAgentDone(taskId);
  const t2 = taskStore.getTask(taskId);
  assert.equal(t2.agent_status, 'done', 'markAgentDone 后 agent_status 应为 done');
  assert.equal(t2.agentStatus, 'done', 'markAgentDone 后 agentStatus 应为 done');
  assert.equal(t2.status, 'completed', 'markAgentDone 后顶层 status 应同步为 completed');
  assert.equal(t2.error, null, 'markAgentDone 后不应残留错误');
  assert.ok(t2.finishedAt, 'markAgentDone 后 finishedAt 应非空');
});
