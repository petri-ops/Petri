#!/usr/bin/env node
'use strict';

/**
 * BLOCK-56 P4 模型降级链路实机驱动（真 HTTP + 真 DB + 真配置 + 真分类）：
 * 本地起双 mock OpenAI-compatible 端点（deepseek provider 真协议）：
 *   primary：可切换故障模式（500 overloaded / 400 context 超限 / 401 鉴权）
 *   backup ：正常 SSE chat completions
 * 场景：
 *   A 请求级降级：500（可重试）→ gateway 内 primary→backup 切换，model_fallback 事件可见
 *   B 任务级降级：400 context 超限（不可重试，请求级不动）→ 任务失败 → 真分类
 *     （classifyDegradableError）→ 真配置解析备用 → maybeLaunchTaskLevelFallback
 *     真建续跑任务（fallbackOfTaskId 溯源）→ 注入 runAgentLoop 走真 gateway.chat
 *     （disableFallback=true）用备用端点真实完成 → 单级不连环闸（already_resumed）
 *   C 不可降级：401 → 诚实失败零回归（不建续跑任务）
 * 证据：acceptance/block-56/model-fallback-live.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// env 必须在 require db/ai-settings 之前设置（单例解析）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block56-live-'));
process.env.BIOF3_DB_PATH = path.join(tmpRoot, 'live.db');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tmpRoot, 'local-data');

const ROOT = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-56');

const { saveAiSettings } = require(ROOT + '/core/biof3-server/helpers/ai-settings');
const { modelGateway } = require(ROOT + '/core/biof3-server/helpers/model-gateway');
const agentTaskStore = require(ROOT + '/core/biof3-server/agent-task-store');
const { classifyDegradableError } = require(ROOT + '/core/biof3-server/helpers/model-fallback-policy');
const { maybeLaunchTaskLevelFallback } = require(ROOT + '/core/biof3-server/helpers/agent-fallback');
const { aiTaskConcurrencyRelease } = require(ROOT + '/core/biof3-server/helpers/runtime');

const USER_ID = 'u_block56_live';

// ---------- mock 端点 ----------
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const primaryState = { mode: 'overload500', hits: [] };
const backupHits = [];

async function startMockServers() {
  const primary = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      primaryState.hits.push({ mode: primaryState.mode, path: req.url });
      if (primaryState.mode === 'overload500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'The server is overloaded. Please try again later.' } }));
        return;
      }
      if (primaryState.mode === 'context400') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: "This model's maximum context length is 131072 tokens. However, your messages resulted in 150000 tokens. Please reduce the length of the messages.",
            type: 'invalid_request_error',
          },
        }));
        return;
      }
      // auth401
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key provided', type: 'invalid_request_error' } }));
    });
  });

  const backup = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      const marker = parsed.__marker || 'B56-BACKUP-OK';
      backupHits.push({ path: req.url, stream: parsed.stream === true, model: parsed.model, marker });
      if (parsed.stream === true) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frames = [
          `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: marker } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
          `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })}`,
          'data: [DONE]',
        ];
        res.end(frames.join('\n\n') + '\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: marker } }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
      }));
    });
  });

  return { primary, backup };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), scenario: [], assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };

  const { primary, backup } = await startMockServers();
  const primaryPort = primary.port;
  const backupPort = backup.port;

  // 真设置落盘（临时 BIOF3_LOCAL_DATA_DIR，不碰用户真实配置）
  saveAiSettings({
    model_profiles: [
      {
        id: 'b56-live-primary', label: '实机主模型(故障注入)', provider: 'deepseek', model: 'mock-primary',
        baseUrl: `http://127.0.0.1:${primaryPort}`, capabilities: ['chat', 'streaming', 'tools'], roles: ['chat', 'agent'],
      },
      {
        id: 'b56-live-backup', label: '实机备用模型', provider: 'deepseek', model: 'mock-backup',
        baseUrl: `http://127.0.0.1:${backupPort}`, capabilities: ['chat', 'streaming', 'tools'], roles: ['chat', 'agent'],
      },
    ],
    model_role_bindings: { chat: 'b56-live-primary', agent: 'b56-live-primary' },
    model_fallback_enabled: true,
    model_fallback_bindings: { chat: ['b56-live-backup'], agent: ['b56-live-backup'] },
  });
  const config = modelGateway.getConfig();
  results.config = {
    fallbackEnabled: config.fallbackEnabled,
    fallbackBindings: config.fallbackBindings,
    profiles: config.profiles.map((p) => ({ id: p.id, provider: p.provider, model: p.model, baseUrl: p.baseUrl })),
    dbPath: 'tmp(biof3-block56-live-*)/live.db',
  };

  try {
    // ---------- 场景 A：请求级降级（500 → gateway 内切备用） ----------
    primaryState.mode = 'overload500';
    const eventsA = [];
    const resultA = await modelGateway.chat({
      role: 'chat',
      profileId: 'b56-live-primary',
      apiKeyOverride: 'live-check-key',
      body: { messages: [{ role: 'user', content: 'A 场景探测' }], __marker: 'B56-BACKUP-REQUEST-LEVEL-OK' },
      onEvent: (e) => eventsA.push(e),
    });
    results.scenario.push({ name: 'A-request-level', primaryHits: primaryState.hits.length, backupHits: backupHits.length });
    const fallbackEventA = eventsA.find((e) => e.type === 'model_fallback');
    assert('A: primary 端点真实收到 500 探测', primaryState.hits.length === 1, JSON.stringify(primaryState.hits));
    assert(
      'A: 收到 model_fallback 事件（from=primary to=backup）',
      !!fallbackEventA && fallbackEventA.fromProfileId === 'b56-live-primary' && fallbackEventA.toProfileId === 'b56-live-backup',
      JSON.stringify(fallbackEventA || {}).slice(0, 200)
    );
    assert(
      'A: 最终响应来自备用端点且附 fallbackFrom 溯源',
      !resultA.error
        && /B56-BACKUP-REQUEST-LEVEL-OK/.test(resultA.choices?.[0]?.message?.content || '')
        && resultA.modelRouting?.fallbackFrom === 'b56-live-primary',
      JSON.stringify({ error: resultA.error, routing: resultA.modelRouting }).slice(0, 200)
    );

    // ---------- 场景 B：任务级降级（context 400 → 请求级不动 → 任务级切 profile 续跑） ----------
    primaryState.mode = 'context400';
    const failB = await modelGateway.chat({
      role: 'agent',
      profileId: 'b56-live-primary',
      apiKeyOverride: 'live-check-key',
      body: { messages: [{ role: 'user', content: '分析 data.csv 并总结' }] },
    });
    const classified = classifyDegradableError(failB.message || failB.error);
    assert(
      'B: 真实 400 context 超限错误 + 真分类为可降级(context_window)',
      !!failB.error && /maximum context length/.test(failB.message || '') && classified.degradable === true && classified.category === 'context_window',
      JSON.stringify({ error: failB.error, message: (failB.message || '').slice(0, 120), classified })
    );
    assert(
      'B: context 超限不触发请求级降级（isRetryable=false，分工正确）',
      !failB.modelRouting?.fallbackFrom && backupHits.length === 1,
      JSON.stringify({ routing: failB.modelRouting, backupHits: backupHits.length })
    );

    const createdB = agentTaskStore.createAgentTask({
      userId: USER_ID,
      params: {
        messages: [{ role: 'user', content: '分析 data.csv 并总结' }],
        conversationId: 'conv_b56_live',
        context: { page: 'chat', projectId: 'p_block56_live' },
        kind: 'primary',
        providerName: 'deepseek',
        profileId: 'b56-live-primary',
      },
    });
    const taskIdB = createdB.taskId;
    // 对齐真实失败链：先落一条工具进度事件（供恢复摘要），再置 failed
    agentTaskStore.appendAgentTaskEvent(taskIdB, 1, 'tool_result', {
      iteration: 1, name: 'workspace_read', summary: '读取 data.csv (24 rows)',
    });
    agentTaskStore.markAgentTaskFailed(taskIdB, failB.message);

    const eventsB = [];
    const resumedCalls = [];
    let resumedResultB = null;
    let resolveResumed;
    const resumedDone = new Promise((r) => { resolveResumed = r; });

    // 无 deps.gatewayConfig → 走真 modelGateway.getConfig()（真配置解析）
    const outcomeB = maybeLaunchTaskLevelFallback({
      taskId: taskIdB,
      error: failB.message,
      kind: 'primary',
      previousProfileId: 'b56-live-primary',
      emit: (e) => eventsB.push(e),
    }, {
      runAgentLoop: async (input) => {
        try {
          resumedCalls.push(input);
          const r = await modelGateway.chat({
            role: 'agent',
            profileId: input.profileId,
            apiKeyOverride: 'live-check-key',
            body: { messages: input.messages.slice(-6), __marker: 'B56-BACKUP-TASK-LEVEL-RESUMED-OK' },
            ...(input.disableProviderFallback ? { disableFallback: true } : {}),
          });
          if (r && !r.error) {
            resumedResultB = r;
            agentTaskStore.markAgentTaskDone(input.taskId);
          } else {
            agentTaskStore.markAgentTaskFailed(input.taskId, (r && r.message) || 'resumed failed');
          }
        } catch (e) {
          agentTaskStore.markAgentTaskFailed(input.taskId, e.message);
        } finally {
          try { aiTaskConcurrencyRelease(USER_ID, input.taskId); } catch {}
          resolveResumed();
        }
      },
    });

    assert(
      'B: 任务级降级启动（category=context_window，新任务已建）',
      outcomeB.launched === true && outcomeB.category === 'context_window' && !!outcomeB.newTaskId,
      JSON.stringify(outcomeB).slice(0, 200)
    );
    const fallbackEventB = eventsB.find((e) => e.event === 'model_fallback');
    assert(
      'B: model_fallback 溯源事件（scope=task_level, newTaskId 可溯）',
      !!fallbackEventB && fallbackEventB.scope === 'task_level'
        && fallbackEventB.fromProfileId === 'b56-live-primary'
        && fallbackEventB.toProfileId === 'b56-live-backup'
        && fallbackEventB.newTaskId === outcomeB.newTaskId,
      JSON.stringify(fallbackEventB || {}).slice(0, 240)
    );

    await resumedDone;

    const originalB = agentTaskStore.getAgentTask(taskIdB);
    const resumedTaskB = agentTaskStore.getAgentTask(outcomeB.newTaskId);
    const resumedInput = resumedCalls[0] || {};
    const resumedContent = resumedResultB?.choices?.[0]?.message?.content || '';
    assert(
      'B: 原 task 保持 failed；续跑 task completed 且带 fallbackOfTaskId/resumeOfTaskId 溯源',
      originalB.status === 'failed'
        && resumedTaskB.status === 'completed'
        && resumedTaskB.params.fallbackOfTaskId === taskIdB
        && resumedTaskB.params.resumeOfTaskId === taskIdB,
      JSON.stringify({ original: originalB.status, resumed: resumedTaskB.status, of: resumedTaskB.params.fallbackOfTaskId }).slice(0, 200)
    );
    assert(
      'B: 续跑任务以备用 profile + disableProviderFallback=true 拉起（单级不连环闸 3）',
      resumedInput.profileId === 'b56-live-backup' && resumedInput.disableProviderFallback === true,
      JSON.stringify({ profileId: resumedInput.profileId, disable: resumedInput.disableProviderFallback }).slice(0, 200)
    );
    assert(
      'B: 恢复指令注入（系统注入标记 + 原任务消息 + 进度摘要 + 降级注明要求）',
      (resumedInput.messages || []).some((m) => /系统注入，非用户输入/.test(m.content || ''))
        && (resumedInput.messages || []).some((m) => /分析 data.csv 并总结/.test(m.content || ''))
        && (resumedInput.messages || []).some((m) => /读取 data\.csv/.test(m.content || '') && /降级生成/.test(m.content || '')),
      JSON.stringify((resumedInput.messages || []).slice(-1)[0]?.content || '').slice(0, 240)
    );
    assert(
      'B: 续跑真实命中备用端点并成功（disableFallback 下仅一次调用）',
      backupHits.length === 2 && /B56-BACKUP-TASK-LEVEL-RESUMED-OK/.test(resumedContent)
        && resumedResultB?.modelRouting?.profileId === 'b56-live-backup'
        && !resumedResultB?.modelRouting?.fallbackFrom,
      JSON.stringify({ backupHits: backupHits.length, content: resumedContent.slice(0, 80), routing: resumedResultB?.modelRouting }).slice(0, 240)
    );

    // 单级不连环闸 2（真数据）：续跑任务自身再失败 → already_resumed
    const gateReB = maybeLaunchTaskLevelFallback({
      taskId: outcomeB.newTaskId,
      error: 'The server is overloaded. Please try again later.',
      kind: 'primary',
      previousProfileId: 'b56-live-backup',
      emit: () => {},
    }, { runAgentLoop: async () => {} });
    assert(
      'B: 单级不连环（续跑任务再失败 → already_resumed，不二次降级）',
      gateReB.launched === false && gateReB.reason === 'already_resumed',
      JSON.stringify(gateReB).slice(0, 200)
    );

    // ---------- 场景 C：不可降级错误 → 诚实失败零回归 ----------
    primaryState.mode = 'auth401';
    const failC = await modelGateway.chat({
      role: 'chat',
      profileId: 'b56-live-primary',
      apiKeyOverride: 'live-check-key',
      body: { messages: [{ role: 'user', content: 'C 场景探测' }] },
    });
    const createdC = agentTaskStore.createAgentTask({
      userId: USER_ID,
      params: {
        messages: [{ role: 'user', content: 'C 场景任务' }],
        conversationId: 'conv_b56_live',
        context: { page: 'chat', projectId: 'p_block56_live' },
        kind: 'primary',
      },
    });
    agentTaskStore.markAgentTaskFailed(createdC.taskId, failC.message);
    const eventsC = [];
    const outcomeC = maybeLaunchTaskLevelFallback({
      taskId: createdC.taskId,
      error: failC.message,
      kind: 'primary',
      previousProfileId: 'b56-live-primary',
      emit: (e) => eventsC.push(e),
    }, { runAgentLoop: async () => {} });
    assert(
      'C: 真实 401 错误诚实失败（不降级、不建续跑任务）',
      !!failC.error && /Invalid API key/.test(failC.message || '')
        && outcomeC.launched === false && outcomeC.reason === 'not_degradable' && outcomeC.newTaskId === null
        && !eventsC.some((e) => e.event === 'model_fallback'),
      JSON.stringify({ error: failC.error, outcome: outcomeC }).slice(0, 200)
    );

    // ---------- 配置关闭 → 诚实失败（现行为） ----------
    saveAiSettings({ model_fallback_enabled: false });
    const outcomeD = maybeLaunchTaskLevelFallback({
      taskId: taskIdB,
      error: 'The server is overloaded. Please try again later.',
      kind: 'primary',
      previousProfileId: 'b56-live-primary',
      emit: () => {},
    }, { runAgentLoop: async () => {} });
    assert(
      'D: 未启用降级配置 → no_fallback_profile 诚实失败（但原任务已续跑过，先闸 already_resumed 亦可）',
      outcomeD.launched === false && (outcomeD.reason === 'no_fallback_profile' || outcomeD.reason === 'already_resumed'),
      JSON.stringify(outcomeD).slice(0, 200)
    );
  } catch (e) {
    assert('驱动异常', false, e.stack || e.message);
  }

  try { primary.server.close(); } catch {}
  try { backup.server.close(); } catch {}

  results.finishedAt = new Date().toISOString();
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'model-fallback-live.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  console.log(`\n${results.allPass ? 'ALL PASS' : 'HAS FAILURES'} → acceptance/block-56/model-fallback-live.json`);
  process.exit(results.allPass ? 0 : 1);
}

main();
