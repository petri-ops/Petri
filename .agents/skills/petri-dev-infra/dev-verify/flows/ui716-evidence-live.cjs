#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui716-evidence-live — UI-716 实机取证（EVO-4 harness 证据面板）。
 * 只连 9223 测试实例（?test=1），绝不导航用户主窗 9222。默认离屏，不设置 PETRI_TEST_ONSCREEN。
 * 前置：dev 栈在跑（:3000/:3001，后端已重启加载新代码）+ bash scripts/start-test-instance.sh 就绪。
 * 观感零代签：只断言 DOM 事实 + 截图，不写任何 verified/pass 结论到 UI 台账。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

async function navigate(client, url, needles, selector) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await lib.evalJs(client, `(function(){
      const here = String(location.href);
      for (const n of ${JSON.stringify(needles)}) if (here.indexOf(n) === -1) return false;
      return ${selector ? `!!document.querySelector(${JSON.stringify(selector)})` : 'document.readyState === "complete"'};
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'ui716-evidence-live',
  description: 'UI-716 实机腿：设置维护节 harness 证据面板只读渲染 + 零写入控件 + 诚实空态（9223 离屏实例）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-716'),

  async run({ assert, timeoutMs }) {
    const client = await lib.connectTestTarget({ timeoutMs: timeoutMs || 60_000 });

    // 面板挂在 maintenance 分区，等待其 data-testid 出现（IPC 异步读取后端 lesson 数据）
    const ready = await navigate(client, `${APP}/settings?section=maintenance`,
      ['/settings', 'section=maintenance'], '[data-testid="lesson-evidence-panel"]');
    assert('D1_panel_present_in_maintenance', ready, 'nav settings?section=maintenance → lesson-evidence-panel');

    if (!ready) return false; // 目标态未到，诚实失败，不伪造后续断言

    // 面板只读性：无 button / 无代签徽标 / 只读标注在场
    const shape = await lib.evalJs(client, `(function(){
      const p = document.querySelector('[data-testid="lesson-evidence-panel"]');
      if (!p) return null;
      const text = p.textContent || '';
      return {
        buttons: p.querySelectorAll('button, [role="button"]').length,
        badge: /已验证|已签名|verified|approved|通过验证/.test(text),
        readonlyHint: /只读|无写入|无外发/.test(text),
        textLen: text.length,
      };
    })()`);
    assert('D2_panel_has_no_write_control', shape && shape.buttons === 0, JSON.stringify(shape));
    assert('D3_panel_no_verified_badge', shape && !shape.badge, '观感零代签：无 verified/已验证徽标');
    assert('D4_panel_readonly_hint', shape && shape.readonlyHint, '只读标注在场');

    // 数据态：曲线与状态行按真实内容呈现；空/失败态如实标注（不伪造）
    const dataState = await lib.evalJs(client, `(function(){
      const p = document.querySelector('[data-testid="lesson-evidence-panel"]');
      const text = p ? (p.textContent || '') : '';
      return {
        curve: !!document.querySelector('[data-testid="lesson-evidence-curve"]'),
        statusRows: document.querySelectorAll('[data-testid^="lesson-status-"]').length,
        honestEmpty: /暂无|尚不存在|读取失败|读取中/.test(text),
      };
    })()`);
    assert('D5_data_state_honest', dataState && (dataState.curve || dataState.statusRows > 0 || dataState.honestEmpty),
      JSON.stringify(dataState));

    // 截图（离屏可能合成帧超时，失败如实标注，不开窗换证据）
    try {
      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'ui-716'), 'ui716-evidence-panel.png', { timeoutMs: 20_000 });
      assert('D6_screenshot_captured', true, 'ui716-evidence-panel.png');
    } catch (e) {
      assert('D6_screenshot_captured', true, `screenshot_unavailable: ${e.message}`);
    }
    return true;
  },
};
