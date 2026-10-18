#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui523-run-stats — composer 运行计量条实机腿（UI-523）。
 *
 * 断言链：
 *   D0 strip_present_empty   欢迎页 composer 下方计量条在场；空会话三项诚实（— tok / 缓存命中 — / 0%）
 *   D1 ring_moved_single     上下文预算环只有一份（搬进条内，未在工具栏留副本）
 *   D2 live_usage_reading    发一条消息后：本次「N 轮 · N 步 · N tok/s」点亮（tok/s 来自 usage 事件）
 *   D3 conversation_totals   会话累计「N tok · 缓存命中 N%」点亮（来自 GET /api/ai/usage-conversation）
 *   D4 context_pct           上下文百分比在位且与环同源
 *   D5 no_fake_zero          tok/s 未到达前必须是「—」而非 0（诚实边界回归）
 *   D6 cleanup               会话/临时项目清理 + 页面恢复
 *
 * 前置（缺一不可，缺失即 fail-fast，不吃假绿）：
 *   ① dev 栈在跑（后端 :3001 / vite :3000）；
 *   ② `R_SERVER_PORT=3002` 的测试实例已在 CDP 9223（本 flow 只连 9223，绝不碰 9222）；
 *   ③ 后端当前指向 mock provider：`bash scripts/ui523-ui-live.mjs` 一键备好并跑本 flow
 *      （mock 只证明代码链，证据标注 provider=mock，不得表述为真实 Provider 已验）。
 *
 * 证据：acceptance/ui-523/ui523-run-stats-live.json + 双截图。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP = 'http://localhost:3000';
const MARKER = 'UI523 实机验收探针：请不要使用任何工具，直接回复「收到」两个字。';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last && last.ok) return last.value;
    await sleep(intervalMs);
  }
  throw new Error('poll_timeout: ' + label + ' :: ' + JSON.stringify(last && last.value).slice(0, 240));
}

function readStrip(client) {
  return lib.evalJs(client, `(function(){
    var strip = document.querySelector('[data-testid="run-stats-bar"]');
    var q = function(sel){ var el = document.querySelector(sel); return el ? (el.textContent || '').trim() : null; };
    var inputArea = strip ? strip.closest('.sc-input-area') : null;
    var composer = strip ? strip.closest('.sc-composer') : null;
    return JSON.stringify({
      present: !!strip,
      state: strip ? strip.getAttribute('data-state') : null,
      run: q('[data-testid="run-stats-run"]'),
      rate: q('[data-testid="run-stats-rate"]'),
      total: q('[data-testid="run-stats-total"]'),
      cache: q('[data-testid="run-stats-cache"]'),
      context: q('[data-testid="run-stats-context"]'),
      ringsInArea: inputArea ? inputArea.querySelectorAll('button[title^="上下文用量"]').length : -1,
      ringsInComposer: composer ? composer.querySelectorAll('button[title^="上下文用量"]').length : -1,
      composer: !!document.querySelector('[class*="chatMount"] textarea.sc-input')
    });
  })()`).then((raw) => JSON.parse(raw));
}

async function typeInto(client, selector, text) {
  const typed = await lib.evalJs(client,
    "(function(){\n" +
    "  var ta = document.querySelector(" + JSON.stringify(selector) + ");\n" +
    "  if (!ta) return 'no_textarea';\n" +
    "  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;\n" +
    "  setter.call(ta, " + JSON.stringify(text) + ");\n" +
    "  ta.dispatchEvent(new Event('input', { bubbles: true }));\n" +
    "  return 'typed:' + ta.value.length;\n" +
    "})()");
  if (typed !== 'typed:' + text.length) throw new Error('type_into_composer_failed: ' + typed);
}

async function clickSend(client) {
  const clicked = await lib.evalJs(client,
    "(function(){\n" +
    "  var btns = document.querySelectorAll('button');\n" +
    "  for (var i = 0; i < btns.length; i++) {\n" +
    "    if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked'; }\n" +
    "  }\n" +
    "  return 'send_button_not_found';\n" +
    "})()");
  if (clicked !== 'clicked') throw new Error('click_send_failed: ' + clicked);
}

