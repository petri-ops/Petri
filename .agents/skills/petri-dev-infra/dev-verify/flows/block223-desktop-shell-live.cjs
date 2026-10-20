#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block223-desktop-shell-live — BLOCK-223 Q9 续项实机腿（UI-536）
 *
 * REST 腿＝真后端 :3001：activity-summary 形状/求和。
 * DOM 腿＝9223 离屏测试实例：外壳状态默认值、终端会话合并、托盘创建/销毁、
 *   通知门（测试实例模拟/去重/偏好关）、退出摘要预览弹窗（两行计数 → 取消清除）。
 *
 * 无可见窗口纪律：只连 9223 离屏实例；预览弹窗走同一渲染进程但不 show 窗口。
 * 真实 OS toast 不在本腿断言范围（测试实例返回 simulated_test_instance，如实登记）。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-223');

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
  id: 'block223-desktop-shell-live',
  description: 'BLOCK-223 Q9 续项实机腿：activity-summary + 托盘状态 + 通知门/去重 + 退出摘要预览（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    // ── REST：活动摘要 ─────────────────────────────────────────
    const summary = await rest('GET', '/app/activity-summary');
    assert(
      'R1_activity_summary_shape',
      summary.ok && summary.data?.ok === true && typeof summary.data?.total === 'number',
      JSON.stringify(summary.data)
    );
    const counts = summary.data?.counts || {};
    const requiredKeys = [
      'toolJobsRunning',
      'toolJobsPending',
      'approvalsPending',
      'primaryTasks',
      'subagentTasks',
      'backgroundProcesses',
    ];
    assert(
      'R2_activity_summary_six_sources',
      requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(counts, key)),
      Object.keys(counts).join(',')
    );
    assert(
      'R3_activity_summary_total_is_sum',
      Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0) === summary.data.total,
      `total=${summary.data?.total}`
    );

    // ── DOM：9223 离屏测试实例 ────────────────────────────────
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const status = await lib.evalJs(client, 'window.petriDesktop.app.getShellStatus()');
      assert(
        'D1_shell_status_defaults',
        status?.ok === true
          && status.closeToTray === false
          && status.notifyOnTurnEnd === true
          && status.testInstance === true,
        JSON.stringify(status)
      );

      const merged = await lib.evalJs(client, 'window.petriDesktop.app.getActivitySummary()');
      assert(
        'D2_summary_merges_terminal_sessions',
        merged?.ok === true && typeof merged?.counts?.terminalSessions === 'number',
        JSON.stringify(merged?.counts)
      );

      const setTray = await lib.evalJs(
        client,
        'window.petriDesktop.app.setShellPrefs({ closeToTray: true })'
      );
      const trayStatus = await lib.evalJs(client, 'window.petriDesktop.app.getShellStatus()');
      assert(
        'D3_tray_created_when_close_to_tray',
        setTray?.ok === true && trayStatus?.trayActive === true,
        JSON.stringify({ setTray, trayActive: trayStatus?.trayActive })
      );

      const notify1 = await lib.evalJs(
        client,
        `window.petriDesktop.app.notify({ kind: 'turn_completed', conversationId: 'probe-block223' })`
      );
      const expectedReason = trayStatus?.notificationsSupported ? 'simulated_test_instance' : 'unsupported';
      assert(
        'D4_notify_gate_honest',
        notify1?.shown === false && notify1?.reason === expectedReason,
        JSON.stringify({ notify1, supported: trayStatus?.notificationsSupported })
      );

      const notify2 = await lib.evalJs(
        client,
        `window.petriDesktop.app.notify({ kind: 'turn_completed', conversationId: 'probe-block223' })`
      );
      assert('D5_notify_deduped_within_3s', notify2?.reason === 'duplicate', JSON.stringify(notify2));

      await lib.evalJs(client, 'window.petriDesktop.app.setShellPrefs({ notifyOnTurnEnd: false })');
      const notifyOff = await lib.evalJs(
        client,
        `window.petriDesktop.app.notify({ kind: 'turn_failed', conversationId: 'probe-block223-off' })`
      );
      assert('D6_notify_pref_off', notifyOff?.reason === 'pref_off', JSON.stringify(notifyOff));
      await lib.evalJs(client, 'window.petriDesktop.app.setShellPrefs({ notifyOnTurnEnd: true })');

      const preview = await lib.evalJs(client, 'window.petriDesktop.app.previewQuitSummary()');
      const dialog = await waitFor(
        client,
        `(function(){
          const d = document.querySelector('[data-testid="quit-summary-dialog"]');
          if (!d) return null;
          return {
            rows: document.querySelectorAll('[data-testid="quit-summary-rows"] li').length,
            preview: !!document.querySelector('[data-testid="quit-summary-preview"]'),
            title: d.querySelector('h2')?.textContent || '',
          };
        })()`
      );
      assert(
        'D7_preview_dialog_visible',
        preview?.ok === true && dialog && dialog.rows === 2 && dialog.preview === true,
        JSON.stringify({ preview, dialog })
      );
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui536-quit-summary.png');
      assert('D8_preview_dialog_screenshot', Boolean(shot), shot);
      const lightCardBg = await lib.evalJs(
        client,
        `(function(){
          const card = document.querySelector('[data-testid="quit-summary-dialog"] > div');
          return card ? getComputedStyle(card).backgroundColor : null;
        })()`
      );

      const clicked = await lib.evalJs(
        client,
        `(function(){
          const d = document.querySelector('[data-testid="quit-summary-dialog"]');
          if (!d) return false;
          const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
          if (!btn) return false;
          btn.click();
          return true;
        })()`
      );
      const gone = await waitFor(
        client,
        `!document.querySelector('[data-testid="quit-summary-dialog"]')`,
        5_000
      );
      assert('D9_cancel_clears_dialog', clicked === true && gone === true, JSON.stringify({ clicked, gone }));

      // D9b — 暗色形态：同一弹窗卡片底色必须跟随 token 变化（只截亮色=没验主题）
      const prevTheme = await lib.evalJs(
        client,
        `document.documentElement.getAttribute('data-theme')`
      );
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme', 'dark'); 'ok'`);
      await lib.evalJs(client, 'window.petriDesktop.app.previewQuitSummary()');
      const darkDialog = await waitFor(
        client,
        `!!document.querySelector('[data-testid="quit-summary-dialog"]')`
      );
      const darkCardBg = await lib.evalJs(
        client,
        `(function(){
          const card = document.querySelector('[data-testid="quit-summary-dialog"] > div');
          return card ? getComputedStyle(card).backgroundColor : null;
        })()`
      );
      const darkShot = await lib.screenshotPng(client, EVIDENCE, 'ui536-quit-summary-dark.png');
      assert(
        'D9b_dark_dialog_uses_tokens',
        darkDialog === true && Boolean(darkCardBg) && darkCardBg !== lightCardBg,
        JSON.stringify({ lightCardBg, darkCardBg })
      );
      assert('D9c_dark_screenshot', Boolean(darkShot), darkShot);
      await lib.evalJs(
        client,
        `(function(){
          const d = document.querySelector('[data-testid="quit-summary-dialog"]');
          const btn = d && [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
          if (btn) btn.click();
          ${prevTheme ? `document.documentElement.setAttribute('data-theme', ${JSON.stringify(prevTheme)});` : `document.documentElement.removeAttribute('data-theme');`}
          return true;
        })()`
      );

      const hide = await lib.evalJs(client, 'window.petriDesktop.app.hideToTray()');
      assert('D10_hide_to_tray_ok', hide?.ok === true, JSON.stringify(hide));

      await lib.evalJs(
        client,
        'window.petriDesktop.app.setShellPrefs({ closeToTray: false, notifyOnTurnEnd: true })'
      );
      const finalStatus = await lib.evalJs(client, 'window.petriDesktop.app.getShellStatus()');
      assert(
        'D11_tray_destroyed_when_pref_off',
        finalStatus?.trayActive === false && finalStatus?.closeToTray === false,
        JSON.stringify(finalStatus)
      );
    } finally {
      try {
        await lib.evalJs(
          client,
          'window.petriDesktop.app.setShellPrefs({ closeToTray: false, notifyOnTurnEnd: true })'
        );
      } catch {}
    }
  },
};
