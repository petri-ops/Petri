#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui699-cv-live — UI-699 字号 token 收敛 + 行 cv DOM 预算实机（BLOCK-517 W2）。
 *
 * 台账缺口：会话行 cv 已在历史会话上过；**结果库行 cv 未出现——结果面板 UI 态依赖，实机走查待人工**。
 * 本 flow 补机械可判据腿：真实项目页上断言两处 DOM 预算行的 computed content-visibility。
 * 结果库行若在当前 UI 态不可达 → 如实 skip 该半腿（不伪造）。
 *
 * 断言链：
 *   P0_temp_project_with_conv     临时项目 + 会话（REST 建，保证 convItem 行在场）
 *   A1_conv_row_cv_auto           会话列表行 .convItem computed content-visibility === auto
 *   A2_results_row_cv             结果库行 .resultsLibraryItem：在场则断言 cv=auto；UI 态不可达 → 如实 skip
 *   P9_cleanup_project_deleted    临时项目清理
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block517-walk-batch/ui699-cv-live-darwin.json。
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
  id: 'ui699-cv-live',
  description: 'UI-699 行 cv DOM 预算实机：会话行 .convItem cv=auto + 结果库行 cv（UI 态不可达如实 skip）（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const created = await rest('POST', '/data/projects', { name: 'UI699-验收-' + Date.now(), modality: 'general' });
    const projectId = created.data && created.data.project && created.data.project.id;
    assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
    if (!projectId) return false;
    const conv = await rest('POST', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`, {
      title: 'UI699 cv 验证会话', project_id: projectId,
    });
    const convOk = Boolean(conv.data && conv.data.conversation && conv.data.conversation.id);
    assert('P0b_conversation_created', convOk, `conversation=${convOk ? (conv.data.conversation.id) : 'none'}`);

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

      // 会话列表可能在左栏需点开会话标签——直接找 .convItem（左栏会话列表行）
      const convCv = await pagePoll(client, `(function(){
        var rows = [...document.querySelectorAll('[class*="convItem"]')];
        if (!rows.length) return '';
        var cv = getComputedStyle(rows[0]).contentVisibility;
        return 'cv:' + cv + ':rows=' + rows.length;
      })()`, { label: 'convItem cv', timeoutMs: 20000 });
      assert('A1_conv_row_cv_auto', String(convCv).startsWith('cv:auto'), convCv);

      // 结果库行：当前 UI 态若不可达则如实 skip（台账原注=结果面板 UI 态依赖）
      const resultState = await evalRetry(client, `(function(){
        var rows = [...document.querySelectorAll('[class*="resultsLibraryItem"]')];
        if (!rows.length) return JSON.stringify({ present: false });
        var cv = getComputedStyle(rows[0]).contentVisibility;
        return JSON.stringify({ present: true, cv: cv });
      })()`);
      const parsed = JSON.parse(resultState);
      if (parsed.present) {
        assert('A2_results_row_cv', parsed.cv === 'auto', `resultsLibraryItem cv=${parsed.cv}`);
      } else {
        assert('A2_results_row_cv', 'skip', '结果库行在当前 UI 态不可达（台账原注=结果面板 UI 态依赖）——如实 skip 不伪造');
      }
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
