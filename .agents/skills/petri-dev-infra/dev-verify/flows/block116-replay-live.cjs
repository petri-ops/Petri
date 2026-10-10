#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block116-replay-live — BLOCK-116 P3 视觉腿
 * （决策台账逐条回放面板：设置页实机过目；plan §3 / UI-434 verified 依据）。
 *
 * 前置：dev 后端含 recent 端点已重启；测试实例已启动（bash scripts/start-test-instance.sh）。
 * decision_log 已有历史行（block116-decision-platform-live 产出 intent-route 记录）。
 *
 * 断言：
 *   V1 设置页「用量与资源」节可见「决策原语调用」面板（真实渲染）；
 *   V2 展开「最近决策」→ 回放行渲染（intent-route 记录在场）；
 *   V3 截图落证据目录。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-116');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'block116-replay-live',
  description: 'BLOCK-116 P3 视觉腿：决策台账回放面板设置页实机过目（截图证据）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });

    // 导航到设置页（SPA）
    await client.send('Page.enable');
    await client.send('Page.navigate', { url: APP_ORIGIN + '/settings' });
    await sleep(4000);

    // V1 — 切到「用量与资源」节并确认决策面板渲染
    const clickedNav = await lib.evalJs(client, `
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('用量与资源'));
        if (btn) { btn.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    assert('V0_usage_section_clicked', clickedNav === 'clicked', `clickedNav=${clickedNav}`);
    await sleep(1000);
    const hasPanel = await lib.evalJs(client, `document.body.innerText.includes('决策原语调用')`);
    assert('V1_decision_panel_visible', hasPanel === true, `hasPanel=${hasPanel}`);

    // V2 — 展开最近决策回放
    const clickedExpand = await lib.evalJs(client, `
      (() => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '展开');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    await sleep(600);
    const replayText = await lib.evalJs(client, `document.body.innerText.includes('最近决策')`);
    const hasIntentRow = await lib.evalJs(client, `document.body.innerText.includes('intent-route')`);
    assert('V2_recent_replay_rendered', clickedExpand === 'clicked' && replayText === true
      && (hasIntentRow === true || hasIntentRow === 'true' || hasIntentRow === 1 || hasIntentRow === '1'),
      `clicked=${clickedExpand} replayText=${replayText} intentRow=${hasIntentRow}`);

    // V2b — 滚动到面板（截图特写）
    await lib.evalJs(client, `
      (() => {
        const h = [...document.querySelectorAll('strong')].find((el) => (el.textContent || '').includes('决策原语调用'));
        if (h) h.scrollIntoView({ block: 'start' });
        return 'scrolled';
      })()
    `);
    await sleep(500);

    // V3 — 截图证据
    const shot = await lib.screenshotPng(client, EVIDENCE_DIR, 'decision-replay-panel.png');
    assert('V3_screenshot_captured', fs.existsSync(shot), `shot=${shot}`);
    lib.log(`视觉证据：${shot}`);
  },
};
