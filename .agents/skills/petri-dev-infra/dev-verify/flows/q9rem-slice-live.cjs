#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q9rem-slice-live — BLOCK-259（Q9-REM 最小切片）实机腿。
 *
 * A0a backend_rest_healthy
 * A0b app_page_ready
 * A1 seeded_conversation_ready
 * A2 polish_fills_composer          润色动作把要求填入输入框（不发送）
 * A3 followups_fill_composer        建议追问 chips → 填入输入框
 * A4 model_price_visible            模型菜单显示 /api/ai/pricing 的价格
 * A5 notification_click_navigates   通知点击从首页跳回项目会话
 * A6 notification_prefs_toggle      类型开关落 localStorage
 * A7 spa_clean
 *
 * 诚实边界：截图离屏 unavailable；会话为合成 seed（只验 UI 动作，不外推模型质量）。
 */

const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => setTimeout(resolve, 6000, 'poll_timeout')),
    ]).catch((e) => `eval_err:${e.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(600);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

async function dismissFirstRun() {
  await evalRetry(null, `(function(){
    var btn = document.querySelector('[data-testid="role-reveal-start"]');
    if (btn) { btn.click(); return 'dismissed'; }
    return 'absent';
  })()`).catch(() => 'ignore');
}

module.exports = {
  id: 'q9rem-slice-live',
  description: 'BLOCK-259 Q9-REM 最小切片：通知点击/开关 + 润色/追问 + 模型价格',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-259'),

  async run(ctx) {
    const { assert, projectId, conversationId } = ctx;
    let client = null;

    const health = await fetch(API + '/data/projects', { headers: AUTH });
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(projectId)}/chat`);
    await dismissFirstRun();
    await pagePoll(client, `String(document.body.innerText.includes('这是上一条回复'))`, { label: 'seeded message', timeoutMs: 30000 });
    assert('A1_seeded_conversation_ready', true, '合成会话与助手消息可见');

    const polish = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="msg-action-polish"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const polishValue = await pagePoll(client, `(function(){ var t=document.querySelector('.sc-input'); return t ? String(t.value || '') : ''; })()`, { label: 'polish composer', timeoutMs: 10000 });
    assert('A2_polish_fills_composer', polish === 'clicked' && String(polishValue).includes('请润色上一条助手回复') && String(polishValue).includes('这是上一条回复'), `${polish} :: ${String(polishValue).slice(0, 80)}`);

    const openFollowups = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="msg-action-suggest-followups"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="msg-followups"]'))`, { label: 'followups', timeoutMs: 10000 });
    const pickFollowup = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="msg-followup-0"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const followupValue = await pagePoll(client, `(function(){ var t=document.querySelector('.sc-input'); return t ? String(t.value || '') : ''; })()`, { label: 'followup composer', timeoutMs: 10000 });
    assert('A3_followups_fill_composer', openFollowups === 'clicked' && pickFollowup === 'clicked' && String(followupValue).includes('关键结论'), `${pickFollowup} :: ${String(followupValue).slice(0, 80)}`);

    const openModel = await evalRetry(null, `(function(){ var b=document.querySelector('.sc-model-name-btn'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`);
    const priceText = await pagePoll(client, `(function(){
      var m=document.querySelector('[data-testid="model-menu"]');
      var t=m ? String(m.innerText || '') : '';
      return t.includes('¥') ? t : '';
    })()`, { label: 'model price', timeoutMs: 20000 });
    assert('A4_model_price_visible', openModel === 'clicked' && String(priceText).includes('¥0.5/¥8 每 1M'), String(priceText).slice(0, 120));
    await evalRetry(null, `(function(){ var o=document.querySelector('.sc-model-overlay'); if(o) o.click(); return 'closed'; })()`).catch(() => 'ignore');

    // K4：写入本地通知（页面重载后由 store 读取），从首页点击应回到项目会话。
    const notice = {
      id: 'n_q9_live_1',
      kind: 'turn_completed',
      title: 'Q9 验收通知',
      body: '点击跳回项目会话',
      projectId,
      conversationId,
      createdAt: new Date().toISOString(),
      read: false,
    };
    await evalRetry(null, `(function(){ localStorage.setItem('petri:notification-center:v1', ${JSON.stringify(JSON.stringify([notice]))}); return 'seeded'; })()`);
    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="notification-center-bell"]'))`, { label: 'bell on home', timeoutMs: 30000 });
    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="notification-center-bell"]'); if(b) b.click(); return 'clicked'; })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="notification-center-item"]'))`, { label: 'notice item', timeoutMs: 10000 });
    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="notification-center-item"]'); if(b) b.click(); return 'clicked'; })()`);
    const pathAfter = await pagePoll(client, `String(location.pathname)`, { label: 'notification navigate', timeoutMs: 15000 });
    assert('A5_notification_click_navigates', pathAfter === `/project/${projectId}/chat`, pathAfter);

    // A6：类型开关落 localStorage（关闭后复选框与存储一致）。
    await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="notification-center-bell"]'); if(b) b.click(); return 'clicked'; })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="notice-pref-turn_completed"]'))`, { label: 'prefs', timeoutMs: 10000 });
    const toggle = await evalRetry(null, `(function(){ var b=document.querySelector('[data-testid="notice-pref-turn_completed"]'); if(!b) return 'no_box'; b.click(); return 'clicked'; })()`);
    const prefRaw = await evalRetry(null, `String(localStorage.getItem('petri:notification-center:prefs:v1') || '')`);
    assert('A6_notification_prefs_toggle', toggle === 'clicked' && String(prefRaw).includes('"turn_completed":false'), String(prefRaw).slice(0, 120));

    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A7_spa_clean', true, '收尾回 ?test=1');
  },
};
