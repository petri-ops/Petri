#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui633-add1 — 提示词优化点击即覆盖（UI-633 加映一）
 * 只连 9223 离屏测试实例；禁 PETRI_TEST_ONSCREEN。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const APP = 'http://localhost:3000';

module.exports = {
  id: 'ui633-add1',
  description: 'UI-633 加映一：sparkles 点击后直接覆盖 composer 原稿（9223 离屏）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'ui-633-add1'),

  async run({ assert }) {
    const target = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const client = target.client || target;
    try {
      await lib.evalJs(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`);
      let ready = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        ready = await lib.evalJs(client, `!!(document.querySelector('[data-testid="composer-input"]') && document.querySelector('[data-testid="prompt-enhance"]'))`);
        if (ready) break;
      }
      assert('P1_composer_ready', ready, 'composer-input + prompt-enhance');
      if (!ready) return false;

      const original = '把下面三行整理成可执行步骤：打开设置、切换模型、保存';
      await lib.evalJs(client, `(function(){
        const input = document.querySelector('[data-testid="composer-input"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(original)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 200));
      const startedAt = Date.now();
      await lib.evalJs(client, `(function(){document.querySelector('[data-testid="prompt-enhance"]').click(); return 'ok';})()`);

      let observed = null;
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        observed = JSON.parse(String(await lib.evalJs(client, `(function(){
          const input = document.querySelector('[data-testid="composer-input"]');
          const status = document.querySelector('[data-testid="prompt-enhance-status"]');
          return JSON.stringify({
            value: input ? input.value : null,
            status: status ? status.textContent : '',
            dialog: !!document.querySelector('[data-testid="prompt-enhance-dialog"]'),
          });
        })()`) || '{}'));
        if (observed.value !== original || /失败/.test(observed.status || '')) break;
      }
      const elapsedMs = Date.now() - startedAt;
      assert('P2_no_preview_dialog', !observed.dialog, JSON.stringify(observed));
      assert('P3_direct_apply_success',
        !!observed.value && observed.value !== original && /已优化/.test(observed.status || ''),
        JSON.stringify(observed));
      assert('P4_quick_latency_under_8s', elapsedMs < 8000, `elapsed=${elapsedMs}ms`);
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }
    return true;
  },
};
