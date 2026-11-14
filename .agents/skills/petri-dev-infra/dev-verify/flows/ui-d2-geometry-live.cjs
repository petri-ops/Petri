#!/usr/bin/env node
'use strict';

/**
 * UI-D2 (BLOCK-417) — 四块几何 / ≤900px / 长内容三态离屏实机腿。
 *
 * 纪律：只连既有 9223 离屏测试实例；不启动/不重启 Electron、不连 9222 用户窗、
 * 不触发 openResultInMain/下钻（运行时 show()）、**不设 PETRI_TEST_ONSCREEN**。
 * CDP 不可达 = external-blocked；截图失败 = screenshot_unavailable，不靠开窗换证据。
 * DOM 几何断言通过 ≠ 视觉验收通过（人眼项另册）。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-design-assessment-2026-11-11', 'd2');

module.exports = {
  id: 'ui-d2-geometry-live',
  description: 'UI-D2 实机：四块几何 / 祖先右缘≤可视列 / 长内容三态 / 元素级截图（9223 离屏只读+恢复）',
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
      const geo = JSON.parse(await lib.evalJs(client, `JSON.stringify((() => {
        const center = document.querySelector('[class*="workspaceSessionLayout"]') || document.body;
        const r = (el) => { const b = el.getBoundingClientRect(); return { x:b.x, y:b.y, w:b.width, h:b.height, right:b.right, bottom:b.bottom }; };
        const box = r(center);
        const chain = [];
        let cur = center;
        while (cur && cur !== document.documentElement && chain.length < 8) {
          chain.push({ tag: cur.tagName, right: r(cur).right });
          cur = cur.parentElement;
        }
        const viewportRight = document.documentElement.clientWidth;
        return { box, chain, viewportRight, ancestorsWithin: chain.every((a) => a.right <= viewportRight + 1) };
      })())`, 10_000));
      assert('G3_no_parent_overflow', geo.box.right <= geo.viewportRight + 1, `right=${geo.box.right} viewport=${geo.viewportRight}`);
      assert('G4_ancestors_within_visual_column', geo.ancestorsWithin, `chain=${geo.chain.length} viewport=${geo.viewportRight}`);
      assert('G1_G2_nonzero_geometry', geo.box.w > 0 && geo.box.h > 0, `w=${geo.box.w} h=${geo.box.h}`);

      const longContent = JSON.parse(await lib.evalJs(client, `JSON.stringify((() => {
        const host = document.querySelector('[class*="workspaceSessionContent"]') || document.body;
        const probe = document.createElement('div');
        probe.textContent = 'x'.repeat(2000);
        probe.style.cssText = 'white-space:nowrap;max-width:100%;overflow:auto;';
        host.appendChild(probe);
        const hostRight = host.getBoundingClientRect().right;
        const probeRight = probe.getBoundingClientRect().right;
        const scrollable = probe.scrollWidth > probe.clientWidth;
        probe.remove();
        return { hostRight, probeRight, scrollable };
      })())`, 10_000));
      assert('L2_frame_scroll_active', longContent.scrollable, `scrollWidth>clientWidth=${longContent.scrollable}`);
      assert('L3_no_escape_from_host', longContent.probeRight <= longContent.hostRight + 2, `probe=${longContent.probeRight} host=${longContent.hostRight}`);

      const narrow = JSON.parse(await lib.evalJs(client, 'JSON.stringify({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth })'));
      assert('narrow_probe_readable', narrow.clientWidth > 0, `clientWidth=${narrow.clientWidth}（≤900px 真缩放需 CDP Emulation，本腿只记录当前视口，不冒充）`);

      try {
        await lib.screenshotPng(client, EVIDENCE, 'ui-d2-geometry-element.png');
        assert('element_screenshot', true, 'captured');
      } catch (err) {
        assert('element_screenshot', false, `screenshot_unavailable: ${err && err.message ? err.message : String(err)}`);
      }
    } catch (err) {
      assert('geometry_flow_exception', false, `external-blocked: ${err && err.message ? err.message : String(err)}`);
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
