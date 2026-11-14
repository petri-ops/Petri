#!/usr/bin/env node
'use strict';

/**
 * UI-D4 (BLOCK-419) — 9223 离屏实机无障碍读数（只读 + 恢复）。
 *
 * 纪律：只连既有 9223 离屏测试实例，不启动/重启 Electron、不连 9222 用户窗、
 * 不触发 openResultInMain/下钻（运行时 show()）、**不设 PETRI_TEST_ONSCREEN**。
 * CDP 不可达 = external-blocked；截图失败 = screenshot_unavailable。
 * DOM/ARIA 断言通过 ≠ 人眼验收通过（签字槽在 docs/ui-design-human-eye-route.md）。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-design-assessment-2026-11-11', 'd4');

module.exports = {
  id: 'ui-d4-a11y-live',
  description: 'UI-D4 实机：ARIA / 焦点 / 八态 DOM 读数 + computedStyle 对比度输入（9223 离屏只读+恢复）',
  evidenceDir: EVIDENCE,

  async run(ctx) {
    const { assert } = ctx;
    let targets;
    try {
      targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: ctx.timeoutMs ?? 8000 });
    } catch (err) {
      assert('cdp_9223_available', false, `external-blocked: ${err && err.message ? err.message : String(err)}`);
      return false;
    }
    assert('cdp_9223_available', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;

    const testPage = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, '!!document.querySelector(".petri-desktop")', 5000).catch(() => false),
    });
    const client = await lib.connectTarget(testPage);
    try {
      const aria = JSON.parse(await lib.evalJs(client, `JSON.stringify((() => {
        const q = (s) => document.querySelectorAll(s).length;
        return {
          ariaBusy: q('[aria-busy]'), roleAlert: q('[role="alert"]'),
          roleStatus: q('[role="status"]'), ariaLive: q('[aria-live]'),
          buttons: q('button'), inputs: q('input, textarea, [contenteditable="true"]'),
          tabbables: q('[tabindex="0"], button:not([disabled]), a[href]'),
          labelledButtons: q('button[aria-label], button[title]'),
        };
      })())`, 10_000));
      assert('aria_live_regions_present', aria.roleAlert + aria.roleStatus + aria.ariaLive > 0, JSON.stringify(aria));
      assert('interactive_elements_present', aria.buttons + aria.inputs > 0, `buttons=${aria.buttons} inputs=${aria.inputs}`);
      assert('tabbables_present', aria.tabbables > 0, `tabbables=${aria.tabbables}`);

      const focus = JSON.parse(await lib.evalJs(client, `JSON.stringify((() => {
        const first = document.querySelector('button:not([disabled]), a[href], input');
        if (!first) return { focusable: false };
        first.focus();
        const active = document.activeElement === first;
        const cs = getComputedStyle(first);
        return { focusable: active, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
      })())`, 10_000));
      assert('focus_target_reachable', focus.focusable === true, JSON.stringify(focus));
      // 诚实读侧：outlineStyle=none 即焦点环不可见，不能以 outlineWidth 非零冒充通过。
      // 该读数登记为 focus-visible 缺口的实机旁证，不写 PASS 也不冒充人眼验收。
      const focusVisible = focus.outlineStyle !== 'none' && focus.outlineStyle !== '';
      assert('focus_ring_observable', focusVisible,
        `focus_ring_not_observable: ${JSON.stringify(focus)} — 登记为 H-06 人眼/独立切片补腿，不冒充通过`);

      const colors = JSON.parse(await lib.evalJs(client, `JSON.stringify((() => {
        const root = getComputedStyle(document.documentElement);
        const pick = (n) => root.getPropertyValue(n).trim();
        return {
          text: pick('--petri-text'), secondary: pick('--petri-text-secondary'),
          tertiary: pick('--petri-text-tertiary'), surface: pick('--petri-bg-surface'),
          subtle: pick('--petri-bg-subtle'), theme: document.documentElement.getAttribute('data-theme') || 'light',
        };
      })())`, 10_000));
      assert('tokens_resolved_at_runtime', Boolean(colors.text && colors.surface), JSON.stringify(colors));

      try {
        await lib.screenshotPng(client, EVIDENCE, 'ui-d4-a11y-live.png');
        assert('element_screenshot', true, 'captured (全页，非元素级裁剪；人眼过目仍 pending_human_eye)');
      } catch (err) {
        assert('element_screenshot', false, `screenshot_unavailable: ${err && err.message ? err.message : String(err)}`);
      }
    } catch (err) {
      assert('a11y_flow_exception', false, `external-blocked: ${err && err.message ? err.message : String(err)}`);
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
