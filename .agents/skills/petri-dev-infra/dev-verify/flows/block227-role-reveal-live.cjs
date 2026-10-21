#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block227-role-reveal-live — BLOCK-227 首启角色揭示（UI-540）
 *
 * REST＝真后端：roleRevealSeen 读写。
 * DOM＝9223 离屏测试实例：首次显示三张角色卡 → 显式「开始使用」关闭并落盘 →
 * 刷新后不再出现；亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-227');

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await lib.evalJs(client, expr);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

module.exports = {
  id: 'block227-role-reveal-live',
  description: 'BLOCK-227 实机腿：首启角色揭示（三卡/显式确认/落盘/刷新不再出现，9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const reset = await rest('PUT', '/user/prefs', { roleRevealSeen: false });
    assert('R1_prefs_reset_unseen', reset.ok && reset.data?.prefs?.roleRevealSeen === false, JSON.stringify(reset.data?.prefs));

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      await lib.evalJs(client, `location.href = '${APP}/?test=1'; 'ok'`);
      const shown = await waitFor(
        client,
        `(function(){
          const el = document.querySelector('[data-testid="role-reveal"]');
          return el ? el.innerText : null;
        })()`
      );
      assert('D1_role_reveal_visible', typeof shown === 'string' && shown.includes('你好，我是格物'), String(shown));
      assert(
        'D2_three_roles',
        shown.includes('分析数据') && shown.includes('写代码') && shown.includes('整理知识'),
        '三张角色卡应全部在场'
      );
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui540-role-reveal.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui540-role-reveal-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D3_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      await lib.evalJs(client, `document.querySelector('[data-testid="role-reveal-start"]').click(); 'ok'`);
      const gone = await waitFor(client, `!document.querySelector('[data-testid="role-reveal"]')`, 5_000);
      assert('D4_dismiss_closes', gone === true, '点击开始使用后浮层应消失');

      const persisted = await (async () => {
        let last = null;
        for (let i = 0; i < 20; i++) {
          last = await rest('GET', '/user/prefs');
          if (last.data?.prefs?.roleRevealSeen === true) return last;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return last;
      })();
      assert('D5_seen_persisted', persisted.data?.prefs?.roleRevealSeen === true, JSON.stringify(persisted.data?.prefs));

      await lib.evalJs(client, `location.reload(); 'ok'`);
      await waitFor(client, `!!document.querySelector('.sc-model-name-btn')`, 30_000);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const reappeared = await lib.evalJs(client, `!!document.querySelector('[data-testid="role-reveal"]')`);
      assert('D6_not_shown_after_reload', reappeared === false, '已看过（true）刷新后不应再出现');
    } finally {
      try { await rest('PUT', '/user/prefs', { roleRevealSeen: true }); } catch {}
    }
  },
};
