#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q7-automation-live — BLOCK-256（Q7）实机腿。
 *
 * 覆盖：
 *   A0a backend_rest_healthy        隔离后端 REST 可达
 *   A0b app_page_ready              CDP 页面 root 就绪
 *   A0c seeded_snapshot             /api/automation 返回 goal/schedule/run/reminder
 *   A1 panel_content                自动化看板显示 schedule/goal/run
 *   A2 goal_pause_resume            goal 暂停/恢复（REST 对账）
 *   A3 schedule_toggle              启用/暂停（REST 对账）
 *   A4 create_schedule_form         看板新建 schedule（REST 对账）
 *   A5 run_now                      立即运行 → 运行记录出现（taskId 或失败如实）
 *   A6 reminder_notification        提醒进入通知中心（schedule_reminder）
 *   A7 composer_schedule_dialog     composer `/schedule` 对话框创建计划（REST 对账）
 *   A8 spa_clean                    收尾回 ?test=1
 *
 * 诚实边界：截图离屏 unavailable；立即运行不要求模型成功（只证执行链被真实触发，
 * 失败如实记录）；提醒由全局 bridge 写入通知中心后 ack。
 *
 * 前置：隔离栈由 scripts/block256-q7-automation-live.mjs 起（:3001/:3000/:9223 + 临时数据根）。
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, p) {
  const resp = await fetch(API + p, { method, headers: AUTH });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, {
    probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false),
  });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let index = 0; index < tries; index += 1) {
    try {
      const live = await ensureClient();
      return await lib.evalJs(live, expr, 8000);
    } catch (error) {
      lastErr = error;
      await sleep(600);
    }
  }
  throw lastErr;
}

async function navigate(url) {
  const withTimeout = (factory, ms) => Promise.race([
    factory(),
    new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('nav_timeout')), ms); }),
  ]);
  const live = await ensureClient();
  try {
    await withTimeout(() => live.send('Page.navigate', { url }), 6000);
  } catch {
    try {
      await withTimeout(
        () => lib.evalJs(live, `setTimeout(function(){ location.href = ${JSON.stringify(url)}; }, 0); 'navigating'`, 3000),
        5000,
      );
    } catch {
      activeClient = null;
    }
  }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const budget = Math.min(6000, Math.max(1200, deadline - Date.now()));
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => { setTimeout(() => resolve('poll_budget_exhausted'), budget); }),
    ]).catch((error) => `eval_err:${error.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(700);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

async function dismissFirstRun() {
  await evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="role-reveal-start"]');
    if (btn) { btn.click(); return 'dismissed'; }
    return 'absent';
  })()`).catch(() => 'ignore');
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

function clickButtonIn(selector, text) {
  return evalRetry(null, `(function(){
    var root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return 'no_root';
    var btn = [...root.querySelectorAll('button')].find(function(el){
      return (el.textContent || '').trim().indexOf(${JSON.stringify(text)}) >= 0; });
    if (!btn) return 'no_button';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'clicked';
  })()`);
}

async function clickButtonWhenEnabled(selector, text, timeoutMs = 12000) {
  return waitFor(async () => {
    const status = await clickButtonIn(selector, text);
    return status === 'clicked' ? status : null;
  }, timeoutMs, `enabled button ${text}`);
}

function setField(selector, value, type = 'input') {
  return evalRetry(null, `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'no_field';
    var proto = ${type === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'set';
  })()`);
}

