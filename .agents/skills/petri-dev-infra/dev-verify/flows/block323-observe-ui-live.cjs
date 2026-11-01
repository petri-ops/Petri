#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block323-observe-ui-live — BLOCK-323 / UI-655 放权坡道复盘区实机腿。
 *
 * 前置（由 scripts/block323-observe-ui-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider + agent-rules.json observe 规则 r-npm）；
 *   - Vite :3000 + Electron 测试实例 CDP :9223（隔离数据根）；
 *   - 任务1（observe 命中真实执行）已由封装脚本经 REST 预置，观察行已在库。
 *
 * 断言：/settings?section=decisions 深链直达决策原语节 → AgentRulesPanel 渲染
 * （规则行「观察」标签 + 待复盘行含命中次数/脱敏样本）→ 点「升级为放行」→
 * 提示 + REST 对账规则 action=allow → REST 跑任务2（allow 档自动执行）→
 * 点「标为已复盘」→ 空态 → 重载后「近期自动放行」与「授权面变更留痕」含 r-npm；
 * 亮/暗截图。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-323');
// ⚠️ 运行时读取（不得提升到模块顶层）：wrapper 在 require 本模块之后才注入
// PETRI_B323_API；顶层求值会固化到默认 :3001（用户的活 dev 后端）——run2/run3 实测抓真。
function apiBase() {
  return process.env.PETRI_B323_API || 'http://127.0.0.1:3001/api';
}
const AUTH = { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollJs(client, expression, { timeoutMs = 20_000, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await lib.evalJs(client, expression, 8_000); } catch (e) { last = `eval_error:${String(e.message).slice(0, 80)}`; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

async function rest(method, endpoint, body) {
  const response = await fetch(apiBase() + endpoint, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

module.exports = {
  id: 'block323-observe-ui-live',
  description: 'UI-655 放权坡道复盘区实机腿：设置面四档规则 + 待复盘升级/标复盘 + 自动放行审计区',
  evidenceDir: EVIDENCE,

  async run(ctx) {
    const { assert } = ctx;

    const targets = await lib.pollTargets({ port: Number(process.env.PETRI_B323_CDP || 9223), timeoutMs: 60_000 });
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('U1_spa_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 160) || 'none');
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(
        client,
        `!!(document.querySelector('[class*="projectTree"]') && document.querySelector('[class*="rightCol"]'))`,
        5_000,
      ).catch(() => false),
    });
    const client = await lib.connectTarget(main);

    // 诊断：页面真实 API base 与页内规则 GET（双后端脑裂取证）
    const pageApiBase = await lib.evalJs(client,
      `(function(){ const cfg = window.petriDesktop && window.petriDesktop.backendConfig; return JSON.stringify({ rApiBase: cfg ? cfg.rApiBase : null, envPort: null }); })()`, 8_000);
    console.log(`  [flow] page rApiBase=${pageApiBase} wrapperApi=${process.env.PETRI_B323_API}`);
    const pageRules = await lib.evalJs(client, `(async function(){
      const base = window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase;
      if (!base) return 'no_base';
      const r = await fetch(base + '/ai/agent-rules', { headers: { Authorization: 'Bearer desktop-local' } });
      const j = await r.json();
      return JSON.stringify((j.rules || []).map((x) => x.id + ':' + x.action));
    })()`, 10_000);
    console.log(`  [flow] page rules=${pageRules}`);

    try {
      // U2 深链直达决策原语节（保留 test=1 测试实例标记）
      await lib.evalJs(client, `location.href = '/settings?section=decisions&test=1'; 'navigating'`, 8_000);
      await pollJs(client,
        `!!(document.querySelector('[data-testid="settings-toolbar"]') && document.querySelector('[data-testid="agent-rule-observations"]')) || ''`,
        { timeoutMs: 30_000, label: 'settings_decisions_section' });
      assert('U2_decisions_section_reachable', true, '/settings?section=decisions 直达：工具栏 + 放权坡道区在场');

      // U3 规则行「观察」标签 + 添加规则四档下拉
      const ruleRow = await pollJs(client,
        `(function(){ const el = document.querySelector('[data-testid="agent-rule-r-npm"]'); return el ? el.textContent : ''; })()`,
        { timeoutMs: 15_000, label: 'rule_row' });
      assert('U3_rule_row_observe_label', String(ruleRow).includes('观察'), String(ruleRow).slice(0, 120));
      const actionOptions = await lib.evalJs(client,
        `(function(){ const sel = document.querySelector('select[aria-label="动作"]'); return sel ? Array.from(sel.options).map((o) => o.value).join(',') : ''; })()`, 8_000);
      assert('U3b_four_action_options', String(actionOptions) === 'require-ack,deny,observe,allow', String(actionOptions));

      // U4 待复盘行：命中次数 + 脱敏样本
      const reviewRow = await pollJs(client,
        `(function(){ const el = document.querySelector('[data-testid^="agent-rule-observation-"]'); return el ? el.textContent : ''; })()`,
        { timeoutMs: 15_000, label: 'observation_row' });
      assert('U4_review_row_hits_sample', String(reviewRow).includes('命中 1 次') && String(reviewRow).includes('npm --version'),
        String(reviewRow).slice(0, 160));
      const shot = await lib.screenshotPng(client, EVIDENCE, 'ui655-review-panel.png');
      assert('U4b_screenshot_light', Boolean(shot), String(shot));

      // U5 升级为放行：点击 → 提示 → REST 对账规则 action=allow
      await lib.evalJs(client,
        `(function(){ const btn = document.querySelector('[data-testid^="observation-upgrade-"]'); if (!btn) return 'missing'; btn.click(); return 'clicked'; })()`, 8_000);
      await pollJs(client,
        `(function(){ const el = document.querySelector('.petri-field__result--ok'); return el && el.textContent.includes('已升级为「放行」') ? el.textContent : ''; })()`,
        { timeoutMs: 15_000, label: 'upgrade_notice' });
      // REST 对账（带原始响应取证 + 页内同刻对比 + 有限重试）
      let rawDump = '';
      let upgraded = null;
      for (let attempt = 0; attempt < 3 && !upgraded; attempt += 1) {
        await sleep(700);
        const response = await fetch(`${apiBase()}/ai/agent-rules`, {
          headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(8000),
        }).catch((e) => ({ error: String(e) }));
        const text = response.error ? `FETCH_ERROR:${response.error}` : await response.text().catch(() => '<text_error>');
        rawDump = String(text).slice(0, 220);
        try {
          const parsed = JSON.parse(typeof text === 'string' ? text : '');
          upgraded = (parsed.rules || []).find((r) => r.id === 'r-npm') || null;
        } catch { upgraded = null; }
      }
      const pageRulesAfter = await lib.evalJs(client, `(async function(){
        const base = window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase;
        if (!base) return 'no_base';
        const r = await fetch(base + '/ai/agent-rules', { headers: { Authorization: 'Bearer desktop-local' } });
        const j = await r.json();
        return JSON.stringify((j.rules || []).map((x) => x.id + ':' + x.action));
      })()`, 10_000);
      assert('U5_upgrade_to_allow', Boolean(upgraded) && upgraded.action === 'allow',
        `REST raw=${rawDump} | page=${pageRulesAfter}`);

      // U6 REST 跑任务2（allow 档自动执行）→ 近期自动放行行落库
      const project = { projectId: process.env.PETRI_B323_PROJECT_ID };
      const conversation = await rest('POST', '/ai/conversations', { title: 'B323 UI 腿任务2（放行档）', project_id: project.projectId });
      const conversationId = conversation.data?.conversation?.id || conversation.data?.data?.conversation?.id || conversation.data?.data?.id;
      const start = await rest('POST', '/ai/agent', {
        conversationId,
        modelPresetId: process.env.PETRI_B323_MODEL_PRESET || 'b323ui-mock',
        messages: [{ role: 'user', content: '再查一次 npm 版本' }],
        context: { accessMode: 'full', projectId: project.projectId },
      });
      const taskId = start.data?.taskId || null;
      assert('U6b_allow_task_started', Boolean(taskId), `taskId=${taskId}`);
      if (taskId) {
        const deadline = Date.now() + 90_000;
        let done = false;
        while (Date.now() < deadline && !done) {
          await sleep(1500);
          const eventsRes = await fetch(`${apiBase().replace(/\/api$/, '')}/api/ai/agent/task/${encodeURIComponent(taskId)}`, {
            headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          if (!eventsRes) continue;
          const text = await eventsRes.text().catch(() => '');
          done = text.includes('"event":"done"') || text.includes('agent_cancelled');
        }
        assert('U6c_allow_task_completed', done, '任务2 收口（轮询终态）');
      }
      const obsAfter = await rest('GET', '/ai/policy-observations');
      const autoRow = (obsAfter.data?.autoAllow || []).find((item) => item.ruleId === 'r-npm');
      assert('U6d_auto_allow_recorded', Boolean(autoRow) && autoRow.hits >= 1, autoRow ? `hits=${autoRow.hits}` : '自动放行审计行缺席');

      // U7 标为已复盘 → 空态
      await lib.evalJs(client,
        `(function(){ const btn = document.querySelector('[data-testid^="observation-review-"]'); if (!btn) return 'missing'; btn.click(); return 'clicked'; })()`, 8_000);
      await pollJs(client,
        `!!document.querySelector('[data-testid="agent-rule-observations-empty"]') || ''`,
        { timeoutMs: 15_000, label: 'review_empty_state' });
      assert('U7_mark_reviewed_empties_list', true, '标复盘后待复盘列表清空');

      // U8 重载 → 近期自动放行 + 授权面变更留痕（面板挂载时拉取）
      await lib.evalJs(client, `location.reload(); 'reloading'`, 8_000);
      await pollJs(client,
        `!!(document.querySelector('[data-testid="settings-toolbar"]') && document.querySelector('[data-testid="agent-rule-observations"]')) || ''`,
        { timeoutMs: 30_000, label: 'settings_reload' });
      const autoListText = await pollJs(client,
        `(function(){ const el = document.querySelector('[data-testid="agent-rule-auto-allow-list"]'); return el ? el.textContent : ''; })()`,
        { timeoutMs: 15_000, label: 'auto_allow_list' });
      assert('U8_auto_allow_visible_in_panel', String(autoListText).includes('r-npm'), String(autoListText).slice(0, 140));
      const changesText = await lib.evalJs(client,
        `(function(){ const el = document.querySelector('[data-testid="agent-rule-policy-changes"]'); return el ? el.textContent : ''; })()`, 8_000);
      assert('U8b_policy_change_visible', String(changesText).includes('r-npm'), String(changesText).slice(0, 140));

      // U9 暗色截图
      await lib.evalJs(client, `document.documentElement.setAttribute('data-theme','dark'); 'ok'`, 8_000);
      const shotDark = await lib.screenshotPng(client, EVIDENCE, 'ui655-review-panel-dark.png');
      await lib.evalJs(client, `document.documentElement.removeAttribute('data-theme'); 'ok'`, 8_000);
      assert('U9_screenshot_dark', Boolean(shotDark), String(shotDark));
      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
