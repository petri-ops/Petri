#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block201-settings-live — BLOCK-201 W2 实机腿（UI-516 / UI-517 / UI-518）
 *
 * 三条腿各管一件事，缺一条就是假绿：
 *   REST 腿＝真后端真落盘（导出信封/导入拒绝零写入/往返幂等/重置回落），证明「校验与写入真的在链上」；
 *   DOM 腿＝9223 测试实例真渲染设置面板，证明「搜索真的过滤导航、备份面真的在维护节」；
 *   重置入口腿＝只有注册表承载的分区才出现「恢复默认」，防止把没做的能力装饰成已提供。
 *
 * 红线：只连 9223（测试实例专属端口），绝不导航用户主窗 9222。
 * 前置：dev 栈在跑（:3001 / :3000）+ `bash scripts/start-test-instance.sh` 已就绪。
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
  id: 'block201-settings-live',
  description: 'BLOCK-201 W2 实机腿：设置搜索过滤 + 全景导出/导入契约 + 按区重置入口（9223 测试实例）',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-201'),

  async run({ assert }) {
    fs.mkdirSync(path.join(process.cwd(), 'acceptance', 'block-201'), { recursive: true });

    // ── REST 腿：真后端真落盘 ──────────────────────────────────
    const exp0 = await rest('GET', '/config/export');
    assert('R1_export_envelope_ok',
      exp0.ok && exp0.data?.config?.format === 'petri-config' && exp0.data.config.version === 1
      && Object.keys(exp0.data.config.families || {}).length === 6,
      `status=${exp0.status} keys=${Object.keys(exp0.data?.config?.families || {}).join(',')}`);

    const serialized = JSON.stringify(exp0.data?.config || {});
    assert('R2_export_has_no_credentials',
      !/apiKey|credential|sk-[A-Za-z0-9]/.test(serialized),
      serialized.slice(0, 200));

    const beforeGen = await rest('GET', '/ai/generation-defaults');
    const beforeTemp = beforeGen.data?.generation?.temperature;

    const badImport = await rest('POST', '/config/import', {
      format: 'petri-config',
      version: 1,
      families: { generation: { temperature: 9, nope: 1 } },
    });
    assert('R3_import_invalid_400_with_diagnostics',
      badImport.status === 400 && (badImport.data?.diagnostics || []).length > 0,
      `status=${badImport.status} diag=${JSON.stringify(badImport.data?.diagnostics).slice(0, 200)}`);

    const afterBadGen = await rest('GET', '/ai/generation-defaults');
    assert('R4_rejected_import_wrote_nothing',
      afterBadGen.data?.generation?.temperature === beforeTemp,
      `before=${beforeTemp} after=${afterBadGen.data?.generation?.temperature}`);

    const goodImport = await rest('POST', '/config/import', {
      format: 'petri-config',
      version: 1,
      families: { generation: { temperature: 0.55 } },
    });
    assert('R5_valid_import_applied', goodImport.ok && (goodImport.data?.applied || []).includes('generation'), JSON.stringify(goodImport.data));

    const exp1 = await rest('GET', '/config/export');
    assert('R6_import_reflected_in_export',
      exp1.data?.config?.families?.generation?.temperature === 0.55,
      JSON.stringify(exp1.data?.config?.families?.generation));

    const replay = await rest('POST', '/config/import', exp1.data.config);
    const exp2 = await rest('GET', '/config/export');
    assert('R7_import_roundtrip_idempotent',
      replay.ok && JSON.stringify(exp2.data?.config?.families) === JSON.stringify(exp1.data?.config?.families),
      `replay=${JSON.stringify(replay.data)}`);

    const badReset = await rest('POST', '/config/reset', { families: ['nope'] });
    assert('R8_reset_unknown_family_400', badReset.status === 400 && (badReset.data?.diagnostics || []).length > 0, `status=${badReset.status}`);

    const reset = await rest('POST', '/config/reset', { families: ['generation'] });
    const exp3 = await rest('GET', '/config/export');
    assert('R9_reset_falls_back_to_default',
      reset.ok && Object.keys(exp3.data?.config?.families?.generation || {}).length === 0,
      JSON.stringify(exp3.data?.config?.families?.generation));

    // ── DOM 腿：9223 测试实例（禁连 9222 用户主窗）──────────────
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const shots = [];
    try {
      const okSettings = await navigate(client, `${APP}/settings`, {
        urlIncludes: ['/settings'],
        selector: '[data-testid="settings-toolbar"]',
      });
      assert('D1_settings_toolbar_rendered', okSettings, 'nav /settings → toolbar');

      const initial = await lib.evalJs(client, `(function(){
        return {
          navItems: document.querySelectorAll('.petri-settings-nav__item').length,
          count: (document.querySelector('[data-testid="settings-search-count"]')||{}).textContent || '',
        };
      })()`);
      assert('D2_all_sections_listed', initial && initial.navItems === 10 && /10 个分区/.test(initial.count), JSON.stringify(initial));

      const search = await lib.evalJs(client, `(async function(){
        const input = document.querySelector('[data-testid="settings-search-input"]');
        if (!input) return { missing: true };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '快捷键');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const hit = {
          navItems: document.querySelectorAll('.petri-settings-nav__item').length,
          count: (document.querySelector('[data-testid="settings-search-count"]')||{}).textContent || '',
        };
        setter.call(input, 'zzz-no-such-setting');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const empty = {
          navItems: document.querySelectorAll('.petri-settings-nav__item').length,
          emptyState: !!document.querySelector('[data-testid="settings-search-empty"]'),
        };
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const cleared = document.querySelectorAll('.petri-settings-nav__item').length;
        return { hit, empty, cleared };
      })()`);
      assert('D3_search_filters_navigation',
        search && search.hit?.navItems === 1 && /命中 1 \/ 10/.test(search.hit?.count || ''),
        JSON.stringify(search));
      assert('D4_no_match_explicit_empty_state',
        search && search.empty?.navItems === 0 && search.empty?.emptyState === true,
        JSON.stringify(search?.empty));
      assert('D5_clear_restores_all_sections', search && search.cleared === 10, `cleared=${search?.cleared}`);

      const shotSearch = await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-201'), 'ui516-settings-search.png');
      shots.push(shotSearch);

      const okMaintenance = await navigate(client, `${APP}/settings?section=maintenance`, {
        urlIncludes: ['section=maintenance'],
        selector: '[data-testid="config-transfer-panel"]',
      });
      assert('D6_config_transfer_panel_in_maintenance', okMaintenance, 'maintenance 节应有配置备份面板');

      const transferDom = await lib.evalJs(client, `(function(){
        const p = document.querySelector('[data-testid="config-transfer-panel"]');
        if (!p) return { missing: true };
        return {
          text: p.innerText.slice(0, 200),
          hasExport: Array.from(p.querySelectorAll('button')).some((b) => b.textContent.includes('导出配置')),
          hasImport: Array.from(p.querySelectorAll('button')).some((b) => b.textContent.includes('导入配置')),
          input: !!p.querySelector('[data-testid="config-import-input"]'),
        };
      })()`);
      assert('D7_transfer_actions_present',
        transferDom && transferDom.hasExport && transferDom.hasImport && transferDom.input,
        JSON.stringify(transferDom).slice(0, 300));

      const shotTransfer = await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-201'), 'ui518-config-transfer.png');
      shots.push(shotTransfer);

      const okKeymap = await navigate(client, `${APP}/settings?section=keymap`, {
        urlIncludes: ['section=keymap'],
        selector: '[data-testid="keymap-panel"]',
      });
      const resetDom = await lib.evalJs(client, `(function(){
        const b = document.querySelector('[data-testid="settings-reset-section"]');
        return { present: !!b, label: b ? b.textContent : '' };
      })()`);
      assert('D8_reset_entry_only_on_registry_section',
        okKeymap && resetDom?.present === true && /恢复「快捷键」默认/.test(resetDom.label || ''),
        JSON.stringify(resetDom));

      const clearReset = await navigate(client, `${APP}/settings?section=general`, {
        urlIncludes: ['section=general'],
        selector: '[data-testid="settings-toolbar"]',
      });
      const generalReset = await lib.evalJs(client, `!!document.querySelector('[data-testid="settings-reset-section"]')`);
      assert('D9_no_fake_reset_on_unregistered_section', clearReset && generalReset === false, `general reset present=${generalReset}`);
    } finally {
      try { client.close(); } catch { /* 会话销毁即可 */ }
    }

    return {
      evidence: {
        screenshots: shots.map((f) => path.basename(f)),
        api: { export: '/api/config/export', import: '/api/config/import', reset: '/api/config/reset' },
      },
    };
  },
};
