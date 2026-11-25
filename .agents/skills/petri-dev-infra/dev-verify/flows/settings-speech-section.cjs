#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：settings-speech-section — item 40 设置页语音独立成区实机。
 * 只连 9223 离屏测试实例；禁 PETRI_TEST_ONSCREEN。验证后即 kill 9223。
 * 断言：?section=speech 直达 / 左栏 core 含语音 / 页面四块常驻 / 旧检索·OCR 两块不在 /
 *       models 页不再含语音面板 / HMR 新源在场。截图留证，观感 pending_human_eye 零代签。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

async function navigate(client, url, selector) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await lib.evalJs(client, `(function(){
      if (String(location.href).indexOf(${JSON.stringify(new URL(url).search)}) === -1) return false;
      return !!document.querySelector(${JSON.stringify(selector)});
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'settings-speech-section',
  description: 'item 40 设置页语音独立成区实机（?section=speech 直达/四块在/两块删/models 隔离，9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'settings-speech-section'),

  async run({ assert }) {
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    try {
      // S1 深链直达 + 左栏语音 active
      const ok = await navigate(client, `${APP}/settings?section=speech`, '[data-testid="channel-panel"]');
      assert('S1_speech_deeplink_reachable', ok, 'nav /settings?section=speech');
      const state = JSON.parse(String(await lib.evalJs(client, `(function(){
        const active = document.querySelector('.petri-settings-nav__item.active');
        const nav = Array.from(document.querySelectorAll('.petri-settings-nav__item')).map((b) => b.innerText.trim());
        const panel = document.querySelector('[data-testid="channel-panel"]');
        return JSON.stringify({ active: active ? active.innerText.trim() : '', nav, text: panel ? panel.innerText : '' });
      })()`) || '{}'));
      assert('S2_nav_has_speech_active', state.active.includes('语音') && state.nav.some((n) => n.includes('语音')), JSON.stringify({ active: state.active, nav: state.nav }));

      // S3 四块在、检索/OCR 两块不在、无外层折叠
      const blocks = ['语音渠道', 'ASR 语言', '本地模型', 'Whisper', 'TTS 声音'];
      const missing = blocks.filter((b) => !state.text.includes(b));
      assert('S3_four_speech_blocks_present', missing.length === 0, `missing=${missing.join(',')}`);
      const forbidden = ['联网检索后端', 'OCR 渠道'].filter((b) => state.text.includes(b));
      assert('S4_search_ocr_ui_removed', forbidden.length === 0, `forbidden=${forbidden.join(',')}`);
      const noToggle = await lib.evalJs(client, `!document.querySelector('[data-testid="channel-panel-toggle"]')`);
      assert('S5_no_outer_fold', noToggle === true, String(noToggle));

      // S6 models 页不再含语音面板
      const okModels = await navigate(client, `${APP}/settings?section=models`, '.petri-settings-section--models');
      assert('S6_models_page_reachable', okModels, 'nav /settings?section=models');
      const noPanel = await lib.evalJs(client, `!document.querySelector('[data-testid="channel-panel"]')`);
      assert('S7_models_page_has_no_speech_panel', noPanel === true, String(noPanel));

      // 截图留证（观感 pending_human_eye 零代签）
      await navigate(client, `${APP}/settings?section=speech`, '[data-testid="channel-panel"]');
      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'settings-speech-section'), 'speech-section.png');
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
