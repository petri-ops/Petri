#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow 模板 — 拷贝为 flows/<your-flow-id>.cjs 后改写。
 * run.cjs 会忽略 _template.cjs 本身。
 *
 * 纪律：
 *   - 只连接既有 dev 栈（npm run dev + remote-debugging-port），不启动/不重启 Electron；
 *   - 断言用 lib 原语组装；证据 JSON 由 createRun 自动落盘，勿手工伪造；
 *   - 每条断言 fail 时带可定位的 detail（选择器/表达式/期望 vs 实际）。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

module.exports = {
  id: 'your-flow-id',
  description: '一句话描述本 flow 验证什么',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'your-block'),

  async run(ctx) {
    const { assert } = ctx;

    // 1) ready：等待 CDP 端点（dev Electron 未起会带启动指引超时失败）
    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 10_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);

    // 2) target：URL 预筛 + 主窗探测（BLOCK-68 教训：按项目树+右栏判真主窗）
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(
        client,
        `!!(document.querySelector('[class*="projectTree"]') && document.querySelector('[class*="rightCol"]'))`,
        5_000,
      ).catch(() => false),
    });

    // 3) capture + assert：求值/截图 + 断言
    const client = await lib.connectTarget(main);
    try {
      const health = JSON.parse(await lib.evalJs(client, `JSON.stringify({ title: document.title })`));
      assert('document_title_non_empty', typeof health.title === 'string' && health.title.length > 0, health.title);
      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'your-block'), 'your-flow.png');
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
    return true;
  },
};
