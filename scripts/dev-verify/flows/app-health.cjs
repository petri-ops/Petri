#!/usr/bin/env node
'use strict';

/**
 * dev-verify 示范 flow：app-health — dev 栈健康检查（BLOCK-71）
 *
 * 断言：
 *   1) CDP 端点可列出 targets（dev Electron 在跑且带 remote-debugging-port）
 *   2) 至少一个 localhost:3000 页面 target
 *   3) 主窗页面 document.title 非空且 SPA 根节点已挂载（#root 有子节点）
 * 证据：acceptance/dev-verify/app-health-live.json
 *
 * 前置：dev 栈已在跑（BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev）。
 * 本 flow 不启动/不重启 Electron，环境未就绪时诚实失败并带启动指引。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

module.exports = {
  id: 'app-health',
  description: 'dev 栈健康检查：CDP 可达 + 页面 target 存在 + SPA 已挂载',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'dev-verify'),

  async run(ctx) {
    const { assert } = ctx;
    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 10_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);

    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');

    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, `!!(document.querySelector('[class*="projectTree"]') && document.querySelector('[class*="rightCol"]'))`, 5_000).catch(() => false),
    });
    const client = await lib.connectTarget(main);
    try {
      const health = await lib.evalJs(client, `JSON.stringify({ title: document.title, mounted: !!document.getElementById('root')?.childElementCount })`);
      const h = JSON.parse(health);
      assert('document_title_non_empty', typeof h.title === 'string' && h.title.length > 0, h.title);
      assert('spa_root_mounted', h.mounted === true, `root childElementCount>0=${h.mounted}`);
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
