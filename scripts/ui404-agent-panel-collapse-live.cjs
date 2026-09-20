#!/usr/bin/env node
'use strict';
/**
 * ui404-agent-panel-collapse-live.cjs — UI-404 实机验收：
 *   智能体详情面板「操作 / 实时工作流」终态默认收起、运行中默认展开、
 *   头部任务全文 + 父会话标注、时间线收起态计数摘要。
 * 前置：dev 栈（vite 3000 + 后端 3001 + CDP 9222）+ 至少一个项目。
 * 证据：acceptance/ui-403/../ui-404/ui404-agent-panel-collapse.png + stdout 断言。
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-404');

function apiJson(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(API + pathname, { method, headers: { ...AUTH, 'Content-Type': 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const run = lib.createRun({ name: 'ui404-agent-panel-collapse', evidenceDir: EVIDENCE_DIR });
  const proj = await apiJson('GET', '/api/data/projects');
  const projectId = (proj.projects && proj.projects[0] && proj.projects[0].id) || null;

  let targets = await lib.pollTargets({ timeoutMs: 20000 });
  let client = await lib.connectTarget(await lib.selectPageTarget(
    lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/),
    { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) },
  ));
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
  await sleep(4500);
  targets = await lib.pollTargets({ timeoutMs: 10000 });
  client = await lib.connectTarget(await lib.selectPageTarget(
    lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/project\//),
    { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) },
  ));

  // composer 真发派生请求（UI 上下文完整，spawn 审批卡可在面板点击）
  const PROMPT = '请立即用 spawn_agent 工具派生一个子智能体，子任务：「报告 7 乘 6 的答案」。派生后直接回复完成。';
  let typed = '';
  for (let i = 0; i < 10 && typed !== 'typed'; i++) {
    typed = await lib.evalJs(client, `(function(){
      var ta = document.querySelector('textarea.sc-input');
      if (!ta) return 'no_textarea';
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(PROMPT)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    if (typed !== 'typed') await sleep(1000);
  }
  run.assert('V1_composer_typed', typed === 'typed', String(typed));
  const sent = await lib.evalJs(client, `(function(){
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].getAttribute('title') || '';
      if (t.indexOf('发送') >= 0 && btns[i].offsetParent) { btns[i].click(); return 'sent'; }
    }
    return 'no_send';
  })()`);
  run.assert('V2_composer_sent', sent === 'sent', String(sent));

  // 等子智能体 chip 出现在摘要卡（spawn 成功后 5s 轮询窗口内）
  let chipFound = false;
  for (let i = 0; i < 40 && !chipFound; i++) {
    await sleep(3000);
    chipFound = (await lib.evalJs(client, `document.querySelectorAll('section[aria-label="智能体"] button').length > 0`)) === true;
    // spawn 审批卡出现则点击批准（标题含「批准」或「允许」的按钮）
    await lib.evalJs(client, `(function(){
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '');
        if ((t.indexOf('批准') >= 0 || t.indexOf('允许') >= 0) && btns[i].offsetParent) { btns[i].click(); return 'approved'; }
      }
      return 'none';
    })()`);
  }
  run.assert('V3_subagent_chip_visible', chipFound, `chip=${chipFound}`);

  // 点击第一枚 chip → 右栏切到智能体详情
  await lib.evalJs(client, `(function(){
    var btns = document.querySelectorAll('section[aria-label="智能体"] button');
    if (btns.length) { btns[btns.length - 1].click(); return 'clicked'; }
    return 'none';
  })()`);
  await sleep(2500);

  // 断言：终态子任务 → 操作/时间线收起 + 时间线计数标题 + 父会话标注
  const actionsCollapsed = await lib.evalJs(client, `(function(){
    var btn = document.querySelector('[data-testid="agent-run-actions"] button[aria-expanded]');
    return btn ? String(btn.getAttribute('aria-expanded')) : 'no_toggle';
  })()`);
  run.assert('V4_terminal_actions_collapsed', actionsCollapsed === 'false', `aria-expanded=${actionsCollapsed}`);

  const timelineTitle = await lib.evalJs(client, `(function(){
    var el = document.querySelector('[data-testid="agent-timeline-title"]');
    return el ? el.textContent : 'missing';
  })()`);
  run.assert('V5_timeline_count_summary', /次调用/.test(timelineTitle), timelineTitle);

  const parent = await lib.evalJs(client, `(function(){
    var el = document.querySelector('[data-testid="agent-parent-conversation"]');
    return el ? el.textContent : 'missing';
  })()`);
  run.assert('V6_parent_conversation_line', parent.indexOf('父会话：') === 0, parent);

  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui404-agent-panel-collapse.png');
  await run.finish({});
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
