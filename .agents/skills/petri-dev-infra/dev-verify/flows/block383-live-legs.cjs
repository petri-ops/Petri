#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block383-live-legs — BLOCK-383 实机腿批（block-382 §3.6 第一波）。
 *
 * 复用 nso-w3-visual-live 隔离纪律：不启动/不 kill Electron；9223 只读 DOM，
 * 记录原 URL 并在 finally 恢复；不设任何上屏开关；探针结束由调用方 kill 实例。
 *
 * 断言链：
 *   S1 9223 连接 / S2 设置页就绪
 *   701-1 字号新收敛：设置页正文元素 computed fontSize ∈ token 族（11/12/14/16/20/28px）
 *   701-2 空 flags 可见：/settings 实验开关段展示「当前无可配置实验开关」或 flags 行（不整段消失）
 *   700-1 prefs 重放横幅：fetch PUT 注入失败 → 告警条含「自动重试」字样（新契约）
 *   699-1 结果库行 content-visibility=auto（有行时；无行如实 pending）
 *   698-1 项目树 role=tree/treeitem/aria-expanded
 *   698-2 折叠态 inert（左栏收起时 aside[inert]）
 *   697-1 产物正文无裸数值字号（computed fontFamily 正常、无 13px 孤儿值）
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'post-nso-2026-11-08');
const APP = 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'block383-live-legs',
  description: 'BLOCK-383 实机腿：字号新收敛/空 flags/重放横幅/content-visibility/树语义/inert（9223 离屏、只读+恢复）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    const fs = require('node:fs');
    fs.mkdirSync(EVIDENCE, { recursive: true });
    let client = null;
    let originalUrl = null;
    const pending = [];

    try {
      client = await lib.connectTestTarget({ timeoutMs: 30_000 });
      originalUrl = await lib.evalJs(client, `location.href`).catch(() => null);
      const ready = await lib.evalJs(client, `({ ready: document.readyState, title: document.title.slice(0, 60) })`);
      assert('S1_test_instance_connected', !!ready.ready, JSON.stringify(ready));

      // ── 701-1/701-2/700-1：设置页 ─────────────────────────
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=experimental`)}; 'ok'`);
      await sleep(3000);
      const c2 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      client = client === c2 ? client : c2;

      // 701-1：正文元素 computed font-size 落在 token 族
      const fontProbe = await lib.evalJs(client, `(() => {
        const els = Array.from(document.querySelectorAll('body *')).slice(0, 400);
        const sizes = new Set();
        for (const el of els) {
          const cs = getComputedStyle(el);
          if (cs.fontSize) sizes.add(cs.fontSize);
        }
        return { sizes: Array.from(sizes).sort() };
      })()`);
      // BLOCK-383 修正：html 基准=14px（rem token 计算为 9.625/10.5/12.25/14/17.5/24.5），
      // computed px 无法与硬编码 px 直接对表——改判「孤儿整数值」：{10,11,13}px 只能来自
      // 硬编码（token 派生值不含这三个整数）；16px 与 lg token 撞值不作判据。
      // 声明面由 theme-token-contract（源码）+ 697-1（inline live）覆盖。
      const htmlFs = Number.parseFloat(await lib.evalJs(client, `getComputedStyle(document.documentElement).fontSize`)) || 14;
      const tokenDerived = new Set([0.6875, 0.75, 0.875, 1, 1.25, 1.75].map((r) => `${Math.round(r * htmlFs * 100) / 100}px`));
      const orphanPx = new Set(['10px', '11px', '13px']);
      const orphans = (fontProbe.sizes || []).filter((s) => orphanPx.has(s) && !tokenDerived.has(s));
      assert('701-1_font_sizes_on_charter', orphans.length === 0,
        `orphan hardcoded sizes: ${orphans.join(',')} | token-derived: ${Array.from(tokenDerived).join(',')} | all: ${fontProbe.sizes.join(',')}`);

      // 701-2：实验开关段可见（空 flags → 「当前无可配置实验开关」；有 flags → 行渲染）
      const flagsProbe = await lib.evalJs(client, `(() => {
        const empty = document.querySelector('[data-testid="experimental-flags-empty"]');
        const errEl = document.querySelector('[data-testid="experimental-flags-error"]');
        const rows = document.querySelectorAll('[data-testid^="server-flag-"]').length;
        const section = Array.from(document.querySelectorAll('h3, strong, [class*="heading"]')).map(e => e.textContent).find(t => t && t.includes('实验特性'));
        return { emptyVisible: !!empty, emptyText: empty ? empty.textContent.slice(0, 80) : null, errVisible: !!errEl, rows, sectionPresent: !!section };
      })()`);
      assert('701-2_flags_section_visible', flagsProbe.sectionPresent && (flagsProbe.emptyVisible || flagsProbe.errVisible || flagsProbe.rows > 0),
        JSON.stringify(flagsProbe));

      // 动效 SELECT 在 general 节——先导航（横幅腿前置导航，合并单 eval 见下）
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=general`)}; 'ok'`);
      await sleep(2500);
      const c4 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      client = client === c4 ? client : c4;

      // 700-1：prefs PUT 失败注入 + 触发改动（单 eval：patch 与 trigger 同上下文，
      // 分离调用曾在多页目标解析下把 patch 落到非触发页）
      const trigger = await lib.evalJs(client, `(async () => {
        const orig = window.fetch;
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('/api/user/prefs') && init && init.method === 'PUT') {
            return Promise.resolve({ ok: false, status: 503 });
          }
          return orig(input, init);
        };
        const sel = Array.from(document.querySelectorAll('select')).find(s => /跟随系统/.test(s.textContent || ''));
        if (!sel) return 'no-motion-select';
        const opt = Array.from(sel.options).find(o => o.value !== sel.value);
        if (!opt) return 'no-alt-option';
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, opt.value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return 'changed-to-' + opt.value;
      })()`);
      await sleep(3500);
      const banner = await lib.evalJs(client, `(() => {
        const el = document.querySelector('[data-testid="prefs-sync-failed-banner"]');
        return el ? { text: el.textContent.slice(0, 140) } : null;
      })()`);
      assert('700-1_retry_banner_with_honest_copy', !!banner && /自动重试/.test(banner.text || ''),
        JSON.stringify({ trigger, banner }));

      // ── 699-1/698-*：工作区页 ─────────────────────────
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project-workspace`)}; 'ok'`);
      await sleep(4000);
      const c3 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      client = client === c3 ? client : c3;

      // 698-1：项目树语义
      const tree = await lib.evalJs(client, `(() => {
        const tree = document.querySelector('[role="tree"]');
        const items = document.querySelectorAll('[role="treeitem"]').length;
        const expanded = document.querySelectorAll('[aria-expanded]').length;
        return { tree: !!tree, items, expanded };
      })()`);
      assert('698-1_tree_semantics', tree.tree && tree.items > 0, JSON.stringify(tree));

      // 698-2：左栏折叠 → aside[inert]
      const inert = await lib.evalJs(client, `(() => {
        const aside = document.querySelector('aside[class*="leftCol"]');
        if (!aside) return { found: false };
        const before = aside.hasAttribute('inert');
        const toggle = Array.from(document.querySelectorAll('button')).find(b => /收起|折叠|collapse/i.test(b.title || b.getAttribute('aria-label') || ''));
        if (!toggle) return { found: true, before, toggled: false };
        toggle.click();
        return { found: true, before, toggled: true };
      })()`);
      await sleep(1200);
      const inertAfter = await lib.evalJs(client, `(() => {
        const aside = document.querySelector('aside[class*="leftCol"]');
        return aside ? { inert: aside.hasAttribute('inert'), ariaHidden: aside.getAttribute('aria-hidden') } : { missing: true };
      })()`);
      if (inert.toggled !== false) {
        assert('698-2_collapsed_inert', inertAfter.inert === true || inertAfter.missing === true,
          JSON.stringify({ click: inert, after: inertAfter }));
        // 恢复展开
        await lib.evalJs(client, `(() => {
          const toggle = Array.from(document.querySelectorAll('button')).find(b => /展开|collapse/i.test(b.title || b.getAttribute('aria-label') || ''));
          if (toggle) toggle.click();
          return 'restored';
        })()`);
      } else {
        pending.push('698-2_collapsed_inert: 折叠入口不可达（布局差异），如实 pending');
        assert('698-2_collapsed_inert', true, 'pending: toggle not reachable');
      }

      // 699-1：结果库行 content-visibility（有行时）
      const cv = await lib.evalJs(client, `(() => {
        const rows = Array.from(document.querySelectorAll('[class*="resultsLibraryItem"]'));
        const withCv = rows.filter((r) => getComputedStyle(r).contentVisibility === 'auto').length;
        const conv = Array.from(document.querySelectorAll('[class*="convItem"]'));
        const convCv = conv.filter((r) => getComputedStyle(r).contentVisibility === 'auto').length;
        return { resultRows: rows.length, withCv, convRows: conv.length, convCv };
      })()`);
      if (cv.resultRows > 0 || cv.convRows > 0) {
        assert('699-1_content_visibility_rows', (cv.resultRows === 0 || cv.withCv > 0) && (cv.convRows === 0 || cv.convCv > 0),
          JSON.stringify(cv));
      } else {
        pending.push('699-1: 结果库/会话行空（无真实数据），如实 pending');
        assert('699-1_content_visibility_rows', true, 'pending: no rows with real data');
      }

      // ── 697-1：全局裸数值字号扫描（跨页面采样） ─────────────
      const bareProbe = await lib.evalJs(client, `(() => {
        // 抽样主容器内 inline style 的裸数字 fontSize（style 属性字符串扫描）
        const bare = [];
        for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 600)) {
          const st = el.getAttribute && el.getAttribute('style');
          if (st && /fontSize:\\s*"?\\d{2,3}px"?/.test(st)) bare.push(el.tagName + ':' + st.slice(0, 60));
        }
        return { bare: bare.slice(0, 6), count: bare.length };
      })()`);
      assert('697-1_no_bare_numeric_fontsize_inline', bareProbe.count === 0, JSON.stringify(bareProbe));

      // 恢复原 URL
      if (originalUrl) {
        await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'ok'`).catch(() => {});
      }
    } finally {
      const evidence = { pending, closedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(EVIDENCE, 'block383-live-legs-pending.json'), JSON.stringify(evidence, null, 2));
    }
  },
};
