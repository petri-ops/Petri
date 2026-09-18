#!/usr/bin/env node
'use strict';
/**
 * ui408-subagent-result-card-live.cjs — UI-408 实机验收：
 *   子智能体终态后，父会话流内出现「终态结果内联卡」（需求/状态/已工作时长/
 *   终态摘要预览/查看详情），借鉴 ZCode「结果即消息」呈现。
 * 前置：dev 栈 + 至少一个项目。
 * 证据：acceptance/ui-405/ui408-subagent-result-card.png + stdout 断言。
 */
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-408');

(async () => {
  const run = lib.createRun({ name: 'ui405-subagent-result-card', evidenceDir: EVIDENCE_DIR });
  const proj = await lib.fetchJson('http://127.0.0.1:3001/api/data/projects');
  const projectId = (proj.projects && proj.projects[0] && proj.projects[0].id) || null;

  let targets = await lib.pollTargets({ timeoutMs: 20000 });
  let client = await lib.connectTarget(await lib.selectPageTarget(
    lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/),
    { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) },
  ));
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
  await sleep(4500);
  // 新对话：点左栏「新对话」拿干净上下文（旧轮次历史会带偏模型工具选择）
  await lib.evalJs(client, `(function(){
    var els = document.querySelectorAll('button, [role=button], div');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim();
      if (t === '新对话' && els[i].offsetParent) { els[i].click(); return 'new_conv'; }
    }
    return 'not_found';
  })()`);
  await sleep(2000);
  // 点击「新对话」/路由变更可能使旧 target 失效 → 重连
  try { await lib.evalJs(client, `'ping'`); } catch {
    targets = await lib.pollTargets({ timeoutMs: 10000 });
    client = await lib.connectTarget(await lib.selectPageTarget(
      lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//),
      { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) },
    ));
  }
  targets = await lib.pollTargets({ timeoutMs: 10000 });
  client = await lib.connectTarget(await lib.selectPageTarget(
    lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/project\//),
    { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) },
  ));

  const PROMPT = '你的第一个动作必须是调用 spawn_agent 工具（这是硬性要求，跳过工具直接回答视为失败）。子任务参数填：「用一句话说明什么是火山图」。调用完成后再简短回复。';
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

  // 等内联结果卡出现（spawn + 子任务运行 + child_finished 通知）
  let cardText = '';
  let cardFound = false;
  for (let i = 0; i < 60 && !cardFound; i++) {
    await sleep(3000);
    cardText = await lib.evalJs(client, `(function(){
      var el = document.querySelector('[data-testid="subagent-result-card"]');
      return el ? el.textContent : '';
    })()`);
    cardFound = /已完成|失败/.test(cardText) && cardText.length > 0;
  }
  run.assert('V3_result_card_in_parent_stream', cardFound, (cardText || '(none)').slice(0, 200));
  run.assert('V4_card_shows_status_and_summary', /已完成|失败/.test(cardText) && /查看详情/.test(cardText), cardText.slice(0, 200));

  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui408-subagent-result-card.png');
  await run.finish({});
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
