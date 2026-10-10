#!/usr/bin/env node
'use strict';
/**
 * ui373-welcome-composer-live.cjs — UI-373 欢迎页不预选 + 输入框常驻 实机验收。
 *
 * 被测缺陷（用户截图指认）：软件冷启动初始界面只有「选择项目」选择器，没有输入框，
 * 与「应显示输入框（图2 形态）但不应预先确定工作区」的预期不符。两条根因：
 *   ① welcome 首载单发 listProjects，dev 栈重启竞态下抛错后 loaded=true + 空列表
 *      且再无重试（UI-369 左栏同族缺陷，本页未同步自愈）→ 无选中 → composer 整体
 *      不挂载（chatMounted=Boolean(selectedProject)）；
 *   ② 列表载入成功时又自动选中最近项目（sorted[0]）→ 预先「确定工作区」。
 *
 * 断言（每条都是旧实现必红、修复后必绿的判别式；A4 竞态自愈由单测门覆盖）：
 *   A1 欢迎页输入框常驻：composer 挂载（textarea 存在）且触发器保持「选择项目」、
 *      无分支徽标（旧实现②：触发器显示最近项目名 → FAIL）
 *   A2 未选项目发送被守卫拦截：键入文本 + Enter → 项目下拉面板展开 + 提示行出现，
 *      文本保留在输入框（旧实现：composer 根本不挂载 → FAIL）
 *   A3 选中项目：草稿随选中迁移（换挂载后 textarea 值不丢）、守卫撤下（触发器
 *      显示项目名 + 分支徽标出现）（旧实现：无「未选态」可言 → FAIL）
 *
 * 用法：dev 栈在跑（Vite:3000 + CDP:9222）→ `node scripts/ui373-welcome-composer-live.cjs`
 * 证据：acceptance/ui-373/ui373-welcome-composer-live.json
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-373');
const DRAFT_TEXT = 'ui373 探针草稿——未选项目先键入';

const STATE = `(function(){
  var ta=document.querySelector('[class*="chatMount"] textarea');
  var trigger=document.querySelector('[aria-label="选择项目"]');
  var search=document.querySelector('[aria-label="搜索工作区"]');
  var branch=document.querySelector('[title^="当前分支"]');
  var hint=Array.prototype.slice.call(document.querySelectorAll('p'))
    .map(function(n){return n.textContent||'';})
    .find(function(t){return t.indexOf('先选择一个项目')>=0;})||null;
  return JSON.stringify({
    path: location.pathname,
    composerMounted: !!ta,
    textareaValue: ta?ta.value:null,
    triggerText: trigger?trigger.textContent.trim():null,
    pickerOpen: !!search,
    hasBranchChip: !!branch,
    guardHint: hint
  });
})()`;

/** React 受控 textarea：原生 setter 写值 + input 事件 + Enter keydown（走 send 路径）。 */
const TYPE_AND_ENTER = `(function(){
  var ta=document.querySelector('[class*="chatMount"] textarea');
  if(!ta) return 'no_textarea';
  var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  setter.call(ta, ${JSON.stringify(DRAFT_TEXT)});
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  return 'typed';
})()`;

async function readState(client) {
  return JSON.parse(await lib.evalJs(client, STATE));
}

async function waitFor(client, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(400);
    last = await readState(client);
    if (predicate(last)) return last;
  }
  return last;
}

