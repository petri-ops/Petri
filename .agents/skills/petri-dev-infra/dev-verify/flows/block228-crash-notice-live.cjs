#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block228-crash-notice-live — BLOCK-228 异常退出提示（UI-541）
 *
 * REST＝真后端：crashNotice 偏好。
 * DOM＝9223 离屏测试实例：测试实例模拟「上次未正常退出 + 转储文件名」→ 刷新出现横幅 →
 * 亮/暗截图 → 「知道了」关闭；偏好关闭后不再显示。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-228');

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
  id: 'block228-crash-notice-live',
  description: 'BLOCK-228 实机腿：异常退出横幅（时间/转储文件名/关闭）+ crashNotice 偏好（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    await rest('PUT', '/user/prefs', { crashNotice: true });

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const simulated = await lib.evalJs(
        client,
        `window.petriDesktop.diagnostic.crashSimulate({
          uncleanExit: true,
          previousStartedAt: '2026-10-21T01:00:00.000Z',
          dumps: [{ name: 'probe-block228.dmp', size: 2048, mtime: '2026-10-21T01:00:00.000Z' }]
        })`
      );
      assert('R1_simulate_status', simulated?.ok === true, JSON.stringify(simulated));

      await lib.evalJs(client, `location.href = '${APP}/?test=1'; 'ok'`);
      const banner = await waitFor(
        client,
        `(function(){
          const el = document.querySelector('[data-testid="crash-notice"]');
          return el ? el.innerText : null;
        })()`
      );
      assert(
        'D1_banner_visible',
        typeof banner === 'string' && banner.includes('上次运行未正常结束') && banner.includes('probe-block228.dmp') && banner.includes('未上传'),
        String(banner)
      );
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui541-crash-notice.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui541-crash-notice-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D2_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      await lib.evalJs(client, `document.querySelector('[data-testid="crash-notice-dismiss"]').click(); 'ok'`);
      const gone = await waitFor(client, `!document.querySelector('[data-testid="crash-notice"]')`, 5_000);
      assert('D3_dismiss_closes', gone === true, '知道了应关闭横幅');

      // 偏好关闭：同样状态不再显示
      await rest('PUT', '/user/prefs', { crashNotice: false });
      await lib.evalJs(client, `window.petriDesktop.diagnostic.crashSimulate({ uncleanExit: true })`);
      await lib.evalJs(client, `location.reload(); 'ok'`);
      await waitFor(client, `!!document.querySelector('.sc-model-name-btn')`, 30_000);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const hidden = await lib.evalJs(client, `!!document.querySelector('[data-testid="crash-notice"]')`);
      assert('D4_pref_off_hides_banner', hidden === false, 'crashNotice=false 不应显示横幅');
    } finally {
      try { await rest('PUT', '/user/prefs', { crashNotice: true }); } catch {}
      try { await lib.evalJs(client, `window.petriDesktop.diagnostic.crashSimulate({ uncleanExit: false, dumps: [] })`); } catch {}
    }
  },
};
