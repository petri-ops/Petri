#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui551-approval-live — BLOCK-243 Q1 审批卡 v2 + MCP trust 实机腿。
 *
 * 前置（由 scripts/ui551-ui-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider + 真实 stdio MCP 夹具 many_destructive）；
 *   - Vite :3000 + Electron 测试实例 CDP :9223（隔离数据根/DB）；
 *   - mock provider 在等第二次模型请求（任务停在等用户），由本 flow 在批准后 POST release。
 *
 * 断言：卡片 info 变体/解释/参数预览/范围按钮 → 编辑参数 → 批准 → 审计可查 →
 * 模型重试原调用按生效参数执行 → 终态答复；亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-551');
const MESSAGE = '请对归档库执行破坏性操作，目标先用 db。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** CDP evaluate 超时护栏：渲染进程卡死时 fail-fast，而不是整条 flow 挂住。 */
async function evalJsWithTimeout(client, expression, timeoutMs = 6000) {
  let timer = null;
  try {
    return await Promise.race([
      lib['evalJs'](client, expression),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cdpSendWithTimeout(client, method, params, timeoutMs = 6000) {
  let timer = null;
  try {
    return await Promise.race([
      client.send(method, params),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cdp_send_timeout:${method}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 截图超时护栏（离屏窗口默认 surface 截图；fromSurface:false 在离屏窗会 -32000）。 */
async function capturePng(client, evidenceDir, filename) {
  const shot = await cdpSendWithTimeout(client, 'Page.captureScreenshot', {
    format: 'png',
  }, 20_000);
  const file = path.join(evidenceDir, filename);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

async function rest(method, endpoint, body) {
  const response = await fetch(API + endpoint, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
}

async function poll(fn, { timeoutMs, intervalMs = 300, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

function setTextareaExpr(selector, text) {
  return `(function(){
    var ta = document.querySelector(${JSON.stringify(selector)});
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

/** React 受控 textarea：原生 setter 失效时直接调用 onChange（避免 send 按钮仍 disabled）。 */
async function ensureComposerInput(client, selector, text) {
  const typed = await evalJsWithTimeout(client, setTextareaExpr(selector, text));
  if (typed !== `ok:${Buffer.byteLength(text, 'utf8')}` && typed !== `ok:${text.length}`) return typed;
  const disabled = await evalJsWithTimeout(client, `(function(){
    var ta = document.querySelector(${JSON.stringify(selector)});
    var composer = ta ? (ta.closest('.sc-composer') || ta.closest('[class*="composer"]')) : null;
    var btn = composer ? composer.querySelector('[data-testid="chat-send"]') : document.querySelector('[data-testid="chat-send"]');
    return btn ? btn.disabled : null;
  })()`);
  if (disabled === false) return typed;
  const fixed = await evalJsWithTimeout(client, `(function(){
    var ta = document.querySelector(${JSON.stringify(selector)});
    if (!ta) return 'no_textarea';
    var key = Object.keys(ta).filter(function(k){ return k.indexOf('__reactProps') === 0; })[0];
    if (!key || !ta[key]) return 'no_react_props';
    var props = ta[key];
    var handler = props.onChange || props.onInput;
    if (typeof handler !== 'function') return 'no_onchange';
    handler({
      target: ta,
      currentTarget: ta,
      nativeEvent: { target: ta },
      preventDefault: function(){},
      stopPropagation: function(){},
    });
    return 'react_onchange';
  })()`);
  if (fixed === 'react_onchange') {
    await sleep(150);
  }
  return `${typed}|${fixed}`;
}

async function clickSend(client) {
  const state = await evalJsWithTimeout(client, `(function(){
    var ta = document.querySelector('[class*="chatMount"] textarea.sc-input') || document.querySelector('textarea.sc-input');
    var composer = ta ? (ta.closest('.sc-composer') || ta.closest('[class*="composer"]')) : null;
    var btn = composer ? composer.querySelector('[data-testid="chat-send"]') : document.querySelector('[data-testid="chat-send"]');
    if (!btn) return null;
    return JSON.stringify({ disabled: btn.disabled, title: btn.title || '', tag: btn.tagName });
  })()`);
  if (!state) throw new Error('chat_send_not_found');
  const parsed = JSON.parse(state);
  if (parsed.disabled) throw new Error('chat_send_disabled: ' + state);
  const clicked = await evalJsWithTimeout(client, `(function(){
    var ta = document.querySelector('[class*="chatMount"] textarea.sc-input') || document.querySelector('textarea.sc-input');
    var composer = ta ? (ta.closest('.sc-composer') || ta.closest('[class*="composer"]')) : null;
    var btn = composer ? composer.querySelector('[data-testid="chat-send"]') : document.querySelector('[data-testid="chat-send"]');
    if (!btn) return 'chat_send_not_found';
    btn.click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') throw new Error('click_send_failed: ' + clicked);
  return state;
}

async function ensureFullAccess(client) {
  const label = await evalJsWithTimeout(client, `(function(){ var b=document.querySelector('.sc-access-btn'); return b ? b.textContent : null; })()`);
  if (!label) throw new Error('access_button_not_found');
  if (String(label).includes('完全访问')) return 'already_full';
  await evalJsWithTimeout(client, `document.querySelector('.sc-access-btn').click(); 'ok'`);
  const switched = await evalJsWithTimeout(client, `(function(){
    var options = document.querySelectorAll('.sc-access-option');
    for (var i = 0; i < options.length; i += 1) {
      if ((options[i].textContent || '').indexOf('完全访问') >= 0) { options[i].click(); return 'clicked'; }
    }
    return 'option_not_found';
  })()`);
  if (switched !== 'clicked') throw new Error('switch_full_access_failed: ' + switched);
  await sleep(300);
  return 'switched';
}

async function captureDebug(client, projectId, error) {
  const body = await evalJsWithTimeout(client, `document.body ? document.body.textContent.slice(-5000) : ''`).catch(() => '');
  const conversations = await rest('GET', `/ai/conversations?project_id=${encodeURIComponent(projectId)}&status=active`).catch(() => null);
  const statsUrl = process.env.PETRI_B243_MOCK_STATS_URL;
  const stats = statsUrl ? await fetch(statsUrl, { signal: AbortSignal.timeout(5000) }).then((response) => response.json()).catch(() => null) : null;
  const storage = await evalJsWithTimeout(client, `(function(){ try { var out={}; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (/run|task|conversation/i.test(k)) out[k]=String(localStorage.getItem(k)).slice(0,400); } return JSON.stringify(out); } catch(e){ return String(e); } })()`).catch(() => null);
  const debug = {
    error: error && error.stack ? error.stack : String(error),
    at: new Date().toISOString(),
    body,
    conversations,
    stats,
    storage,
  };
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, 'ui551-debug.json'), JSON.stringify(debug, null, 2));
  return debug;
}

module.exports = {
  id: 'ui551-approval-live',
  description: 'BLOCK-243 UI-551 实机腿：MCP destructive 审批卡 → 编辑参数 → 批准 → 审计（隔离栈）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const consoleLogs = [];
    const pushConsole = (entry) => {
      consoleLogs.push(String(entry).slice(0, 500));
      if (consoleLogs.length > 300) consoleLogs.shift();
    };
    client.on('Runtime.consoleAPICalled', (params) => {
      const args = (params.args || []).map((arg) => arg && (arg.value ?? arg.description ?? arg.unserializableValue ?? '')).join(' ');
      pushConsole(`${params.type || 'log'}: ${args}`);
    });
    client.on('Runtime.exceptionThrown', (params) => {
      pushConsole(`exception: ${JSON.stringify(params.exceptionDetails || params).slice(0, 400)}`);
    });
    let projectId = null;
    let conversationId = null;
    let succeeded = false;

    try {
      const project = await rest('POST', '/data/projects', { name: 'UI-551 审批探针项目' });
      projectId = project.data?.project?.id || project.data?.data?.id || project.data?.data?.project?.id;
      assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
      if (!projectId) throw new Error('project_create_failed');

      await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/?project=${projectId}`)}; 'ok'`);
      await poll(async () => {
        const ready = await evalJsWithTimeout(client, `!!document.querySelector('[class*="chatMount"] textarea.sc-input') || !!document.querySelector('textarea.sc-input')`).catch(() => false);
        return ready === true;
      }, { timeoutMs: 30_000, label: 'composer_ready' });
      // 项目列表异步拉取（welcome 页退避重试）：选择器出现项目名后才允许发送，
      // 否则 sendGuard 会以「先选择一个项目」拒绝（新 userData 冷启动必现）。
      await poll(async () => {
        const text = await evalJsWithTimeout(client, `(function(){ var b=document.querySelector('button[aria-label="选择项目"]'); return b ? b.textContent : null; })()`).catch(() => null);
        return text && String(text).includes('UI-551') ? true : null;
      }, { timeoutMs: 25_000, label: 'project_selected' });

      const access = await ensureFullAccess(client);
      assert('E2_full_access', access === 'already_full' || access === 'switched', access);

      const darkMode = process.env.PETRI_B243_DARK === '1';
      if (darkMode) {
        // 暗色截图走独立运行：在卡片出现前切主题，避免卡片可见时切换触发
        // ProjectWorkspace 的既存重渲染环（BLOCK-243 探针边界，不归本包修复）。
        await cdpSendWithTimeout(client, 'Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'dark' }],
        }).catch(() => {});
        await poll(async () => {
          const theme = await evalJsWithTimeout(client, `document.documentElement.getAttribute('data-theme')`).catch(() => null);
          return theme === 'dark' ? true : null;
        }, { timeoutMs: 8000, label: 'dark_theme' }).catch(() => null);
      }

      const typed = await ensureComposerInput(client, '[class*="chatMount"] textarea.sc-input', MESSAGE);
      assert('E3_message_typed', String(typed).startsWith(`ok:${MESSAGE.length}`), String(typed));
      const sendState = await clickSend(client);
      assert('E4_send_enabled', Boolean(sendState && !JSON.parse(sendState).disabled), String(sendState));

      const card = await poll(async () => {
        const raw = await evalJsWithTimeout(client, `(function(){
          var el = document.querySelector('[data-testid="guard-ack-card"]');
          if (!el) return null;
          var q = function(sel){ var n = el.querySelector(sel); return n ? (n.textContent || '').trim() : null; };
          return JSON.stringify({
            variant: el.getAttribute('data-variant'),
            text: el.textContent || '',
            explanation: q('[data-testid="guard-ack-explanation"]'),
            args: q('[data-testid="guard-ack-args-preview"]'),
            taskBtn: !!el.querySelector('[data-testid="guard-ack-task"]'),
            alwaysBtn: !!el.querySelector('[data-testid="guard-ack-always"]'),
            editBtn: !!el.querySelector('[data-testid="guard-ack-edit-toggle"]'),
            pendingCount: !!el.querySelector('[data-testid="guard-ack-pending-count"]'),
            duplicate: !!el.querySelector('[data-testid="guard-ack-duplicate"]'),
          });
        })()`).catch(() => null);
        return raw ? JSON.parse(raw) : null;
      }, { timeoutMs: 60_000, label: 'guard_card_visible' }).catch(async (error) => {
        const debug = await captureDebug(client, projectId, error);
        throw new Error(`${error.message} :: ${JSON.stringify({ stats: debug.stats, body: String(debug.body).slice(-1200) })}`);
      });

      assert('A1_card_variant_info', card.variant === 'info' && card.text.includes('MCP 服务确认'), `variant=${card.variant}`);
      assert('A2_card_explanation', String(card.explanation || '').includes('信任位') && String(card.explanation || '').includes('destructive'), String(card.explanation));
      assert('A3_card_args_preview', String(card.args || '').includes('"target": "db"'), String(card.args));
      assert('A4_scope_buttons', card.taskBtn === true && card.alwaysBtn === true && card.editBtn === true,
        `task=${card.taskBtn} always=${card.alwaysBtn} edit=${card.editBtn}`);
      assert('A5_single_request', card.pendingCount === false && card.duplicate === false,
        `pending=${card.pendingCount} duplicate=${card.duplicate}`);

      fs.writeFileSync(path.join(EVIDENCE, 'ui551-console.json'), JSON.stringify(consoleLogs.slice(-200), null, 2));
      const shot1 = await capturePng(
        client,
        EVIDENCE,
        darkMode ? 'ui551-approval-card-dark.png' : 'ui551-approval-card-light.png',
      );
      assert('A6_card_screenshot', Boolean(shot1), String(shot1));

      await evalJsWithTimeout(client, `document.querySelector('[data-testid="guard-ack-edit-toggle"]').click(); 'ok'`);
      const editing = await poll(async () => {
        const value = await evalJsWithTimeout(client, `(function(){ var ta=document.querySelector('[data-testid="guard-ack-args-input"]'); return ta ? ta.value : null; })()`).catch(() => null);
        return value ? value : null;
      }, { timeoutMs: 10_000, label: 'args_editor' });
      assert('B1_args_editor_open', String(editing).includes('"target": "db"'), String(editing).slice(0, 120));

      const edited = await evalJsWithTimeout(client, setTextareaExpr('[data-testid="guard-ack-args-input"]', '{"target":"archive"}'));
      assert('B2_args_edited', edited === 'ok:19' || String(edited).startsWith('ok:'), String(edited));

      const hint = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="guard-ack-edit-hint"]')`);
      assert('B4_edit_forces_once', hint === true, `hint=${hint}`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="guard-ack-once"]').click(); 'ok'`);

      const notice = await poll(async () => {
        const text = await evalJsWithTimeout(client, `(function(){ var el=document.querySelector('[data-testid="guard-ack-notice"]'); return el ? el.textContent : null; })()`).catch(() => null);
        return text && String(text).includes('已按你编辑的参数批准') ? text : null;
      }, { timeoutMs: 20_000, label: 'approval_notice' });
      assert('B5_approval_notice', String(notice).includes('已按你编辑的参数批准'), String(notice));

      const releaseUrl = process.env.PETRI_B243_MOCK_RELEASE_URL;
      if (!releaseUrl) throw new Error('missing PETRI_B243_MOCK_RELEASE_URL');
      const released = await fetch(releaseUrl, { method: 'POST', signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false);
      assert('C1_mock_released', released === true, releaseUrl);

      const finalText = await poll(async () => {
        const text = await evalJsWithTimeout(client, `document.body ? document.body.textContent : ''`).catch(() => '');
        return text && String(text).includes('审批链路收口') ? text : null;
      }, { timeoutMs: 60_000, label: 'final_answer' });
      assert('C2_final_answer', String(finalText).includes('审批链路收口'), '终态答复在场');

      const cardGone = await evalJsWithTimeout(client, `!document.querySelector('[data-testid="guard-ack-card"]')`);
      assert('C3_card_dismissed', cardGone === true, `gone=${cardGone}`);

      const guardEvents = await rest('GET', '/ai/agent/guard-events?limit=20');
      const resolved = (guardEvents.data?.events || []).find((event) => event.eventType === 'permission.resolved');
      assert('D1_audit_visible', Boolean(resolved
        && resolved.decision === 'approve'
        && resolved.scope === 'once'
        && resolved.updatedInput === true
        && resolved.mcpServerId === 'many'), JSON.stringify(resolved || null).slice(0, 320));

      const conversations = await rest('GET', `/ai/conversations?project_id=${encodeURIComponent(projectId)}&status=active`);
      conversationId = (conversations.data?.conversations || [])[0]?.id || null;
      succeeded = true;
    } finally {
      try {
        if (succeeded) {
          if (conversationId) await rest('DELETE', `/ai/conversations/${encodeURIComponent(conversationId)}`);
          if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`);
        }
      } catch { /* cleanup best effort */ }
      try { await evalJsWithTimeout(client, `location.href = ${JSON.stringify(APP + '/')}; 'ok'`); } catch { /* window may be closing */ }
    }
  },
};
