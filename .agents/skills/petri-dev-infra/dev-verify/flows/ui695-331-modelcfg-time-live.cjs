#!/usr/bin/env node
'use strict';

/**
 * UI-695 / UI-331 代行验收（2026-11-16，用户授权按 BLOCK-349 口径自动化）。
 * UI-695：模型菜单「上下文窗口 / 思考强度」就地切换快捷区在场（data-testid 断言）。
 * UI-331：左栏会话行短式相对时间 .convItemTime 在场。
 * 9223 离屏测试实例，建临时项目后导航；跑完由调用方终止，项目清理。
 * 纪律：不设 PETRI_TEST_ONSCREEN；断言用 lib 原语；证据 createRun 自动落盘。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.UI695_API || 'http://127.0.0.1:3001';
const EVDIR = path.join(ROOT, 'acceptance', 'ui-695-331-modelcfg-time');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, endpoint, body) {
  const resp = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

// 打开模型菜单：优先点 composer 里带 data-testid/aria 的模型按钮，回退斜杠命令
const OPEN_MENU = `(() => {
  const cands = [
    '[data-testid="model-chip-model"]',
    '[data-testid="composer-model-button"]',
    '[data-testid="model-selector"]',
    'button[aria-label*="模型"]',
    'button[title*="模型"]',
    '[class*="modelTrigger"]',
    '[class*="modelSelect"]'
  ];
  for (const sel of cands) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return 'clicked:' + sel; }
  }
  return 'no_trigger';
})()`;

const STATE = `(() => {
  const q = (s) => document.querySelectorAll(s);
  const menu = document.querySelector('[data-testid="model-menu"]');
  const quick = document.querySelector('[data-testid="model-menu-quick"]');
  const ctx = document.querySelector('[data-testid="model-menu-context-window"]');
  const think = document.querySelector('[data-testid="model-menu-thinking-level"]');
  const txt = (e) => e ? (e.textContent || '').replace(/\\s+/g,' ').trim() : '';
  const body = document.body.innerText || '';
  return JSON.stringify({
    url: location.href,
    title: document.title,
    composer: q('textarea.sc-input').length,
    convItemTime: q('.convItemTime').length,
    convItemTimeSample: Array.from(q('.convItemTime')).slice(0,3).map((e)=>txt(e)),
    modelMenu: !!menu,
    menuQuick: !!quick,
    ctxWindow: !!ctx,
    ctxValue: ctx ? ctx.getAttribute('data-value') : null,
    thinking: !!think,
    thinkLevel: think ? think.getAttribute('data-level') : null,
    hasContextLabel: body.includes('上下文窗口'),
    hasThinkingLabel: body.includes('思考强度')
  });
})()`;

module.exports = {
  id: 'ui695-331-modelcfg-time-live',
  description: 'UI-695 模型菜单就地切换快捷区 + UI-331 左栏会话相对时间（9223 离屏 DOM 断言）',
  evidenceDir: EVDIR,

  async run(ctx) {
    const { assert } = ctx;
    const detail = {};
    let projectId = null;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    try {
      const project = await rest('POST', '/data/projects', { name: `UI695-331-${Date.now()}`, modality: 'general' });
      projectId = project.data?.project?.id || null;
      assert('project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));

      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}, 'nav'`, 15_000).catch(() => null);
      await sleep(6000);

      let s = JSON.parse(await lib.evalJs(client, STATE, 20_000));
      assert('spa_loaded', s.composer >= 1, JSON.stringify(s).slice(0, 200));

      // UI-331：左栏会话行短式相对时间。新项目可能无会话→用既有会话数或标记 n/a
      detail.ui331 = { convItemTime: s.convItemTime, sample: s.convItemTimeSample };

      // UI-695：打开模型菜单（多次尝试 + 斜杠命令回退）
      let opened = await lib.evalJs(client, OPEN_MENU, 15_000);
      if (opened === 'no_trigger') {
        // 通过 composer 输入 /toggle-model-menu 触发（不发送，仅 slash 预览可能不生效）→直接派发自定义键盘事件
        await lib.evalJs(client, `document.dispatchEvent(new CustomEvent('petri:copilot-ask', {detail:{prompt:'/toggle-model-menu'}})); 'dispatched'`, 10_000).catch(() => null);
        await sleep(800);
      }
      detail.opened = opened;
      await sleep(1000);

      s = JSON.parse(await lib.evalJs(client, STATE, 20_000));
      detail.menuState = s;
      assert('model_menu_open', s.modelMenu === true, `opened=${opened} state=${JSON.stringify(s).slice(0,200)}`);
      assert('model_menu_quick_present', s.menuQuick === true, JSON.stringify(s).slice(0, 160));
      assert('context_window_control', s.ctxWindow === true && s.hasContextLabel,
        `ctx=${s.ctxWindow} label=${s.hasContextLabel} value=${s.ctxValue}`);
      assert('thinking_level_control', s.thinking === true && s.hasThinkingLabel,
        `think=${s.thinking} label=${s.hasThinkingLabel} level=${s.thinkLevel}`);

      await lib.screenshotPng(client, EVDIR, 'ui695-model-menu-quick.png');

      // UI-331：REST 建会话 → reload → 左栏 .convItemTime 短式相对时间（复用 RW02 配方）
      const convCreate = await rest('POST', '/ai/conversations', { title: 'UI331 相对时间探针', projectId });
      assert('ui331_conversation_created', convCreate.status === 200 && convCreate.data?.status === 'ok',
        JSON.stringify(convCreate.data).slice(0, 160));
      await lib.evalJs(client, `location.reload(); 'reloading'`, 15_000).catch(() => null);
      await sleep(4000);
      const convTime = await lib.evalJs(client, `(function(){
        var times = Array.prototype.slice.call(document.querySelectorAll('[class*="convItemTime"]'));
        return JSON.stringify({
          count: times.length,
          samples: times.slice(0,3).map(function(t){ return (t.innerText||'').trim(); }),
          valid: times.filter(function(t){ return /^(刚刚|\\d+分|\\d+小时|\\d+天|\\d{1,2}-\\d{1,2})$/.test((t.innerText||'').trim()); }).length
        });
      })()`, 15_000);
      const ctParsed = JSON.parse(convTime);
      detail.ui331After = ctParsed;
      assert('ui331_conversation_relative_time', ctParsed.count > 0 && ctParsed.valid > 0,
        JSON.stringify(ctParsed));

      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
      if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
    }
  },
};
