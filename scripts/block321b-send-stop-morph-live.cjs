#!/usr/bin/env node
'use strict';
/**
 * scripts/block321b-send-stop-morph-live.cjs — BLOCK-321b / UI-628 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例；聊天模型可用。
 * 单钮态机四态验证（用户裁决「发送/停止同一位置」）：
 *   1 空闲：无 Stop、Send 在场且空输入禁用；输入文字 → Send 启用；
 *   2 发送进入流式：单钮=Stop（Send 不在场）；
 *   3 流式中输入新内容：钮变回 Send（BLOCK-316 排队语义）；
 *   4 清空 → 变回 Stop；点击 → 停止 → 回空闲 Send。
 * 证据：acceptance/block-321b/live-send-stop-morph.json。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-321b');
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

/** 设输入框文本（原生 setter + input 事件，React 受控组件生效）。 */
const SET_INPUT = (text) => `(function(){
  var ta = document.querySelector('.sc-input');
  if (!ta) return 'no_textarea';
  var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set';
})()`;

/** 单钮态机读数：两钮互斥 + Send 禁用态 + 输入框内容。 */
const READ_MORPH = `(function(){
  var stop = document.querySelector('[data-testid="chat-stop"]');
  var send = document.querySelector('[data-testid="chat-send"]');
  var ta = document.querySelector('.sc-input');
  return JSON.stringify({
    stop: !!stop,
    send: !!send,
    sendDisabled: send ? send.disabled : null,
    input: ta ? ta.value : null,
    both: !!(stop && send),
  });
})()`;

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 320) });
    console.log(`${ok === true || ok === 'true' ? 'PASS' : 'FAIL'} ${id} ${String(detail).slice(0, 240)}`);
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

  const created = await rest('POST', '/data/projects', { name: 'BLOCK321b-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer' });
  await sleep(800);

  // 态 1a：空闲 + 空输入 → 只有 Send（禁用），无 Stop，两钮不并存
  const idle1 = JSON.parse(await evalRetry(client, READ_MORPH));
  assert('T1a_idle_empty_send_only', !idle1.stop && idle1.send && idle1.sendDisabled === true && !idle1.both, idle1);
  // 态 1b：输入文字 → Send 启用（仍无 Stop）
  await evalRetry(client, SET_INPUT('态1b 探针'));
  const idle2 = JSON.parse(await evalRetry(client, READ_MORPH));
  assert('T1b_idle_typed_send_enabled', !idle2.stop && idle2.send && idle2.sendDisabled === false && !idle2.both, idle2);
  await evalRetry(client, SET_INPUT(''));

  // 态 2：发送长任务进入流式 → 单钮=Stop（Send 不在场）
  const longPrompt = '请逐步执行：1) 读取项目根 package.json；2) 列出 src 目录；3) 读取 src/main.js 前 120 行；4) 读取 frontend/package.json；最后用三点总结。不要省略步骤。';
  const setterSend = `(function(){
    var ta = document.querySelector('.sc-input');
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(longPrompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    var btn = document.querySelector('[data-testid="chat-send"]');
    if (!btn) return 'no_send';
    btn.click();
    return 'sent';
  })()`;
  const sent = await evalRetry(client, setterSend);
  assert('T2_submit', sent === 'sent', `submit=${sent}`);
  await pagePoll(client, `!!document.querySelector('[data-testid="chat-stop"]')`, { timeoutMs: 90000, label: 'streaming' });
  await sleep(600);
  const streaming1 = JSON.parse(await evalRetry(client, READ_MORPH));
  assert('T2_streaming_stop_only', streaming1.stop && !streaming1.send && !streaming1.both, streaming1);

  // 态 3：流式中输入新内容 → 钮变回 Send（排队语义）
  await evalRetry(client, SET_INPUT('排队探针：收到后只回复「已插话」'));
  const streaming2 = JSON.parse(await evalRetry(client, READ_MORPH));
  assert('T3_streaming_typed_send_back', !streaming2.stop && streaming2.send && streaming2.sendDisabled === false, streaming2);

  // 态 4a：清空 → 变回 Stop
  await evalRetry(client, SET_INPUT(''));
  const streaming3 = JSON.parse(await evalRetry(client, READ_MORPH));
  assert('T4a_streaming_cleared_stop_again', streaming3.stop && !streaming3.send, streaming3);

  // 态 4b：点击 Stop → 停止 → 回空闲 Send
  await evalRetry(client, `document.querySelector('[data-testid="chat-stop"]').click(); 'clicked'`);
  const backIdle = await pagePoll(client, `(function(){
    var stop = document.querySelector('[data-testid="chat-stop"]');
    var send = document.querySelector('[data-testid="chat-send"]');
    return (stop === null && send !== null) ? 'idle_send' : 'waiting';
  })()`, { timeoutMs: 30000, label: 'stop_back_to_idle' });
  assert('T4b_stopped_back_to_send', backIdle === 'idle_send', backIdle);

  const pass = records.every((r) => r.ok);
  const evidence = {
    capturedAt: new Date().toISOString(),
    projectId,
    pass,
    checks: records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-send-stop-morph.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} (${records.filter((r) => r.ok).length}/${records.length})`);
  console.log('evidence: acceptance/block-321b/live-send-stop-morph.json');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('PROBE-ERROR:', err.message);
  process.exit(2);
});
