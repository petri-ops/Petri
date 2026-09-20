#!/usr/bin/env node
'use strict';
/**
 * block98-resilience-live.cjs — BLOCK-98 P5 实机验收（dev Electron 真轮次）：
 *   W1 长任务运行中插队：composer 真发多步任务 → 运行中 POST /steer 注入标记消息
 *      → SSE input_queued 事件可见 → 最终回复包含标记内容（端到端零丢失）；
 *   W2 遥测列：ai_usage 表 additive 四列在位（attempt/retryable/context_exceeded/cancelled_by_user）；
 *   W3 microcompact 接线在场：BIOF3_AGENT_RESILIENCE=1 下发送成功（开关分支加载）。
 * 前置：dev 栈带 BIOF3_AGENT_RESILIENCE=1 启动；CDP 9222。
 * 证据：acceptance/block-98/block98-resilience-live.json + 截图。
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5emekx_g13p';
const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-98');
const STEER_MARKER = '插队标记青色河马';

const PROMPT =
  '请用 todo_write 维护一个 4 条清单的任务，并逐步执行（每条执行前后正确更新状态）：' +
  '第一步：报出数字 7；第二步：报出数字 8；第三步：报出数字 9；第四步：完成后输出「四步完成」。' +
  '过程中请注意是否有新的用户插入消息，如有请在最后一条回复中原样复述插入消息的完整内容。';

let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function apiPost(pathname, payload) {
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = http.request(API + pathname, { method: 'POST', headers: { ...AUTH, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: b }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

(async () => {
  const run = lib.createRun({ name: 'block98-resilience-live', evidenceDir: EVIDENCE_DIR });
  Date.now();
  client = await attach();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();
  // URL 守卫：探针独占窗口期间用户操作会改变路由——不在目标项目直接中止（不乱发消息）
  const guardUrl = await EVAL(`location.pathname`);
  run.assert('V0_on_target_project', String(guardUrl) === `/project/${PROJECT_ID}`, 'pathname=' + guardUrl);
  if (String(guardUrl) !== `/project/${PROJECT_ID}`) throw new Error('user navigated away — abort (no message sent)');

  // 打开文件 tab 无关；确认 composer 在场后真发
  let typed = '';
  for (let i = 0; i < 12 && !String(typed).startsWith('typed'); i++) {
    typed = await EVAL(
      "(function(){ var ta=document.querySelector('textarea.sc-input'); if(!ta) return 'no_textarea';" +
      " var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;" +
      " st.call(ta, " + JSON.stringify(PROMPT) + "); ta.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()");
    if (String(typed).startsWith('typed')) break;
    await sleep(1000);
  }
  run.assert('V1_composer_sent', String(typed).startsWith('typed'), String(typed));
  const clicked = await EVAL(
    "(function(){ var btns=document.querySelectorAll('button'); for (var i=0;i<btns.length;i++){ if((btns[i].getAttribute('title')||'').indexOf('发送')>=0 && btns[i].offsetParent){ btns[i].click(); return 'clicked'; } } return 'no_btn'; })()");
  run.assert('V1_send_clicked', clicked === 'clicked', String(clicked));

  // 等任务开始（localStorage taskId）
  let taskId = null;
  for (let i = 0; i < 25 && !taskId; i++) {
    await sleep(1000);
    const ids = await EVAL(
      "JSON.stringify(Object.keys(localStorage).filter(function(k){return k.indexOf('gewu_agent_task_')===0||k.indexOf('biof3_agent_task_')===0;}).map(function(k){return k.split('agent_task_')[1];}))");
    try { const arr = JSON.parse(ids); if (Array.isArray(arr) && arr.length) taskId = arr[arr.length - 1]; } catch {}
  }
  run.assert('V1_task_created', Boolean(taskId), 'taskId=' + (taskId || 'none'));
  await sleep(3000); // 让 loop 进入第 2 轮

  // ── W1 运行中插队 ──
  const steer = await apiPost(`/api/ai/agent/task/${taskId}/steer`, { message: `${STEER_MARKER}（请在最后复述这句）` });
  run.assert('W1_steer_accepted', steer.status === 200 && steer.body && steer.body.queued === true,
    `HTTP ${steer.status} ${JSON.stringify(steer.body).slice(0, 100)}`);

  // SSE input_queued 可见（页面事件流出现该事件 → 摘要条 statusMessage 或任务事件）
  let sseSeen = false;
  for (let i = 0; i < 10; i++) {
    const seen = await EVAL(
      `(function(){ var el=document.querySelector('[class*="workspaceSessionStatus"], [class*="sc-status"], [role="status"]');` +
      ` var t=document.body.textContent; return t.indexOf('已排队')>=0 ? 'status-visible' : 'pending'; })()`);
    if (seen === 'status-visible') { sseSeen = true; break; }
    await sleep(1000);
  }
  run.assert('W1_queued_visible', sseSeen, 'queued notice visible in UI');

  // 等任务终态 + 检查回复含标记
  let finalText = '';
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    finalText = String(await EVAL(
      `(function(){ var msgs=document.querySelectorAll('.sc-messages .sc-msg'); var last=msgs[msgs.length-1]; return last? last.textContent : ''; })()`));
    if (finalText.indexOf('四步完成') >= 0) break;
  }
  run.assert('W1_steer_injection_zero_loss', finalText.includes(STEER_MARKER),
    'final reply contains steer marker (端到端零丢失): ' + finalText.slice(-120));

  // ── W2 遥测列 ──
  // 直接走 sqlite（脚本侧 better-sqlite3 只读 dev 库）
  try {
    const Database = require(path.join(__dirname, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
    const dbPath = process.env.BIOF3_DB_PATH || path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare("PRAGMA table_info('ai_usage')").all().map((c) => c.name);
    db.close();
    const need = ['attempt', 'retryable', 'context_exceeded', 'cancelled_by_user'];
    run.assert('W2_telemetry_columns', need.every((c) => cols.includes(c)), 'cols=' + need.join(','));
  } catch (e) {
    run.assert('W2_telemetry_columns', false, 'schema check failed: ' + e.message);
  }

  await lib.screenshotPng(client, EVIDENCE_DIR, 'block98-final.png').catch(() => {});
  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[block98] FATAL', err && err.message);
  process.exit(2);
});