module.exports = {
  id: 'q7-automation-live',
  description: 'BLOCK-256 Q7 实机：自动化看板 + goal 状态/预算 + 立即运行 + 提醒通知 + /schedule 对话框',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-256'),

  async run(ctx) {
    const { assert } = ctx;
    const projectId = ctx.projectId;
    const goalId = ctx.goalId;
    const scheduleId = ctx.scheduleId;
    let client = null;

    const health = await rest('GET', '/data/projects');
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    const snapshot = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
    const data = snapshot.data || {};
    assert('A0c_seeded_snapshot',
      snapshot.ok
      && Array.isArray(data.schedules) && data.schedules.some((row) => row.id === scheduleId)
      && Array.isArray(data.goals) && data.goals.some((row) => row.id === goalId)
      && Array.isArray(data.runs) && data.runs.length >= 1,
      JSON.stringify({ schedules: data.schedules && data.schedules.length, goals: data.goals && data.goals.length, runs: data.runs && data.runs.length }).slice(0, 300));

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}/scheduled`);
    await dismissFirstRun();
    await pagePoll(client, `String(!!document.querySelector('[data-testid="automation-panel"]'))`, {
      label: 'automation panel', timeoutMs: 30000,
    });
    assert('A1_panel_content',
      await evalRetry(null, `String(!!(document.querySelector('[data-testid="automation-schedule-${scheduleId}"]') && document.querySelector('[data-testid="automation-goal-${goalId}"]')))`) === 'true',
      'schedule/goal 卡片在场');
    const panelText = await evalRetry(null, `(document.querySelector('[data-testid="automation-panel"]')||{}).textContent || ''`);
    assert('A1b_goal_budget_visible',
      panelText.indexOf('820') >= 0 && panelText.indexOf('1000') >= 0 && panelText.indexOf('接近预算') >= 0,
      panelText.slice(0, 500));

    const pauseGoal = await clickButtonIn(`[data-testid="automation-goal-${goalId}"]`, '暂停');
    assert('A2_goal_pause_clicked', pauseGoal === 'clicked', pauseGoal);
    const paused = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      const goal = resp.data && resp.data.goals && resp.data.goals.find((row) => row.id === goalId);
      return goal && goal.status === 'paused' ? goal : null;
    }, 15000, 'goal paused');
    assert('A2b_goal_paused', paused.status === 'paused', paused.status);
    await pagePoll(client, `String(((document.querySelector('[data-testid="automation-goal-${goalId}"]')||{}).textContent||'').indexOf('恢复')>=0)`, { label: 'goal resume button', timeoutMs: 15000 });
    const resumeClick = await clickButtonWhenEnabled(`[data-testid="automation-goal-${goalId}"]`, '恢复');
    assert('A2c_goal_resume_clicked', resumeClick === 'clicked', resumeClick);
    const resumed = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      const goal = resp.data && resp.data.goals && resp.data.goals.find((row) => row.id === goalId);
      return goal && goal.status === 'active' ? goal : null;
    }, 15000, 'goal resumed');
    assert('A2d_goal_resumed', resumed.status === 'active', resumed.status);

    const toggle = await clickButtonWhenEnabled(`[data-testid="automation-schedule-${scheduleId}"]`, '暂停');
    assert('A3_schedule_toggle_clicked', toggle === 'clicked', toggle);
    const disabled = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      const schedule = resp.data && resp.data.schedules && resp.data.schedules.find((row) => row.id === scheduleId);
      return schedule && schedule.enabled === false ? schedule : null;
    }, 15000, 'schedule disabled');
    assert('A3b_schedule_disabled', disabled.enabled === false, String(disabled.enabled));
    await pagePoll(client, `String(((document.querySelector('[data-testid="automation-schedule-${scheduleId}"]')||{}).textContent||'').indexOf('启用')>=0)`, { label: 'schedule enable button', timeoutMs: 15000 });
    const enableClick = await clickButtonWhenEnabled(`[data-testid="automation-schedule-${scheduleId}"]`, '启用');
    assert('A3c_schedule_enable_clicked', enableClick === 'clicked', enableClick);

    const openForm = await clickButtonWhenEnabled('[data-testid="automation-panel"]', '新建');
    assert('A4_new_form_open', openForm === 'clicked', openForm);
    await pagePoll(client, `String(document.querySelector('input[placeholder="例如：每日质控汇总"]'))`, { label: 'new title input', timeoutMs: 10000 });
    await setField('input[placeholder="例如：每日质控汇总"]', 'BLOCK256 看板新建');
    await setField('textarea[placeholder="到点后交给 agent 的完整指令"]', '汇总今日质控并给出结论', 'textarea');
    await clickButtonWhenEnabled('[data-testid="automation-panel"]', '创建');
    const created = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      return resp.data && resp.data.schedules && resp.data.schedules.find((row) => row.title === 'BLOCK256 看板新建') ? true : null;
    }, 15000, 'schedule created');
    assert('A4b_schedule_created', created === true, 'REST 可见新计划');

    const runNow = await clickButtonWhenEnabled(`[data-testid="automation-schedule-${scheduleId}"]`, '立即运行');
    assert('A5_run_now_clicked', runNow === 'clicked', runNow);
    const runRecord = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      return resp.data && resp.data.runs && resp.data.runs.find((row) => row.schedule_id === scheduleId) ? true : null;
    }, 30000, 'new run record');
    assert('A5b_run_recorded', runRecord === true, '运行记录已落库（模型成败不伪造）');

    await pagePoll(client, `String(!!document.querySelector('[data-testid="notification-center-bell"]'))`, { label: 'notification bell', timeoutMs: 15000 });
    const notice = await waitFor(async () => {
      const pushed = await evalRetry(null, `(function(){
        var badge = document.querySelector('[data-testid="notification-center-unread"]');
        return badge ? badge.textContent : '';
      })()`);
      if (!pushed) return null;
      await evalRetry(null, `(document.querySelector('[data-testid="notification-center-bell"]')||{}).click()`);
      await sleep(300);
      const text = await evalRetry(null, `(document.querySelector('[data-testid="notification-center-panel"]')||{}).textContent || ''`);
      return text.indexOf('计划提醒') >= 0 && text.indexOf('记得看质控') >= 0 ? text : null;
    }, 35000, 'schedule reminder notice');
    assert('A6_reminder_notification', Boolean(notice), notice ? notice.slice(0, 300) : 'no notice');

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}`);
    await dismissFirstRun();
    await pagePoll(client, `String(!!document.querySelector('.sc-composer textarea'))`, { label: 'composer textarea', timeoutMs: 30000 });
    await evalRetry(null, `(function(){
      var ta = document.querySelector('.sc-composer textarea');
      if (!ta) return 'no_ta';
      ta.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '/定时');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    const slashClicked = await waitFor(async () => {
      const clicked = await evalRetry(null, `(function(){
        var btn = [...document.querySelectorAll('button')].find(function(el){
          return (el.textContent || '').trim().indexOf('定时任务') >= 0; });
        if (!btn) return '';
        btn.click();
        return 'clicked';
      })()`);
      return clicked === 'clicked' ? 'clicked' : null;
    }, 15000, 'slash schedule entry');
    assert('A7_slash_entry', slashClicked === 'clicked', slashClicked);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="schedule-dialog"]'))`, { label: 'schedule dialog', timeoutMs: 10000 });
    await setField('[data-testid="schedule-dialog"] input', 'BLOCK256 composer 计划');
    await setField('[data-testid="schedule-dialog"] input[type="number"]', '90');
    await setField('[data-testid="schedule-dialog-prompt"]', '汇总今天的质控结果并给出结论', 'textarea');
    await evalRetry(null, `(function(){
      var btn = document.querySelector('[data-testid="schedule-dialog-submit"]');
      if (!btn) return 'no_submit';
      btn.click();
      return 'submitted';
    })()`);
    const composerCreated = await waitFor(async () => {
      const resp = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      return resp.data && resp.data.schedules && resp.data.schedules.find((row) => row.title === 'BLOCK256 composer 计划') ? true : null;
    }, 15000, 'composer schedule created');
    assert('A7b_composer_schedule_created', composerCreated === true, 'REST 可见 composer 创建的计划');

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A8_spa_clean', true, '收尾回 ?test=1');
  },
};