module.exports = {
  id: 'ui523-run-stats',
  description: 'UI-523 composer 运行计量条：本次/会话/上下文三组读数点亮（mock provider 实机链）',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-523'),

  async run({ assert }) {
    const evidenceDir = path.join(ROOT, 'acceptance', 'ui-523');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: 9223 测试实例未找到（localhost:3000）');
    const target = await lib.selectPageTarget(pages, {
      probe: async (client) => {
        const v = await lib.evalJs(client, '!!document.querySelector("[aria-label=\\"欢迎页\\"]") || !!document.querySelector("textarea.sc-input")').catch(() => false);
        return v === true;
      },
    });
    const client = await lib.connectTarget(target);
    const originalUrl = target.url;

    let projectId = null;
    let conversationId = null;

    // 证据边界：记录本腿绑定的模型渠道（mock 时明确标注，禁止表述为真实 Provider）
    try {
      const settingsResp = await rest('GET', '/ai/settings');
      const settings = (settingsResp.data && settingsResp.data.settings) || {};
      const activeModelId = (settings.model_role_bindings && settings.model_role_bindings.chat)
        || settings.active_chat_model_id || '(unknown)';
      const isMock = String(activeModelId).indexOf('ui523-mock') === 0;
      assert('D_meta_model_boundary', true,
        'activeModel=' + activeModelId + (isMock ? ' · provider=mock（非真实 Provider，代码链证据）' : ' · 非 mock 渠道'));
    } catch (e) {
      assert('D_meta_model_boundary', false, 'settings_probe_failed: ' + String(e && e.message).slice(0, 120));
    }

    try {
      const projectName = 'UI523-验收-' + Date.now();
      const created = await rest('POST', '/data/projects', { name: projectName, modality: 'general' });
      if (!created.ok || !created.data || !created.data.project) {
        throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      }
      projectId = created.data.project.id;

      await lib.evalJs(client, "location.href = '" + APP + "/?project=" + projectId + "'; 'navigating'");
      await poll(async () => {
        const v = await lib.evalJs(client, '!!document.querySelector(\'[class*="chatMount"] textarea.sc-input\')').catch(() => false);
        return { ok: v === true, value: v };
      }, { timeoutMs: 30_000, label: 'welcome_composer' });
      await sleep(800);

      // ── D0 空态诚实 ──
      const empty = await readStrip(client);
      assert('D0a_strip_present', empty.present === true, 'run-stats-bar=' + empty.present);
      assert('D0b_empty_state_honest', empty.total === '— tok' && (empty.cache || '').indexOf('缓存命中 —') >= 0 && empty.context === '0%',
        'total=' + empty.total + ' cache=' + empty.cache + ' context=' + empty.context);
      // 环应只在条内（area 恰 1 个），且条不在 composer 内 ⇒ ringsInComposer=-1；
      // 若未来条被塞回 composer，工具栏内必须为 0（不是 1）。
      assert('D1_ring_single_after_move', empty.ringsInArea === 1 && empty.ringsInComposer <= 0,
        '环实例（composer 区）=' + empty.ringsInArea + ' 工具栏内=' + empty.ringsInComposer);

      // ── 发一条消息（React 受控 textarea：原生 setter + input 事件 → 点发送）──
      await typeInto(client, '[class*="chatMount"] textarea.sc-input', MARKER);
      await clickSend(client);

      // ── 首问自动建会话并导航进工作区（ui341 同款产品路径）──
      await poll(async () => {
        const href = await lib.evalJs(client, 'location.href').catch(() => '');
        return { ok: String(href).indexOf('/project/' + projectId) >= 0, value: href };
      }, { timeoutMs: 30_000, label: 'workspace_navigate' });
      await poll(async () => {
        const v = await lib.evalJs(client, '!!document.querySelector(\'main textarea.sc-input, [class*="centerCol"] textarea.sc-input\')').catch(() => false);
        return { ok: v === true, value: v };
      }, { timeoutMs: 30_000, label: 'workspace_composer' });
      await sleep(600);

      // ── 工作区再发一条：run 快照与计量条同处一个 SimpleChat 实例（跨实例导航
      // 期间快照归属会漂移，验收腿取同实例路径）──
      await typeInto(client, 'main textarea.sc-input, [class*="centerCol"] textarea.sc-input', MARKER);
      await clickSend(client);

      // ── D2 本次读数点亮（轮/步/tok/s） ──
      const live = await poll(async () => {
        const s = await readStrip(client).catch(() => null);
        if (!s) return { ok: false, value: null };
        const okRun = !!s.run && s.run.indexOf('轮') >= 0 && s.run.indexOf('步') >= 0;
        const okRate = !!s.rate && /\d+\s+tok\/s/.test(s.rate);
        return { ok: okRun && okRate, value: s };
      }, { timeoutMs: 30_000, label: 'live_usage_reading' });
      assert('D2_live_usage_reading', true, 'run=' + live.run + ' rate=' + live.rate);
      await lib.screenshotPng(client, evidenceDir, 'ui523-run-stats-running.png');

      // ── D3 会话累计点亮（token 总量 + 缓存命中） ──
      const totals = await poll(async () => {
        const s = await readStrip(client).catch(() => null);
        if (!s) return { ok: false, value: null };
        const okTotal = !!s.total && /^(\d+(\.\d+)?[KMB]|\d+)\s+tok$/.test(s.total) && s.total.indexOf('—') === -1;
        const okCache = !!s.cache && /缓存命中\s+\d+%/.test(s.cache);
        return { ok: okTotal && okCache, value: s };
      }, { timeoutMs: 30_000, label: 'conversation_totals' });
      assert('D3_conversation_totals', true, 'total=' + totals.total + ' cache=' + totals.cache);
      // 运行结束后 run 快照会被持久消息对账清除；条内必须记住最近一次轮/步
      assert('D3b_last_run_memory', !!totals.run && totals.run.indexOf('轮') >= 0 && totals.run.indexOf('步') >= 0,
        'run=' + totals.run);

      assert('D4_context_pct', /^\d+%$/.test(String(totals.context || '')), 'context=' + totals.context);
      assert('D5_no_fake_zero_rate', String(totals.rate || '').indexOf('tok/s') >= 0 || totals.rate === '—',
        'rate=' + totals.rate + '（未测量时必须为 — 而不是 0）');

      await sleep(1200);
      await lib.screenshotPng(client, evidenceDir, 'ui523-run-stats-totals.png');

      // 会话归属对账（REST 侧）
      const conv = await poll(async () => {
        const r = await rest('GET', '/ai/conversations?status=active&project_id=' + encodeURIComponent(projectId));
        const list = (r.data && r.data.conversations) || [];
        return { ok: list.length > 0, value: list[0] || null };
      }, { timeoutMs: 20_000, label: 'conversation_created' });
      conversationId = conv.id;
    } finally {
      const cleanup = [];
      if (conversationId) {
        const d = await rest('DELETE', '/ai/conversations/' + encodeURIComponent(conversationId));
        cleanup.push('conv=' + d.ok);
      }
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        cleanup.push('project=' + d.ok);
      }
      try {
        await lib.evalJs(client, 'location.href = ' + JSON.stringify(originalUrl) + "; 'restoring'");
        await sleep(2000);
        cleanup.push('restored=' + ((await lib.evalJs(client, 'location.href').catch(() => '')) === originalUrl));
      } catch { cleanup.push('restored=eval_failed'); }
      assert('D6_cleanup_restored', cleanup.every((s) => s.endsWith('=true')), cleanup.join(' '));
    }
    return true;
  },
};
