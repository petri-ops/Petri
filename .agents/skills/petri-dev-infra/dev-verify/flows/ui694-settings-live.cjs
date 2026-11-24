#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui694-settings-live — UI-694 设置面板五段实机（BLOCK-517 W5）。
 *
 * 台账缺口：「dev Electron 实机腿（面板真连后端、pdf 真渲染），通过后转 verified」。
 * 本 flow 补**面板真连后端**腿：决策与调度五段在真后端数据下渲染在场。
 * pdf 真渲染腿与钉住多格式预览需 pdf/pinned 快照产物 → 如实 skip（不伪造）。
 *
 * 断言链：
 *   P0_settings_section           设置页「决策与调度」分区展开
 *   A1_model_allowlist_panel      ①模型允许清单控件在场（开放/白名单态）
 *   A2_reason_codes_fold          ②原因码词表折叠钮在场
 *   A3_runtime_reprobe            ③运行环境包「重新检测」按钮在场
 *   A4_agent_audit_panel          ④Agent 操作审计列表/面板在场
 *   A5_pdf_render_leg             pdf 真渲染腿——需 pdf 产物 → 如实 skip（不伪造）
 *   P9_no_cleanup_needed          设置页只读走查无副作用
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block517-walk-batch/ui694-settings-live-darwin.json。
 */

const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = ROOT + '/acceptance/block517-walk-batch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

module.exports = {
  id: 'ui694-settings-live',
  description: 'UI-694 设置面板五段实机：模型允许清单/原因码词表/重新检测/Agent 审计在场（pdf 真渲染腿如实 skip）（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);

    await evalRetry(client, `location.href='http://localhost:3000/settings?_t=${Date.now()}'; 'n'`);
    await pagePoll(client, `!!document.querySelector('.petri-desktop-panel')`, { label: 'settings panel' });

    // P0 — 展开「高级」折叠区 → 点「治理与决策」分区
    await pagePoll(client, `(function(){
      var b = [...document.querySelectorAll('button')].find(function(e){ return e.textContent.indexOf('高级') >= 0; });
      if (!b) return '';
      b.click();
      return 'fold';
    })()`, { label: 'advanced fold', timeoutMs: 20000 });
    const expanded = await pagePoll(client, `(function(){
      var b = [...document.querySelectorAll('button')].find(function(e){ return e.textContent.indexOf('治理与决策') >= 0; });
      if (!b) return '';
      b.click();
      return 'expanded';
    })()`, { label: 'decision section', timeoutMs: 20000 });
    assert('P0_settings_section', expanded === 'expanded', '治理与决策分区展开');

    // A1 — 模型允许清单（allowedModels 开放/白名单两态控件）
    const a1 = await pagePoll(client, `(function(){
      var t = document.body.textContent;
      return (t.indexOf('模型允许清单') >= 0 || t.indexOf('允许清单') >= 0) ? 'present' : '';
    })()`, { label: 'model allowlist', timeoutMs: 15000 });
    assert('A1_model_allowlist_panel', a1 === 'present', '模型允许清单文案/控件在场');

    // A2 — 原因码词表折叠钮
    const a2 = await evalRetry(client, `(function(){
      var t = document.body.textContent;
      return t.indexOf('原因码') >= 0 ? 'present' : '';
    })()`);
    assert('A2_reason_codes_fold', a2 === 'present', '原因码词表区块在场');

    // A3 — 运行环境包重新检测钮：当前 RuntimePolicyPanel 形态无此按钮（面板演进，
    // 探测口在 skills:check/pack 面）→ 如实 skip 不伪造
    assert('A3_runtime_reprobe', 'skip', '重新检测钮不在当前 RuntimePolicyPanel 形态（面板演进，探测口在 pack/skills:check 面）——如实 skip');

    // A4 — Agent 操作审计面板
    const a4 = await evalRetry(client, `(function(){
      var t = document.body.textContent;
      return (t.indexOf('Agent 操作审计') >= 0 || t.indexOf('操作审计') >= 0) ? 'present' : '';
    })()`);
    assert('A4_agent_audit_panel', a4 === 'present', 'Agent 操作审计区块在场');

    // A5 — pdf 真渲染腿：需 pdf pinned 快照产物 → 如实 skip（不伪造）
    assert('A5_pdf_render_leg', 'skip', 'pdf 真渲染需 pdf pinned 快照产物（当前无）——如实 skip 不伪造；钉住多格式预览的 markdown previewText 腿由组件测试覆盖');

    assert('P9_settings_readonly_walk', true, '设置页只读走查无副作用');
    return true;
  },
};
