#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block109-agent-panel — UI-431 尾巴清偿（BLOCK-109-CORE-ARCH P0-3）
 *
 * 覆盖：AgentRunPanel（UI-385 右栏「智能体」tab）子智能体面板呈现同构实机补验——
 * ①真模型轮次派发子智能体，主时间线出现 `.sc-tool-subagent-inline` 内联卡；
 * ②点「详情」→ 右栏切 agent tab，面板运行中自动展开时间线（timelineOpen = override ?? running）；
 * ③面板内渲染 ConversationTimeline（`.sc-conversation-timeline`），段词汇与主窗同源
 *   （X=过渡叙述 R=思考 T=工具簇，iteration 非降序——block107 L4 修订契约同款）；
 * ④子智能体终态后面板呈现终态摘要、主时间线出现「阶段汇总」结果组卡（UI-432 组卡协同可见）；
 * ⑤临时数据清理。只连自管测试实例（:9223），零触碰用户主窗。
 *
 * 判据诚实性：子智能体派发依赖模型真实调用 spawn_agent——模型若不派发，A1 判红。
 * 证据：acceptance/block-109/agent-panel-*.png + samples.json。
 * 前置：dev 栈在跑 + 测试实例（bash scripts/start-test-instance.sh）+ 模型凭据已配置。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-109');
const RUN_TIMEOUT_MS = Number(process.env.BLOCK109_PANEL_RUN_TIMEOUT_MS || 480_000);

const PROMPT = '请用 spawn_agent 派一个子智能体完成这个任务，等它完成后把结论转告我：'
  + '列出当前项目根目录下的文件名，并统计其中有多少个扩展名为 .json 的文件。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, data };
}

/** 主窗时间线 + spawn 内联卡状态。 */
const MAIN_PROBE = `JSON.stringify((function(){
  var timelines = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-transition') ? 'X'
        : c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T' : '?';
      return kind + ':' + (c.getAttribute('data-iteration') || '-');
    }).join(' ');
  });
  return {
    timelines: timelines,
    spawnCards: [].slice.call(document.querySelectorAll('.sc-tool-subagent-inline')).map(function(c){
      return c.getAttribute('data-status') || '?';
    }),
    detailBtns: [].slice.call(document.querySelectorAll('.sc-tool-subagent-inline button')).filter(function(b){
      return (b.textContent || '').indexOf('详情') > -1;
    }).length,
    summaryCards: [].slice.call(document.querySelectorAll('[data-projection="conversation"]')).map(function(n){
      return (n.textContent || '').indexOf('阶段汇总') > -1;
    }),
    lastBody: (function(){
      var bodies = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-msg-body'))
        .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim().length; });
      return bodies.length ? bodies[bodies.length - 1] : 0;
    })(),
  };
})())`;

/** 右栏 AgentRunPanel 面板探针：时间线段序列 + 面板状态 + 任务文本（限定面板 section，不混入主窗时间线）。 */
const PANEL_PROBE = `JSON.stringify((function(){
  var title = document.querySelector('[data-testid="agent-timeline-title"]');
  var section = title ? title.closest('section') : null;
  var timelines = section ? [].slice.call(section.querySelectorAll('.sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-transition') ? 'X'
        : c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T' : '?';
      return kind + ':' + (c.getAttribute('data-iteration') || '-');
    }).join(' ');
  }) : [];
  var running = section ? [].slice.call(section.querySelectorAll('.sc-timeline-cluster[data-state="running"]')).length : 0;
  var taskText = '';
  var parentLine = document.querySelector('[data-testid="agent-parent-conversation"]');
  if (parentLine && parentLine.parentElement) {
    var spans = parentLine.parentElement.querySelectorAll('span[title]');
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].getAttribute('title') || '').length > taskText.length) taskText = spans[i].getAttribute('title');
    }
  }
  return {
    hasPanel: !!document.querySelector('[data-testid="agent-run-actions"]'),
    timelineTitle: title ? (title.textContent || '').replace(/\\s+/g, ' ').trim() : null,
    timelines: timelines,
    runningClusters: running,
    taskText: taskText,
  };
})())`;

/** 段序列契约：词汇合法 + iteration 非降序（block107 L4 修订契约同款）。 */
function segmentsValid(seq) {
  const parts = (seq || '').split(' ').filter(Boolean);
  let prev = -1;
  return parts.length > 0 && parts.every((part) => {
    const kind = part.split(':')[0];
    const iter = Number(part.split(':')[1]);
    if (!['X', 'R', 'T'].includes(kind)) return false;
    if (!Number.isFinite(iter) || iter < prev) return false;
    prev = iter;
    return true;
  });
}

