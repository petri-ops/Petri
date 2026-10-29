#!/usr/bin/env node
'use strict';

/**
 * RW-02 A 线 a 档 — UI 证据债 CDP 批量取证（9223 离屏实例）。
 *
 * 分批推进（逐条断言→翻 verified；台账原文为断言契约）：
 *   第一批（欢迎页）：UI-598 计量条无消耗隐藏 + 通用 starter chips；UI-543 领域文案去核。
 *   后续批次：UI-594 斜杠 chip / UI-331 相对时间 / UI-303 档位菜单 / UI-248 / UI-301 /
 *   UI-385 / UI-462 / UI-484 / UI-596 / UI-638（面板发现腿）。
 * 证据：acceptance/rw-02-ui-evidence/rw02-ui-evidence-live.json
 */

const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';

async function evalJs(client, expression, timeoutMs = 15_000) {
  return lib.evalJs(client, expression, timeoutMs);
}

module.exports = {
  id: 'rw02-ui-evidence-live',
  description: 'RW-02 A 线：a 档 UI 证据债 CDP 批量取证（分批：欢迎页→斜杠→面板）',
  evidenceDir: path.join(ROOT, 'acceptance', 'rw-02-ui-evidence'),

  async run(ctx) {
    const { assert } = ctx;
    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 20_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    try {
      // 导航到欢迎页（首页）
      await evalJs(client, `location.href = ${JSON.stringify(`${APP}/`)}; 'navigating'`).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // UI-598a：无消耗时计量条整条隐藏
      const runStats = await evalJs(client, `(function(){
        var el = document.querySelector('[class*="runStats"]');
        if (!el) return 'absent';
        var style = window.getComputedStyle(el);
        return (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) ? 'hidden' : 'visible';
      })()`);
      assert('ui598_runstats_hidden_without_consumption', runStats === 'absent' || runStats === 'hidden', `runStats=${runStats}`);

      // UI-598b + UI-543：starter chips 通用 agent 文案（无生信垂直词）
      const chips = await evalJs(client, `(function(){
        var text = document.body.innerText || '';
        return JSON.stringify({
          generic: ['整理笔记', '写一份总结', '代码走查', '规划任务'].filter(function (t) { return text.indexOf(t) >= 0; }),
          bioLeak: ['差异分析', '富集分析', '聚类分析', '报告解读'].filter(function (t) { return text.indexOf(t) >= 0; }),
        });
      })()`);
      const chipsParsed = JSON.parse(chips);
      assert('ui598_starter_chips_generic', chipsParsed.generic.length > 0 && chipsParsed.bioLeak.length === 0,
        `generic=${JSON.stringify(chipsParsed.generic)} bioLeak=${JSON.stringify(chipsParsed.bioLeak)}`);
      assert('ui543_welcome_copy_neutral', chipsParsed.bioLeak.length === 0, `bioLeak=${JSON.stringify(chipsParsed.bioLeak)}`);

      // UI-543b：无领域包时无领域示例卡（示例卡由 provides.examplePrompts 动态提供）
      const exampleCards = await evalJs(client, `(function(){
        var cards = document.querySelectorAll('[class*="exampleCard"], [class*="examplePrompts"], [data-example-card]');
        return JSON.stringify({ count: cards.length });
      })()`);
      const exampleParsed = JSON.parse(exampleCards);
      assert('ui543_no_domain_example_cards_without_packs', exampleParsed.count === 0, `count=${exampleParsed.count}`);

      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
