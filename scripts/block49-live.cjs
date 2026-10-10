#!/usr/bin/env node
'use strict';

/**
 * BLOCK-49 多 Agent 派生实机驱动（真 HTTP + 真 DB + 真 registry + 真 runAgentLoop）：
 * 本地起一个 mock OpenAI-compatible 端点（deepseek provider 真协议，非流式 tool_calls），
 * 按请求内容编排脚本：
 *   场景 A（串行链路）：父 loop spawn_agent → wait_agent → 子 loop 真实跑完 → 摘要回流父正文
 *   场景 B（并发 + 汇总）：父 loop 派生两个子 agent（并发运行）→ 逐个 wait_agent → 父整合两份报告
 *   场景 C（级联取消）：spawn 子 agent 后 cancelAgentTaskCascade 取消父任务 → 子 agent 被级联取消
 * 验证：父子任务落库（kind=subagent/parentTaskId 溯源）、权限继承、并发槽闭环、
 *       摘要 token 预算链路、子 agent 会话消息持久化、并发时间窗重叠、级联取消。
 * 证据：acceptance/block-49/spawn-agent-live.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// env 必须在 require db/ai-settings 之前设置（单例解析）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block49-live-'));
process.env.PETRI_DB_PATH = path.join(tmpRoot, 'live.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(tmpRoot, 'local-data');

// 新鲜 DB 先应用 src/migrations 全量（projects/copilot 等用户数据表由迁移管理；
// db.js 模块加载即预编译 projects 语句）。与 test/block49-spawn-agent-tools.test.mjs 同一自举手法。
const ROOT = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-49');
{
  const Database = require(ROOT + '/core/petri-server/node_modules/better-sqlite3');
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  const boot = new Database(process.env.PETRI_DB_PATH);
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
}

const { saveAiSettings } = require(ROOT + '/core/petri-server/helpers/ai-settings');
const agentTaskStore = require(ROOT + '/core/petri-server/agent-task-store');
const dbMod = require(ROOT + '/core/petri-server/db');
const { runAgentLoop } = require(ROOT + '/core/petri-server/agent-runner');
const { spawn_agent } = require(ROOT + '/core/petri-server/agent-tools/spawn-agent-tools');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require(ROOT + '/core/petri-server/helpers/runtime');
const { getAssistantMessageByTaskId } = require(ROOT + '/core/petri-server/helpers/conversations');

const USER_ID = 'u_block49_live';
const PARENT_PROMPT = 'LIVE-PARENT: 请派生一个子 agent 计算 7 乘 6，等待它完成后把它的结论原样汇报给我。';
const PARENT_PROMPT_2 = 'LIVE-PARENT-CONCURRENT: 请同时派生两个子 agent：一个计算 7 乘 6，一个计算 9 乘 9；都完成后把两份结论一起汇报给我。';
const CHILD_TASK_A = 'LIVE-CHILD-A: 计算 7 乘 6 并直接给出结果。';
const CHILD_TASK_B = 'LIVE-CHILD-B: 计算 9 乘 9 并直接给出结果。';
const CHILD_REPORT_A = 'CHILD-REPORT-A: 计算完成，7 乘 6 等于 42，没有余数。';
const CHILD_REPORT_B = 'CHILD-REPORT-B: 计算完成，9 乘 9 等于 81，九九归一。';

// ---------- mock 端点 ----------
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const hits = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startMockServer() {
  return listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const firstUser = messages.find((m) => m.role === 'user');
      const firstUserText = String((firstUser && firstUser.content) || '');
      const toolMsgs = messages.filter((m) => m.role === 'tool').map((m) => String(m.content || ''));
      const toolTexts = toolMsgs.join('\n');
      hits.push({
        path: req.url,
        firstUser: firstUserText.slice(0, 40),
        toolMsgCount: toolMsgs.length,
        spawnResults: toolMsgs.filter((t) => /"tool":"spawn_agent"/.test(t) && /"agentId"/.test(t)).length,
        waitResults: toolMsgs.filter((t) => /"agentStatus"/.test(t)).length,
      });

      const reply = (message) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: message } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }));
      };
      const replyToolCalls = (calls) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: calls.map((c, i) => ({
                id: 'call_live_' + hits.length + '_' + i,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            },
          }],
          usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
        }));
      };

      // ---- 子 loop：按任务前缀返回对应报告（延迟制造并发窗口）----
      if (firstUserText.startsWith('LIVE-CHILD-A:')) {
        await sleep(400);
        return reply(CHILD_REPORT_A);
      }
      if (firstUserText.startsWith('LIVE-CHILD-B:')) {
        await sleep(400);
        return reply(CHILD_REPORT_B);
      }
      if (firstUserText.startsWith('LIVE-CHILD-C:')) {
        // 场景 C：留 1s 窗口让父任务取消先发生，子 loop 下一轮 aborted() 生效
        await sleep(1000);
        return reply('CHILD-REPORT-C: 本任务不应被看到。');
      }

      // ---- 场景 B：并发双子 agent ----
      if (firstUserText.startsWith('LIVE-PARENT-CONCURRENT:')) {
        const spawnHits = hits.filter((h) => h.firstUser.startsWith('LIVE-PARENT-CONCURRENT'));
        const spawnSeen = spawnHits.reduce((acc, h) => acc + (h.spawnResults || 0), 0);
        const waitSeen = spawnHits.reduce((acc, h) => acc + (h.waitResults || 0), 0);
        if (spawnSeen === 0) return replyToolCalls([{ name: 'spawn_agent', args: { task: CHILD_TASK_A } }]);
        if (spawnSeen === 1) return replyToolCalls([{ name: 'spawn_agent', args: { task: CHILD_TASK_B } }]);
        if (spawnSeen >= 2 && waitSeen === 0) {
          const agentId = (toolTexts.match(/"tool":"spawn_agent"[\s\S]{0,600}?"agentId"\s*:\s*"([^"]+)"/) || [])[1];
          return replyToolCalls([{ name: 'list_agents', args: {} }, { name: 'wait_agent', args: { agentId, timeout: 30000 } }]);
        }
        if (spawnSeen >= 2 && waitSeen === 1) {
          const seenIds = [...toolTexts.matchAll(/"agentId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
          const agentIds = [...toolTexts.matchAll(/"tool":"spawn_agent"[\s\S]{0,600}?"agentId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
          const remaining = agentIds.find((id) => !seenIds.slice(0, -1).includes(id) || id !== seenIds[seenIds.length - 1]);
          const target = agentIds.find((id) => id !== agentIds[0]) || remaining || agentIds[1] || agentIds[0];
          return replyToolCalls([{ name: 'wait_agent', args: { agentId: target, timeout: 30000 } }]);
        }
        return reply('DONE-BOTH: 两份子 agent 报告已收到 —— ' + CHILD_REPORT_A + ' / ' + CHILD_REPORT_B);
      }

      // ---- 场景 A：串行链路 ----
      if (toolTexts.includes('CHILD-REPORT-A')) {
        return reply('DONE: 子 agent 汇报已收到 —— ' + (toolTexts.match(/CHILD-REPORT-A[^\n"\\]*/) || [])[0]);
      }
      if (/"agentId"/.test(toolTexts)) {
        const agentId = (toolTexts.match(/"agentId"\s*:\s*"([^"]+)"/) || [])[1];
        return replyToolCalls([{ name: 'wait_agent', args: { agentId, timeout: 30000 } }]);
      }
      return replyToolCalls([{ name: 'spawn_agent', args: { task: CHILD_TASK_A } }]);
    });
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };

  const mock = await startMockServer();

  // 真设置落盘（临时 PETRI_LOCAL_DATA_DIR，不碰用户真实配置）
  saveAiSettings({
    model_profiles: [
      {
        id: 'b49-live', label: '实机多Agent派生', provider: 'deepseek', model: 'mock-b49',
        baseUrl: `http://127.0.0.1:${mock.port}`, capabilities: ['chat', 'streaming', 'tools'], roles: ['chat', 'agent'],
      },
    ],
    model_role_bindings: { chat: 'b49-live', agent: 'b49-live' },
    model_fallback_enabled: false,
    model_fallback_bindings: {},
  });

  try {
    // ============ 场景 A：spawn → wait → 摘要回流 ============
    const created = agentTaskStore.createAgentTask({
      userId: USER_ID,
      params: {
        messages: [{ role: 'user', content: PARENT_PROMPT }],
        conversationId: 'conv_b49_live',
        context: { page: 'chat', accessMode: 'full' },
        kind: 'primary',
        providerName: 'deepseek',
        profileId: 'b49-live',
      },
    });
    const parentTaskId = created.taskId;
    const acquiredParent = aiTaskConcurrencyAcquire(USER_ID, parentTaskId, { isPrimary: true });
    assert('A0 父任务主会话并发槽获取成功', !!acquiredParent && acquiredParent.ok !== false, JSON.stringify(acquiredParent || {}));

    const events = [];
    const parentRun = await runAgentLoop({
      messages: [{ role: 'user', content: PARENT_PROMPT }],
      // 对齐生产：accessMode 由 UI 传入（inferExecutionPolicy 以它为唯一决策权威；
      // 缺省即 read-only，state-write 的 spawn_agent 会被拒绝）。full 档同时让
      // 子 agent 走真实权限继承链。
      context: { page: 'chat', accessMode: 'full' },
      userId: USER_ID,
      conversationId: 'conv_b49_live',
      apiKey: 'live-check-key',
      providerName: 'deepseek',
      providerLabel: '实机多Agent派生',
      modelName: 'mock-b49',
      profileId: 'b49-live',
      baseUrl: `http://127.0.0.1:${mock.port}`,
      taskId: parentTaskId,
      kind: 'primary',
      onEvent: (e) => events.push(e),
    });
    aiTaskConcurrencyRelease(USER_ID, parentTaskId);

    const parentTask = agentTaskStore.getAgentTask(parentTaskId);
    const children = agentTaskStore.listChildAgentTasks(parentTaskId);
    const child = children[0] || null;
    const childMsg = child ? getAssistantMessageByTaskId(child.taskId) : null;

    results.scenarioA = {
      taskId: parentTaskId,
      status: parentTask && parentTask.status,
      assistantText: String((parentRun && parentRun.assistantText) || ''),
      children: children.map((t) => ({
        agentId: t.taskId, status: t.status, kind: t.params && t.params.kind,
        parentTaskId: t.params && t.params.parentTaskId, spawnSource: t.params && t.params.spawnSource,
      })),
      childMessage: childMsg,
    };

    const parentText = results.scenarioA.assistantText;
    assert('A1 父 loop 正常完成', results.scenarioA.status === 'completed', JSON.stringify({ status: results.scenarioA.status }));
    assert(
      'A2 子 agent 落库：kind=subagent + parentTaskId 溯源 + spawnSource',
      !!child && child.params && child.params.kind === 'subagent' && child.params.parentTaskId === parentTaskId && child.params.spawnSource === 'tool:spawn_agent',
      JSON.stringify(results.scenarioA.children)
    );
    assert('A3 子 agent 真实跑完（completed）', !!child && child.status === 'completed', JSON.stringify({ status: child && child.status }));
    assert(
      'A4 wait_agent 摘要回流父上下文（父正文包含子 agent 结论）',
      parentText.includes('DONE:') && parentText.includes('CHILD-REPORT-A') && parentText.includes('42'),
      parentText.slice(0, 200)
    );
    assert(
      'A5 子 agent 会话消息已持久化（task_id 可查，供 wait_agent 摘要）',
      !!childMsg && String(childMsg.content || '').includes('42'),
      JSON.stringify(childMsg || {}).slice(0, 160)
    );
    assert(
      'A6 权限继承：子 agent 继承父 context（page/accessMode）',
      !!child && !!child.params && !!child.params.context && child.params.context.page === 'chat' && child.params.context.accessMode === 'full',
      JSON.stringify((child && child.params && child.params.context) || {})
    );
    assert(
      'A7 并发槽闭环：子 agent 终态后子 agent 槽可再次占用',
      (() => {
        if (!child) return false;
        const probe = aiTaskConcurrencyAcquire(USER_ID, 'probe_child_slot', { isPrimary: false });
        if (probe && probe.ok !== false) {
          aiTaskConcurrencyRelease(USER_ID, 'probe_child_slot');
          return true;
        }
        return false;
      })(),
      'acquire probe after child terminal'
    );

    // ============ 场景 B：并发双子 agent + 父整合 ============
    const created2 = agentTaskStore.createAgentTask({
      userId: USER_ID,
      params: {
        messages: [{ role: 'user', content: PARENT_PROMPT_2 }],
        conversationId: 'conv_b49_live',
        context: { page: 'chat', accessMode: 'full' },
        kind: 'primary',
        providerName: 'deepseek',
        profileId: 'b49-live',
      },
    });
    const parent2TaskId = created2.taskId;
    const acquired2 = aiTaskConcurrencyAcquire(USER_ID, parent2TaskId, { isPrimary: true });
    assert('B0 第二父任务主会话槽获取成功', !!acquired2 && acquired2.ok !== false, JSON.stringify(acquired2 || {}));

    const parent2Run = await runAgentLoop({
      messages: [{ role: 'user', content: PARENT_PROMPT_2 }],
      context: { page: 'chat', accessMode: 'full' },
      userId: USER_ID,
      conversationId: 'conv_b49_live',
      apiKey: 'live-check-key',
      providerName: 'deepseek',
      providerLabel: '实机多Agent派生',
      modelName: 'mock-b49',
      profileId: 'b49-live',
      baseUrl: `http://127.0.0.1:${mock.port}`,
      taskId: parent2TaskId,
      kind: 'primary',
      onEvent: () => {},
    });
    aiTaskConcurrencyRelease(USER_ID, parent2TaskId);

    const parent2 = agentTaskStore.getAgentTask(parent2TaskId);
    const children2 = agentTaskStore.listChildAgentTasks(parent2TaskId);
    const [childA, childB] = children2;
    const text2 = String((parent2Run && parent2Run.assistantText) || '');
    results.scenarioB = {
      taskId: parent2TaskId,
      status: parent2 && parent2.status,
      assistantText: text2,
      children: children2.map((t) => ({
        agentId: t.taskId, status: t.status, createdAt: t.createdAt, finishedAt: t.finishedAt,
        task: String(t.params && t.params.messages && t.params.messages[0] && t.params.messages[0].content || '').slice(0, 30),
      })),
    };

    assert('B1 第二父 loop 正常完成', (parent2 && parent2.status) === 'completed', JSON.stringify({ status: parent2 && parent2.status, text: text2.slice(0, 120) }));
    assert('B2 模型并发派生两个子 agent', children2.length === 2, JSON.stringify({ count: children2.length }));
    assert(
      'B3 两个子 agent 都真实跑完（completed）',
      !!childA && !!childB && childA.status === 'completed' && childB.status === 'completed',
      JSON.stringify(results.scenarioB.children)
    );
    assert(
      'B4 并发时间窗重叠（第二个子 agent 派生时第一个仍在运行）',
      !!childA && !!childB && String(childB.createdAt) >= String(childA.createdAt) && String(childA.finishedAt) >= String(childB.createdAt),
      JSON.stringify(results.scenarioB.children)
    );
    assert(
      'B5 父整合两份子 agent 报告',
      text2.includes('DONE-BOTH') && text2.includes('CHILD-REPORT-A') && text2.includes('CHILD-REPORT-B') && text2.includes('42') && text2.includes('81'),
      text2.slice(0, 240)
    );

    // ============ 场景 C：级联取消 ============
    const user3 = 'u_block49_live_c';
    const created3 = agentTaskStore.createAgentTask({
      userId: user3,
      params: {
        messages: [{ role: 'user', content: 'LIVE-PARENT-CANCEL: 占位' }],
        context: { page: 'chat', accessMode: 'full' },
        kind: 'primary',
        providerName: 'deepseek',
        profileId: 'b49-live',
      },
    });
    const parent3TaskId = created3.taskId;
    const spawnResult = await spawn_agent(
      { task: 'LIVE-CHILD-C: 长任务占位，等待被级联取消。' },
      { taskId: parent3TaskId, userId: user3, accessMode: 'full' }
    );
    const cascade = agentTaskStore.cancelAgentTaskCascade(parent3TaskId, { dbMod });
    // 子 loop 首个模型调用约 1s 返回，之后 aborted() 生效置 cancelled；轮询等待
    let childC = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      childC = spawnResult && spawnResult.agentId ? agentTaskStore.getAgentTask(spawnResult.agentId) : null;
      if (childC && childC.status === 'cancelled') break;
    }
    const parent3 = agentTaskStore.getAgentTask(parent3TaskId);
    results.scenarioC = {
      parentTaskId: parent3TaskId,
      parentStatus: parent3 && parent3.status,
      parentAgentStatus: parent3 && parent3.agentStatus,
      childTaskId: spawnResult && spawnResult.agentId,
      childStatus: childC && childC.status,
      childAgentStatus: childC && childC.agentStatus,
      cascadeCancelledIds: cascade && cascade.cancelledTaskIds,
    };
    assert(
      'C1 spawn_agent 直调成功（异步返回 agentId）',
      !!spawnResult && spawnResult.ok === true && !!spawnResult.agentId,
      JSON.stringify(spawnResult || {})
    );
    assert(
      'C2 级联取消：父取消后子 agent 被级联置为取消态',
      !!childC && childC.status === 'cancelled',
      JSON.stringify(results.scenarioC)
    );
    assert(
      'C3 级联取消不外溢：父任务自身进入取消态',
      !!parent3 && (parent3.status === 'cancelled' || parent3.agentStatus === 'cancel_requested'),
      JSON.stringify(results.scenarioC)
    );

    const allPass = results.assertions.every((a) => a.pass);
    results.mockHits = hits;
    results.finishedAt = new Date().toISOString();
    results.allPass = allPass;
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'spawn-agent-live.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(`\n证据已写入 acceptance/block-49/spawn-agent-live.json (allPass=${allPass})`);
    process.exitCode = allPass ? 0 : 1;
  } finally {
    try { mock.server.close(); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

const watchdog = setTimeout(() => {
  console.error('FAIL 实机脚本 180s 看门狗超时');
  process.exit(2);
}, 180000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 实机脚本异常:', e && e.stack || e);
  process.exit(1);
});