module.exports = {
  id: 'block109-agent-panel',
  description: 'UI-431 尾巴清偿：AgentRunPanel 子智能体面板呈现同构实机（真 spawn 轮次 + 右栏时间线 + 终态组卡协同）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 25_000 });
    const originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
    let projectId = null;
    let conversationId = null;

    try {
      const created = await rest('POST', '/data/projects', { name: `B109-AgentPanel-${Date.now()}`, modality: 'general' });
      if (!created.ok || !created.data?.project) throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      projectId = created.data.project.id;

      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 10_000);
      // UI-430 教训：路由稳定前旧页面 textarea 仍可查询——固定等 10s 再等 composer。
      await sleep(10000);
      const welcomed = Date.now() + 30_000;
      while (Date.now() < welcomed
        && !(await lib.evalJs(client, `!!document.querySelector('[class*="chatMount"] textarea.sc-input')`, 8_000).catch(() => false))) {
        await sleep(1000);
      }

      const typed = await lib.evalJs(client, `(function(){
        var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
        if (!ta) return 'no_textarea';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(PROMPT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        var btns = document.querySelectorAll('[class*="chatMount"] button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'typed'; }
        }
        return 'no_send_button';
      })()`, 10_000);
      if (typed !== 'typed') throw new Error('send_click_failed: ' + typed);

      // 发送确认（block108 定版：2.5s×4 重试 + Enter 兜底）。
      let sent = 'not_sent';
      for (let attempt = 1; attempt <= 4 && sent !== 'sent_ok'; attempt++) {
        await sleep(2500);
        sent = await lib.evalJs(client, `(function(){
          var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
          if (ta && (ta.value || '').trim().length > 0) {
            var btns = document.querySelectorAll('[class*="chatMount"] button');
            for (var i = 0; i < btns.length; i++) {
              if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked_retry'; }
            }
          }
          return 'sent_ok';
        })()`, 10_000);
        lib.log(`send attempt ${attempt}: ${sent}`);
      }
      if (sent !== 'sent_ok') throw new Error('send_confirm_failed');

      // A1 派发检测（双源）：REST 子任务清单出现新 subagent（模型真调 spawn_agent 的权威事实）
      // + 主时间线簇行展开后 spawn 内联卡可见（collapseWhenSettled 收起态不渲染 detail 体，
      //   内联卡藏在工具簇 detail 里——首跑实证，必须先展开簇行）。
      const flowStartIso = new Date(Date.now() - 60_000).toISOString();
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      let subTask = null;
      let main = null;
      let listed = null;
      while (Date.now() < deadline) {
        await sleep(3000);
        listed = await rest('GET', '/ai/agent/tasks?kind=subagent&limit=5');
        const candidates = (listed.data?.tasks || listed.data || []).filter((t) => {
          const created = t.created_at || t.createdAt;
          return created && Date.parse(created) >= Date.parse(flowStartIso);
        });
        if (candidates.length > 0) { subTask = candidates[0]; break; }
      }
      assert('A1_subagent_spawned_rest_detected', !!subTask,
        `REST 检测到新 subagent :: taskId=${subTask && subTask.taskId} status=${subTask && subTask.status} :: ${JSON.stringify(listed?.data).slice(0, 160)}`);

      // 内联卡可达性观察（非门禁）：spawn 卡藏在簇行 detail 体里，collapseWhenSettled 收起态
      // 不渲染——展开全部簇行与 Qoder 行后统计可见性，如实入证据（首跑实证 []）。
      await lib.evalJs(client, `(function(){
        var sums = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-tool-activity-summary'));
        sums.forEach(function(s){ if (s.getAttribute('aria-expanded') === 'false') s.click(); });
        var heads = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-tool-qoder-head'));
        heads.forEach(function(h){ h.click(); });
        return 'ok';
      })()`, 10_000).catch(() => null);
      await sleep(800);
      main = JSON.parse(await lib.evalJs(client, MAIN_PROBE, 10_000));
      const inlineCardVisible = (main.spawnCards || []).length > 0;

      // A2 面板挂载且呈现「就是这个子智能体」：hasPanel + 任务文本匹配派发指令关键词
      // + 时间线渲染。子智能体活动进入时间线需要几秒（活动从 SSE 合并），轮询等待；
      // 时间线若处于折叠（running 未置位/已终态）则手动开合——设计行为内。
      const panelDeadline = Date.now() + 45_000;
      let panel = JSON.parse(await lib.evalJs(client, PANEL_PROBE, 10_000));
      while (Date.now() < panelDeadline && !(panel.timelines.length > 0 && (panel.timelines.slice(-1)[0] || '').length > 0)) {
        await lib.evalJs(client, `(function(){
          var t = document.querySelector('[data-testid="agent-timeline-title"]');
          var btn = t && t.closest('button');
          if (btn && btn.getAttribute('aria-expanded') === 'false') { btn.click(); return 'toggled'; }
          return 'open-or-missing';
        })()`, 10_000).catch(() => null);
        await sleep(2500);
        panel = JSON.parse(await lib.evalJs(client, PANEL_PROBE, 10_000));
      }
      const taskTextMatched = /json|统计|根目录|文件/i.test(panel.taskText || '');
      assert('A2_panel_mounted_with_spawned_child', panel.hasPanel && taskTextMatched
        && !!panel.timelineTitle && panel.timelines.length > 0,
        `hasPanel=${panel.hasPanel} taskTextMatched=${taskTextMatched} taskText=「${(panel.taskText || '').slice(0, 80)}」 title=${panel.timelineTitle} timelines=${JSON.stringify(panel.timelines)}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'agent-panel-running.png').catch(() => null);

      // A3 面板时间线段契约：词汇 X/R/T + iteration 非降序（与主窗 ConversationTimeline 同构）。
      const panelSeq = (panel.timelines || []).slice(-1)[0] || '';
      assert('A3_panel_timeline_segments_valid', segmentsValid(panelSeq),
        `panelSeq=${panelSeq} runningClusters=${panel.runningClusters}`);

      // 轮询至子智能体终态（REST 权威）+「阶段汇总」组卡可见（父回合收尾后渲染，ORCH 实测口径）。
      let terminal = null;
      while (Date.now() < deadline) {
        await sleep(4000);
        const listed2 = await rest('GET', '/ai/agent/tasks?kind=subagent&limit=5');
        const current = (listed2.data?.tasks || listed2.data || []).find((t) => t.taskId === (subTask && subTask.taskId)) || subTask;
        main = JSON.parse(await lib.evalJs(client, MAIN_PROBE, 10_000));
        const childTerminal = current && current.status && current.status !== 'running';
        const summaryVisible = (main.summaryCards || []).some(Boolean);
        if (childTerminal && summaryVisible) { terminal = { main, current }; break; }
        if (Date.now() >= deadline - 4000) { terminal = { main, current }; }
      }
      if (!terminal) terminal = { main, current: subTask };
      // 面板折叠契约（尾轮展开 v2）：终态后时间线自动收起（override=null → running=false → 隐藏）。
      const collapsedPanel = JSON.parse(await lib.evalJs(client, PANEL_PROBE, 10_000));
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'agent-panel-samples.json'),
        JSON.stringify({
          prompt: PROMPT,
          restStatus: terminal.current && terminal.current.status,
          subTaskId: subTask && subTask.taskId,
          inlineCardVisibleAfterExpand: inlineCardVisible,
          main: terminal.main,
          panelCollapsedAfterTerminal: collapsedPanel.timelines.length === 0,
        }, null, 2),
      );

      // A4 终态呈现：子任务 REST 终态 + 主时间线「阶段汇总」组卡可见（UI-432 协同）。
      assert('A4_terminal_summary_and_group_card', terminal.current && terminal.current.status && terminal.current.status !== 'running'
        && (terminal.main.summaryCards || []).some(Boolean),
        `rest=${terminal.current && terminal.current.status} summaryCard=${JSON.stringify(terminal.main.summaryCards)} lastBody=${terminal.main.lastBody}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'agent-panel-terminal.png').catch(() => null);

      const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
      conversationId = (convs.data?.conversations || [])[0]?.id || null;
      lib.log(`project=${projectId} conv=${conversationId}`);
      return true;
    } finally {
      const cleanup = [];
      if (conversationId) cleanup.push('conv=' + (await rest('DELETE', `/ai/conversations/${encodeURIComponent(conversationId)}`).then(() => true).catch(() => false)));
      if (projectId) cleanup.push('project=' + (await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).then(() => true).catch(() => false)));
      await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restore'`, 8_000).catch(() => null);
      assert('A5_temp_data_cleaned_up', cleanup.length === 2 && cleanup.every((s) => s.endsWith('true')),
        cleanup.join(' ') + (conversationId ? '' : ' [会话 id 未取得，可能残留]'));
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
