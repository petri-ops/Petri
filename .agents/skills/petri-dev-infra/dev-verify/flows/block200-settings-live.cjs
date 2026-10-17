#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block200-settings-live — BLOCK-200 P4 实机腿（UI-514 / UI-515）
 *
 * 三条腿各管一件事，缺一条就是假绿：
 *   REST 腿＝真后端真落盘（写侧守卫 400/解绑/读回），证明"配置确实进了盘"；
 *   DOM 腿＝9223 测试实例真渲染两节，证明"注册表的值就是界面显示的值"（同源）；
 *   派发腿＝在真页面把绑定改掉后，旧组合不再触发、新组合触发，证明"改了键位真的跟着变"。
 *
 * 红线：只连 9223（测试实例专属端口），绝不导航用户主窗 9222。
 * 前置：dev 栈在跑（后端 :3001）+ `bash scripts/start-test-instance.sh` 已就绪。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const APP = 'http://localhost:3000';

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function navigate(client, url, opts = {}) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'ok'`);
  const needles = opts.urlIncludes || [];
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await lib.evalJs(client, `(function(){
      const here = String(location.href);
      for (const needle of ${JSON.stringify(needles)}) if (here.indexOf(needle) === -1) return false;
      ${opts.selector ? `return !!document.querySelector(${JSON.stringify(opts.selector)});` : 'return document.readyState === "complete";'}
    })()`);
    if (ready) return true;
  }
  return false;
}

module.exports = {
  id: 'block200-settings-live',
  description: 'BLOCK-200 P4 实机腿：键位与推理档位设置面（REST 写侧拒绝 + DOM 同源显示 + 真页面派发跟随）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-200'),

  async run({ assert }) {
    // ── REST 腿：真后端真落盘 ──────────────────────────────────
    const km0 = await rest('GET', '/keymap');
    assert('R1_keymap_get_ok', km0.ok && km0.data && km0.data.status === 'ok', `status=${km0.status}`);

    const kmPut = await rest('PUT', '/keymap', { bindings: { 'nav-projects': 'Mod+Alt+P' } });
    assert('R2_keymap_put_valid_200', kmPut.ok && kmPut.data?.bindings?.['nav-projects'] === 'Mod+Alt+P', JSON.stringify(kmPut.data).slice(0, 160));

    const kmBack = await rest('GET', '/keymap');
    assert('R3_keymap_persisted_readback', kmBack.data?.bindings?.['nav-projects'] === 'Mod+Alt+P', JSON.stringify(kmBack.data?.bindings));

    const kmBad = await rest('PUT', '/keymap', { bindings: { 'nav-home': 'Mod+Mod+K' } });
    assert('R4_keymap_illegal_combo_400_with_diagnostics',
      kmBad.status === 400 && Array.isArray(kmBad.data?.diagnostics) && kmBad.data.diagnostics.length > 0,
      `status=${kmBad.status} diag=${JSON.stringify(kmBad.data?.diagnostics).slice(0, 160)}`);

    const kmUnknown = await rest('PUT', '/keymap', { bindings: { 'nav-typo': 'Mod+J' } });
    assert('R5_keymap_unknown_command_400',
      kmUnknown.status === 400 && (kmUnknown.data?.diagnostics || []).some((d) => d.code === 'unknown-key'),
      `status=${kmUnknown.status} diag=${JSON.stringify(kmUnknown.data?.diagnostics).slice(0, 160)}`);

    const afterRejects = await rest('GET', '/keymap');
    assert('R6_rejected_writes_left_no_trace',
      afterRejects.data?.bindings?.['nav-home'] === undefined && afterRejects.data?.bindings?.['nav-projects'] === 'Mod+Alt+P',
      JSON.stringify(afterRejects.data?.bindings));

    const kmReset = await rest('PUT', '/keymap', { bindings: { 'nav-projects': null } });
    assert('R7_unbind_clears_store', kmReset.ok && kmReset.data?.bindings?.['nav-projects'] === undefined, JSON.stringify(kmReset.data?.bindings));

    const rs0 = await rest('GET', '/ai/reasoning-defaults');
    const snap = rs0.data?.reasoning;
    assert('R8_reasoning_snapshot_in_registers',
      rs0.ok && snap && snap.levels?.length === 3 && Object.keys(snap.protocols || {}).length === 3
      && snap.effective?.defaultLevel === 'standard',
      `levels=${JSON.stringify(snap?.levels)} protocols=${Object.keys(snap?.protocols || {}).join(',')}`);

    const rsPut = await rest('PUT', '/ai/reasoning-defaults', { defaultLevel: 'high' });
    assert('R9_reasoning_default_level_persists', rsPut.ok && rsPut.data?.reasoning?.effective?.defaultLevel === 'high', JSON.stringify(rsPut.data?.reasoning?.effective));

    const rsCross = await rest('PUT', '/ai/reasoning-defaults', { mapping: { 'openai-compatible': { high: 'thinking:enabled' } } });
    assert('R10_cross_protocol_token_400',
      rsCross.status === 400 && (rsCross.data?.diagnostics || []).length > 0,
      `status=${rsCross.status} diag=${JSON.stringify(rsCross.data?.diagnostics).slice(0, 180)}`);

    const rsOut = await rest('PUT', '/ai/reasoning-defaults', { anthropicHighBudgetTokens: 24000 });
    assert('R11_budget_editable', rsOut.ok && rsOut.data?.reasoning?.effective?.anthropicHighBudgetTokens === 24000, JSON.stringify(rsOut.data?.reasoning?.effective));

    // 还原出厂（腿与腿之间不留残留状态）
    const rsClear = await rest('PUT', '/ai/reasoning-defaults', { defaultLevel: null, anthropicHighBudgetTokens: null });
    assert('R12_restore_factory', rsClear.ok && rsClear.data?.reasoning?.effective?.defaultLevel === 'standard'
      && rsClear.data?.reasoning?.effective?.anthropicHighBudgetTokens === 16000,
      JSON.stringify(rsClear.data?.reasoning?.effective));

    // ── DOM 腿：9223 测试实例（禁连 9222 用户主窗）──────────────
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const shots = [];
    try {
      const okKeymap = await navigate(client, `${APP}/settings?section=keymap`, { urlIncludes: ['section=keymap'], selector: '[data-testid="keymap-panel"]' });
      assert('D1_keymap_section_reachable', okKeymap, 'nav /settings?section=keymap');

      const panel = await lib.evalJs(client, `(function(){
        const p = document.querySelector('[data-testid="keymap-panel"]');
        if (!p) return { missing: true, body: document.body.innerText.slice(0, 160) };
        const rows = Array.from(p.querySelectorAll('[data-testid^="keymap-row-"]'));
        const combos = rows.map((r) => {
          const id = r.getAttribute('data-testid').replace('keymap-row-', '');
          const c = r.querySelector('[data-testid^="keymap-combo-"]');
          return id + '=' + (c ? c.textContent : '?');
        });
        return { rows: rows.length, combos: combos.join(' | '), defaultBtns: p.querySelectorAll('button').length };
      })()`);
      assert('D2_keymap_rows_from_registry',
        !!panel && panel.rows === 10 && /nav-home=Ctrl\+N/.test(panel.combos || '') && /palette\.toggle=Ctrl\+K/.test(panel.combos || ''),
        JSON.stringify(panel).slice(0, 300));

      // 同源证明：改盘上的值 → 界面文本必须跟着变（不是另抄一份显示清单）
      await rest('PUT', '/keymap', { bindings: { 'nav-home': 'Mod+Shift+7' } });
      await navigate(client, `${APP}/settings?section=keymap`, { urlIncludes: ['section=keymap'], selector: '[data-testid="keymap-combo-nav-home"]' });
      const afterEdit = await lib.evalJs(client, `(document.querySelector('[data-testid="keymap-combo-nav-home"]')||{}).textContent`);
      assert('D3_badge_follows_stored_binding', /Ctrl\+Shift\+7/.test(String(afterEdit)), `badge=${afterEdit}`);

      // 派发跟随：旧默认 Ctrl+N 不再触发导航，新组合触发（真页面真派发器）
      const navProbe = await lib.evalJs(client, `(async () => {
        const seen = { before: location.pathname };
        const fire = (init) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init)));
        fire({ key: 'n', ctrlKey: true });                     // 旧默认组合
        await new Promise((r) => setTimeout(r, 700));
        const afterOld = location.pathname;
        fire({ key: '7', ctrlKey: true, shiftKey: true });      // 新绑定
        await new Promise((r) => setTimeout(r, 900));
        return JSON.stringify({ before: seen.before, afterOld, afterNew: location.pathname });
      })()`);
      const nav = JSON.parse(String(navProbe || '{}'));
      assert('D4_dispatch_follows_rebind',
        nav.before === nav.afterOld && nav.afterNew === '/' && nav.before !== '/',
        JSON.stringify(nav));

      await rest('PUT', '/keymap', { bindings: { 'nav-home': null } });
      const shotKeymap = await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-200'), 'ui514-keymap-section.png');
      shots.push(shotKeymap);

      await navigate(client, `${APP}/settings?section=reasoning`, { urlIncludes: ['section=reasoning'], selector: '[data-testid="reasoning-mapping-table"]' });
      const reasoningDom = await lib.evalJs(client, `(function(){
        const p = document.querySelector('[data-testid="reasoning-defaults"]');
        if (!p) return { missing: true, body: document.body.innerText.slice(0, 160) };
        const sel = document.querySelector('[data-testid="reasoning-default-level"]');
        const table = document.querySelector('[data-testid="reasoning-mapping-table"]');
        return {
          levelOptions: sel ? sel.options.length : 0,
          levelValue: sel ? sel.value : '',
          budget: (document.querySelector('[data-testid="reasoning-anthropic-budget"]')||{}).value,
          tableRows: table ? table.rows.length : 0,
        };
      })()`);
      assert('D5_reasoning_section_renders',
        !!reasoningDom && reasoningDom.levelOptions === 3 && reasoningDom.levelValue === 'standard'
        && reasoningDom.budget === '16000' && reasoningDom.tableRows === 4,
        JSON.stringify(reasoningDom));

      const shotReasoning = await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-200'), 'ui515-reasoning-section.png');
      shots.push(shotReasoning);
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }

    return { evidence: { screenshots: shots.map((f) => path.basename(f)), api: { keymap: '/api/keymap', reasoning: '/api/ai/reasoning-defaults' } } };
  },
};