(async () => {
  const run = lib.createRun({ name: 'ui373-welcome-composer', evidenceDir: EVIDENCE_DIR });
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  const client = await lib.connectTarget(target);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // 载入当前源码的欢迎页；快照草稿键，探针结束后原样还原（不碰用户真实草稿）
  await client.send('Page.navigate', { url: 'http://localhost:3000/' });
  await sleep(4000);
  const draftSnapshot = JSON.parse(await lib.evalJs(client, `(function(){
    var out={};
    for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);
      if(k.indexOf('petri:composer-draft:')===0) out[k]=localStorage.getItem(k);}
    return JSON.stringify(out);})()`));
  await lib.evalJs(client, `(function(){
    Object.keys(${JSON.stringify(draftSnapshot)}).forEach(function(k){localStorage.removeItem(k);});
    return true;})()`);

  try {
    // A1 — 常驻 composer + 不预选
    const a1 = await waitFor(client, (s) => s.path === '/' && s.composerMounted && (s.triggerText || '').indexOf('选择项目') >= 0);
    lib.log(`A1 → composer=${a1.composerMounted} trigger="${a1.triggerText}" branch=${a1.hasBranchChip}`);

    // A2 — 未选项目发送：守卫展开选择器 + 提示 + 文本保留
    await lib.evalJs(client, TYPE_AND_ENTER);
    const a2 = await waitFor(client, (s) => s.pickerOpen && s.guardHint && s.textareaValue === DRAFT_TEXT);
    lib.log(`A2 → pickerOpen=${a2.pickerOpen} hint=${a2.guardHint ? 'shown' : 'none'} textKept=${a2.textareaValue === DRAFT_TEXT}`);

    // A3 — 选中项目（列表首行）：草稿迁移 + 守卫撤下（触发器显示项目名 + 分支徽标）
    await lib.evalJs(client, `(function(){
      var list=document.querySelector('[aria-label="工作区列表"]');
      var row=list&&list.querySelector('button');
      if(!row) return 'no_row'; row.click(); return 'picked:'+row.textContent.trim();})()`);
    const a3 = await waitFor(client, (s) => s.composerMounted && (s.triggerText || '').indexOf('选择项目') < 0 && s.triggerText !== '项目加载中…' && s.textareaValue === DRAFT_TEXT);
    lib.log(`A3 → trigger="${a3.triggerText}" textCarried=${a3.textareaValue === DRAFT_TEXT} branch=${a3.hasBranchChip}`);

    run.assert('A1 欢迎页输入框常驻：composer 挂载且触发器保持「选择项目」（不预选工作区）',
      a1.composerMounted && (a1.triggerText || '').indexOf('选择项目') >= 0 && !a1.hasBranchChip,
      `composer=${a1.composerMounted} trigger="${a1.triggerText}" branch=${a1.hasBranchChip}`);
    run.assert('A2 未选项目发送被守卫拦截：下拉面板展开 + 提示行出现 + 输入保留',
      a2.pickerOpen && !!a2.guardHint && a2.textareaValue === DRAFT_TEXT,
      `pickerOpen=${a2.pickerOpen} hint=${a2.guardHint ? 'shown' : 'none'} textKept=${a2.textareaValue === DRAFT_TEXT}`);
    run.assert('A3 选中后草稿随选中迁移（换挂载不丢字）且触发器切换到所选项目',
      a3.composerMounted && (a3.triggerText || '').indexOf('选择项目') < 0 && a3.textareaValue === DRAFT_TEXT,
      `trigger="${a3.triggerText}" textCarried=${a3.textareaValue === DRAFT_TEXT}`);
  } finally {
    // 还原用户草稿键 + 回到干净欢迎页
    await lib.evalJs(client, `(function(){
      var snap=${JSON.stringify(draftSnapshot)};
      Object.keys(snap).forEach(function(k){localStorage.setItem(k,snap[k]);});
      return Object.keys(snap).length;})()`);
    await client.send('Page.navigate', { url: 'http://localhost:3000/' });
    await sleep(1500);
  }

  client.close?.();
  await run.finish({
    draftText: DRAFT_TEXT,
    note: 'A4 首载竞态退避自愈由单测门 welcome.test.tsx 覆盖（fake timers），实机不重启后端不复演',
    userReport: '用户截图指认「软件刚启动的初始界面只有选择项目没有输入框，按理应该是图2（但不应该确定的工作区）」',
  });
  process.exit(run.allPass ? 0 : 1);
})().catch((e) => { lib.log(`FATAL ${e.message}`); process.exit(2); });
