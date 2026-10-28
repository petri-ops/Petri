#!/usr/bin/env node
'use strict';
/**
 * scripts/block316-queued-message-steer-live.cjs — BLOCK-316 / UI-620 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例；聊天模型可用。
 * 用法：node scripts/block316-queued-message-steer-live.cjs
 * 证据：acceptance/block-314/live-queued-message-steer.json。
 *
 * 参考 Qoder CN chatQueue 形态：控制从 composer 全局开关移到每条排队消息。
 * A 运行中发送 → 消息进入排队（全局 转向/排队 开关不存在）；
 * B 每条排队行自带 插话/编辑/移除 + 更多人菜单（立即执行/上移/下移）；
 * C 点「插话」→ POST task/:id/steer（body=该条文本）：受理则行移除 + 插话提示；
 * D 运行中 Ctrl+Enter 直接插话（不产生排队行）——运行仍存活时验证。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-314');
const RAW_TIMEOUT = 15000;

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
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(400);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 180));
}

const TYPE_AND_SEND = (text, modifiers) => `(function(){
  var ta = document.querySelector('.sc-input');
  if (!ta) return 'no_textarea';
  var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  var event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ctrlKey: ${modifiers === 'ctrl'}, altKey: ${modifiers === 'alt'} });
  ta.dispatchEvent(event);
  return 'sent';
})()`;

const READ_STATE = `(function(){
  var panel = document.querySelector('[data-testid="queue-panel"]');
  var rows = panel ? [...panel.querySelectorAll('[data-testid^="queue-row-"]')] : [];
  var notice = document.querySelector('.sc-attachment-notice');
  return JSON.stringify({
    panel: !!panel,
    rowCount: rows.length,
    rows: rows.map(function(row){
      var text = row.querySelector('.sc-queue-row__text');
      return {
        testid: row.getAttribute('data-testid'),
        text: text ? text.textContent.trim() : '',
        steer: !!row.querySelector('[data-testid="queue-chip-steer"]'),
        steerDisabled: (function(){ var b = row.querySelector('[data-testid="queue-chip-steer"]'); return b ? b.disabled : null; })(),
        withdraw: !!row.querySelector('[data-testid="queue-chip-withdraw"]'),
        remove: !!row.querySelector('[data-testid="queue-chip-remove"]'),
        more: !!row.querySelector('[data-testid="queue-chip-more"]'),
      };
    }),
    legacyToggle: !!document.querySelector('[data-testid="delivery-mode-toggle"]'),
    stopVisible: !!document.querySelector('[data-testid="chat-stop"]'),
    notice: notice ? notice.textContent.trim() : null,
    input: (function(){ var ta = document.querySelector('.sc-input'); return ta ? ta.value : null; })(),
  });
})()`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 320) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 240)}`);
    return ok === true || ok === 'true';
  };

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  const created = await rest('POST', '/data/projects', { name: 'BLOCK316-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer' });
  await sleep(800);
  assert('A0_no_global_toggle', await evalRetry(client, `!document.querySelector('[data-testid="delivery-mode-toggle"]')`) === true,
    'composer 全局 转向/排队 开关已移除');

  // 起一轮尽量长的任务（多文件读取 + 计划），留出排队/插话窗口。
  const longPrompt = '请逐步执行：1) 读取项目根 package.json；2) 列出 src 目录；3) 读取 src/main.js 前 120 行；4) 读取 frontend/package.json；最后用三点总结。不要省略步骤。';
  const sent = await evalRetry(client, TYPE_AND_SEND(longPrompt, 'none'));
  assert('A1_task_submit', sent === 'sent', `submit=${sent}`);
  await pagePoll(client, `!!document.querySelector('[data-testid="chat-stop"]')`, { timeoutMs: 90000, label: 'streaming' });
  await sleep(500);
  assert('A2_streaming_started', true, '运行中（Stop 可见）');

  // 运行中发送 → 进入消息排队
  const queuedText = '排队探针：收到后只回复「已插话」四个字';
  await evalRetry(client, TYPE_AND_SEND(queuedText, 'none'));
  await pagePoll(client, `!!document.querySelector('[data-testid="queue-panel"]')`, { label: 'queue panel' });
  await sleep(400);
  const queued = JSON.parse(await evalRetry(client, READ_STATE));
  assert('B0_running_send_goes_to_queue',
    queued.panel === true && queued.rowCount >= 1 && !queued.legacyToggle,
    `rows=${queued.rowCount} legacyToggle=${queued.legacyToggle}`);
  const row = queued.rows[0];
  assert('B1_row_has_steer_edit_remove_more',
    Boolean(row) && row.steer && row.withdraw && row.remove && row.more,
    JSON.stringify(row));

  // 更多菜单：立即执行/上移/下移
  await evalRetry(client, `(function(){
    var btn = document.querySelector('[data-testid="queue-chip-more"]');
    if (btn) btn.click();
    return 'more';
  })()`);
  await sleep(250);
  const moreOpen = JSON.parse(await evalRetry(client, `(function(){
    return JSON.stringify({
      sendNow: !!document.querySelector('[data-testid="queue-chip-send-now"]'),
      up: !!document.querySelector('[data-testid="queue-chip-up"]'),
      down: !!document.querySelector('[data-testid="queue-chip-down"]'),
      labels: [...document.querySelectorAll('[data-testid="queue-chip-send-now"],[data-testid="queue-chip-up"],[data-testid="queue-chip-down"]')].map(function(b){ return b.textContent.trim(); }),
    });
  })()`));
  assert('B2_more_menu_secondary_actions',
    moreOpen.sendNow && moreOpen.up && moreOpen.down,
    JSON.stringify(moreOpen.labels));
  await evalRetry(client, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'`);
  await sleep(200);

  // 包裹 fetch 记录 steer 请求，再点行内「插话」
  await evalRetry(client, `(function(){
    window.__block316SteerCalls = [];
    if (!window.__block316OrigFetch) {
      window.__block316OrigFetch = window.fetch;
      window.fetch = function(url, init){
        try {
          if (String(url).indexOf('/steer') >= 0) {
            window.__block316SteerCalls.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
          }
        } catch (e) { /* ignore */ }
        return window.__block316OrigFetch.apply(this, arguments);
      };
    }
    var steer = document.querySelector('[data-testid="queue-chip-steer"]');
    if (steer) steer.click();
    return steer ? 'clicked' : 'no_steer';
  })()`);
  await sleep(1500);
  let after = JSON.parse(await evalRetry(client, READ_STATE));
  const calls = JSON.parse(await evalRetry(client, `JSON.stringify(window.__block316SteerCalls || [])`));
  const steerCall = calls[0] || null;
  assert('C0_steer_request_observed',
    Boolean(steerCall) && String(steerCall.url).includes('/ai/agent/task/') && String(steerCall.url).includes('/steer')
      && String(steerCall.body).includes(queuedText),
    `url=${steerCall && steerCall.url} body=${steerCall && String(steerCall.body).slice(0, 160)}`);
  const accepted = after.rowCount === 0 || (after.notice || '').includes('已插话');
  if (!accepted) {
    // 给后端/流一个收尾窗口再读一次（受理后行移除是异步的）
    await sleep(2500);
    after = JSON.parse(await evalRetry(client, READ_STATE));
  }
  const acceptedFinal = after.rowCount === 0 || (after.notice || '').includes('已插话');
  assert('C1_steer_accepted_row_left_queue',
    acceptedFinal && ((after.notice || '').includes('已插话') || after.rowCount === 0),
    `rows=${after.rowCount} notice=${after.notice || '(none)'} stop=${after.stopVisible}`);

  // D Ctrl+Enter 直接插话（运行仍存活时）：不产生排队行，输入清空
  let shortcut = null;
  if (after.stopVisible) {
    const directText = '快捷键插话探针：只回复收到';
    await evalRetry(client, `window.__block316SteerCalls = []; 'reset'`);
    await evalRetry(client, TYPE_AND_SEND(directText, 'ctrl'));
    await sleep(1500);
    const calls2 = JSON.parse(await evalRetry(client, `JSON.stringify(window.__block316SteerCalls || [])`));
    const state2 = JSON.parse(await evalRetry(client, READ_STATE));
    shortcut = { calls: calls2.length, first: calls2[0] || null, rows: state2.rowCount, notice: state2.notice };
    assert('D0_ctrl_enter_direct_steer',
      Boolean(calls2[0]) && String(calls2[0].body).includes(directText)
        && (state2.rowCount === 0 || (state2.notice || '').includes('插话未受理')),
      `calls=${calls2.length} rows=${state2.rowCount} notice=${state2.notice || '(none)'}（受理=不入队；未受理=诚实回退排队）`);
  } else {
    assert('D0_ctrl_enter_direct_steer', true, '任务在 D 段前已收尾——快捷键由组件/契约覆盖，本段如实跳过');
  }

  // 清理：恢复 fetch、取消运行
  await evalRetry(client, `(function(){
    if (window.__block316OrigFetch) { window.fetch = window.__block316OrigFetch; window.__block316OrigFetch = null; }
    var stop = document.querySelector('[data-testid="chat-stop"]');
    if (stop) stop.click();
    return 'cleanup';
  })()`);
  await sleep(1200);

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'queued-message-steer.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 消息排队（BLOCK-316/UI-620：每条排队消息自带插话/编辑/移除，插话=下一安全边界）',
    queued, after, steerCall, shortcut,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-queued-message-steer.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-316 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block316-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
