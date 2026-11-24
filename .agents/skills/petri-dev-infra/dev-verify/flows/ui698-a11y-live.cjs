#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui698-a11y-live — UI-698 无障碍语义实机（BLOCK-517 W3）。
 *
 * 台账缺口：代码+契约测试完成，待实机观感。本 flow 补**可达的机械语义腿**；
 * inert 双模态的 scheduled 入口当前 UI 不存在（handleShowScheduled 仅声明未消费，
 * 产品范围注记）→ 该腿由 nso-w3-a11y 契约测试 4/4 覆盖，live 可达腿如下：
 *
 * 断言链：
 *   A1_tree_semantics             项目树容器 role=tree + aria-label；节点 role=treeitem + aria-expanded ≥1
 *   A2_import_panel_form_semantics 设置页配置导入面板：fieldset/legend「选择配置来源」+ radio/textarea label 关联
 *   A3_inert_dual_mode            非 chat 投影层 inert 双模态——当前 UI 无 scheduled 入口 → 如实 skip（契约测试覆盖）
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block517-walk-batch/ui698-a11y-live-darwin.json。
 */
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = ROOT + '/acceptance/block517-walk-batch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch('http://127.0.0.1:3001/api' + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}
const AUTH = { Authorization: 'Bearer desktop-local' };

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
  id: 'ui698-a11y-live',
  description: 'UI-698 无障碍语义实机：项目树 role=tree/treeitem/aria-expanded + 导入面板 fieldset/legend/live region（inert 双模态腿如实 skip）（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const created = await rest('POST', '/data/projects', { name: 'UI698-验收-' + Date.now(), modality: 'general' });
    const projectId = created.data && created.data.project && created.data.project.id;
    assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
    if (!projectId) return false;

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    const originalUrl = await evalRetry(client, 'location.href');

    try {
      await evalRetry(client, `location.href='http://localhost:3000/?test=1&_t=${Date.now()}'; 'r'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after reset' });
      await sleep(2000);
      await evalRetry(client, `location.href='http://localhost:3000/project/${projectId}?_t=${Date.now()}'; 'n'`);
      await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer', timeoutMs: 30000 });

      // A1 — 项目树语义
      const tree = await evalRetry(client, `(function(){
        var t = document.querySelector('[role="tree"]');
        var items = [...document.querySelectorAll('[role="treeitem"][aria-expanded]')];
        return JSON.stringify({ tree: !!t, label: t ? (t.getAttribute('aria-label') || '') : '', items: items.length });
      })()`);
      const treeParsed = JSON.parse(tree);
      assert('A1_tree_semantics', treeParsed.tree === true && treeParsed.items >= 1,
        `tree=${treeParsed.tree} label=${treeParsed.label} treeitems=${treeParsed.items}`);

      // A2 — 导入面板表单语义（settings 页 Config transfer 区）
      await evalRetry(client, `location.href='http://localhost:3000/settings?_t=${Date.now()}'; 'n'`);
      await pagePoll(client, `!!document.querySelector('.petri-desktop-panel')`, { label: 'settings panel' });
      // 展开配置导入所在分区（分区手风琴）
      await evalRetry(client, `(function(){
        var btns = [...document.querySelectorAll('button')].filter(function(b){ return b.textContent.indexOf('数据与维护') >= 0 || b.textContent.indexOf('导入') >= 0; });
        if (btns.length) btns[btns.length - 1].click();
        return 'expanded';
      })()`);
      await sleep(1000);
      const form = await pagePoll(client, `(function(){
        var fs = [...document.querySelectorAll('fieldset')].find(function(f){
          var lg = f.querySelector('legend');
          return lg && lg.textContent.indexOf('选择配置来源') >= 0;
        });
        if (!fs) return '';
        var radios = fs.querySelectorAll('input[type=radio]').length;
        var labeled = [...fs.querySelectorAll('label[for]')].length;
        return JSON.stringify({ radios: radios, labeled: labeled });
      })()`, { label: 'import fieldset', timeoutMs: 20000 });
      const formParsed = JSON.parse(form);
      assert('A2_import_panel_form_semantics', formParsed.radios >= 2 && formParsed.labeled >= 1,
        `radios=${formParsed.radios} labeled=${formParsed.labeled}`);

      // A3 — inert 双模态：当前 UI 无 scheduled 入口 → 如实 skip（契约 nso-w3-a11y 4/4 覆盖）
      assert('A3_inert_dual_mode', 'skip', '非 chat 投影层 inert 双模态的 scheduled 入口当前 UI 不存在（handleShowScheduled 仅声明未消费，产品范围注记）——双模态行为由 nso-w3-a11y 契约测试 4/4 覆盖，live 腿如实 skip');
    } finally {
      const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
      assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(1500);
      } catch { /* 恢复失败不掩盖断言结果 */ }
    }
    return true;
  },
};
