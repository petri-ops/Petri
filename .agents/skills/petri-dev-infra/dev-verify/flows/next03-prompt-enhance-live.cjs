#!/usr/bin/env node
'use strict';

/**
 * NEXT-03 实机腿：点击才请求真实当前 chat 模型；TaskSpec 预览不自动替换/发送；
 * 用户点击替换后才回填 composer，消息数保持不变。
 * 前置：隔离后端 :3011（复用本机模型配置）+ 9223 测试实例 + Vite :3000。
 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.NEXT03_API || 'http://127.0.0.1:3011';
const PROMPT = '做一个桌面小外壳，能放一块电路板，导出模型和尺寸校验结果。';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evalJsWithTimeout(client, expression, timeoutMs = 15_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 400, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 240)}`);
}

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function dismissOverlays(client) {
  await evalJsWithTimeout(client, `(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < btns.length; i += 1) {
      var text = (btns[i].textContent || '').trim();
      if (text === '开始使用' || text === '知道了') btns[i].click();
    }
    return 'ok';
  })()`).catch(() => null);
  await sleep(400);
}

async function setComposer(client, text) {
  return evalJsWithTimeout(client, `(function(){
    var ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  })()`);
}

async function composerValue(client) {
  return evalJsWithTimeout(client, `document.querySelector('textarea.sc-input')?.value ?? null`);
}

async function messageCount(client) {
  return evalJsWithTimeout(client, `document.querySelectorAll('.sc-msg').length`).catch(() => 0);
}

async function run({ assert }) {
  let projectId = null;
  let client = null;
  try {
    const project = await rest('POST', '/data/projects', { name: `NEXT-03-提示词-${Date.now()}` });
    projectId = project.data?.project?.id || null;
    assert('W0_temp_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 240));

    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJsWithTimeout(client, `location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)}`);
    await poll(async () => {
      const pathname = await evalJsWithTimeout(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, intervalMs: 500, label: 'project_route' });
    await dismissOverlays(client);
    await poll(async () => {
      const ready = await evalJsWithTimeout(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
      return ready === true ? true : null;
    }, { timeoutMs: 40_000, intervalMs: 600, label: 'composer_ready' });

    const typed = await setComposer(client, PROMPT);
    assert('W1_prompt_typed', typed === PROMPT, String(typed));
    assert('W2_no_dialog_before_click', await evalJsWithTimeout(client, `!document.querySelector('[data-testid="prompt-enhance-dialog"]')`) === true);

    const beforeMessages = await messageCount(client);
    const clicked = await evalJsWithTimeout(client, `(function(){
      var btn = document.querySelector('[data-testid="prompt-enhance"]');
      if (!btn || btn.disabled) return 'unavailable';
      btn.click();
      return 'clicked';
    })()`);
    assert('W3_prompt_enhance_clicked', clicked === 'clicked', String(clicked));

    const dialogState = await poll(async () => {
      const raw = await evalJsWithTimeout(client, `(function(){
        var dialog = document.querySelector('[data-testid="prompt-enhance-dialog"]');
        if (!dialog) return JSON.stringify({ present: false });
        var alert = dialog.querySelector('[role="alert"]');
        var result = dialog.querySelector('[data-testid="prompt-enhance-result"]');
        var spec = dialog.querySelector('[data-testid="task-spec"]');
        var original = dialog.querySelector('[data-testid="prompt-enhance-original"]');
        return JSON.stringify({
          present: true,
          error: alert ? (alert.textContent || '').trim() : null,
          result: result ? (result.textContent || '').trim() : null,
          spec: spec ? (spec.textContent || '').trim().slice(0, 1200) : null,
          original: original ? (original.textContent || '').trim() : null,
          text: (dialog.textContent || '').slice(0, 2400),
        });
      })()`).catch(() => '{}');
      const parsed = JSON.parse(raw || '{}');
      return parsed.present && (parsed.result || parsed.error) ? parsed : null;
    }, { timeoutMs: 60_000, intervalMs: 700, label: 'prompt_enhance_result' });

    assert('W4_model_result_visible', Boolean(dialogState.result),
      String(dialogState.result || dialogState.error || 'no_result').slice(0, 300));
    assert('W5_task_spec_visible', String(dialogState.spec || '').includes('task-spec/v1') && String(dialogState.spec || '').includes('验收'), String(dialogState.spec || '').slice(0, 500));
    assert('W6_original_preserved_in_dialog', dialogState.original === PROMPT, String(dialogState.original));
    assert('W7_capability_truth_visible', String(dialogState.text || '').includes('blender') && String(dialogState.text || '').includes('不可用'), String(dialogState.text || '').slice(0, 800));
    assert('W8_no_auto_replace_before_apply', await composerValue(client) === PROMPT, String(await composerValue(client)));
    assert('W9_no_auto_send', await messageCount(client) === beforeMessages, `before=${beforeMessages} after=${await messageCount(client)}`);

    const applied = await evalJsWithTimeout(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('[data-testid="prompt-enhance-dialog"] button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '替换原稿') { btns[i].click(); return 'clicked'; }
      }
      return 'missing';
    })()`);
    assert('W10_apply_clicked', applied === 'clicked', String(applied));
    await poll(async () => {
      const gone = await evalJsWithTimeout(client, `!document.querySelector('[data-testid="prompt-enhance-dialog"]')`).catch(() => false);
      return gone === true ? true : null;
    }, { timeoutMs: 10_000, intervalMs: 300, label: 'dialog_closed' });
    const valueAfter = await composerValue(client);
    assert('W11_apply_replaces_only_draft', typeof valueAfter === 'string' && valueAfter !== PROMPT && valueAfter.length > 10,
      String(valueAfter).slice(0, 300));
    assert('W12_apply_did_not_send', await messageCount(client) === beforeMessages, `before=${beforeMessages} after=${await messageCount(client)}`);
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'next03-prompt-enhance-live',
  description: 'NEXT-03 提示词增强：点击触发/TaskSpec 预览/不自动替换发送/应用后仅回填',
  evidenceDir: path.join(ROOT, 'acceptance', 'next-03-prompt-enhance'),
  run,
};
