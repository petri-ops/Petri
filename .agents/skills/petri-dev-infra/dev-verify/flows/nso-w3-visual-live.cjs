#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: nso-w3-visual-live — BLOCK-371（NSO-W3 F-09/F-10/F-18/W3b）实机走查腿。
 *
 * 隔离纪律（复用 UI-696 flow 形态）：
 *   - 不启动/不重启 Electron，不连接、不 kill 9222 用户主窗；9223 只读 DOM，
 *     记录原 URL 并在 finally 恢复；不设置任何上屏开关。
 *   - 本 flow 不改后端代码，共享 :3001 长活后端即可（prefs PUT 失败由前端侧
 *     fetch 拦截注入模拟，不动后端）。
 *
 * 断言链：
 *   S1 9223 连接 / S2 设置页就绪
 *   F10-1 prefs PUT 失败 → role=status 告警条（服务端同步失败 + 本端已生效）
 *   F10-2 页面重载后告警条消失（内存态，不持久）
 *   F18-1 项目树 role=tree/treeitem/aria-expanded
 *   F18-2 scheduled 入口可达时投影层 inert + aria-hidden（入口不可达则如实记 pending）
 *   W3b-1 结果库行 content-visibility=auto（有行时）
 *   W3b-2 会话行 content-visibility=auto（有行时）
 *   F09-1 binary 产物选中时降级原因可见（库内无 binary 产物则如实记 pending）
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'nso-2026-11-06', 'wave-3b');
const APP = 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** evalJs 在 returnByValue 下对象直接回对象——统一容忍对象/字符串两种形态。 */
function parseEval(value) {
  if (value && typeof value === 'object') return value;
  return JSON.parse(value);
}

