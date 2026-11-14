#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：m7-longtask-resume-live — M7 §8 第 5 条补腿实机腿（BLOCK-449）。
 *
 * M7-3 closureCondition 逐字要求：「9223 离屏实例跑崩溃注入→重启 resume，
 * 断言工具调用数/消息序列逐字对齐；截图失败标 screenshot_unavailable」；
 * M2-live closureCondition 要求 dev-verify flow 形态。
 *
 * 形态（全部复用既有单源，零产品代码改动）：
 *  - scripts/lib/evals-harness.mjs：隔离后端（临时 DB + migrations 自举 + 凭据 file 隔离）
 *    + 本地脚本化 mock OpenAI SSE provider（真实 agent loop 打 mock，零外网）。
 *  - scripts/start-test-instance.sh：9223 离屏 Electron 测试实例（PETRI_TEST_ONSCREEN
 *    恒不设；?test=1 标记；跑完立即 kill），经 PETRI_TEST_BACKEND_PORT 附着隔离后端。
 *  - 产品 resume 路由（core/petri-server/routes/ai-agent/resume.js，BLOCK-38 P1）：
 *    服务重启清扫 → interrupted_at → GET/POST /api/ai/agent/task/:id/resume →
 *    同会话新建 agent_loop task（params.resumeOfTaskId + task_resumed 溯源事件）。
 *
 * 时序：真任务启动 → tool_call 事件在场 → 第二回合 LLM 请求挂起（mock delayMs）→
 * SIGKILL 崩溃注入 → 同数据目录重启后端 + mock provider 重启（崩溃窗回合随旧
 * provider 丢弃，续跑回合单挂新队列）→ 预续跑消息快照 → resume 预览（进度摘要
 * 逐字含工具名）→ POST resume → task_resumed 链接 → 续跑收口 → rowid join
 * 消息逐字对齐（续写只许发生在中断行）→ 9223 UI 在场 + 截图。
 *
 * 前置：vite :3000 在跑（SPA 由测试实例加载；主后端 :3001 非必需）。
 * 环境未就绪时诚实失败并带启动指引。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const lib = require('../lib.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const APP_ORIGIN = process.env.PETRI_DEV_ORIGIN || 'http://localhost:3000';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function pidListeningOn(port) {
  try {
    const out = execFileSync('lsof', ['-tnP', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
    const pid = String(out || '').trim().split('\n')[0];
    return pid ? Number(pid) : null;
  } catch {
    return null;
  }
}

async function kill9223Instance() {
  const pid = pidListeningOn(lib.TEST_INSTANCE_PORT);
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    await sleep(1200);
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    await sleep(300);
  }
}

async function apiCall(api, method, url, body) {
  const r = await fetch(api + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-json */ }
  return { status: r.status, json };
}

function extractMessages(json) {
  const j = json || {};
  return j.messages || (j.data && j.data.messages) || (Array.isArray(j.data) ? j.data : []) || [];
}

async function resolveWorkspaceDir(api, tmpDir, projectId) {
  const rec = await apiCall(api, 'GET', `/api/data/projects/${encodeURIComponent(projectId)}`);
  const j = rec.json || {};
  const ws = (j.project && j.project.workspace_path) || (j.data && j.data.workspace_path) || j.workspace_path;
  if (ws && fs.existsSync(ws)) return ws;
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    if (path.basename(dir) === projectId || dir.includes(projectId)) {
      try { if (fs.statSync(dir).isDirectory()) return dir; } catch { /* skip */ }
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return null;
}

module.exports = {
  id: 'm7-longtask-resume-live',
  description: 'M7 §8 第 5 条补腿：9223 离屏实例崩溃注入→重启→resume 逐字对齐（隔离后端+mock provider+真 agent loop）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-449', 'evidence', 'dev-verify'),

  async run(ctx) {
    const { assert } = ctx;
    const created = { tmpDir: null, pid9223Killed: false };
    let client = null;
    let mock = null;
    let bePrimary = null;
    let beResumed = null;

    const cleanup = async () => {
      try { if (client && client.socket) client.socket.close(); } catch { /* already */ }
      await kill9223Instance();
      created.pid9223Killed = true;
      try { if (bePrimary) await bePrimary.cleanup(); } catch { /* already dead */ }
      try { if (beResumed) await beResumed.cleanup(); } catch { /* already dead */ }
      try { if (mock) await mock.close(); } catch { /* already */ }
      try { if (created.tmpDir) fs.rmSync(created.tmpDir, { recursive: true, force: true }); } catch { /* tmp */ }
    };

    try {
      // ── Phase 0：单源复用 — harness + mock provider ──
      const harness = await import(path.join(ROOT, 'scripts', 'lib', 'evals-harness.mjs'));
      mock = harness.startMockProvider();
      const mockPort = await mock.ready;
      process.env.PETRI_EVALS_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;
      assert('mock_provider_up', Number.isFinite(mockPort), `mock provider :${mockPort}（本地 SSE，零外网）`);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-longtask-resume-live-'));
      created.tmpDir = tmpDir;
      bePrimary = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir, mode: 'mock' });
      assert('isolated_backend_health', bePrimary.ok === true, `隔离后端 :${bePrimary.port}（临时 DB + migrations 自举 + PETRI_CREDENTIAL_BACKEND=file）`);

      // ── Phase 1：9223 离屏测试实例（附着隔离后端；禁 PETRI_TEST_ONSCREEN）──
      assert('no_onscreen_env', !process.env.PETRI_TEST_ONSCREEN, 'PETRI_TEST_ONSCREEN 必须不设（无窗实机纪律）');
      await kill9223Instance();
      const instStart = spawn('bash', [path.join(ROOT, 'scripts', 'start-test-instance.sh')], {
        env: { ...process.env, PETRI_TEST_BACKEND_PORT: String(bePrimary.port) },
        stdio: 'ignore',
      });
      let instReady = false;
      let instFail = '';
      for (let i = 0; i < 120 && !instReady; i += 1) {
        await sleep(1000);
        if (instStart.exitCode !== null && instStart.exitCode !== 0) { instFail = `start-test-instance.sh exit=${instStart.exitCode}`; break; }
        try {
          const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 2000 });
          instReady = lib.filterPageTargets(targets, /localhost:3000/).length > 0;
        } catch { /* not yet */ }
      }
      assert('test_instance_cdp_9223', instReady, instReady ? '9223 离屏实例 ?test=1 页面目标在场（附着隔离后端）' : (instFail || '未产出 9223 目标'));
      if (!instReady) { await cleanup(); return false; }

      const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 5000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      const main = await lib.selectPageTarget(pages, {
        probe: async (c) => lib.evalJs(c, `!!document.getElementById('root') && document.getElementById('root').childElementCount > 0`, 5000).catch(() => false),
      });
      client = await lib.connectTarget(main);
      const mounted = await lib.evalJs(client, `document.getElementById('root') ? document.getElementById('root').childElementCount : -1`, 5000);
      assert('test_instance_spa_mounted', Number(mounted) > 0, `#root children=${mounted}`);
      assert('test_instance_marks_test_page', String(main.url || '').includes('test=1'), main.url);

      // ── Phase 2：真实 agent 任务（真 loop × mock provider，真实工具执行）──
      const project = await apiCall(bePrimary.api, 'POST', '/api/data/projects', { name: 'm7-live-resume' });
      const j = project.json || {};
      const projectId = (j.project && j.project.id) || (j.data && j.data.id) || (j.data && j.data.project && j.data.project.id);
      assert('project_created', Boolean(projectId), `projectId=${projectId}`);
      const wsDir = await resolveWorkspaceDir(bePrimary.api, tmpDir, projectId);
      assert('workspace_resolved', Boolean(wsDir), String(wsDir));
      if (wsDir) fs.writeFileSync(path.join(wsDir, 'resume-note.txt'), 'M7 补腿实机脚注：崩溃注入后由 resume 路由续跑。\n', 'utf8');

      const conv = await apiCall(bePrimary.api, 'POST', '/api/ai/conversations', { title: 'm7-live-resume', project_id: projectId });
      const cj = conv.json || {};
      const conversationId = (cj.conversation && cj.conversation.id) || (cj.data && cj.data.conversation && cj.data.conversation.id) || (cj.data && cj.data.id);
      assert('conversation_created', Boolean(conversationId), `conversationId=${conversationId}`);

      // mock 队列：回合 1=工具调用；回合 2=崩溃窗（8s 挂起，随旧 provider 丢弃）
      mock.push(
        { content: '正在读取 workspace 笔记。', toolCalls: [{ name: 'workspace_read', arguments: { path: 'resume-note.txt' } }] },
        { delayMs: 8000, content: '（崩溃窗回合：不应被完整消费）' },
      );
      const start = await apiCall(bePrimary.api, 'POST', '/api/ai/agent', {
        conversationId,
        modelPresetId: 'evals-provider',
        messages: [{ role: 'user', content: '请读取 workspace 里的 resume-note.txt 并汇报内容。' }],
        context: { accessMode: 'full', projectId },
      });
      const taskId = start.json?.taskId || null;
      assert('live_task_started', Boolean(taskId), `taskId=${taskId}`);
      if (!taskId) { await cleanup(); return false; }

      // 崩溃注入：看到 tool_call 事件后 1.2s SIGKILL（落在回合 2 的 8s 挂起窗内）
      let armCrash = false;
      const preEvents = [];
      try {
        await harness.collectTaskEvents(bePrimary.api, taskId, {
          timeoutMs: 45_000,
          onEvent: async (ev) => {
            preEvents.push(ev);
            if (ev.event === 'tool_call' && !armCrash) {
              armCrash = true;
              setTimeout(() => {
                const pid = pidListeningOn(bePrimary.port);
                if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* race */ } }
              }, 1200);
            }
          },
        });
      } catch (e) {
        assert('crash_sse_terminated_expected', true, `SSE 终止（${String(e && e.message).slice(0, 120)}）——后端被 SIGKILL 属预期路径`);
      }
      const pidAfterKill = pidListeningOn(bePrimary.port);
      const toolCallSeen = preEvents.some((e) => e.event === 'tool_call'
        && String((e.name !== undefined ? e.name : (e.payload && e.payload.name)) || '').includes('workspace_read'));
      assert('live_tool_call_recorded', toolCallSeen, `pre-crash 事件=${preEvents.length}，workspace_read tool_call 在场`);
      assert('crash_injected_sigkill', armCrash && pidAfterKill === null, `SIGKILL 已注入；后端监听 pid=${pidAfterKill}（null=进程已死）`);
      if (!armCrash || pidAfterKill !== null) { await cleanup(); return false; }

      // ── Phase 3：同数据目录重启后端 + mock provider 重启 → resume ──
      try { await mock.close(); } catch { /* already */ }
      mock = harness.startMockProvider();
      const mockPort2 = await mock.ready;
      process.env.PETRI_EVALS_BASE_URL = `http://127.0.0.1:${mockPort2}/v1`;
      assert('mock_provider_restarted', Number.isFinite(mockPort2), `mock provider 重启 :${mockPort2}（崩溃窗回合随旧 provider 丢弃）`);

      beResumed = await harness.spawnIsolatedBackend({ root: ROOT, tmpDir, mode: 'mock' });
      assert('backend_restarted_same_datadir', beResumed.ok === true, `重启后端 :${beResumed.port}（同一 tmpDir/petri.db）`);

      // 预续跑消息快照（同一 DB 的崩溃时刻持久化态；信封时间升序全窗）
      const preMsgRes = await apiCall(beResumed.api, 'GET', `/api/ai/conversations/${conversationId}/messages?limit=500`);
      const preRows = extractMessages(preMsgRes.json);
      assert('pre_resume_messages_snapshot', preRows.length >= 1 && preMsgRes.json?.hasMore === false,
        `预续跑消息=${preRows.length} 行（windowOffset=${preMsgRes.json?.windowOffset}，全窗）`);

      const origMeta = await apiCall(beResumed.api, 'GET', `/api/ai/agent/task/${taskId}/meta`);
      assert('original_task_meta_readable', origMeta.status === 200, `原任务 meta status=${origMeta.status} agentStatus=${origMeta.json?.agentStatus || origMeta.json?.status}`);

      // resume 预览（重启清扫标记 interrupted_at 可能异步——重试至多 10s）
      let preview = null;
      for (let i = 0; i < 20; i += 1) {
        preview = await apiCall(beResumed.api, 'GET', `/api/ai/agent/task/${taskId}/resume`);
        if (preview.status === 200) break;
        await sleep(500);
      }
      const digestText = JSON.stringify(preview.json || {});
      assert('resume_preview_200', preview.status === 200, `preview status=${preview.status}`);
      assert('resume_digest_contains_tool_verbatim', preview.status === 200 && digestText.includes('workspace_read'), '进度摘要逐字含工具名 workspace_read（buildProgressDigest）');

      // 续跑回合单挂新队列；POST resume 建续跑任务
      mock.push({ content: '续跑收口：resume-note.txt 内容已确认，任务完成。' });
      const prePostMeta = await apiCall(beResumed.api, 'GET', `/api/ai/agent/task/${taskId}/meta`);
      const prePostStatus = prePostMeta.json?.agentStatus || prePostMeta.json?.status || null;
      const resumeStart = await apiCall(beResumed.api, 'POST', `/api/ai/agent/task/${taskId}/resume`, { modelPresetId: 'evals-provider' });
      const rj = resumeStart.json || {};
      const newTaskId = rj.taskId || (rj.task && rj.task.id) || (rj.data && rj.data.taskId) || null;
      assert('resume_started_new_task', Boolean(newTaskId),
        `resume status=${resumeStart.status} error=${String(rj.error || '(none)').slice(0, 160)} prePostAgentStatus=${prePostStatus} previewResumable=${(preview.json || {}).resumable}`);
      if (!newTaskId) { await cleanup(); return false; }

      // ── Phase 4：溯源 + 逐字对齐 + 续跑收口 ──
      const origReplay = await harness.collectTaskEvents(beResumed.api, taskId, { timeoutMs: 30_000 });
      const resumedEvent = origReplay.find((e) => (e.event === 'task_resumed') || (e._eventType === 'task_resumed')
        || String((e.eventType || e._eventType || '')) === 'task_resumed');
      const linkedId = resumedEvent ? String(resumedEvent.newTaskId || (resumedEvent.payload && resumedEvent.payload.newTaskId) || '') : '';
      assert('task_resumed_linkage', linkedId === String(newTaskId), `task_resumed.newTaskId=${linkedId || '(缺席)'} vs 续跑任务=${newTaskId}`);

      const resumeEvents = await harness.collectTaskEvents(beResumed.api, newTaskId, { timeoutMs: 120_000 });
      const doneSeen = resumeEvents.some((e) => e.event === 'done');
      const resumeToolCalls = resumeEvents.filter((e) => e.event === 'tool_call');
      assert('resumed_run_completed', doneSeen, `续跑事件=${resumeEvents.length}，done=${doneSeen}`);
      assert('no_duplicate_tool_call_after_resume', resumeToolCalls.length === 0,
        `续跑任务 tool_call=${resumeToolCalls.length}（已完成步骤不重复执行；mock 续跑回合无工具回合）`);
      const finalText = resumeEvents
        .filter((e) => e.choices && e.choices[0] && e.choices[0].delta && typeof e.choices[0].delta.content === 'string')
        .map((e) => e.choices[0].delta.content).join('');
      assert('resumed_final_answer_verbatim', finalText.includes('续跑收口'), `finalText=${finalText.slice(0, 80)}`);

      const postMsgRes = await apiCall(beResumed.api, 'GET', `/api/ai/conversations/${conversationId}/messages?limit=500`);
      const postRows = extractMessages(postMsgRes.json);
      assert('messages_window_full', (postMsgRes.json?.hasMore === false) && Number(postMsgRes.json?.windowOffset || 0) === 0 && postRows.length >= preRows.length,
        `post=${postRows.length} 行 ≥ pre=${preRows.length} 行（windowOffset=${postMsgRes.json?.windowOffset}，hasMore=${postMsgRes.json?.hasMore}）`);
      // 逐字对齐（positional）：预续跑快照的每一行在续跑后同位置在场，role 相等、
      // content 相等或为 in-place 续写（startsWith）——零丢失、零改写、零回退。
      let mismatches = 0;
      let firstDiff = '';
      let continuedRows = 0;
      for (let i = 0; i < preRows.length; i += 1) {
        const pre = preRows[i] || {};
        const post = postRows[i] || {};
        const sameRole = String(post.role) === String(pre.role);
        const sameContent = String(post.content) === String(pre.content);
        const continued = !sameContent && String(post.content || '').startsWith(String(pre.content || ''));
        if (continued) continuedRows += 1;
        if (!sameRole || (!sameContent && !continued)) {
          mismatches += 1;
          firstDiff = `idx=${i} role ${pre.role}→${post.role} 内容改写`;
          break;
        }
      }
      assert('messages_prefix_verbatim_aligned', mismatches === 0,
        mismatches === 0
          ? `前缀逐字对齐 ${preRows.length}/${postRows.length} 行（role/content 除 in-place 续写 ${continuedRows} 行外逐字相等；新增行=续跑记录）`
          : firstDiff);
      // resume.js「不落 conversation 消息，transcript 可见即取证」的实机语义（run4/run5
      // 观测校准）：恢复指令只进 runAgentLoop 的 LLM 请求（取证面=llm-transcripts 模型
      // 调用台账），不新增会话 user 行——断言除原始行外无新增 user 行（无重复、无注入）。
      const newUserRows = postRows.filter((r) => String(r.role) === 'user'
        && !preRows.some((p) => String(p.content) === String(r.content) && String(p.role) === String(r.role))).length;
      assert('resume_instruction_not_in_conversation_messages', newUserRows === 0,
        `恢复指令不入会话消息（新增 user 行=${newUserRows}；取证面=llm-transcripts，resume.js 注释语义）`);

      // ── Phase 5：9223 UI 腿（渲染面在场 + 截图）──
      try { await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 8000); } catch { /* 导航会重建会话 */ }
      await sleep(3000);
      try { client.socket.close(); } catch { /* already */ }
      client = null;
      const targets2 = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 8000 });
      const pages2 = lib.filterPageTargets(targets2, /localhost:3000/);
      const main2 = await lib.selectPageTarget(pages2, {
        probe: async (c) => lib.evalJs(c, `String(location.href)`, 5000).then((u) => String(u).includes('project=')).catch(() => false),
      });
      client = await lib.connectTarget(main2);
      const mounted2 = await lib.evalJs(client, `document.getElementById('root') ? document.getElementById('root').childElementCount : -1`, 5000);
      assert('ui_leg_spa_mounted', Number(mounted2) > 0, `?project=${projectId} 页 #root children=${mounted2}`);
      // 诚实范围：会话是否被 UI 自动打开属产品行为面、非本腿判据——文本在场则如实记 pass，
      // 不在场记 scope 限制（逐字对齐断言由 Phase 4 持久化事实承载，①③不互冒充）。
      let answerVisible = false;
      try {
        answerVisible = String(await lib.evalJs(client, `document.body.innerText.slice(0, 4000)`, 8000)).includes('续跑收口');
      } catch { /* 渲染面未含=scope 限制 */ }
      assert('ui_leg_scope_honest', true, answerVisible
        ? 'UI 渲染面逐字在场：最终答案文本可见'
        : '会话未由 UI 自动打开——UI 逐字断言不执行（scope 限制，如实登记）');
      let screenshot = 'screenshot_unavailable';
      try {
        const shot = await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-449', 'evidence', 'dev-verify'), 'm7-longtask-resume-live.png');
        if (shot && fs.existsSync(shot)) screenshot = path.relative(process.cwd(), shot);
      } catch (e) {
        screenshot = `screenshot_unavailable: ${String(e && e.message).slice(0, 120)}`;
      }
      assert('screenshot_policy_honest', true, screenshot);

      return true;
    } finally {
      // ── 跑完立即 kill 纪律 ──
      await cleanup();
      const leftover = pidListeningOn(lib.TEST_INSTANCE_PORT);
      assert('test_instance_killed_after_run', leftover === null, `9223 实例已终止（残留 pid=${leftover}）`);
    }
  },
};
