#!/usr/bin/env node
/**
 * BLOCK-266 — composer 视觉收缩实机腿：ModelChip 图标化 + RunStatsBar 图标态。
 * 在 BLOCK-265 同款隔离栈上断言（亮/暗一轮各一次）：
 *   V1 ModelChip 两钮无常驻文字（图标钮），title 携带供应商/模型名
 *   V2 RunStatsBar 条内零数字文字（图标+环），title 承载读数
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP_ORIGIN = 'http://localhost:3000';
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

module.exports = {
  async run({ assert }) {
    const client = await lib.connectTarget(
      (await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 }))
        .filter((t) => /^http:\/\/localhost:3000\//.test(t.url))
        .find(async (t) => { try { return await lib.evalJs(t, `!!document.getElementById('root')`); } catch { return false; } }),
    );

    // 进一个项目工作台（composer 所在）
    await client.send('Page.navigate', { url: `${APP_ORIGIN}/` });
    await sleep(2500);

    // V1 ModelChip：图标钮 + 无常驻文字
    const chip = await lib.evalJs(client, `
      (function(){
        const sup = document.querySelector('[data-testid="model-chip-supplier"]');
        const model = document.querySelector('[data-testid="model-chip-model"]');
        if (!sup || !model) return JSON.stringify({ ok: false, error: 'chip-not-found' });
        return JSON.stringify({
          ok: true,
          supText: (sup.textContent || '').trim(),
          supTitle: sup.getAttribute('title') || '',
          modelText: (model.textContent || '').trim(),
          modelTitle: model.getAttribute('title') || '',
          supWidth: sup.getBoundingClientRect().width,
          modelWidth: model.getBoundingClientRect().width,
        });
      })()
    `, 8000);
    const chipParsed = JSON.parse(chip);
    assert('V1_model_chip_iconic',
      chipParsed.ok && chipParsed.supText === '' && chipParsed.modelText === ''
      && chipParsed.supTitle && chipParsed.modelTitle
      && chipParsed.supWidth < 48 && chipParsed.modelWidth < 56,
      `sup=${chipParsed.supWidth}px title="${(chipParsed.supTitle || '').slice(0, 24)}" model=${chipParsed.modelWidth}px title="${(chipParsed.modelTitle || '').slice(0, 30)}"（图标钮零常驻文字）`);

    // V2 RunStatsBar：条内零数字文字
    const strip = await lib.evalJs(client, `
      (function(){
        const bar = document.querySelector('[data-testid="run-stats-bar"]');
        if (!bar) return JSON.stringify({ ok: false, error: 'bar-not-found' });
        const conv = bar.querySelector('[data-testid="run-stats-conversation"]');
        return JSON.stringify({
          ok: true,
          text: (bar.textContent || '').trim(),
          convTitle: conv ? (conv.getAttribute('title') || '') : null,
          height: bar.getBoundingClientRect().height,
        });
      })()
    `, 8000);
    const stripParsed = JSON.parse(strip);
    // 上下文段的视觉隐藏 span 含 'N%'（可访问性读数，clip 掉不占版面）——剔除后核零数字
    const visibleText = String(stripParsed.text).replace(/\d+%/g, '');
    const noNumbers = stripParsed.ok && !/\d/.test(visibleText);
    assert('V2_run_stats_iconic',
      stripParsed.ok && noNumbers && stripParsed.convTitle && stripParsed.height <= 26,
      `text="${stripParsed.text}" visible="${visibleText}" title="${(stripParsed.convTitle || '').slice(0, 36)}" h=${stripParsed.height}px（图标+环，读数在 title，不换行）`);
  },
};
