#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block225-auto-model-live — BLOCK-225 Q9 D4 Auto 实机腿（UI-538）
 *
 * REST＝真后端：userPrefs.autoModel 默认 false、开关写回。
 * DOM＝9223 离屏测试实例：菜单「自动（按任务选择）」开关、解析预览、
 * composer 模型钮显示「自动」、关闭后恢复具体模型；亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-225');

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
  id: 'block225-auto-model-live',
  description: 'BLOCK-225 Q9 D4 Auto 实机腿：自动开关/解析预览/composer 自动标签（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    // REST：先复位为关闭（避免上一轮残留），再断言默认语义。
    const reset = await rest('PUT', '/user/prefs', { autoModel: false });
    assert('R1_prefs_reset_auto_off', reset.ok && reset.data?.prefs?.autoModel === false, JSON.stringify(reset.data?.prefs));

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const ready = await waitFor(client, `!!document.querySelector('.sc-model-name-btn')`, 30_000);
      assert('D1_composer_model_chip_present', ready === true, '欢迎页 composer 应有模型钮');

      await lib.evalJs(client, `document.querySelector('.sc-model-name-btn').click(); 'ok'`);
      const offRow = await waitFor(
        client,
        `(function(){
          const row = document.querySelector('[data-testid="model-menu-auto"]');
          return row ? row.textContent : null;
        })()`
      );
      assert('D2_auto_toggle_default_off', typeof offRow === 'string' && offRow.includes('关闭'), String(offRow));

      await lib.evalJs(client, `document.querySelector('[data-testid="model-menu-auto"]').click(); 'ok'`);
      const onState = await waitFor(
        client,
        `(function(){
          const row = document.querySelector('[data-testid="model-menu-auto"]');
          const chip = document.querySelector('.sc-model-name-btn');
          return row && chip ? { row: row.textContent, chip: chip.textContent, title: chip.title } : null;
        })()`
      );
      assert(
        'D3_auto_enabled_with_preview',
        onState && onState.row.includes('开启') && onState.chip.includes('自动') && /\（.+）/.test(onState.row),
        JSON.stringify(onState)
      );
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui538-auto-model-menu.png');
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui538-auto-model-menu-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D4_auto_screenshots', Boolean(shot) && Boolean(shotDark), `${shot} | ${shotDark}`);

      const persisted = await rest('GET', '/user/prefs');
      assert('D5_auto_persisted', persisted.data?.prefs?.autoModel === true, JSON.stringify(persisted.data?.prefs));

      await lib.evalJs(client, `document.querySelector('[data-testid="model-menu-auto"]').click(); 'ok'`);
      const offAgain = await waitFor(
        client,
        `(function(){
          const row = document.querySelector('[data-testid="model-menu-auto"]');
          const chip = document.querySelector('.sc-model-name-btn');
          return row && chip ? { row: row.textContent, chip: chip.textContent } : null;
        })()`
      );
      assert(
        'D6_auto_disabled_restores_model',
        offAgain && offAgain.row.includes('关闭') && !offAgain.chip.includes('自动'),
        JSON.stringify(offAgain)
      );
      const cleared = await rest('GET', '/user/prefs');
      assert('D7_auto_cleared', cleared.data?.prefs?.autoModel === false, JSON.stringify(cleared.data?.prefs));
    } finally {
      try { await rest('PUT', '/user/prefs', { autoModel: false }); } catch {}
      try { await lib.evalJs(client, `document.querySelector('.sc-model-overlay')?.click(); 'ok'`); } catch {}
    }
  },
};
