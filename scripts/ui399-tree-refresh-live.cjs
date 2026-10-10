#!/usr/bin/env node
'use strict';
/**
 * ui399-tree-refresh-live.cjs — UI-399 实机取证（SSH 项目文件树切换刷新）
 * 步骤：打开 ssh 项目 → 清空资源计时 → 点击文件 A → 点击文件 B →
 * 断言 /tree 请求数零增长（旧代码每次点击 +2~4 次）且预览内容请求 ≥1 次。
 * 证据：acceptance/ui-399/ui399-tree-refresh-live.json
 */
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-399');
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

(async () => {
  const run = lib.createRun({ name: 'ui399-tree-refresh-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();

  // 准备阶段：根目录文件不足 2 个则先展开第一个目录（此阶段请求不计入断言）
  let fileRows = Number(await EVAL(`document.querySelectorAll('[role="treeitem"][title^="预览"]').length`)) || 0;
  if (fileRows < 2) {
    await EVAL(`(function(){ var d=document.querySelector('[role="treeitem"][title^="展开"]'); if(!d) return 'no_dir'; d.click(); return 'expanded'; })()`);
    await sleep(2500);
    for (let i = 0; i < 10 && fileRows < 2; i++) {
      fileRows = Number(await EVAL(`document.querySelectorAll('[role="treeitem"][title^="预览"]').length`)) || 0;
      if (fileRows < 2) await sleep(1000);
    }
  }
  run.assert('V1_file_rows_present', fileRows >= 2, 'rows=' + fileRows);
  if (fileRows < 2) throw new Error('not enough files in tree root');

  // 清空资源计时：此后 /tree 请求增量全部归因于点击行为
  await EVAL(`performance.clearResourceTimings(); 'cleared'`);

  const clickNth = (n) => EVAL(
    `(function(){ var rows=document.querySelectorAll('[role="treeitem"][title^="预览"]'); ` +
    `if (rows.length < ${n + 1}) return 'no_row'; rows[${n}].click(); return 'clicked:' + rows[${n}].getAttribute('title'); })()`);

  const c1 = await clickNth(0);
  run.assert('V2_click_file_A', String(c1).startsWith('clicked'), String(c1));
  await sleep(1500);
  const midCount = Number(await EVAL(`performance.getEntriesByType('resource').filter(function(r){ return r.name.indexOf('/tree') >= 0; }).length`));
  Number(await EVAL(`performance.getEntriesByType('resource').filter(function(r){ return r.name.indexOf('/workspaces/') >= 0 && r.name.indexOf('/tree') < 0; }).length`));

  const c2 = await clickNth(1);
  run.assert('V3_click_file_B', String(c2).startsWith('clicked'), String(c2));
  await sleep(1500);
  const finalCount = Number(await EVAL(`performance.getEntriesByType('resource').filter(function(r){ return r.name.indexOf('/tree') >= 0; }).length`));
  const finalContent = Number(await EVAL(`performance.getEntriesByType('resource').filter(function(r){ return r.name.indexOf('/workspaces/') >= 0 && r.name.indexOf('/tree') < 0; }).length`));

  run.assert('V4_zero_tree_refetch_on_switch', midCount === 0 && finalCount === 0,
    'tree requests after click A=' + midCount + ', after click B=' + finalCount + '（旧代码每次点击 +2~4）');
  run.assert('V5_preview_content_loaded', finalContent >= 1,
    'content requests=' + finalContent);

  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui399-after.png').catch(() => {});
  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui399] FATAL', err && err.message);
  process.exit(2);
});
