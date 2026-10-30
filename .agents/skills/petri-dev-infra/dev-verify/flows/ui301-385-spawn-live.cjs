#!/usr/bin/env node
'use strict';

/**
 * UI-301 / UI-385 代行验收 — 纯 spawn 流的真实 UI 落点（2026-10-30）。
 *
 * 背景：这两条此前归 c 档「面板视觉离屏不可达」。代码核查确认旧清单路线写错
 * （dock 里没有列表），真实落点是：
 *   UI-301 活动条 = 对话时间线「已派发 · <任务首行>」折叠行（+ 项目卡智能体图标带）
 *   UI-385 详情   = 右栏「智能体」tab 的 AgentRunPanel（派发行详情 / chip 进入）
 *   UI-501 编排图 = dock 自动弹出（纯 spawn 流直接出图；修复前是空壳）→ ⎇ 切换
 *
 * 本 flow 真跑一轮 spawn（2 个只回一句话的子代理），断言 DOM 落点。会真实调用
 * 模型（成本极小）；前置=dev 栈在跑 + 模型通道可用。9223 离屏实例，跑完由调用方终止。
 */

const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.UI301_API || 'http://127.0.0.1:3001';
const PROMPT = '并行派 2 个子代理，各自只回复一句话：子代理A 回复「A-OK」，子代理B 回复「B-OK」。必须用 spawn 并行派发，不要自己做。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function fillAndSend(client) {
  return lib.evalJs(client, `(() => {
    const ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    return 'filled';
  })()`, 15_000);
}

async function clickSend(client) {
  return lib.evalJs(client, `(() => {
    const btn = document.querySelector('[data-testid="chat-send"]');
    if (!btn) return 'no_btn';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  })()`, 15_000);
}

const STATE = `(() => {
  const q = (sel) => [...document.querySelectorAll(sel)];
  const txt = (e) => e ? (e.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  const dock = document.querySelector('[data-testid="tool-activity-dock"]');
  const graph = document.querySelector('[data-testid="orchestration-graph"]');
  return JSON.stringify({
    dock: !!dock,
    dockTitle: dock ? txt(dock.querySelector('[class*="title"]')) : '',
    graphNodes: graph ? q('[data-testid="orchestration-graph"] .react-flow__node').length : 0,
    agentPanel: !!document.querySelector('[data-testid="agent-parent-conversation"]')
      && !!document.querySelector('[data-testid="agent-run-actions"]'),
    agentTimeline: txt(document.querySelector('[data-testid="agent-timeline-title"]')),
    agentTaskText: txt(document.querySelector('[data-testid="agent-run-actions"]')?.closest('section')?.parentElement).slice(0, 160),
    clusterHeads: q('.sc-tool-qoder-head').length,
    dispatchRows: q('*').filter((e) => e.children.length === 0 && /^已派发$/.test(txt(e))).length
  });
})()`;

module.exports = {
  id: 'ui301-385-spawn-live',
  description: 'UI-301/385/501 代行验收：真实 spawn 一轮 → 时间线「已派发」行 + 右栏 AgentRunPanel + dock 编排图节点',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-301-385-spawn'),

  async run(ctx) {
    const { assert } = ctx;
    const detail = {};
    let projectId = null;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    try {
      const project = await rest('POST', '/data/projects', { name: `UI301-Spawn-${Date.now()}` });
      projectId = project.data?.project?.id || null;
      assert('project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));

      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}, 'nav'`, 15_000).catch(() => null);
      await sleep(5000);
      const filled = await fillAndSend(client);
      assert('prompt_filled', filled === 'filled', filled);
      const sent = await clickSend(client);
      assert('prompt_sent', sent === 'clicked', sent);

      let state = null;
      for (let i = 0; i < 60; i += 1) {
        await sleep(3000);
        state = JSON.parse(await lib.evalJs(client, STATE, 20_000));
        if (state.dock && state.graphNodes > 0 && state.agentPanel) break;
      }
      detail.initial = state;
      assert('dock_auto_opens_with_graph', state.dock === true && state.graphNodes > 0,
        `dock=${state.dock} nodes=${state.graphNodes} title=${state.dockTitle}`);
      assert('dock_title_matches_content', state.dockTitle !== '后台进程', `title=${state.dockTitle}`);
      assert('agent_panel_auto_opens', state.agentPanel === true, JSON.stringify(state).slice(0, 200));
      assert('agent_panel_has_task_and_timeline', state.agentTimeline.length > 0 && state.agentTaskText.length > 20,
        `timeline=${state.agentTimeline} task=${state.agentTaskText.slice(0, 80)}`);

      // UI-301：展开时间线簇 → 「已派发」折叠行（任务首行）
      await lib.evalJs(client, `(() => { [...document.querySelectorAll('.sc-tool-qoder-head')].forEach((h) => h.click()); return 'expanded'; })()`, 15_000);
      await sleep(1500);
      const expanded = JSON.parse(await lib.evalJs(client, STATE, 20_000));
      detail.expanded = expanded;
      assert('timeline_dispatch_rows', expanded.dispatchRows >= 1, `rows=${expanded.dispatchRows}`);

      await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-301-385-spawn'), 'spawn-dispatch.png');
      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
      if (projectId) {
        await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
      }
    }
  },
};
