#!/usr/bin/env node
'use strict';

/**
 * BLOCK-156 P1 实机校验 flow — 扩展中心四货架 + 旧路由重定向 + D2 分类学接线。
 *
 * 前置：主 dev 栈在跑 + 测试实例（bash scripts/start-test-instance.sh，CDP 9223）。
 * 断言：①/extensions 四货签在场且默认领域插件（嵌入商店面板、无双重页头）
 * ②D2 接线：领域技能货签含 bioinformatics 技能、通用技能货签含 coding playbook 且互不混
 * ③MCP 货签 P1 占位在场 ④旧深链 /plugins /skills fail-closed 重定向到对应货签。
 * 红线：只连测试实例 9223（connectTestTarget），绝不触碰 9222 用户主窗口。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRetry(client, expr, tries = 10) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(400); }
  }
  throw lastErr;
}

module.exports = {
  id: 'block156-extensions-hub',
  description: 'BLOCK-156 P1：扩展中心四货架在场/D2 分类学接线/MCP 占位/旧深链重定向',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-156'),

  async run(ctx) {
    const { assert } = ctx;
    const client = await lib.connectTestTarget({ timeoutMs: ctx.timeoutMs ?? 30_000 });
    try {
      // ── A1: /extensions 四货签在场，默认领域插件 ──
      await lib.evalJs(client, `location.href = 'http://localhost:3000/extensions'; 'nav'`);
      await sleep(2500);
      const hub = JSON.parse(await evalRetry(client, `(function(){
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
          .filter((t) => t.offsetParent !== null)
          .map((t) => ({ label: t.textContent.trim(), selected: t.getAttribute('aria-selected') }));
        const pageHeader = !!document.querySelector('[data-testid="extensions-page"]');
        const panel = document.querySelector('[aria-label="插件商店"]');
        const backBtns = Array.from(document.querySelectorAll('button'))
          .filter((b) => b.offsetParent !== null && b.textContent.trim() === '返回');
        const storeTitle = Array.from(document.querySelectorAll('h2'))
          .some((h) => h.offsetParent !== null && h.textContent.trim() === '插件商店');
        return JSON.stringify({ tabs, pageHeader, panelRole: panel ? panel.getAttribute('role') : null, backBtnCount: backBtns.length, storeTitle });
      })()`));
      const labels = hub.tabs.map((t) => t.label);
      assert('extensions_hub_four_shelves_present',
        ['领域插件', '领域技能', '通用技能', 'MCP 服务'].every((l) => labels.includes(l)),
        JSON.stringify(labels));
      assert('default_shelf_domain_plugins',
        hub.tabs.find((t) => t.label === '领域插件')?.selected === 'true',
        JSON.stringify(hub.tabs));
      assert('plugin_store_embedded_no_double_header',
        hub.pageHeader && hub.panelRole === 'region' && !hub.storeTitle && hub.backBtnCount === 1,
        `pageHeader=${hub.pageHeader} panelRole=${hub.panelRole} storeTitle=${hub.storeTitle} backBtns=${hub.backBtnCount}`);

      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-156'), 'p1-hub-domain-plugins.png');

      // ── A2: D2 接线——领域技能货签（真实内置技能：bioinformatics/*） ──
      const domain = JSON.parse(await evalRetry(client, `(function(){
        const tab = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((t) => t.textContent.trim() === '领域技能');
        if (!tab) return JSON.stringify({ clicked: false });
        tab.click(); return JSON.stringify({ clicked: true });
      })()`));
      await sleep(1200);
      const domainShelf = await evalRetry(client, `(function(){
        const pane = document.querySelector('[data-testid="skill-shelf-domain-skills"]');
        if (!pane) return JSON.stringify({ pane: false });
        const text = pane.textContent || '';
        return JSON.stringify({ pane: true, hasDeg: text.includes('DEG'), hasGo: text.includes('GO 富集') || text.includes('GO富集'), hasCoding: text.includes('编码') || text.includes('coding'), count: (pane.querySelector('[class*="shelfCount"]')||{}).textContent });
      })()`, 15);
      const ds = JSON.parse(domainShelf);
      assert('domain_skills_shelf_bioinformatics_only',
        ds.pane && ds.hasDeg && !ds.hasCoding,
        `clicked=${domain.clicked} pane=${ds.pane} deg=${ds.hasDeg} coding=${ds.hasCoding}`);

      // ── A3: D2 接线——通用技能货签（coding-playbook 既成实例） ──
      await evalRetry(client, `(function(){
        const tab = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((t) => t.textContent.trim() === '通用技能');
        if (!tab) return 'not-found';
        tab.click(); return 'clicked';
      })()`);
      await sleep(1200);
      const generalShelf = await evalRetry(client, `(function(){
        const pane = document.querySelector('[data-testid="skill-shelf-general-skills"]');
        if (!pane) return JSON.stringify({ pane: false });
        const text = pane.textContent || '';
        return JSON.stringify({ pane: true, hasCoding: text.includes('编码') || text.includes('coding'), hasDeg: text.includes('DEG') });
      })()`, 15);
      const gs = JSON.parse(generalShelf);
      assert('general_skills_shelf_coding_playbook_only',
        gs.pane && gs.hasCoding && !gs.hasDeg,
        `pane=${gs.pane} coding=${gs.hasCoding} deg=${gs.hasDeg}`);

      // ── A4: MCP 货签 P1 占位在场 ──
      await evalRetry(client, `(function(){
        const tab = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((t) => t.textContent.trim() === 'MCP 服务');
        if (!tab) return 'not-found';
        tab.click(); return 'clicked';
      })()`);
      await sleep(800);
      const mcpPlaceholder = await evalRetry(client,
        `!!document.querySelector('[data-testid="mcp-shelf-placeholder"]')`);
      assert('mcp_shelf_placeholder_present', mcpPlaceholder === true, String(mcpPlaceholder));

      // ── A5: 旧深链 /plugins → 领域插件货签（fail-closed 重定向） ──
      await lib.evalJs(client, `location.href = 'http://localhost:3000/plugins'; 'nav'`);
      await sleep(2500);
      const pluginsRedirect = JSON.parse(await evalRetry(client, `(function(){
        const sel = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((t) => t.textContent.trim() === '领域插件');
        return JSON.stringify({
          url: location.pathname + location.search,
          hub: !!document.querySelector('[data-testid="extensions-page"]'),
          domainPluginsSelected: sel ? sel.getAttribute('aria-selected') : 'missing',
        });
      })()`));
      assert('legacy_plugins_deep_link_redirects',
        pluginsRedirect.hub && pluginsRedirect.domainPluginsSelected === 'true',
        JSON.stringify(pluginsRedirect));

      // ── A6: 旧深链 /skills → 领域技能货签 ──
      await lib.evalJs(client, `location.href = 'http://localhost:3000/skills'; 'nav'`);
      await sleep(2500);
      const skillsRedirect = JSON.parse(await evalRetry(client, `(function(){
        const sel = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((t) => t.textContent.trim() === '领域技能');
        return JSON.stringify({
          url: location.pathname + location.search,
          hub: !!document.querySelector('[data-testid="extensions-page"]'),
          domainSkillsSelected: sel ? sel.getAttribute('aria-selected') : 'missing',
        });
      })()`));
      assert('legacy_skills_deep_link_redirects',
        skillsRedirect.hub && skillsRedirect.domainSkillsSelected === 'true',
        JSON.stringify(skillsRedirect));
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
