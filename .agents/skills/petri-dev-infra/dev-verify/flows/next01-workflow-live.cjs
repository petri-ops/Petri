#!/usr/bin/env node
'use strict';

/**
 * NEXT-01 实机腿：隔离后端 :3011（PETRI_WORKFLOW_ENABLED=1）+ 9223 测试实例。
 * 验证：dryRun 零执行、真实无代理工作流 journal、workflow schedule 关联、
 * 工作流控制面列表/预算/步骤展示。取消/恢复由 Node 契约测试覆盖。
 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT01_API || 'http://127.0.0.1:3011';

const SCRIPT = `export const meta = { name: 'next01-live', version: 1, budget: { maxAgents: 2, maxSteps: 4 }, concurrency: 1 };
export default async function run() {
  await phase('prepare', async () => { log('next01 live probe'); });
  return { ok: true };
}`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 15_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 400, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var dismissed = [];
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var text = (btns[i].textContent || '').trim();
      if (text === '开始使用' || text === '知道了') { btns[i].click(); dismissed.push(text); }
    }
    return dismissed.length ? dismissed.join(',') : 'none';
  })()`).catch(() => 'none');
  if (clicked !== 'none') await sleep(600);
  return clicked;
}

async function openWorkflowPanel(client) {
  return evalJsWithTimeout(client, `(function(){
    var panel = document.querySelector('[data-testid="workflow-runs-panel"]');
    if (panel) {
      var r = panel.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return 'visible';
    }
    var expand = document.querySelector('[aria-label="展开右侧栏"]');
    if (expand) expand.click();
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').indexOf('工作流') >= 0) { btns[i].click(); return 'clicked'; }
    }
    return 'missing';
  })()`).catch(() => 'missing');
}

async function panelState(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    var panel = document.querySelector('[data-testid="workflow-runs-panel"]');
    if (!panel) return JSON.stringify({ present: false });
    var items = Array.prototype.slice.call(panel.querySelectorAll('[data-testid="workflow-run-item"]'));
    return JSON.stringify({
      present: true,
      state: panel.getAttribute('data-state'),
      items: items.map(function(el){ return { id: el.getAttribute('data-run-id'), text: (el.textContent || '').slice(0, 160) }; }),
      selectedStatus: panel.querySelector('[data-testid="workflow-selected-status"]')?.textContent || null,
      detail: (panel.querySelector('[data-testid="workflow-run-detail"]')?.textContent || '').slice(0, 800),
      journal: panel.querySelectorAll('[data-testid="workflow-journal-row"]').length,
      rect: (function(r){ return { width: r.width, height: r.height }; })(panel.getBoundingClientRect()),
    });
  })()`).catch(() => '{}');
  return JSON.parse(raw || '{}');
}

async function run({ assert }) {
  let projectId = null;
  let scheduleId = null;
  let client = null;
  try {
    const project = await rest('POST', '/data/projects', { name: `NEXT-01-工作流-${Date.now()}` });
    projectId = project.data?.project?.id || null;
    assert('W0_temp_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 240));

    const dry = await rest('POST', '/ai/agent/workflow/run', { script: SCRIPT, dryRun: true });
    assert('W1_dry_run_zero_execution', dry.status === 200 && dry.data?.dryRun === true && dry.data?.estimate?.budget?.maxAgents === 2,
      JSON.stringify(dry.data).slice(0, 300));

    const started = await rest('POST', '/ai/agent/workflow/run', { script: SCRIPT, args: { probe: 'live' } });
    const runId = started.data?.runId || null;
    assert('W2_workflow_started', started.status === 202 && Boolean(runId), JSON.stringify(started.data).slice(0, 240));

    const detail = await poll(async () => {
      const response = await rest('GET', `/ai/agent/workflow/runs/${encodeURIComponent(runId)}`);
      return response.status === 200 && response.data?.run?.status === 'completed' ? response.data : null;
    }, { timeoutMs: 20_000, intervalMs: 300, label: 'workflow_completed' }).catch(() => null);
    assert('W3_workflow_journal_completed',
      Boolean(detail) && Array.isArray(detail.journalTail) && detail.journalTail.some((line) => line.kind === 'phase'),
      detail ? `status=${detail.run.status} journal=${detail.journalTail.length}` : 'not_completed');

    const schedule = await rest('POST', '/schedules', {
      projectId,
      title: 'NEXT-01 workflow schedule',
      kind: 'workflow',
      workflowScript: SCRIPT,
      workflowArgs: { scheduled: true },
      intervalMinutes: 60,
    });
    scheduleId = schedule.data?.schedule?.id || null;
    assert('W4_workflow_schedule_created',
      schedule.status === 200 && Boolean(scheduleId) && schedule.data?.schedule?.hasWorkflowScript === true
        && schedule.data?.schedule?.workflow_script === undefined,
      JSON.stringify(schedule.data).slice(0, 300));
    const ran = await rest('POST', `/schedules/${encodeURIComponent(scheduleId)}/run`);
    assert('W5_workflow_schedule_started', ran.status === 200 && ran.data?.result?.workflowRunId, JSON.stringify(ran.data).slice(0, 300));

    const reconciled = await poll(async () => {
      const snapshot = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      const row = snapshot.data?.runs?.find((run) => run.schedule_id === scheduleId);
      return row && row.workflow_run_id ? row : null;
    }, { timeoutMs: 25_000, intervalMs: 700, label: 'schedule_workflow_reconciled' }).catch(() => null);
    assert('W6_schedule_run_links_workflow',
      Boolean(reconciled) && (reconciled.status === 'completed' || reconciled.status === 'running'),
      JSON.stringify(reconciled || null).slice(0, 300));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJsWithTimeout(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'workflow', surfaceId: 'workflow' }], activeId: 'workflow' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'navigating';
    })()`);
    await poll(async () => {
      const pathname = await evalJsWithTimeout(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' });
    await dismissFirstRun(client);
    await poll(async () => {
      const ready = await evalJsWithTimeout(client, `!!document.querySelector('.sc-input')`).catch(() => false);
      return ready === true ? true : null;
    }, { timeoutMs: 40_000, intervalMs: 600, label: 'workspace_ready' }).catch(() => null);

    await openWorkflowPanel(client);
    const state = await poll(async () => {
      const current = await panelState(client);
      return current.present ? current : null;
    }, { timeoutMs: 30_000, intervalMs: 600, label: 'workflow_panel' }).catch(() => ({}));
    assert('W7_workflow_panel_visible', state.present === true && state.rect?.width > 0 && state.rect?.height > 0,
      JSON.stringify(state).slice(0, 400));
    assert('W8_workflow_run_listed', Array.isArray(state.items) && state.items.some((item) => item.id === runId),
      JSON.stringify(state.items || []).slice(0, 400));
    assert('W9_detail_budget_and_journal',
      String(state.detail || '').includes('2 agents · 4 steps') && Number(state.journal) >= 2,
      `journal=${state.journal} detail=${String(state.detail || '').slice(0, 300)}`);
    assert('W10_completed_status_projection',
      state.selectedStatus === '已完成' || (state.items || []).some((item) => item.id === runId && item.text.includes('已完成')),
      `selected=${state.selectedStatus}`);
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (scheduleId) await rest('DELETE', `/schedules/${encodeURIComponent(scheduleId)}`).catch(() => null);
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next01-workflow-live',
  description: 'NEXT-01 workflow dryRun/真实 journal/schedule 关联/控制面实机',
  evidenceDir: path.join(ROOT, 'acceptance', 'next-01-q4b-rem'),
  run,
};
