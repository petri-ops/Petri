#!/usr/bin/env node
// BLOCK-100 P5 — 测试实例隔离实机校验 flow。
// 前置：主 dev 栈在跑 + bash scripts/start-test-instance.sh（测试实例 READY）。
// 断言：①离屏可见窗口 ②输入屏蔽双向（屏蔽吞合成点击/恢复后放行）
// ③withInputShield 崩溃兜底恢复 ④用户实例零扰动（9222 无 test=1 目标）。
'use strict';
const lib = require('../lib.cjs');
const path = require('path');

module.exports = {
  id: 'block100-test-instance',
  description: '测试实例隔离：离屏窗口/输入屏蔽双向/崩溃兜底/用户实例零扰动',
  evidenceDir: path.join(lib.findRepoRoot(__dirname) || process.cwd(), 'acceptance', 'block-100'),

  async run(ctx) {
    const { assert } = ctx;

    async function syntheticClick(client, x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    }

    const client = await lib.connectTestTarget({ timeoutMs: (ctx.timeoutMs ?? 30_000) });
    assert('test_instance_target_connected', true, '9223 ?test=1 target');

    const bounds = JSON.parse(await lib.evalJs(client,
      `JSON.stringify({ x: window.screenX, y: window.screenY, vis: document.visibilityState, w: window.innerWidth })`));
    // 2026-09-18 放宽：x 位置仅记录不断言——默认离屏摆放，但用户可 --onscreen
    // 启动或随时拖回屏幕内（「能够看到测试的情况」），渲染可见性才是断言本体。
    assert('test_window_rendering_visible',
      bounds.vis === 'visible' && bounds.w >= 720,
      `x=${bounds.x} vis=${bounds.vis} w=${bounds.w}（hidden/minimized 有渲染冻结反例，禁用）`);

    await lib.evalJs(client, `window.__clicks = 0; document.addEventListener('click', () => window.__clicks++, true); 'ok'`);
    await client.send('Input.setIgnoreInputEvents', { ignore: true });
    await syntheticClick(client, 300, 300);
    const shieldedClicks = Number(await lib.evalJs(client, `window.__clicks`));
    await client.send('Input.setIgnoreInputEvents', { ignore: false });
    await syntheticClick(client, 300, 300);
    const unshieldedClicks = Number(await lib.evalJs(client, `window.__clicks`));
    assert('input_shield_blocks_all_input',
      shieldedClicks === 0 && unshieldedClicks > 0,
      `shielded=${shieldedClicks} unshielded=${unshieldedClicks}（屏蔽连合成输入一并吞，D6：交互型 flow 禁用）`);

    let crashFallbackRestored = false;
    try {
      await lib.withInputShield(client, async () => { throw new Error('boom'); });
    } catch { /* 预期异常 */ }
    const before = Number(await lib.evalJs(client, `window.__clicks`));
    await syntheticClick(client, 300, 300);
    const after = Number(await lib.evalJs(client, `window.__clicks`));
    crashFallbackRestored = after > before;
    assert('input_shield_crash_fallback_restores', crashFallbackRestored,
      `withInputShield 内抛异常后 finally 恢复输入（clicks ${before}→${after}）`);

    const userTargets = await lib.pollTargets({ port: 9222, timeoutMs: 10_000 });
    const userPages = userTargets.filter((t) => t.type === 'page');
    assert('user_instance_untouched',
      userPages.length > 0 && userPages.every((t) => !String(t.url).includes('test=1')),
      userPages.map((t) => t.url).join(' | ').slice(0, 200) || 'none');

    return true;
  },
};
