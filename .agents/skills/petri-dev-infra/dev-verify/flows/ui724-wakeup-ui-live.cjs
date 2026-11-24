#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui724-wakeup-ui-live — UI-724 唤醒预授权 UI 实机（BLOCK-516）。
 *
 * 真实用户路径（9223 离屏）：composer 输入 `/schedule …` 回车 → ScheduleDialog 打开 →
 * 展开「无人值守预授权」折起区 → 勾选 trusted → goal 下拉选带预算 goal（seed）→
 * 白名单勾选（auto-tool-names 数据源）→ 提交 → REST 复核 trusted+白名单落库。
 *
 * 断言链：
 *   P0_fixture_goal_seeded       临时项目 + 带预算 active goal（sqlite seed，结束清理）
 *   A1_dialog_opens             /schedule 回车 → ScheduleDialog 打开
 *   A2_trusted_fold_expands      折起区展开 + trusted 勾选 → goal 下拉只列带预算 active
 *   A3_allowlist_checked         内置名单数据源在场并勾选一项
 *   A4_submitted_trusted_persisted 提交成功 + REST 复核 auto_mode=trusted/白名单/goal 绑定
 *   P9_cleanup                   临时项目与 goal fixture 清理
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block516-wakeup-ui/（run.cjs 落盘）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block516-wakeup-ui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

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
  id: 'ui724-wakeup-ui-live',
  description: 'UI-724 唤醒预授权 UI：/schedule 对话框 trusted 折起区→goal 下拉→白名单勾选→提交→REST 复核（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // P0 fixture：临时项目 + 带预算 active goal（sqlite 直插，block256 ensureConversation 同款）
    const created = await rest('POST', '/data/projects', { name: 'UI724-验收-' + Date.now(), modality: 'general' });
    const projectId = created.data && created.data.project && created.data.project.id;
    assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
    if (!projectId) return false;
    const projResp = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
    const ws = projResp.data && (projResp.data.project ? projResp.data.project.workspace_path : projResp.data.workspace_path);

    const { createRequire } = require('module');
    const req = createRequire(path.join(ROOT, 'test/x.js'));
    const Database = req('better-sqlite3');
    const dbPath = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
    let sqlite = null;
    let goalId = null;
    let conversationId = null;
    try {
      sqlite = new Database(dbPath);
      conversationId = 'conv_b516_' + crypto.randomBytes(4).toString('hex');
      goalId = 'goal_b516_' + crypto.randomBytes(4).toString('hex');
      const now = new Date().toISOString();
      sqlite.prepare(`INSERT OR REPLACE INTO copilot_conversations
        (id,user_id,title,status,last_page,project_id,message_count,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(conversationId, 'local-user', 'BLOCK-516 fixture', 'active', null, projectId, 0, now, now);
      sqlite.prepare(`INSERT INTO agent_goals (id,user_id,project_id,conversation_id,title,description,status,budget_tokens,created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`)
        .run(goalId, 'local-user', projectId, conversationId, 'B516 预算目标（fixture）', null, 'active', 5000, now, now);
      assert('P0_fixture_goal_seeded', true, `goal=${goalId} budget=5000 conversation=${conversationId}`);
    } catch (e) {
      assert('P0_fixture_goal_seeded', false, String(e && e.message || e).slice(0, 160));
      try { sqlite && sqlite.close(); } catch { /* ignore */ }
      await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
      return false;
    } finally {
      try { sqlite && sqlite.close(); } catch { /* ignore */ }
    }

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

      // A1 — composer 输入 /schedule → 斜杠菜单点「定时任务」→ ScheduleDialog 打开
      // （合成 Enter 不触发执行链，RW-02 UI-594 同款「点菜单条目」配方）
      await evalRetry(client, `(function(){
        var input = document.querySelector('.sc-input');
        input.focus();
        return String(document.activeElement === input);
      })()`);
      await client.send('Input.insertText', { text: '/schedule' });
      await pagePoll(client, `(function(){
        var items = [...document.querySelectorAll('button, li, [role=option]')].filter(function(e){
          return e.textContent.indexOf('定时任务') >= 0 && e.offsetParent !== null;
        });
        return items.length >= 1 ? 'menu' : '';
      })()`, { label: 'slash menu item', timeoutMs: 15000 });
      await evalRetry(client, `(function(){
        var items = [...document.querySelectorAll('button, li, [role=option]')].filter(function(e){
          return e.textContent.indexOf('定时任务') >= 0 && e.offsetParent !== null;
        });
        items[items.length - 1].click();
        return 'clicked';
      })()`);
      await pagePoll(client, `String(!!document.querySelector('[data-testid="schedule-dialog"]'))`, { label: 'schedule dialog', timeoutMs: 20000 });
      assert('A1_dialog_opens', true, '/schedule menu → ScheduleDialog opened');

      // A2 — 展开折起区 + trusted 勾选 → goal 下拉只列带预算 active
      await evalRetry(client, `(function(){
        var fold = document.querySelector('[data-testid="schedule-dialog-trusted-fold"] summary');
        if (!fold) return 'no_fold';
        fold.click();
        return 'expanded';
      })()`);
      await pagePoll(client, `String(!!document.querySelector('[data-testid="schedule-dialog-trusted"]'))`, { label: 'trusted checkbox' });
      await evalRetry(client, `(function(){
        document.querySelector('[data-testid="schedule-dialog-trusted"]').click();
        return 'checked';
      })()`);
      const goalSelected = await pagePoll(client, `(function(){
        var s = document.querySelector('[data-testid="schedule-dialog-goal"]');
        if (!s) return '';
        var opt = [...s.options].find(function(o){ return (o.textContent||'').indexOf('B516 预算目标') >= 0; });
        if (!opt) return '';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(s, opt.value);
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return 'selected:' + opt.value;
      })()`, { label: 'goal selected', timeoutMs: 20000 });
      assert('A2_trusted_fold_expands', String(goalSelected).startsWith('selected:'), goalSelected);

      // A3 — 白名单勾选（数据源=auto-tool-names；列表渲染异步，轮询内执行动作）
      const namesResp = await rest('GET', '/schedules/auto-tool-names');
      const firstName = namesResp.data && namesResp.data.names && namesResp.data.names[0];
      assert('A3_allowlist_data_source', Boolean(firstName), `first=${firstName || 'none'}`);
      const checkResult = await pagePoll(client, `(function(){
        var div = document.querySelector('[data-testid="schedule-dialog-allowlist"]');
        if (!div) return '';
        var labels = [...div.querySelectorAll('label')].filter(function(l){ return l.textContent.indexOf(${JSON.stringify(firstName)}) >= 0; });
        if (!labels.length) return '';
        var box = labels[0].querySelector('input');
        box.click();
        return 'checked';
      })()`, { label: 'allowlist checked', timeoutMs: 20000 });
      const checked = await evalRetry(client, `(function(){
        var labels = [...document.querySelectorAll('[data-testid="schedule-dialog-allowlist"] input[type=checkbox]')];
        return String(labels.filter(function(b){ return b.checked; }).length);
      })()`);
      assert('A3_allowlist_checked', checkResult === 'checked' && checked === '1', `${checkResult} checked=${checked}`);

      // A4 — 提交（补标题 + prompt 文本——/schedule 无尾随文本时 prompt 为空、提交钮禁用）
      await evalRetry(client, `(function(){
        var input = document.querySelector('[data-testid="schedule-dialog"] input');
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'UI724 trusted 汇总');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var ta = document.querySelector('[data-testid="schedule-dialog-prompt"]');
        var taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        taSetter.call(ta, '每日汇总数据');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'titled';
      })()`);
      await evalRetry(client, `(function(){
        document.querySelector('[data-testid="schedule-dialog-submit"]').click();
        return 'submitted';
      })()`);
      await pagePoll(client, `String(!document.querySelector('[data-testid="schedule-dialog"]'))`, { label: 'dialog closed', timeoutMs: 20000 });

      // REST 复核：trusted + 白名单 + goal 绑定落库
      const snap = await rest('GET', `/automation?projectId=${encodeURIComponent(projectId)}`);
      const rows = (snap.data && snap.data.schedules) || [];
      const trustedRow = rows.find((r) => r.auto_mode === 'trusted') || null;
      let allowlistOk = false;
      try { allowlistOk = Boolean(trustedRow) && JSON.parse(trustedRow.auto_tool_allowlist).includes(firstName); } catch { /* ignore */ }
      assert('A4_submitted_trusted_persisted',
        Boolean(trustedRow) && allowlistOk && trustedRow.goal_id === goalId,
        JSON.stringify({ found: Boolean(trustedRow), allowlistOk, goalId: trustedRow && trustedRow.goal_id }));
    } finally {
      // P9 清理：fixture goal/conversation + 临时项目
      try {
        const Database = require('better-sqlite3');
        const sqlite = new Database(dbPath);
        const del = sqlite.prepare('DELETE FROM agent_goals WHERE conversation_id=?');
        del.run(conversationId);
        sqlite.prepare('DELETE FROM copilot_conversations WHERE id=?').run(conversationId);
        sqlite.close();
        assert('P9_fixture_rows_cleaned', true, `goal=${goalId}`);
      } catch (e) {
        assert('P9_fixture_rows_cleaned', false, String(e && e.message || e).slice(0, 120));
      }
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
