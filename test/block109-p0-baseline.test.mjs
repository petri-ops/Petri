/**
 * BLOCK-109-CORE-ARCH P0 — 拆前行为基线（BLOCK-92 先例：拆前基线拆后对账）。
 *
 * P1（事件溯源单一事实源 + 组装唯一化）动核心链路前的行为等价判据。
 * 钉的是「拆前实况」——包括已知疣（emitToolResult 未消费 / 裸驱动 loopRunId=null /
 * assistantText 只含流式增量 / 流中断在真实 provider 层不达重试包装）。
 * P1 重写后本文件必须原样绿；有意的行为变更（如重试覆盖全流轮）必须显式修订
 * 本文件并在 plan §1 P0-2 留痕。
 *
 * 覆盖面：
 * ① 一轮带工具调用的会话：SSE 事件序列契约（iter→delta→agent_progress→tool_call→tool_result→…）
 * ② runLoop 返回契约（reasoningByIteration / assistantProgress / toolResultEventsByCallId）
 * ③ 事件存储 + 回放等价（task_events seq 严格递增 + getAgentTaskEventsSince 回放恒等）
 * ④ 流中断形态 @ runLoop 边界：瞬断 reject → 重试×2 → fatalAgentError + agent_status 可见性
 *    （生产分歧：真实 provider 层流中途死亡走体面终态不 reject → 零重试，
 *     run 80669989 三败实证——该疣登记 plan §1 P0-2，P1 有意修复时修订本文件）
 *
 * UI-432 四件套回归集：test/block109-orchestration.test.mjs（重试四态/软上限/孤儿过滤）
 * + frontend SubAgentResultGroup.test.tsx（结果组卡）——经 impact-map 同域规则路由。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const here = path.dirname(__filename);
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（同 block34 先例：loop-orchestrator/agent-task-store 顶层即 prepare）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-b109-p0-baseline-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const { runLoop } = require(path.join(root, 'core', 'biof3-server', 'loop-orchestrator.js'));
const agentTaskStore = require(path.join(root, 'core', 'biof3-server', 'agent-task-store.js'));

// 事件分类器：把 emit 流折成稳定类型标签（拆前序列钉死用）
function classify(e) {
  if (e && typeof e === 'object') {
    if (e.event) return e.event + (e.phase ? ':' + e.phase : '');
    if (e.choices) {
      const d = e.choices[0] && e.choices[0].delta;
      if (!d) return 'delta:raw';
      if (d.reasoning_content != null) return 'delta:reasoning';
      if (d.tool_calls) return 'delta:tool_calls';
      return 'delta:content';
    }
    if (e.error) return 'error';
    const s = JSON.stringify(e);
    return s === '{}' ? '{}' : 'other:' + s.slice(0, 60);
  }
  return String(e);
}

// 一轮带工具调用的会话：第 1 轮 思考+过渡叙述+system_info 工具调用；第 2 轮 收尾叙述
function scriptedProvider() {
  let round = 0;
  return async (_provider, _apiKey, _reqBody, _telemetry, onEvent) => {
    round += 1;
    if (round === 1) {
      onEvent({ type: 'reasoning_delta', content: '思考一下' });
      onEvent({ type: 'content_delta', content: '我先查系统信息。' });
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'system_info', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      };
    }
    onEvent({ type: 'content_delta', content: '查询完成，汇报：' });
    return { choices: [{ message: { role: 'assistant', content: '查询完成，汇报：全部正常' }, finish_reason: 'stop' }] };
  };
}

const baseConfig = { userId: 'u_b109', modelName: 'baseline-model', kind: 'primary', contextWindow: 24000, executionPolicy: { allowExecution: false }, context: {} };
const baseArgs = (events) => ({
  messages: [{ role: 'user', content: '检查系统信息' }],
  toolCtx: { accessMode: 'read', userId: 'u_b109' },
  shouldAbort: () => false,
  emitToolResult: () => {},
  emitAssistant: (e) => events.push(e),
  emitDone: () => {},
  conversationState: {},
});

// 拆前事件序列实况（2026-09-21 干跑钉死；P1 重写后须原样复现）。
// 终止信号不走 emitAssistant：runLoop 结尾以无参 emitDone() 收束（拆前实况）。
const PINNED_SEQUENCE = [
  'iter',
  'delta:reasoning',
  'delta:content',
  'agent_progress',
  'tool_call',
  'tool_result',
  'iter',
  'delta:content',
];

test('P0 基线①② — 一轮带工具调用会话的 SSE 事件序列 + runLoop 返回契约', async () => {
  const events = [];
  let doneCalls = 0;
  let doneArg = 'not-called';
  const result = await runLoop({
    ...baseArgs(events),
    emitDone: (...a) => { doneCalls += 1; doneArg = a[0]; },
    callChatProvider: scriptedProvider(),
    config: baseConfig,
  });

  assert.deepEqual(
    events.map(classify),
    PINNED_SEQUENCE,
    '拆前事件序列漂移——若为有意行为变更，修订 PINNED_SEQUENCE 并在 plan §1 P0-2 留痕',
  );
  assert.equal(doneCalls, 1, '终止信号 = 恰一次 emitDone');
  assert.equal(doneArg, undefined, '拆前实况：emitDone 无参调用（不携带终态载荷）');

  const toolCall = events.find((e) => e.event === 'tool_call');
  assert.equal(toolCall.name, 'system_info', '工具轮真实执行 system_info');
  assert.ok(events.find((e) => e.event === 'tool_result'), 'tool_result 事件在位');

  // 返回契约（拆前实况：assistantText 只含流式增量，不含收尾 message.content 的未流式部分）
  assert.equal(result.assistantText, '查询完成，汇报：');
  assert.deepEqual(result.reasoningByIteration['1'], '思考一下');
  // assistantProgress 是 record/snapshot 记录器（非纯数据）；叙述经 agent_progress 事件外发
  const progressEvent = events.find((e) => e.event === 'agent_progress');
  assert.deepEqual(
    { event: progressEvent.event, iteration: progressEvent.iteration, content: progressEvent.content },
    { event: 'agent_progress', iteration: 1, content: '我先查系统信息。' },
    '第 1 轮过渡叙述经 agent_progress 事件外发（BLOCK-108 progressUpdates 数据源）',
  );
  const progressSnapshot = result.assistantProgress && typeof result.assistantProgress.snapshot === 'function'
    ? result.assistantProgress.snapshot()
    : null;
  assert.ok(
    progressSnapshot && JSON.stringify(progressSnapshot).includes('我先查系统信息。'),
    'assistantProgress.snapshot() 可回放过渡叙述',
  );
  assert.ok(result.toolResultEventsByCallId && result.toolResultEventsByCallId.call_1, 'toolResultEventsByCallId 按调用 ID 留档');
  // P1 关键边界：裸驱动 runLoop 不落 loop_runs（挂接在 agent-runner 装配层）——
  // P1 事件单一事实源收口时此挂接点必须显式设计（plan 附录 A）
  assert.equal(result.loopRunId, null);
  assert.equal(result.loopState, null);
});

test('P0 基线③ — 事件存储 + 回放等价（seq 严格递增，回放恒等）', async () => {
  const task = agentTaskStore.createAgentTask({ userId: 'u_b109', params: { kind: 'baseline', note: 'p0-baseline-leg3' } });
  const taskId = task && (task.taskId || task.id);
  assert.ok(taskId, '任务创建成功');

  // 模拟 agent-runner 的 emit 落库通道：emit → appendAgentTaskEvent（seq 自增）
  const written = [];
  let seq = 0;
  const events = [];
  const result = await runLoop({
    ...baseArgs(events),
    emitAssistant: (e) => {
      events.push(e);
      seq += 1;
      const eventType = e.event || (e.choices ? 'delta' : 'unknown');
      agentTaskStore.appendAgentTaskEvent(taskId, seq, eventType, e);
      written.push({ seq, eventType, payload: e });
    },
    callChatProvider: scriptedProvider(),
    config: baseConfig,
  });
  assert.equal(result.assistantText, '查询完成，汇报：');

  // 回放恒等：getAgentTaskEventsSince(taskId, 0, N) 重建的序列与写入序列逐条相等
  const replayed = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000);
  assert.equal(replayed.length, written.length, '回放条数恒等');
  let prevSeq = 0;
  written.forEach((w, i) => {
    const r = replayed[i];
    assert.ok(r.seq > prevSeq, `seq 严格递增（agent-task-store.js:404 契约）@${w.seq}`);
    prevSeq = r.seq;
    assert.equal(r.seq, w.seq);
    assert.equal(r.eventType, w.eventType);
    assert.deepEqual(r.payload, w.payload, `回放 payload 恒等 @seq ${w.seq}`);
  });

  // 存储侧序列与 emit 流序列同构（同一分类器下逐标签相等）。
  // 终止信号 emitDone() 无参不入 task_events（拆前实况）——P1 事件模型须显式定义
  // 「运行终止」是否入存储（plan 附录 A）。
  assert.deepEqual(
    replayed.map((r) => classify(r.payload)),
    PINNED_SEQUENCE,
    '落库回放序列 = emit 流序列（终止信号不入库为拆前实况）',
  );
});

test('P0 基线④ — 流中断形态 @ runLoop 边界：瞬断 reject → 重试×2 → fatalAgentError + agent_status 可见', async () => {
  const events = [];
  let providerCalls = 0;
  const midStreamReset = async (_p, _k, _b, _t, onEvent) => {
    providerCalls += 1;
    onEvent({ type: 'content_delta', content: `流式中途-${providerCalls}` });
    throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  };
  const result = await runLoop({
    ...baseArgs(events),
    callChatProvider: midStreamReset,
    config: baseConfig,
  });

  // 拆前实况：provider 层以瞬断 reject 到达包装 → 重试 2 次（共 3 次调用，3s/6s 退避≈9s）
  assert.equal(providerCalls, 3, '瞬断 reject 在此边界触发重试×2（生产分歧见文件头注）');
  assert.equal(String(result.fatalAgentError && result.fatalAgentError.message), 'read ECONNRESET', '重试耗尽 → fatalAgentError 原样携带');
  assert.equal(result.assistantText, '', '流中断后 streamedText 丢弃，不产半截正文');

  // 重试可见性：agent_status(network_retry) 事件在 emit 流中（每轮重试 2 条，拆前实况）
  const retryStatus = events.filter((e) => e.event === 'agent_status' && e.phase === 'network_retry');
  assert.equal(retryStatus.length, 4, '2 次重试 × 2 条 agent_status（拆前实况钉死）');
  // 两条来源：包装器 log 的「模型连接瞬断，Ns 后自动重试」+ 内部 '[network-retry] transient ...' 透传
  assert.ok(
    retryStatus.some((e) => /模型连接瞬断/.test(e.message || '')),
    '用户可见文案「模型连接瞬断」在位',
  );
  assert.ok(
    retryStatus.every((e) => typeof e.message === 'string' && e.message.length > 0),
    '每条 agent_status 携带非空消息',
  );
});
