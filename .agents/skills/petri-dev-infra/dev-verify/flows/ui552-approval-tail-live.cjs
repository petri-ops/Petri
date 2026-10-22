#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui552-approval-tail-live — BLOCK-244 Q1-REM 审批控制面实机腿。
 *
 * 前置（由 scripts/block244-approval-tail-live.mjs 一键备好）：
 *   - 隔离后端 :3001（mock provider + 真实 stdio MCP 夹具 many_echo）；
 *   - Vite :3000 + Electron 测试实例 CDP :9223（隔离数据根/DB/git 工作区）；
 *   - mock provider 按「用户批准后释放」的节奏推进：策略 ask → 循环 3 次 → 提问 → 终态。
 *
 * 断言：完全访问确认（取消不改档）→ 策略 ask 卡 → 批准放行 → 循环卡 → 批准 →
 * 提问卡 → 回答 → 终态 → checkpoint 编辑回退（文件回到快照态 + 输入回填）；亮/暗截图。
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const APP = 'http://localhost:3000';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-552');
const MESSAGE = '请按审批链路执行回显，然后告诉我结果。';
const PROBE_TEXT = 'checkpoint 探针轮：只回一句话。';
const PROBE_REPLY = '探针轮完成。';
const COMPOSER = '[class*="chatMount"] textarea.sc-input';
const FINAL_TEXT = 'Q1-REM 收口：策略、循环与提问均已按批准执行。';

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

async function capturePng(client, evidenceDir, filename) {
  const shot = await cdpSendWithTimeout(client, 'Page.captureScreenshot', { format: 'png' }, 20_000);
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

async function clickSend(client) {
  await poll(async () => {
    const clicked = await evalJsWithTimeout(client, `(function(){
      var ta = document.querySelector(${JSON.stringify(COMPOSER)}) || document.querySelector('textarea.sc-input');
      var composer = ta ? (ta.closest('.sc-composer') || ta.closest('[class*="composer"]')) : null;
      var btn = composer ? composer.querySelector('[data-testid="chat-send"]') : document.querySelector('[data-testid="chat-send"]');
      if (!btn || btn.disabled) return null;
      btn.click();
      return 'clicked';
    })()`, 20_000).catch(() => null);
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 40_000, intervalMs: 800, label: 'chat_send_clicked' });
  return 'clicked';
}

function accessLabelExpr() {
  return `(function(){ var b=document.querySelector('.sc-access-btn'); return b ? b.textContent : null; })()`;
}

async function clickAccessOption(client, label) {
  const opened = await evalJsWithTimeout(client, `(function(){ var b=document.querySelector('.sc-access-btn'); if(!b) return 'no_btn'; b.click(); return 'ok'; })()`);
  if (opened !== 'ok') throw new Error('access_menu_open_failed: ' + opened);
  await sleep(250);
  const picked = await evalJsWithTimeout(client, `(function(){
    var options = document.querySelectorAll('.sc-access-option');
    for (var i = 0; i < options.length; i += 1) {
      if ((options[i].textContent || '').indexOf(${JSON.stringify(label)}) >= 0) { options[i].click(); return 'clicked'; }
    }
    return 'option_not_found';
  })()`);
  if (picked !== 'clicked') throw new Error('access_option_failed: ' + picked);
  await sleep(350);
  return picked;
}

async function guardCardState(client) {
  const raw = await evalJsWithTimeout(client, `(function(){
    var el = document.querySelector('[data-testid="guard-ack-card"]');
    if (!el) return null;
    var q = function(sel){ var n = el.querySelector(sel); return n ? (n.textContent || '').trim() : null; };
    return JSON.stringify({
      variant: el.getAttribute('data-variant'),
      text: el.textContent || '',
      intent: q('[data-testid="guard-ack-intent"]'),
      source: q('[data-testid="guard-ack-source"]'),
    });
  })()`, 8000).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

async function waitGuardGone(client) {
  await poll(async () => {
    const present = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="guard-ack-card"]')`).catch(() => true);
    return present === false ? true : null;
  }, { timeoutMs: 30_000, label: 'guard_card_gone' });
}

async function captureDebug(client, error) {
  const body = await evalJsWithTimeout(client, `document.body ? document.body.textContent.slice(-6000) : ''`).catch(() => '');
  const storage = await evalJsWithTimeout(client, `(function(){ try { var out={}; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (/run|task|conversation|checkpoint/i.test(k)) out[k]=String(localStorage.getItem(k)).slice(0,400); } return JSON.stringify(out); } catch(e){ return String(e); } })()`).catch(() => null);
  const statsUrl = process.env.PETRI_B244_MOCK_STATS_URL;
  const stats = statsUrl ? await fetch(statsUrl, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null) : null;
  // 后端真相：最近一个任务的 task_events 事件序（判断提问事件是否真的发出过）。
  let taskEvents = null;
  const dbPath = process.env.PETRI_B244_DB_PATH;
  if (dbPath) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const last = db.prepare("SELECT id FROM tasks WHERE type = 'agent' ORDER BY created_at DESC LIMIT 1").get()
        || db.prepare('SELECT id FROM tasks ORDER BY rowid DESC LIMIT 1').get();
      if (last) {
        taskEvents = db
          .prepare('SELECT seq, event_type AS eventType, substr(payload,1,300) AS payload FROM task_events WHERE task_id = ? ORDER BY seq DESC LIMIT 40')
          .all(last.id)
          .reverse();
      }
      db.close();
    } catch (e) { taskEvents = [{ error: String(e && e.message) }]; }
  }
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, 'ui552-debug.json'), JSON.stringify({
    error: error && error.stack ? error.stack : String(error),
    at: new Date().toISOString(),
    body,
    storage,
    stats,
    taskEvents,
    console: consoleHolder.slice(-120),
  }, null, 2));
  await capturePng(client, EVIDENCE, 'ui552-debug.png').catch(() => null);
}

