#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui553-context-mention-live — BLOCK-245 统一 `@` 上下文菜单实机腿。
 *
 * 前置（由 scripts/block245-context-mention-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider，请求体留档）+ Vite :3000 + Electron 测试实例 CDP :9223；
 *   - 隔离工作区里有 note.txt / f0..f9.txt；隔离库里有合成 done job（结果源夹具）。
 *
 * 断言（要反证，不停留在"UI 有 chip"）：
 *   M1–M3  `@` 打开菜单 → 选文件 → chip 在场 + token 被摘掉；
 *   M4     技能源：有候选就选中，没候选必须显示原因（不静默）；
 *   M5     结果产物源（合成 done job）选中；
 *   M6     键盘路径 ↑↓ + Enter 同样能选（无障碍/可达性）；
 *   M7/M8  发送 → **请求体**里真有 `【引用…】` 引用块（不是只有 chip）；
 *   M9     发送后引用不残留（清空语义）；
 *   M10    同样加三条、移除一条重发 → 请求体里的引用块**变少**；
 *   M11    连续选到超过分组上限 → 提示可见（C16：静默截断改可见）；
 *   M12    暗色下菜单与提示同样可渲染（亮/暗截图）。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-553');
const COMPOSER = 'textarea.sc-input';
const PANEL = '[data-testid="sc-mention-panel"]';
const REPLY_TEXT = 'UI-553 探针：已收到引用上下文。';
const MESSAGE = '请根据我引用的上下文回答。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 15_000) {
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

async function capturePng(client, filename) {
  // 面板有 0.12s fade-in：不等它落定就截图会拍到半透明（实机抓真：暗色图里能看穿底板）。
  await sleep(260);
  const shot = await cdpSendWithTimeout(client, 'Page.captureScreenshot', { format: 'png' }, 20_000);
  fs.writeFileSync(path.join(EVIDENCE, filename), Buffer.from(shot.data, 'base64'));
  return filename;
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

function setTextareaExpr(text) {
  return `(function(){
    var ta = document.querySelector(${JSON.stringify(COMPOSER)});
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + ta.value.length;
  })()`;
}

function panelExpr() {
  return `(function(){
    var panel = document.querySelector(${JSON.stringify(PANEL)});
    if (!panel) return null;
    var groups = [];
    panel.querySelectorAll('.sc-mention-group').forEach(function(g){
      var label = g.querySelector('.sc-slash-title');
      groups.push({ label: label ? label.textContent : '', items: g.querySelectorAll('[role="option"]').length });
    });
    var items = [];
    panel.querySelectorAll('[role="option"]').forEach(function(b){
      items.push((b.textContent || '').trim());
    });
    var unavailable = [];
    panel.querySelectorAll('.sc-mention-unavailable-row').forEach(function(r){
      unavailable.push((r.textContent || '').trim());
    });
    return JSON.stringify({ groups: groups, items: items, unavailable: unavailable, text: (panel.textContent || '').slice(0, 800) });
  })()`;
}

async function panelState(client) {
  const raw = await evalJsWithTimeout(client, panelExpr(), 8000).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

/** 打开 `@` 菜单（query 只用源 id 定位：file / skill / artifact …）。 */
async function openMention(client, query) {
  const typed = await evalJsWithTimeout(client, setTextareaExpr(`@${query}`));
  if (!String(typed).startsWith('ok:')) throw new Error(`mention_type_failed: ${typed}`);
  return poll(async () => {
    const state = await panelState(client);
    if (!state) return null;
    return state.items.length > 0 || state.unavailable.length > 0 ? state : null;
  }, { timeoutMs: 30_000, intervalMs: 400, label: `mention_panel:${query}` });
}

/**
 * 首启角色揭示浮层（BLOCK-227）在**全新隔离数据根**上必然出现，且它覆盖整页——
 * DOM 断言能过、截图全是浮层（2026-10-22 本包实机抓真：截图里是欢迎页不是菜单）。
 * 故先按用户路径点掉它，再做视觉面断言。
 */
async function dismissFirstRun(client) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
    }
    return 'none';
  })()`);
  if (clicked === 'clicked') {
    await poll(async () => {
      const present = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => true);
      return present === false ? true : null;
    }, { timeoutMs: 12_000, label: 'role_reveal_dismissed' }).catch(() => null);
  }
  return clicked;
}

async function clickOption(client, index) {
  const clicked = await evalJsWithTimeout(client, `(function(){
    var panel = document.querySelector(${JSON.stringify(PANEL)});
    if (!panel) return 'no_panel';
    var options = panel.querySelectorAll('[role="option"]');
    if (options.length <= ${index}) return 'no_option:' + options.length;
    options[${index}].click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') throw new Error(`option_click_failed: ${clicked}`);
  await poll(async () => {
    const present = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(PANEL)})`).catch(() => true);
    return present === false ? true : null;
  }, { timeoutMs: 10_000, label: 'mention_panel_closed' });
}

/** 选第 index 个候选；返回选中项文本与当时的候选表。 */
async function pickMention(client, query, index = 0) {
  const state = await openMention(client, query);
  const label = state.items[index] || null;
  await clickOption(client, index);
  return { label, state };
}

async function chipsState(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    var out = [];
    document.querySelectorAll('.sc-selection-ref').forEach(function(el){
      out.push({ kind: el.getAttribute('data-context-kind') || 'selection', label: el.textContent || '' });
    });
    return JSON.stringify(out);
  })()`, 8000).catch(() => '[]');
  return JSON.parse(raw || '[]');
}

