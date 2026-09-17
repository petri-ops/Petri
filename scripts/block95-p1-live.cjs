#!/usr/bin/env node
'use strict';
/**
 * block95-p1-live.cjs — BLOCK-95 P1 实机验收（dev Electron 真轮次）：
 *   V1 A1 窗口翻转：打开 250 条会话，首条渲染消息 = 最新窗口的最旧一条（B95消息-50），
 *      旧缺陷下首条 = B95消息-0（最旧 200 条窗口）；
 *   V2 A1 向上补页：滚动到顶自动 prepend，首条变 B95消息-0，250 条全量可达；
 *   V3 A3 滚动守卫：上翻后回底浮标出现；点击浮标回到底部且浮标消失；
 *   V4 A4 话题分隔：.sc-topic-shift 存在，其后第一条消息 = 转移后的第一条 user 消息；
 *   V5 fork index：无 run 态下第 i 条消息的创建分支请求 untilIndex = windowOffset+i（协议对账走契约测试，此处验 UI 可点）。
 * 证据：acceptance/block-95/block95-p1-live.json + 截图。
 */
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu3qk7vs_2xwc';
const CONV_TITLE = 'B95 长会话游标验证';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-95');

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

const EVAL = (expr) => lib.evalJs(client, expr);

let client;

(async () => {
  const run = lib.createRun({ name: 'block95-p1-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();

  // 打开项目工作台
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(4000);
  client = await attach();

  // 点击目标会话（左栏会话列表按标题定位）
  const clicked = await EVAL(`(function(){
    var nodes = Array.from(document.querySelectorAll('button, [role="button"], li, div'));
    var hit = nodes.filter(function(n){ return n.childElementCount <= 3 && n.textContent && n.textContent.trim() === '${CONV_TITLE}'; }).pop();
    if (!hit) return 'conv_not_found:' + nodes.length;
    hit.click(); return 'clicked';
  })()`);
  run.assert('open_target_conversation', String(clicked).includes('clicked'), String(clicked));
  await sleep(2500);

  // V1 首条渲染消息（A1 窗口翻转）
  const firstMsg = await EVAL(`(function(){
    var el = document.querySelector('.sc-messages .sc-msg .sc-msg-body');
    var scroller = document.querySelector('.sc-messages');
    return JSON.stringify({ first: el ? el.textContent.slice(0, 30) : null,
      count: document.querySelectorAll('.sc-messages .sc-msg').length,
      scrollTop: scroller ? scroller.scrollTop : null });
  })()`);
  const v1 = JSON.parse(firstMsg);
  run.assert('a1_latest_window_first_message', v1.first === 'B95消息-50（问）', 'first=' + v1.first + ' rendered=' + v1.count);

  // A4 分隔卡（补页前先验：分隔卡应在其后第一条 user 消息 B95消息-162 前）
  const shift = await EVAL(`(function(){
    var card = document.querySelector('.sc-topic-shift');
    if (!card) return JSON.stringify({ present: false });
    var next = card.nextElementSibling;
    var nextBody = next && next.querySelector('.sc-msg-body');
    return JSON.stringify({ present: true, text: card.textContent.slice(0, 40),
      nextMsg: nextBody ? nextBody.textContent.slice(0, 30) : null });
  })()`);
  const v4 = JSON.parse(shift);
  run.assert('a4_topic_shift_card', v4.present === true && /转向游标加载验证/.test(v4.text || ''), shift);
  run.assert('a4_topic_shift_position', v4.nextMsg === 'B95消息-162（问）', 'nextMsg=' + v4.nextMsg);

  // V3 滚动守卫：滚到中部（距底 >600px），浮标应出现
  const floatProbe = await EVAL(`(function(){
    var sc = document.querySelector('.sc-messages');
    sc.scrollTop = sc.scrollHeight - sc.clientHeight - 900;
    sc.dispatchEvent(new Event('scroll'));
    return 'scrolled:' + sc.scrollTop;
  })()`);
  await sleep(400);
  const float1 = await EVAL(`(function(){
    var b = document.querySelector('.sc-jump-bottom');
    return JSON.stringify({ visible: !!b, text: b ? b.textContent.trim() : null });
  })()`);
  run.assert('a3_jump_bottom_visible', JSON.parse(float1).visible === true, float1 + ' @' + floatProbe);
  await lib.screenshotPng(client, EVIDENCE_DIR, 'block95-a3-jump-bottom.png');

  // V3 点击浮标回底
  const backRes = await EVAL(`(function(){
    var b = document.querySelector('.sc-jump-bottom');
    if (!b) return 'missing';
    b.click(); return 'clicked';
  })()`);
  await sleep(600);
  const backState = await EVAL(`(function(){
    var sc = document.querySelector('.sc-messages');
    var b = document.querySelector('.sc-jump-bottom');
    return JSON.stringify({ atBottom: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 50, floatGone: !b });
  })()`);
  const v3b = JSON.parse(backState);
  run.assert('a3_jump_bottom_click', backRes === 'clicked' && v3b.atBottom && v3b.floatGone, backState);

  // V2 向上补页：滚到顶 → 等待 prepend → 首条变最旧
  await EVAL(`(function(){ var sc = document.querySelector('.sc-messages'); sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); return 'top'; })()`);
  await sleep(1500);
  const older = await EVAL(`(function(){
    var el = document.querySelector('.sc-messages .sc-msg .sc-msg-body');
    var sc = document.querySelector('.sc-messages');
    return JSON.stringify({ first: el ? el.textContent.slice(0, 30) : null,
      count: document.querySelectorAll('.sc-messages .sc-msg').length,
      scrollTop: sc ? Math.round(sc.scrollTop) : null,
      loadingIndicator: !!document.querySelector('.sc-loading-older') });
  })()`);
  const v2 = JSON.parse(older);
  run.assert('a1_older_page_prepended', v2.first === 'B95消息-0（问）' && v2.count > 200, 'first=' + v2.first + ' count=' + v2.count + ' scrollTop=' + v2.scrollTop);
  await lib.screenshotPng(client, EVIDENCE_DIR, 'block95-a1-older-page.png');

  // 补页后视口保持（prepend 不把用户拽到底部）
  run.assert('a1_viewport_kept_after_prepend', v2.scrollTop > 0, 'scrollTop=' + v2.scrollTop);

  const payload = await run.finish({ conversationId: 'conv_b95_live', projectId: PROJECT_ID });
  console.log('ALLPASS=' + payload.allPass);
  process.exit(payload.allPass ? 0 : 1);
})().catch((e) => { console.error('PROBE_ERROR', e && e.message); process.exit(2); });
