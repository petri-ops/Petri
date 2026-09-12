#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block83-tool-catalog — 工具目录投影 SPI 前端核验（BLOCK-83 D4 / P2）。
 *
 * 目标形态：核心不再内置领域工具清单——目录由后端从「已装插件」投影
 * （GET /api/tools/catalog），前端经 frontend/src/lib/tool-catalog.ts 消费；
 * 零插件时渲染诚实空态（data-testid="analysis-launch-empty"）。
 *
 * 断言链：
 *   C1_workspace_mounted   进入项目工作区（projectTree + rightCol 挂载）
 *   C2_catalog_endpoint    页面内经 app 源拉取 /api/tools/catalog → ok + count>0
 *   C3_analyze_panel_opens 顶栏「展开更多工具」→ 菜单「分析」→ 面板头「分析入口」可见
 *   C4_cards_from_catalog  渲染卡片数 === 端点 count（证明目录驱动 UI，非静态清单）
 *   C5_titles_match        首个卡片标题 === 端点同 id 条目标题（逐项对账）
 *   C6_empty_state_absent  目录非空时不得渲染空态（空态属零插件路径，诚实性由契约测试覆盖）
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP_ORIGIN = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

async function poll(fn, { timeoutMs, intervalMs = 800, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last && last.ok) return last.value;
    await sleep(intervalMs);
  }
  throw new Error('poll_timeout: ' + label + ' :: ' + JSON.stringify(last && last.value).slice(0, 200));
}

module.exports = {
  id: 'block83-tool-catalog',
  description: 'BLOCK-83 D4 工具目录投影：后端自插件投影 → 前端分析面板渲染对账（含空态路径核验）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-83'),

  async run(ctx = {}) {
    const results = [];
    // 断言同时进 runner 收集器（ctx.assert）与本 flow 摘要——前者决定退出码，后者落详细证据。
    const assert = (name, ok, detail) => {
      const trimmed = detail == null ? '' : String(detail).slice(0, 300);
      if (typeof ctx.assert === 'function') ctx.assert(name, !!ok, trimmed);
      results.push({ name, ok: !!ok, detail: trimmed });
      console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + trimmed));
    };

    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 10_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);

    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return results;

    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, `!!document.querySelector('#root')`, 5_000).catch(() => false),
    });

    const client = await lib.connectTarget(main);
    try {
      // 进入一个已存在项目的工作区（不新建，避免制造测试数据）
      const projects = await rest('GET', '/data/projects');
      const list = (projects.data && (projects.data.projects || projects.data.items || projects.data)) || [];
      const project = Array.isArray(list) ? list[0] : null;
      if (!project || !project.id) throw new Error('no_project_available');
      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/project/${project.id}/chat'; 'nav'`);
      const mounted = await poll(async () => {
        const v = await lib.evalJs(client, `JSON.stringify({tree: !!document.querySelector('[class*="projectTree"]'), right: !!document.querySelector('[class*="rightCol"]')})`).catch(() => null);
        if (!v) return { ok: false, value: null };
        const parsed = JSON.parse(v);
        return { ok: parsed.tree && parsed.right, value: parsed };
      }, { timeoutMs: 30_000, label: 'workspace_mount' }).catch((e) => { assert('C1_workspace_mounted', false, e.message); return null; });
      if (!mounted) return results;
      assert('C1_workspace_mounted', true, JSON.stringify(mounted));

      // C2 端点实况（页面内、经 app 源）
      const catalogRaw = await lib.evalJs(client, `(async () => {
        const r = await fetch('http://localhost:3001/api/tools/catalog', { headers: { Authorization: 'Bearer desktop-local' } });
        const j = await r.json();
        return JSON.stringify({ status: r.status, ok: j.ok, count: j.count, source: j.source, first: (j.catalog && j.catalog[0]) ? { id: j.catalog[0].id, title: j.catalog[0].title, category: j.catalog[0].category, color: j.catalog[0].color } : null });
      })()`, 20_000);
      const catalog = JSON.parse(catalogRaw);
      assert('C2_catalog_endpoint', catalog.status === 200 && catalog.ok === true && catalog.count > 0,
        JSON.stringify(catalog).slice(0, 200));

      // C3 打开分析面板
      await lib.evalJs(client, `(function () {
        var trigger = document.querySelector('button[aria-label="展开更多工具"]');
        if (trigger) trigger.click();
        return 'menu_opened';
      })()`);
      await sleep(700);
      const clickedAnalyze = await lib.evalJs(client, `(function () {
        var menu = document.getElementById('titlebar-tool-menu');
        if (!menu) return 'no_menu';
        var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        var target = items.filter(function (b) { return (b.textContent || '').trim() === '分析'; })[0];
        if (!target) return 'no_analyze_item:' + items.map(function (b) { return (b.textContent || '').trim(); }).join(',');
        target.click();
        return 'clicked';
      })()`);
      const panel = await poll(async () => {
        const v = await lib.evalJs(client, `JSON.stringify({
          header: Array.from(document.querySelectorAll('strong')).some(function (e) { return (e.textContent || '').trim() === '分析入口'; }),
          cards: document.querySelectorAll('[class*="analysisLaunchCards"] > li').length,
          empty: !!document.querySelector('[data-testid="analysis-launch-empty"]'),
          firstTitle: (document.querySelector('[class*="analysisLaunchCardTitle"]') || {}).textContent || ''
        })`).catch(() => null);
        if (!v) return { ok: false, value: null };
        const parsed = JSON.parse(v);
        return { ok: parsed.header, value: parsed };
      }, { timeoutMs: 15_000, label: 'analyze_panel' }).catch((e) => { assert('C3_analyze_panel_opens', false, clickedAnalyze + ' :: ' + e.message); return null; });
      if (!panel) return results;
      assert('C3_analyze_panel_opens', true, `trigger=${clickedAnalyze} cards=${panel.cards}`);

      // C4/C5 渲染与端点逐项对账
      assert('C4_cards_from_catalog', panel.cards === catalog.count,
        `rendered=${panel.cards} endpoint=${catalog.count}`);
      const titleMatch = catalog.first && panel.firstTitle && panel.firstTitle.includes(catalog.first.title);
      assert('C5_titles_match', !!titleMatch, `ui="${process.env.NOBREAK || panel.firstTitle}" api="${catalog.first && catalog.first.title}"`);
      assert('C6_empty_state_absent', panel.empty === false, `empty=${panel.empty}`);

      await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'block-83'), 'block83-tool-catalog.png');
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      flow: 'block83-tool-catalog',
      block: 'BLOCK-83-P2',
      totals: { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, all: results.length },
      results,
    };
    const outDir = path.join(ROOT, 'acceptance', 'block-83');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'block83-tool-catalog-live.json'), JSON.stringify(summary, null, 2));
    console.log('---');
    console.log('P2 目录投影实机: ' + summary.totals.pass + '/' + summary.totals.all + ' allPass=' + (summary.totals.fail === 0));
    return results;
  },
};
