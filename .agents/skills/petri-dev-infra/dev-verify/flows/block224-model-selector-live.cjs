#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block224-model-selector-live — BLOCK-224 Q9 D1+D2 实机腿（UI-537）
 *
 * REST＝真后端：/api/ai/settings 有 profiles 与 credential_status（无密钥明文）。
 * DOM＝9223 离屏测试实例：模型菜单打开 → 状态行/禁用行可读 → 亮/暗截图；
 * 设置页模型行出现「选择器可见 / 默认思考档」两控。
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';
const EVIDENCE = path.join(process.cwd(), 'acceptance', 'block-224');

async function rest(endpoint) {
  const resp = await fetch(API + endpoint, { headers: AUTH });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function navigate(client, url, opts = {}) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const ready = await lib.evalJs(client, `(function(){
      const here = String(location.href);
      for (const needle of ${JSON.stringify(opts.urlIncludes || [])}) if (here.indexOf(needle) === -1) return false;
      ${opts.selector ? `return !!document.querySelector(${JSON.stringify(opts.selector)});` : 'return document.readyState === "complete";'}
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'block224-model-selector-live',
  description: 'BLOCK-224 Q9 D1+D2 实机腿：模型菜单状态诚实 + 禁用行 + 设置页可见/默认思考两控（9223 离屏）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    // ── REST：设置面形状 ─────────────────────────────────────
    const settings = await rest('/ai/settings');
    assert('R1_ai_settings_available', settings.ok && settings.data && settings.data.status === 'ok', JSON.stringify(settings.data && Object.keys(settings.data)));
    const payload = settings.data?.settings || settings.data || {};
    assert(
      'R2_profiles_and_credential_status',
      Array.isArray(payload.model_profiles) && payload.model_profiles.length >= 1
        && payload.credential_status && typeof payload.credential_status === 'object',
      JSON.stringify({ profiles: payload.model_profiles?.length, credentials: Object.keys(payload.credential_status || {}) })
    );
    assert(
      'R3_no_secret_material_in_settings',
      !JSON.stringify(payload).match(/sk-[A-Za-z0-9]{8,}/),
      'settings 响应不得包含 API Key 明文'
    );

    // ── DOM：模型菜单 ────────────────────────────────────────
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      const onWelcome = await navigate(client, `${APP}/?test=1`, { selector: '.sc-model-name-btn' });
      assert('D1_composer_model_button_present', onWelcome === true, '欢迎页 composer 应有模型按钮');

      await lib.evalJs(client, `document.querySelector('.sc-model-name-btn').click(); 'ok'`);
      const readMenu = () => lib.evalJs(
        client,
        `(function(){
          const menu = document.querySelector('[data-testid="model-menu"]');
          if (!menu) return null;
          const buttons = [...menu.querySelectorAll('button')];
          return {
            buttons: buttons.length,
            disabled: buttons.filter((b) => b.disabled).length,
            status: document.querySelector('[data-testid="model-menu-status"]')?.textContent || '',
            text: menu.innerText.slice(0, 400),
          };
        })()`
      );
      let opened = await readMenu();
      // 等目录加载落定（loading→degraded/ok/empty），避免截到瞬时加载态。
      for (let i = 0; i < 40 && opened && opened.status.includes('正在加载'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        opened = await readMenu();
      }
      assert('D2_model_menu_opens', Boolean(opened), '点击模型按钮应出现 model-menu');
      assert(
        'D3_menu_state_settled',
        opened.buttons > 0 && !opened.status.includes('正在加载'),
        JSON.stringify(opened)
      );
      const shotLight = await lib.screenshotPng(client, EVIDENCE, 'ui537-model-menu-light.png');

      // 暗色形态：同一菜单的 token 必须跟随主题
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui537-model-menu-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`);
      assert('D4_model_menu_screenshots', Boolean(shotLight) && Boolean(shotDark), `${shotLight} | ${shotDark}`);
      await lib.evalJs(client, `document.querySelector('.sc-model-overlay')?.click(); 'ok'`);

      // ── DOM：设置页治理控件 ─────────────────────────────────
      const onSettings = await navigate(client, `${APP}/settings?section=models`, {
        urlIncludes: ['section=models'],
        selector: 'input[aria-label$="在选择器中显示"]',
      });
      const controls = await lib.evalJs(
        client,
        `(function(){
          const visible = document.querySelectorAll('input[aria-label$="在选择器中显示"]');
          const levels = document.querySelectorAll('select[aria-label="默认思考档"]');
          return { visible: visible.length, levels: levels.length };
        })()`
      );
      assert(
        'D5_model_selector_controls_present',
        onSettings === true && controls.visible >= 1 && controls.levels >= 1,
        JSON.stringify(controls)
      );
      const shotSettings = await lib.screenshotPng(client, EVIDENCE, 'ui537-model-governance-settings.png');
      assert('D6_settings_screenshot', Boolean(shotSettings), shotSettings);
    } finally {
      try { await lib.evalJs(client, `document.querySelector('.sc-model-overlay')?.click(); 'ok'`); } catch {}
    }
  },
};
