#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block226-notification-center-live — BLOCK-226 实机腿（UI-539）
 *
 * REST＝真后端：quietHours 归一/落盘。
 * DOM＝9223 离屏测试实例：铃铛空态 → 本地通知列表/未读徽章 → 全部已读 → 亮/暗截图；
 * 设置页免打扰输入在场；主进程通知门在免打扰窗口返回 quiet_hours。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-226');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await lib.evalJs(client, expr);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

module.exports = {
  id: 'block226-notification-center-live',
  description: 'BLOCK-226 实机腿：通知中心空态/列表/未读/全部已读 + 免打扰门 + 设置输入（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const reset = await rest('PUT', '/user/prefs', { quietHours: '', autoModel: false });
    assert('R1_prefs_reset', reset.ok && reset.data?.prefs?.quietHours === '', JSON.stringify(reset.data?.prefs));

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      // 清掉上一轮残留并重载，保证空态断言确定。
      await lib.evalJs(client, `localStorage.removeItem('petri:notification-center:v1'); location.reload(); 'ok'`);
      const bellReady = await waitFor(client, `!!document.querySelector('[data-testid="notification-center-bell"]')`, 30_000);
      assert('D1_bell_present', bellReady === true, '标题栏应有通知中心铃铛');

      await lib.evalJs(client, `document.querySelector('[data-testid="notification-center-bell"]').click(); 'ok'`);
      const empty = await waitFor(
        client,
        `(function(){
          const panel = document.querySelector('[data-testid="notification-center-panel"]');
          return panel ? panel.textContent : null;
        })()`
      );
      assert('D2_empty_state', typeof empty === 'string' && empty.includes('暂无通知'), String(empty));

      // 本地 seed 两条通知后重载（store 在模块加载时读取 localStorage）
      await lib.evalJs(
        client,
        `(function(){
          const now = new Date().toISOString();
          localStorage.setItem('petri:notification-center:v1', JSON.stringify([
            { id: 'n_live_1', kind: 'turn_completed', title: '本轮完成', body: '对话已完成', conversationId: 'conv-live', projectId: 'proj-live', createdAt: now, read: false },
            { id: 'n_live_2', kind: 'approval_required', title: '需要确认', body: '工具 workspace_exec 正在等待授权', conversationId: 'conv-live', projectId: 'proj-live', createdAt: now, read: false }
          ]));
          location.reload();
          return 'ok';
        })()`
      );
      const reloaded = await waitFor(client, `!!document.querySelector('[data-testid="notification-center-bell"]')`, 30_000);
      assert('D3_reloaded_with_seeded_notices', reloaded === true, 'reload 后铃铛应仍在');
      await lib.evalJs(client, `document.querySelector('[data-testid="notification-center-bell"]').click(); 'ok'`);
      const seeded = await waitFor(
        client,
        `(function(){
          const panel = document.querySelector('[data-testid="notification-center-panel"]');
          if (!panel) return null;
          return {
            items: document.querySelectorAll('[data-testid="notification-center-item"]').length,
            dots: document.querySelectorAll('[data-testid="notification-center-dot"]').length,
            badge: document.querySelector('[data-testid="notification-center-unread"]')?.textContent || '',
            text: panel.innerText.slice(0, 300),
          };
        })()`
      );
      assert(
        'D4_seeded_list_and_unread',
        seeded && seeded.items === 2 && seeded.dots === 2 && seeded.badge === '2',
        JSON.stringify(seeded)
      );
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui539-notification-center.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui539-notification-center-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D5_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      await lib.evalJs(
        client,
        `(function(){
          const panel = document.querySelector('[data-testid="notification-center-panel"]');
          const btn = panel && [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === '全部已读');
          if (btn) btn.click();
          return 'ok';
        })()`
      );
      const readState = await waitFor(
        client,
        `(function(){
          return {
            dots: document.querySelectorAll('[data-testid="notification-center-dot"]').length,
            badge: document.querySelector('[data-testid="notification-center-unread"]'),
          };
        })()`
      );
      assert(
        'D6_mark_all_read',
        readState && readState.dots === 0 && readState.badge === null,
        JSON.stringify(readState)
      );
      await lib.evalJs(client, `document.querySelector('[data-testid="notification-center-bell"]')?.click(); 'ok'`);

      // 免打扰门：全天窗口 → 主进程返回 quiet_hours
      const quiet = await rest('PUT', '/user/prefs', { quietHours: '00:00-23:59' });
      assert('D7_quiet_pref_saved', quiet.ok && quiet.data?.prefs?.quietHours === '00:00-23:59', JSON.stringify(quiet.data?.prefs));
      await lib.evalJs(client, `window.petriDesktop.app.setShellPrefs({ closeToTray: false, notifyOnTurnEnd: true, quietHours: '00:00-23:59' }); 'ok'`);
      const notify = await lib.evalJs(
        client,
        `window.petriDesktop.app.notify({ kind: 'turn_completed', conversationId: 'probe-block226' })`
      );
      assert('D8_quiet_hours_gate', notify?.shown === false && notify?.reason === 'quiet_hours', JSON.stringify(notify));
      await rest('PUT', '/user/prefs', { quietHours: '' });
      await lib.evalJs(client, `window.petriDesktop.app.setShellPrefs({ closeToTray: false, notifyOnTurnEnd: true, quietHours: '' }); 'ok'`);

      // 设置页免打扰输入
      await lib.evalJs(client, `location.href = '${APP}/settings?section=general'; 'ok'`);
      const onSettings = await waitFor(
        client,
        `!!document.querySelector('input[aria-label="免打扰时段"]')`,
        30_000
      );
      assert('D9_settings_quiet_input_present', onSettings === true, '设置页应有免打扰输入');
      const shotSettings = await lib.screenshotPng(client, EVIDENCE, 'ui539-quiet-hours-setting.png');
      assert('D10_settings_screenshot', Boolean(shotSettings), shotSettings);
    } finally {
      try { await rest('PUT', '/user/prefs', { quietHours: '' }); } catch {}
      try { await lib.evalJs(client, `localStorage.removeItem('petri:notification-center:v1'); 'ok'`); } catch {}
    }
  },
};