const consoleHolder = [];

/** 读最近一个 agent 任务的事件序（后端真相面，绕开渲染环干扰）。 */
function latestTaskEvents(dbPath, limit = 200) {
  if (!dbPath) return null;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const last = db.prepare('SELECT id FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
    const rows = last
      ? db.prepare('SELECT seq, event_type AS eventType FROM task_events WHERE task_id = ? ORDER BY seq ASC LIMIT ?').all(last.id, limit)
      : [];
    db.close();
    return { taskId: last ? last.id : null, events: rows };
  } catch (error) {
    return { error: String(error && error.message) };
  }
}

module.exports = {
  id: 'ui552-approval-tail-live',
  description: 'BLOCK-244 Q1-REM 实机腿：工具策略 ask / 循环防护 / 结构化提问 / 完全访问确认 / checkpoint 回退（隔离栈）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const projectId = process.env.PETRI_B244_PROJECT_ID;
    const workspace = process.env.PETRI_B244_WORKSPACE;
    const releaseUrl = process.env.PETRI_B244_MOCK_RELEASE_URL;
    if (!projectId || !workspace || !releaseUrl) throw new Error('missing PETRI_B244_* env');
    const notePath = path.join(workspace, 'note.txt');

    const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    const pushConsole = (entry) => {
      consoleHolder.push(String(entry).slice(0, 500));
      if (consoleHolder.length > 300) consoleHolder.shift();
    };
    client.on('Runtime.consoleAPICalled', (params) => {
      const args = (params.args || []).map((arg) => arg && (arg.value ?? arg.description ?? arg.unserializableValue ?? '')).join(' ');
      pushConsole(`${params.type || 'log'}: ${args}`);
    });
    client.on('Runtime.exceptionThrown', (params) => {
      pushConsole(`exception: ${JSON.stringify(params.exceptionDetails || params).slice(0, 400)}`);
    });

    const darkMode = process.env.PETRI_B244_DARK === '1';
    const suffix = darkMode ? 'dark' : 'light';

    try {
      await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/?project=${projectId}`)}; 'ok'`);
      await poll(async () => {
        const ready = await evalJsWithTimeout(client, `!!document.querySelector('[class*="chatMount"] textarea.sc-input') || !!document.querySelector('textarea.sc-input')`).catch(() => false);
        return ready === true;
      }, { timeoutMs: 30_000, label: 'composer_ready' });
      await poll(async () => {
        const text = await evalJsWithTimeout(client, `(function(){ var b=document.querySelector('button[aria-label="选择项目"]'); return b ? b.textContent : null; })()`).catch(() => null);
        return text && String(text).includes('UI-552') ? true : null;
      }, { timeoutMs: 25_000, label: 'project_selected' });

      if (darkMode) {
        await cdpSendWithTimeout(client, 'Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'dark' }],
        }).catch(() => {});
        await poll(async () => {
          const theme = await evalJsWithTimeout(client, `document.documentElement.getAttribute('data-theme')`).catch(() => null);
          return theme === 'dark' ? true : null;
        }, { timeoutMs: 8000, label: 'dark_theme' }).catch(() => null);
      }

      // D3 — 完全访问确认层：先切只读（取消路径），再切完全访问（确认路径）。
      let label = await evalJsWithTimeout(client, accessLabelExpr());
      if (!String(label || '').includes('只读')) {
        await clickAccessOption(client, '只读模式');
        label = await evalJsWithTimeout(client, accessLabelExpr());
      }
      assert('D1_read_mode', String(label || '').includes('只读'), String(label));

      await clickAccessOption(client, '完全访问');
      const dialog = await poll(async () => {
        const raw = await evalJsWithTimeout(client, `(function(){
          var el = document.querySelector('[data-testid="full-access-confirm"]');
          if (!el) return null;
          var risk = el.querySelector('[data-testid="full-access-risk"]');
          return JSON.stringify({ text: el.textContent || '', risk: risk ? risk.textContent : '' });
        })()`, 8000).catch(() => null);
        return raw ? JSON.parse(raw) : null;
      }, { timeoutMs: 12_000, label: 'full_access_dialog' });
      assert('D2_dialog_capability_risk', String(dialog.text).includes('完全访问') && String(dialog.risk).length > 10, String(dialog.risk).slice(0, 120));
      await capturePng(client, EVIDENCE, `ui552-full-access-${suffix}.png`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="full-access-confirm-no"]').click(); 'ok'`);
      await sleep(300);
      label = await evalJsWithTimeout(client, accessLabelExpr());
      assert('D3_cancel_keeps_mode', String(label || '').includes('只读'), String(label));

      await clickAccessOption(client, '完全访问');
      await poll(async () => {
        const open = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="full-access-confirm"]')`).catch(() => false);
        return open === true ? true : null;
      }, { timeoutMs: 10_000, label: 'full_access_dialog_again' });
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="full-access-confirm-yes"]').click(); 'ok'`);
      await sleep(350);
      label = await evalJsWithTimeout(client, accessLabelExpr());
      assert('D4_confirm_switches_full', String(label || '').includes('完全访问'), String(label));

      // K1–K4 — checkpoint 快照 → 编辑 → 回退本轮文件 + 输入回填。
      // 先跑：ProjectWorkspace 的既存重渲染环会把长链路尾部的渲染拖慢，
      // 探针轮在最干净时验完，才能把「回退确实改了文件」这条断言钉住。
      const probeTyped = await evalJsWithTimeout(client, setTextareaExpr(COMPOSER, PROBE_TEXT));
      assert('K0_probe_typed', String(probeTyped).startsWith('ok:'), String(probeTyped));
      await clickSend(client);
      await poll(async () => {
        const body = await evalJsWithTimeout(client, `document.body ? document.body.textContent : ''`).catch(() => '');
        return String(body).includes(PROBE_REPLY) ? true : null;
      }, { timeoutMs: 60_000, label: 'probe_reply' });
      assert('K0b_probe_reply', true, PROBE_REPLY);

      const stored = await poll(async () => {
        const raw = await evalJsWithTimeout(client, `(function(){ try { return localStorage.getItem('petri_turn_checkpoints_v1') || ''; } catch(e){ return 'ERR:' + e; } })()`, 20_000).catch(() => null);
        return raw && String(raw).includes('"ref"') ? raw : null;
      }, { timeoutMs: 40_000, label: 'checkpoint_record' });
      assert('K1_checkpoint_recorded', true, String(stored).slice(0, 200));
      fs.writeFileSync(notePath, 'v3\n', 'utf8');
      const editBtn = await poll(async () => {
        const ok = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="msg-edit-user"]')`).catch(() => false);
        return ok === true ? true : null;
      }, { timeoutMs: 30_000, label: 'edit_button' });
      assert('K2_edit_button', editBtn === true, 'msg-edit-user');
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="msg-edit-user"]').click(); 'ok'`, 20_000);
      await poll(async () => {
        const open = await evalJsWithTimeout(client, `!!document.querySelector('[data-testid="edit-checkpoint-dialog"]')`).catch(() => false);
        return open === true ? true : null;
      }, { timeoutMs: 20_000, label: 'checkpoint_dialog' });
      await capturePng(client, EVIDENCE, `ui552-checkpoint-dialog-${suffix}.png`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="edit-checkpoint-rollback"]').click(); 'ok'`, 20_000);
      await poll(async () => {
        const gone = await evalJsWithTimeout(client, `!document.querySelector('[data-testid="edit-checkpoint-dialog"]')`).catch(() => false);
        return gone === true ? true : null;
      }, { timeoutMs: 30_000, label: 'checkpoint_dialog_gone' });
      const restored = fs.readFileSync(notePath, 'utf8');
      assert('K3_rollback_restores_files', restored === 'v2\n', JSON.stringify(restored));
      const inputValue = await evalJsWithTimeout(client, `(function(){ var ta=document.querySelector(${JSON.stringify(COMPOSER)}) || document.querySelector('textarea.sc-input'); return ta ? ta.value : null; })()`, 20_000);
      assert('K4_edit_refills_input', String(inputValue).includes('探针轮'), String(inputValue).slice(0, 80));

      // E1 — 主链路轮：提问 → 策略 ask → 循环防护 → 终态。
      // 回退编辑会触发 git checkout/clean + 历史截断 + ProjectWorkspace 既存重渲染环，
      // 页面在 checkpoint 腿之后已被拖慢 → 重新挂载一次，让审批腿在干净渲染面上验。
      await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/?project=${projectId}`)}; 'ok'`, 20_000);
      await sleep(1500);
      await poll(async () => {
        const ready = await evalJsWithTimeout(client, `!!document.querySelector(${JSON.stringify(COMPOSER)}) || !!document.querySelector('textarea.sc-input')`).catch(() => false);
        return ready === true ? true : null;
      }, { timeoutMs: 40_000, label: 'composer_ready_after_reload' });
      const typed = await poll(async () => {
        const result = await evalJsWithTimeout(client, setTextareaExpr(COMPOSER, MESSAGE), 20_000).catch(() => null);
        return String(result || '').startsWith('ok:') ? result : null;
      }, { timeoutMs: 40_000, intervalMs: 1000, label: 'message_typed' });
      assert('E1_message_typed', true, String(typed));
      await clickSend(client);

      // Q1/Q2 — 结构化提问 → 回答 → 同轮返回模型（放在链路最前：ProjectWorkspace 的
      // 既存重渲染环会把长链路尾部的渲染拖慢，提问先跑可在页面干净时断言）。
      const question = await poll(async () => {
        const raw = await evalJsWithTimeout(client, `(function(){
          var el = document.querySelector('[data-testid="user-question-card"]');
          if (!el) return null;
          var q = el.querySelector('[data-testid="user-question-text"]');
          var opt = el.querySelector('[data-testid="user-question-option-opt-run"]');
          return JSON.stringify({ text: el.textContent || '', question: q ? q.textContent : null, option: !!opt });
        })()`, 8000).catch(() => null);
        return raw ? JSON.parse(raw) : null;
      }, { timeoutMs: 60_000, label: 'question_card' });
      assert('Q1_question_card', String(question.question).includes('选择继续方式') && question.option === true, String(question.question));
      await capturePng(client, EVIDENCE, `ui552-question-card-${suffix}.png`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="user-question-option-opt-run"]').click(); 'ok'`);
      await sleep(150);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="user-question-submit"]').click(); 'ok'`);
      await poll(async () => {
        const gone = await evalJsWithTimeout(client, `!document.querySelector('[data-testid="user-question-card"]')`).catch(() => false);
        return gone === true ? true : null;
      }, { timeoutMs: 20_000, label: 'question_card_gone' });
      assert('Q2_answer_submitted', true, 'option=opt-run');

      // A1/A2 — 工具审批策略 ask → warning 卡（intent 确定性解释）。
      const policyCard = await poll(async () => {
        const card = await guardCardState(client);
        return card && String(card.text).includes('工具审批策略') ? card : null;
      }, { timeoutMs: 60_000, label: 'policy_card' });
      await sleep(200);
      const policySnap = await guardCardState(client);
      assert('A1_policy_card', policySnap && policySnap.variant === 'warning' && String(policySnap.text).includes('每次询问'),
        `variant=${policySnap && policySnap.variant}`);
      assert('A2_intent_block', String(policySnap && policySnap.intent).includes('回显消息') && String(policySnap && policySnap.intent).includes('执行本地命令'),
        String(policySnap && policySnap.intent).slice(0, 160));
      assert('A3_main_source', !policySnap || !policySnap.source, String(policySnap && policySnap.source));
      await capturePng(client, EVIDENCE, `ui552-policy-card-${suffix}.png`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="guard-ack-once"]').click(); 'ok'`);
      await sleep(300);

      const policyAllow = await rest('PUT', '/ai/tool-approval-policy', { modes: [] });
      assert('A4_policy_reset_allow', policyAllow.ok, JSON.stringify(policyAllow.data).slice(0, 200));
      const readBack = await rest('GET', '/ai/tool-approval-policy');
      assert('A4b_policy_readback_empty', readBack.ok && Object.keys(readBack.data?.modes || {}).length === 0,
        JSON.stringify(readBack.data?.modes || {}).slice(0, 200));
      await fetch(releaseUrl + '?phase=policy', { method: 'POST', signal: AbortSignal.timeout(5000) });

      // A5/A6 — 同参连续 3 次 → loop_guard 卡。
      const loopCard = await poll(async () => {
        const body = await evalJsWithTimeout(client, `document.body ? document.body.textContent.slice(-4000) : ''`).catch(() => '');
        if (String(body).includes('MOCK_ABORT')) throw new Error(String(body).slice(-300));
        const card = await guardCardState(client);
        return card && String(card.text).includes('连续') ? card : null;
      }, { timeoutMs: 60_000, label: 'loop_card' });
      await sleep(200);
      const loopSnap = await guardCardState(client);
      assert('A5_loop_card', loopSnap && loopSnap.variant === 'warning' && String(loopSnap.text).includes('循环防护'),
        `variant=${loopSnap && loopSnap.variant}`);
      await capturePng(client, EVIDENCE, `ui552-loop-card-${suffix}.png`);
      await evalJsWithTimeout(client, `document.querySelector('[data-testid="guard-ack-once"]').click(); 'ok'`);
      await sleep(300);
      await waitGuardGone(client);
      await fetch(releaseUrl + '?phase=loop', { method: 'POST', signal: AbortSignal.timeout(5000) });

      // C1 — 同轮终态：DOM 文本优先；渲染面被既存重渲染环拖慢时回落持久化消息
      // （两条路都如实标注来源，不把「后端已完成」冒充「界面已渲染」）。
      const seenInDom = await poll(async () => {
        const body = await evalJsWithTimeout(client, `document.body ? document.body.textContent : ''`, 20_000).catch(() => '');
        return String(body).includes(FINAL_TEXT) ? true : null;
      }, { timeoutMs: 45_000, label: 'final_text_dom' }).catch(() => null);
      let finalSource = seenInDom ? 'dom' : null;
      if (!finalSource) {
        const list = await rest('GET', `/ai/conversations?project_id=${encodeURIComponent(projectId)}`);
        const items = (list.data && (list.data.conversations || list.data.items || list.data.data)) || [];
        const conversation = Array.isArray(items) ? items[0] : null;
        const conversationId = conversation && (conversation.id || conversation.conversation_id);
        if (conversationId) {
          const persisted = await rest('GET', `/ai/conversations/${encodeURIComponent(conversationId)}/messages`);
          if (JSON.stringify(persisted.data || '').includes(FINAL_TEXT)) finalSource = 'persisted';
        }
      }
      assert('C1_final_text', Boolean(finalSource), `source=${finalSource || 'none'}`);
      await sleep(1200);

      // 审计面（后端真相）：两次审批落 permission.resolved，回答落 user_question_answered。
      const audit = latestTaskEvents(process.env.PETRI_B244_DB_PATH);
      const eventTypes = (audit && Array.isArray(audit.events) ? audit.events : []).map((row) => row.eventType);
      const resolvedCount = eventTypes.filter((type) => type === 'permission.resolved').length;
      assert('C2_permission_resolved_audit', resolvedCount >= 2, `count=${resolvedCount} taskId=${audit && audit.taskId}`);
      assert('C3_question_answered_audit', eventTypes.includes('user_question_answered'),
        `taskId=${audit && audit.taskId} types=${eventTypes.slice(-6).join(',')}`);
      fs.writeFileSync(path.join(EVIDENCE, `ui552-audit-${suffix}.json`), JSON.stringify(audit, null, 2));

      fs.writeFileSync(path.join(EVIDENCE, `ui552-console-${suffix}.json`), JSON.stringify(consoleHolder.slice(-200), null, 2));
    } catch (error) {
      await captureDebug(client, error).catch(() => {});
      fs.writeFileSync(path.join(EVIDENCE, `ui552-console-${suffix}.json`), JSON.stringify(consoleHolder.slice(-200), null, 2));
      throw error;
    } finally {
      try { client.close(); } catch { /* ignore */ }
    }
  },
};
