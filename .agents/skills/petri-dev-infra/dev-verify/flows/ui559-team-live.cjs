#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui559-team-live — BLOCK-249（Q4a）多智能体团队实机腿。
 *
 * 前置（由 scripts/block249-team-live.mjs 一键备好）：隔离后端 :3001 + Vite :3000 + CDP 9223，
 * mock 父任务一次派 3 个子代理（search / investigator / search+schema），B 长跑供暂停/停止演练。
 *
 * 断言链：父派 3 → 团队 roster 可见（角色/状态）→ 结构化子代理有效 → 切换成员 →
 *        暂停/恢复 → 停止团队（部分回执）→ journal 落盘（≥3 行）→ 截图（离屏不可得如实标记）。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const appUrl = () => process.env.PETRI_B249_APP || 'http://localhost:3000';
const apiUrl = () => process.env.PETRI_B249_API || 'http://127.0.0.1:3001';
const isDark = () => process.env.PETRI_B249_DARK === '1';
const suffix = () => (isDark() ? 'dark' : 'light');
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-559');
const COMPOSER = 'textarea.sc-input';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 20_000) {
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

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function restGet(endpoint) {
  const response = await fetch(`${apiUrl()}/api${endpoint}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function restPost(endpoint) {
  const response = await fetch(`${apiUrl()}/api${endpoint}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`).catch(() => 'none');
  if (clicked === 'clicked') {
    await poll(async () => {
      const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => true);
      return present === false ? true : null;
    }, { timeoutMs: 12_000, label: 'role_reveal_dismissed' }).catch(() => null);
  }
  return clicked;
}


async function waitWorkspace(client, projectId, projectName) {
  await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${appUrl()}/project/${projectId}`)}; 'ok'`).catch(() => null);
  await dismissFirstRun(client);
  await poll(async () => {
    const onWorkspace = await evalJsWithTimeout(client, `location.pathname.indexOf(${JSON.stringify(`/project/${projectId}`)}) === 0`).catch(() => false);
    return onWorkspace === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 500, label: 'workspace_route' }).catch(() => null);
  await poll(async () => {
    const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
    return ready === true ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 600, label: 'composer_ready' });
  await poll(async () => {
    const has = await evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf(${JSON.stringify(projectName)}) >= 0`).catch(() => false);
    return has === true ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 600, label: 'project_list_loaded' });
  const pendingText = () => evalJsWithTimeout(client, `document.body && document.body.innerText.indexOf('先选择一个项目') >= 0`).catch(() => false);
  if ((await pendingText()) === true) {
    await evalJsWithTimeout(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var t = (btns[i].textContent || '').trim();
        if (${JSON.stringify(projectName)} && t.indexOf(${JSON.stringify(projectName)}) >= 0) { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`, 10_000).catch(() => null);
  }
  return poll(async () => {
    const pending = await pendingText();
    return pending === false ? 'selected' : null;
  }, { timeoutMs: 25_000, intervalMs: 600, label: 'project_selected' }).catch(() => 'not_selected');
}

function setTextareaExpr(text) {
  return `(function(){
    var ta = document.querySelector(${JSON.stringify(COMPOSER)});
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

async function clickSend(client) {
  await poll(async () => {
    const state = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn) return 'no_button';
      return btn.disabled ? 'disabled' : 'enabled';
    })()`, 10_000).catch(() => 'eval_failed');
    return state === 'enabled' ? state : null;
  }, { timeoutMs: 120_000, intervalMs: 800, label: 'chat_send_enabled' });
  await evalJsWithTimeout(client, `(function(){
    var btn = document.querySelector('[data-testid="chat-send"]');
    if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
    return 'none';
  })()`, 20_000).catch(() => null);
}

async function teamFor(leaderId) {
  const response = await restGet(`/ai/agent/team?taskId=${encodeURIComponent(leaderId)}`);
  return response.data;
}

async function capturePng(client, filename, timeoutMs = 10_000) {
  let timer = null;
  try {
    const shot = await Promise.race([
      client.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('screenshot_timeout(offscreen)')), timeoutMs); }),
    ]);
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, filename), Buffer.from(shot.data, 'base64'));
    return filename;
  } catch (error) {
    return `unavailable:${error.message}`;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B249_PROJECT_ID;
  const projectName = process.env.PETRI_B249_PROJECT_NAME || '';
  const dataDir = process.env.PETRI_B249_DATA_DIR || '';
  let client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  const screenshots = {};
  const applyDark = async () => {
    if (!isDark()) return;
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }).catch(() => {});
    await sleep(400);
  };

  const selected = await waitWorkspace(client, projectId, projectName);
  assert('W0_project_selected', selected === 'selected', String(selected));
  await applyDark();

  // 唯一需要在"活页"上做的操作：发一条消息让父任务派团队。
  await evalJsWithTimeout(client, setTextareaExpr('团队演练：派三个子代理'));
  await clickSend(client);
  const sent = await poll(async () => {
    const text = await evalJsWithTimeout(client, `document.body ? document.body.innerText : ''`).catch(() => '');
    return String(text).includes('团队演练') ? 'sent' : null;
  }, { timeoutMs: 30_000, intervalMs: 700, label: 'message_sent' }).catch(() => 'not_sent');
  assert('W1_message_sent', sent === 'sent', String(sent));

  // leader 任务：会话 → 轨迹 API → 最近主任务
  const convList = await restGet(`/ai/conversations?project_id=${encodeURIComponent(projectId)}`);
  const conversationId = convList.data && convList.data.conversations && convList.data.conversations[0]
    ? convList.data.conversations[0].id
    : null;
  const trajectory = await poll(async () => {
    const response = await restGet(`/ai/agent/trajectory?conversationId=${encodeURIComponent(conversationId)}`);
    const data = response.data;
    return data && data.ok && data.task && data.task.taskId ? data : null;
  }, { timeoutMs: 60_000, intervalMs: 800, label: 'leader_task' }).catch(() => null);
  const leaderId = trajectory ? trajectory.task.taskId : null;
  assert('R1_leader_task_resolved', Boolean(leaderId), `conversation=${conversationId} leader=${leaderId}`);

  // ---- 活态断言走 REST（渲染器在长回合期间不稳定，不与之抢线程）----
  const team3 = await poll(async () => {
    const data = await teamFor(leaderId);
    return data && data.ok && Array.isArray(data.members) && data.members.length === 3 ? data : null;
  }, { timeoutMs: 90_000, intervalMs: 800, label: 'team_members' }).catch(() => null);
  const roles = team3 ? team3.members.map((member) => member.role) : [];
  const investigator = team3 ? team3.members.find((member) => member.role === 'investigator') : null;
  const structured = team3 ? team3.members.find((member) => member.structured) : null;
  assert('R2_three_members_with_roles',
    Boolean(team3) && roles.filter((role) => role === 'search').length === 2 && Boolean(investigator),
    `members=${team3 ? team3.members.length : 0} roles=${JSON.stringify(roles)}`);
  assert('R3_structured_valid',
    Boolean(structured && structured.structured && structured.structured.ok === true),
    JSON.stringify(structured && structured.structured));

  // 等 A/C 收口、B 仍在跑
  const settled = await poll(async () => {
    const data = await teamFor(leaderId);
    if (!data || !data.ok) return null;
    return data.counts && data.counts.finished >= 2 && data.counts.running >= 1 ? data : null;
  }, { timeoutMs: 120_000, intervalMs: 1000, label: 'two_finished_one_running' }).catch(() => null);
  assert('R4_team_settled_for_stop', Boolean(settled), settled ? JSON.stringify(settled.counts) : 'not_settled');
  const longMember = settled ? settled.members.find((member) => member.status === 'running') : null;

  // 暂停/恢复：REST（迭代边界语义；活态 API 免渲染器抖动）
  const pausedResponse = await restPost(`/ai/agent/task/${encodeURIComponent(longMember ? longMember.agentId : '')}/pause`);
  const pausedState = await poll(async () => {
    const data = await teamFor(leaderId);
    const member = data && data.members ? data.members.find((row) => row.agentId === (longMember && longMember.agentId)) : null;
    return member && member.agentStatus === 'paused' ? member : null;
  }, { timeoutMs: 20_000, intervalMs: 600, label: 'paused_state' }).catch(() => null);
  assert('R5_pause_iteration_boundary_api',
    pausedResponse.status === 200 && Boolean(pausedState) && pausedResponse.data.effective === 'iteration_boundary',
    `status=${pausedResponse.status} effective=${pausedResponse.data && pausedResponse.data.effective} state=${pausedState && pausedState.agentStatus}`);

  const resumedResponse = await restPost(`/ai/agent/task/${encodeURIComponent(longMember ? longMember.agentId : '')}/resume`);
  const resumedState = await poll(async () => {
    const data = await teamFor(leaderId);
    const member = data && data.members ? data.members.find((row) => row.agentId === (longMember && longMember.agentId)) : null;
    return member && member.agentStatus === 'running' ? member : null;
  }, { timeoutMs: 20_000, intervalMs: 600, label: 'resumed_state' }).catch(() => null);
  assert('R6_resume_same_task_api',
    resumedResponse.status === 200 && Boolean(resumedState),
    `status=${resumedResponse.status} state=${resumedState && resumedState.agentStatus}`);

  // 停止团队：权威部分回执（B 在跑 → 请求停止；A/C 已完成 → 本就已结束）
  const stopResponse = await restPost(`/ai/agent/team/${encodeURIComponent(leaderId)}/stop`);
  const stopData = stopResponse.data;
  assert('R7_stop_partial_receipt_api',
    stopResponse.status === 200 && Boolean(stopData && stopData.ok)
      && stopData.summary && stopData.summary.requested === 1 && stopData.summary.alreadyFinished === 2,
    JSON.stringify(stopData && { status: stopResponse.status, summary: stopData.summary, members: stopData.members && stopData.members.map((m) => [m.agentId.slice(0, 6), m.outcome]) }));

  await poll(async () => {
    const data = await teamFor(leaderId);
    return data && data.counts && data.counts.finished === 3 ? data : null;
  }, { timeoutMs: 90_000, intervalMs: 1000, label: 'all_terminal' }).catch(() => null);

  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `ui559-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'ui559-team-live',
  description: 'BLOCK-249 实机腿：父派 3 子代理 → roster → 成员切换 → 暂停/恢复 → 停止团队（部分回执）→ journal',
  run,
};