module.exports = {
  id: 'nso-w3-visual-live',
  description: 'NSO-W3 实机走查：prefs 失败告警条 / inert / 树语义 / content-visibility / binary 降级原因（9223 离屏、只读+恢复）',
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
      const ready = await lib.evalJs(client,
        `({ ready: document.readyState, title: document.title.slice(0, 60) })`);
      assert('S1_test_instance_connected', !!ready.ready, JSON.stringify(ready));

      // ── F10-1/2：prefs PUT 失败告警条 ─────────────────────────
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=general`)}; 'ok'`);
      await sleep(3000);
      const c2 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c2;
      const generalTab = await lib.evalJs(client, `(function(){
        var t = [].slice.call(document.querySelectorAll('[role="tab"]')).find(function(x){ return (x.innerText||'').indexOf('常规') !== -1; });
        if (t) { t.click(); return 'tab_clicked'; }
        return 'no_tab';
      })()`).catch(() => 'no_tab');
      await sleep(600);
      const settingsReady = await lib.evalJs(client,
        `document.body.innerText.includes('外观') || document.body.innerText.includes('主题') || document.body.innerText.includes('设置')`);
      assert('S2_settings_page_ready', settingsReady === true, `settingsReady=${settingsReady} generalTab=${generalTab}`);

      await lib.evalJs(client, `(function(){
        window.__origFetch = window.fetch;
        window.fetch = function(input, init){
          if (init && init.method === 'PUT') return Promise.reject(new Error('probe-offline'));
          return window.__origFetch.apply(this, arguments);
        };
        return 'patched';
      })()`);
      const themeClicked = await lib.evalJs(client, `(function(){
        var ctl = document.querySelector('.petri-theme-control button');
        if (!ctl) return 'no_control';
        ctl.click(); return 'clicked';
      })()`).catch(() => 'no_control');
      await sleep(600);
      const darkClicked = await lib.evalJs(client, `(function(){
        var opts = [].slice.call(document.querySelectorAll('button, [role="menuitem"], li, label'));
        var target = opts.find(function(x){ return /深色|夜间/.test((x.innerText||'').trim()); });
        if (!target) return 'no_option';
        target.click(); return 'clicked';
      })()`).catch(() => 'no_option');
      await sleep(900);
      const banner = await lib.evalJs(client, `(function(){
        var b = document.querySelector('[data-testid="prefs-sync-failed-banner"]');
        if (!b) return { present: false };
        return { present: true, role: b.getAttribute('role'),
          text: (b.innerText||'').slice(0, 160) };
      })()`).catch((e) => ({ error: e.message }));
      assert('F10_1_prefs_failure_banner_visible', banner.present === true
        && banner.role === 'status'
        && /服务端同步失败/.test(banner.text || '')
        && /本端已生效/.test(banner.text || ''), JSON.stringify({
          themeClicked, darkClicked, banner }).slice(0, 300));

      // F10-2：重载页面 → 内存态清零，告警条不再出现
      await lib.evalJs(client, `location.reload(); 'ok'`);
      await sleep(3000);
      const c3 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c3;
      const bannerAfterReload = await lib.evalJs(client,
        `document.querySelector('[data-testid="prefs-sync-failed-banner"]') ? 'present' : 'absent'`);
      assert('F10_2_banner_gone_after_reload', bannerAfterReload === 'absent', `afterReload=${bannerAfterReload}`);

      // ── F18-1：项目树语义（chat 主页）─────────────────────────
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/p_mvtwf22y_9byo`)}; 'ok'`);
      await sleep(3000);
      const c4 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c4;
      const tree = await lib.evalJs(client, `(function(){
        var t = document.querySelector('[role="tree"][aria-label="项目树"]');
        var items = [].slice.call(document.querySelectorAll('[role="treeitem"]'));
        return { tree: !!t, treeItems: items.length,
          firstExpanded: items.length ? (items[0].getAttribute('aria-expanded') !== null) : null };
      })()`).catch((e) => ({ error: e.message }));
      // 先选中一个已有项目（treeitem 点击 = switchToProject + 展开会话），行数据才会在场
      const projSelected = await lib.evalJs(client, `(function(){
        var rows = [].slice.call(document.querySelectorAll('[role="treeitem"]'));
        if (!rows.length) return 'no_treeitem';
        var nameBtn = rows[0].querySelector('button');
        (nameBtn || rows[0]).click();
        return 'selected';
      })()`).catch(() => 'no_treeitem');
      await sleep(3000);
      assert('F18_1_tree_semantics', tree.tree === true && tree.treeItems > 0 && tree.firstExpanded === true,
        JSON.stringify(tree) + ` projSelected=${projSelected}`);

      // 尝试展开结果库（如有 tab/section header 可点）
      await lib.evalJs(client, `(function(){
        var hdrs = [].slice.call(document.querySelectorAll('[class*="resultsLibraryHeader"] button, [class*="resultsLibrary"] summary, [data-testid*="result"] button'));
        for (var i = 0; i < hdrs.length; i++) { try { hdrs[i].click(); } catch(e) {} }
        return hdrs.length;
      })()`).catch(() => 0);
      await sleep(800);
      // ── W3b-1/2：content-visibility（结果库行 / 会话行）────────
      const cv = await lib.evalJs(client, `(function(){
        function probe(sel){
          var el = document.querySelector(sel);
          if (!el) return { present: false };
          return { present: true, cv: getComputedStyle(el).contentVisibility || getComputedStyle(el)['content-visibility'] };
        }
        return {
          results: probe('[class*="resultsLibraryItem"]'),
          conv: probe('[class*="convItem"]'),
        };
      })()`).catch((e) => ({ error: e.message }));
      const cvParsed = cv;
      if (cvParsed.results.present) {
        assert('W3B_1_results_row_content_visibility_auto', cvParsed.results.cv === 'auto', cv);
      } else {
        pending.push('W3B_1_results_row：结果库无行（当前项目无分析任务），live 腿 pending');
      }
      if (cvParsed.conv.present) {
        assert('W3B_2_conv_row_content_visibility_auto', cvParsed.conv.cv === 'auto', cv);
      } else {
        pending.push('W3B_2_conv_row：当前项目无会话行，live 腿 pending');
      }

      // ── F18-2：scheduled 入口可达时的投影层 inert ─────────────
      // scheduled 模式 URL 直达（useWorkspaceRouting：/project/:id/scheduled）
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/p_mvtwf22y_9byo/scheduled`)}; 'ok'`);
      await sleep(3000);
      const p = await lib.evalJs(client, `(function(){
        var layer = document.querySelector('[data-projection="conversation"]');
        if (!layer) return { layer: false };
        return { layer: true, ariaHidden: layer.getAttribute('aria-hidden'),
          inert: layer.hasAttribute('inert') };
      })()`).catch((e) => ({ error: e.message }));
      if (p.layer && p.ariaHidden === 'true') {
        assert('F18_2_hidden_projection_inert', p.inert === true, JSON.stringify(p));
      } else {
        pending.push(`F18_2：scheduled 投影层状态未达（${JSON.stringify(p).slice(0, 120)}），live 腿 pending`);
      }

      // ── F09-1：binary 产物降级原因可见 ─────────────────────────
      const rows = parseEval(await lib.evalJs(client, `(function(){
        var rows = [].slice.call(document.querySelectorAll('[class*="resultsLibraryItem"]'));
        return JSON.stringify({ count: rows.length });
      })()`).catch((e) => JSON.stringify({ error: e.message })));
      const rowCount = rows.count;
      if (rowCount > 0) {
        let reasonSeen = null;
        for (var i = 0; i < Math.min(rowCount, 6); i++) {
          await lib.evalJs(client, `(function(){
            var rows = [].slice.call(document.querySelectorAll('[class*="resultsLibraryItem"]'));
            if (rows[${i}]) rows[${i}].click();
            return 'clicked';
          })()`);
          await sleep(600);
          const found = await lib.evalJs(client,
            `document.querySelector('[data-testid="viewer-fallback-reason"]') ? document.querySelector('[data-testid="viewer-fallback-reason"]').innerText.slice(0,80) : 'absent'`);
          if (found !== 'absent') { reasonSeen = found; break; }
        }
        if (reasonSeen) {
          assert('F09_1_binary_fallback_reason_visible', String(reasonSeen).length > 0, `reason=${reasonSeen}`);
        } else {
          pending.push(`F09_1：前 ${Math.min(rowCount, 6)} 个产物均为可渲染类型（无 binary 兜底例），live 腿 pending`);
        }
      } else {
        pending.push('F09_1：结果库为空，live 腿 pending');
      }

      // 截图（离屏隐藏窗可能失败 → 如实 unavailable）
      try {
        const shot = await lib.screenshotPng(client, EVIDENCE, 'nso-w3-visual-live.png');
        assert('SHOT_screenshot_captured', !!shot, shot ? 'captured' : 'unavailable');
      } catch (e) {
        assert('SHOT_screenshot_captured', false, `screenshot_unavailable: ${e.message}`);
      }
    } finally {
      if (client) {
        try {
          if (originalUrl) await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'ok'`);
        } catch { /* ignore */ }
        try { client.socket.close(); } catch { /* ignore */ }
      }
      for (const p of pending) {
        // pending 腿如实透出（不计入失败，也不冒绿）
        console.log(`[flow] PENDING ${p}`);
      }
    }
  },
};