async function noticeText(client) {
  return evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('.sc-attachment-notice');
    return el ? (el.textContent || '').trim() : '';
  })()`, 8000).catch(() => '');
}

async function textareaValue(client) {
  return evalJsWithTimeout(client, `(function(){ var ta = document.querySelector(${JSON.stringify(COMPOSER)}); return ta ? ta.value : null; })()`);
}

async function clickSend(client) {
  await poll(async () => {
    const clicked = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="chat-send"]');
      if (!btn || btn.disabled) return null;
      btn.click();
      return 'clicked';
    })()`, 20_000).catch(() => null);
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'chat_send_clicked' });
}

async function mockStats() {
  const url = process.env.PETRI_B245_MOCK_STATS_URL;
  if (!url) throw new Error('missing PETRI_B245_MOCK_STATS_URL');
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
}

async function waitProviderCalls(expected) {
  return poll(async () => {
    const stats = await mockStats();
    return stats.calls >= expected ? stats : null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: `provider_calls>=${expected}` });
}

/**
 * 取「本轮聊天请求」而不是"最后一次请求"：同一 provider 还会被标题生成、
 * 记忆抽取等辅助链路调用（它们把整段对话再贴一遍），拿最后一次会数错引用块。
 * 判据 = 请求体里含本轮用户正文（`MESSAGE`），取第 n>afterN 的**第一条**。
 */
async function waitChatRequest(messageText, afterN) {
  return poll(async () => {
    const stats = await mockStats();
    const hits = (stats.requests || []).filter(
      (row) => row.n > afterN && String(row.userText).includes(messageText),
    );
    return hits.length > 0 ? hits[0] : null;
  }, { timeoutMs: 90_000, intervalMs: 700, label: 'chat_request_with_message' });
}

function countReferences(text) {
  return (String(text || '').match(/【引用/g) || []).length;
}

module.exports = {
  id: 'ui553-context-mention-live',
  description: 'BLOCK-245 实机腿：统一 @ 菜单（文件/技能/结果同源聚合）+ 引用真正上行 + 移除后变少 + 上限提示（隔离栈）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const projectId = process.env.PETRI_B245_PROJECT_ID;
    if (!projectId) throw new Error('missing PETRI_B245_PROJECT_ID');
    const syntheticJobId = process.env.PETRI_B245_SYNTHETIC_JOB_ID || '';

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const consoleHolder = [];
    client.on('Runtime.consoleAPICalled', (params) => {
      const args = (params.args || []).map((arg) => arg && (arg.value ?? arg.description ?? '')).join(' ');
      consoleHolder.push(`${params.type || 'log'}: ${args}`.slice(0, 400));
      if (consoleHolder.length > 300) consoleHolder.shift();
    });

    const darkMode = process.env.PETRI_B245_DARK === '1';
    const suffix = darkMode ? 'dark' : 'light';

    try {
      await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/?project=${projectId}`)}; 'ok'`);
      await poll(async () => {
        const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)})`).catch(() => false);
        return ready === true ? true : null;
      }, { timeoutMs: 45_000, label: 'composer_ready' });
      await poll(async () => {
        const text = await evalJsWithTimeout(client, `(function(){ var b=document.querySelector('button[aria-label="选择项目"]'); return b ? b.textContent : null; })()`).catch(() => null);
        return text && String(text).includes('UI-553') ? true : null;
      }, { timeoutMs: 25_000, label: 'project_selected' });

      if (darkMode) {
        await cdpSendWithTimeout(client, 'Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'dark' }],
        }).catch(() => {});
        await poll(async () => {
          const theme = await evalJsWithTimeout(client, `document.documentElement.getAttribute('data-theme')`).catch(() => null);
          return theme === 'dark' ? true : null;
        }, { timeoutMs: 10_000, label: 'dark_theme' }).catch(() => null);
      }

      // M0 — 先关掉首启角色揭示浮层（否则后面所有截图拍的都是它）
      const overlay = await dismissFirstRun(client);
      const overlayGone = await evalJsWithTimeout(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') < 0 : false`);
      assert('M0_first_run_overlay_dismissed', overlayGone === true, `click=${overlay}`);

      // M1 — `@` 打开统一菜单（七源同源聚合；文件组必有候选）
      const filePanel = await openMention(client, 'file');
      const fileGroup = filePanel.groups.find((g) => g.label === '文件');
      assert('M1_mention_menu_open', Boolean(fileGroup) && fileGroup.items > 0,
        JSON.stringify(filePanel.groups));
      // 视觉红线：面板必须在自己的几何中心**可命中**（浮层遮住时 DOM 断言仍会绿）。
      const hit = await evalJsWithTimeout(client, `(function(){
        var p = document.querySelector(${JSON.stringify(PANEL)});
        if (!p) return 'no_panel';
        var r = p.getBoundingClientRect();
        var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        var inside = !!(el && p.contains(el));
        return JSON.stringify({ inside: inside, blockedBy: inside ? '' : (el ? String(el.className) : 'null'),
          rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } });
      })()`);
      const hitState = JSON.parse(String(hit || '{}'));
      assert('M1b_panel_hittable', hitState.inside === true, String(hit));
      await capturePng(client, `ui553-mention-menu-${suffix}.png`);

      // M2/M3 — 选文件 → chip 在场 + `@token` 被摘掉
      const fileLabel = filePanel.items[0];
      await clickOption(client, 0);
      await sleep(200);
      let chips = await chipsState(client);
      assert('M2_file_picked', chips.some((c) => c.kind === 'file' && c.label.includes((fileLabel || '').slice(0, 6))),
        JSON.stringify(chips));
      const afterPick = await textareaValue(client);
      assert('M3_token_stripped', String(afterPick) === '', JSON.stringify(afterPick));

      // M4 — 技能源：有候选就选；没候选必须是"显示原因"而不是静默空白
      const skillPanel = await openMention(client, 'skill');
      if (skillPanel.items.length > 0) {
        await clickOption(client, 0);
        await sleep(200);
        chips = await chipsState(client);
        assert('M4_skill_picked', chips.some((c) => c.kind === 'skill'), JSON.stringify(chips));
      } else {
        await evalJsWithTimeout(client, `(function(){ var ta=document.querySelector(${JSON.stringify(COMPOSER)}); if(ta){ ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); } return 'esc'; })()`).catch(() => null);
        assert('M4_skill_source_honest', skillPanel.unavailable.length > 0 || String(skillPanel.text).includes('没有匹配'),
          JSON.stringify({ unavailable: skillPanel.unavailable, text: String(skillPanel.text).slice(0, 200) }));
      }

      // M5 — 结果产物源（合成 done job）
      const resultPanel = await openMention(client, 'artifact');
      assert('M5a_result_source_present', resultPanel.items.length > 0, JSON.stringify(resultPanel.items.slice(0, 3)));
      await clickOption(client, 0);
      await sleep(200);
      chips = await chipsState(client);
      assert('M5_result_picked', chips.some((c) => c.kind === 'artifact'),
        JSON.stringify(chips.map((c) => c.kind)));

      // M6 — 键盘路径：↑↓ 移动 + Enter 选中（菜单不抢焦点，事件仍由 textarea 消费）
      await openMention(client, 'file');
      await evalJsWithTimeout(client, `(function(){
        var ta = document.querySelector(${JSON.stringify(COMPOSER)});
        if (!ta) return 'no_ta';
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return 'sent';
      })()`);
      await poll(async () => {
        const present = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(PANEL)})`).catch(() => true);
        return present === false ? true : null;
      }, { timeoutMs: 12_000, label: 'mention_panel_closed_by_enter' });
      const afterKeyboard = await chipsState(client);
      assert('M6_keyboard_pick', afterKeyboard.length === chips.length + 1,
        `before=${chips.length} after=${afterKeyboard.length}`);

      // M7/M8 — 发送 → 请求体里真有引用块（反证：只有 chip 没上行会红）
      await evalJsWithTimeout(client, setTextareaExpr(MESSAGE));
      const beforeCalls = (await mockStats()).calls;
      await clickSend(client);
      const firstRequest = await waitChatRequest(MESSAGE, beforeCalls);
      const firstRefs = countReferences(firstRequest.userText);
      assert('M7_request_has_reference_block', firstRefs >= 2 && firstRequest.userText.includes('【引用文件'),
        `refs=${firstRefs} head=${String(firstRequest.userText).slice(0, 120)}`);
      assert('M8_request_has_result_reference', firstRequest.userText.includes('【引用结果'),
        String(firstRequest.userText).slice(0, 200));

      // M9 — 发送后引用不残留
      await sleep(500);
      const chipsAfterSend = await chipsState(client);
      assert('M9_chips_cleared_after_send', chipsAfterSend.length === 0, JSON.stringify(chipsAfterSend));

      // M10 — 同样加三条、移除一条重发 → 请求体引用块变少（反证）
      await pickMention(client, 'file', 1);
      await pickMention(client, 'file', 2);
      await pickMention(client, 'artifact', 0);
      const beforeRemove = await chipsState(client);
      const removed = await evalJsWithTimeout(client, `(function(){
        var rows = document.querySelectorAll('.sc-selection-ref');
        for (var i = 0; i < rows.length; i += 1) {
          if (rows[i].getAttribute('data-context-kind') === 'artifact') {
            var btn = rows[i].querySelector('.sc-selection-ref-remove');
            if (btn) { btn.click(); return 'removed'; }
          }
        }
        return 'not_found';
      })()`);
      assert('M10a_artifact_removed', removed === 'removed', String(removed));
      await sleep(300);
      const afterRemove = await chipsState(client);
      assert('M10b_chip_count_dropped', afterRemove.length === beforeRemove.length - 1,
        `before=${beforeRemove.length} after=${afterRemove.length}`);
      await evalJsWithTimeout(client, setTextareaExpr(MESSAGE));
      const callsBeforeSecond = (await mockStats()).calls;
      await clickSend(client);
      const secondRequest = await waitChatRequest(MESSAGE, callsBeforeSecond);
      const secondRefs = countReferences(secondRequest.userText);
      // 判据 = 请求体引用块数恰等于发送时的 chip 数，且严格少于上一轮（反证：移除没生效会相等）。
      assert('M10c_second_request_fewer_refs', secondRefs < firstRefs && secondRefs === afterRemove.length,
        `first=${firstRefs} second=${secondRefs} chips=${afterRemove.length}`);
      assert('M10d_second_request_has_no_result_ref', !secondRequest.userText.includes('【引用结果'),
        String(secondRequest.userText).slice(0, 200));

      // M11 — 连续选到超过分组上限 → 可见提示（C16）
      await sleep(400);
      let notice = '';
      for (let index = 0; index < 10; index += 1) {
        await pickMention(client, 'file', index);
        notice = await noticeText(client);
        if (notice) break;
      }
      assert('M11_limit_notice_visible', notice.includes('已达上限') && notice.includes('已移出'), notice.slice(0, 200));
      await capturePng(client, `ui553-limit-notice-${suffix}.png`);

      // M12 — 暗色下菜单同样可渲染（亮/暗双截图；此处是"已满 + 提示在场"的复访形态，
      // 干净首开形态由 M1 的 ui553-mention-menu-dark.png 承担，别互相覆盖）
      if (darkMode) {
        await openMention(client, 'file');
        await capturePng(client, `ui553-mention-menu-dark-revisit.png`);
        await evalJsWithTimeout(client, `(function(){ var ta=document.querySelector(${JSON.stringify(COMPOSER)}); if(ta){ ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); } return 'esc'; })()`).catch(() => null);
      }

      const finalStats = await mockStats();
      fs.writeFileSync(path.join(EVIDENCE, `ui553-provider-requests-${suffix}.json`), JSON.stringify(finalStats.requests, null, 2));
      fs.writeFileSync(path.join(EVIDENCE, `ui553-console-${suffix}.json`), JSON.stringify(consoleHolder.slice(-200), null, 2));
      fs.writeFileSync(path.join(EVIDENCE, `ui553-summary-${suffix}.json`), JSON.stringify({
        syntheticJobId,
        dark: darkMode,
        firstRequestRefs: firstRefs,
        secondRequestRefs: secondRefs,
        limitNotice: notice,
        replyRendered: String(REPLY_TEXT).slice(0, 8),
      }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(EVIDENCE, `ui553-debug-${suffix}.json`), JSON.stringify({
        error: error && error.stack ? error.stack : String(error),
        at: new Date().toISOString(),
        console: consoleHolder.slice(-120),
      }, null, 2));
      await capturePng(client, `ui553-debug-${suffix}.png`).catch(() => null);
      throw error;
    } finally {
      try { client.close(); } catch { /* ignore */ }
    }
  },
};
