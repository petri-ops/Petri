#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: workspace-panel-motion — 侧栏常驻 + 左右栏/终端开合平滑（UI-341 加映二）。
 *
 * 断言链：
 *   P1_result_mode_keeps_left        进入结果族模式（/result）后左栏仍开（不再自动收缩）
 *   P2_settings_keeps_left           进入设置页后左栏仍开
 *   P3_left_collapse_is_animated     左栏收起态：保持挂载 + width 过渡（平滑机制）
 *   P4_right_collapse_is_animated    右栏收起态：同上
 *   P5_terminal_collapse_is_animated 终端收起态：同上（height）
 *   P6_left_restored                 收合再展开后宽度回到原值（无状态残留）
 *
 * 关于「平滑」的判据：不做时间轴采样——dev Electron 窗口常处隐藏/被遮挡态，
 * Chromium 对不可见页面停发 requestAnimationFrame 且节流 setTimeout（实测 rAF 采样
 * 直接 30s 超时），无头环境下时间序列不可靠。「卸载即瞬跳」的根因正是元素被 unmount
 * 或该维度没有 transition，这两条在 DOM/计算样式层可确定性断言；动画观感由实机截图
 * 加人眼复核。窗口宽度 <960 为 compact 浮层模式（语义不同，仅提示）。
 *
 * 证据：acceptance/ui-341/workspace-panel-motion-live.json + panel-motion.png
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function widthOf(client, selector) {
  return lib.evalJs(client, `(function(){
    var e = document.querySelector('${selector}');
    return e ? Math.round(e.getBoundingClientRect().width) : -1;
  })()`).catch(() => -1);
}

async function heightOf(client, selector) {
  return lib.evalJs(client, `(function(){
    var e = document.querySelector('${selector}');
    return e ? Math.round(e.getBoundingClientRect().height) : -1;
  })()`).catch(() => -1);
}

async function clickByLabel(client, label) {
  return lib.evalJs(client, `(function(){
    var b = [...document.querySelectorAll('button')].find(function(x){
      return (x.getAttribute('aria-label')||'') === ${JSON.stringify(label)};
    });
    if (!b) return 'not_found';
    b.click();
    return 'clicked';
  })()`).catch((e) => 'err:' + e.message.slice(0, 60));
}

/** 按期望状态点击开关：当前开着→点「收起X」；当前关着→点「展开X」。 */
async function setPanelOpen(client, selector, dim, openLabel, closeLabel, wantOpen) {
  const cur = dim === 'w' ? await widthOf(client, selector) : await heightOf(client, selector);
  if ((cur > 0) === wantOpen) return 'already';
  return clickByLabel(client, wantOpen ? openLabel : closeLabel);
}

/** 开合平滑的机械判据：收合后保持挂载 + 该维度过渡时长 ≥50ms。
 *  阈值不能放宽到 >0：全局 reduced-motion 兜底会把时长压成 1 微秒（实测），
 *  >0 会把它误判为「有动画」而放过真实缺陷。 */
async function panelTransitionInfo(client, selector, dim) {
  const prop = dim === 'w' ? 'width' : 'height';
  const raw = await lib.evalJs(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return JSON.stringify({ mounted: false });
    var cs = getComputedStyle(e);
    var names = (cs.transitionProperty || '').split(',').map(function (s) { return s.trim(); });
    var durs = (cs.transitionDuration || '').split(',').map(function (s) { return parseFloat(s) || 0; });
    var idx = names.indexOf(${JSON.stringify(prop)});
    var r = e.getBoundingClientRect();
    return JSON.stringify({
      mounted: true,
      value: Math.round(${JSON.stringify(prop)} === 'width' ? r.width : r.height),
      transition: cs.transitionProperty,
      duration: idx >= 0 ? durs[idx] : 0,
    });
  })()`).catch((e) => JSON.stringify({ mounted: false, err: e.message.slice(0, 60) }));
  return JSON.parse(raw);
}

module.exports = {
  id: 'workspace-panel-motion',
  description: 'UI-341 加映二 侧栏常驻 + 左右栏/终端开合平滑（挂载与过渡机制断言）',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-341'),

  async run({ assert }) {
    const targets = await lib.pollTargets({ timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到');
    const client = await lib.connectTarget(pages[0]);
    const originalUrl = pages[0].url;

    // 窗口宽度仅提示：<960 为 compact 浮层模式（侧栏变浮层），「常驻」结论不受影响
    const w0 = await lib.evalJs(client, 'window.innerWidth').catch(() => 0);
    lib.log(`note: innerWidth=${w0}${w0 < 960 ? '（compact 浮层模式）' : ''}`);

    const listRaw = await lib.evalJs(client, `(async () => {
      const r = await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
      const d = await r.json();
      return JSON.stringify((d.projects || []).slice(0, 1).map(function (p) { return { id: p.id, name: p.name }; }));
    })()`).catch(() => '[]');
    const first = (JSON.parse(listRaw || '[]')[0]) || null;
    if (!first) throw new Error('no_project_available: 需要至少一个项目');

    const gotoMode = async (seg) => {
      await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${first.id}${seg}'; 'nav'`);
      await sleep(3200);
    };

    try {
      await gotoMode('/result');
      const p1w = await widthOf(client, '[class*="leftCol"]');
      assert('P1_result_mode_keeps_left', p1w > 100, 'leftCol width=' + p1w);

      await gotoMode('/settings');
      const p2w = await widthOf(client, '[class*="leftCol"]');
      assert('P2_settings_keeps_left', p2w > 100, 'leftCol width=' + p2w);

      await gotoMode('');
      await setPanelOpen(client, '[class*="leftCol"]', 'w', '展开左侧栏', '收起左侧栏', true);
      await sleep(600);
      const baseW = await widthOf(client, '[class*="leftCol"]');

      await clickByLabel(client, '收起左侧栏');
      await sleep(700);
      const lInfo = await panelTransitionInfo(client, '[class*="leftCol"]', 'w');
      assert('P3_left_collapse_is_animated',
        lInfo.mounted === true && lInfo.value <= 2 && lInfo.duration >= 0.05,
        `mounted=${lInfo.mounted} width=${lInfo.value} transition=${lInfo.transition} dur=${lInfo.duration}`);

      await clickByLabel(client, '展开左侧栏');
      await sleep(800);
      const reopenedW = await widthOf(client, '[class*="leftCol"]');
      assert('P6_left_restored', baseW > 100 && Math.abs(reopenedW - baseW) <= 2, `base=${baseW} reopened=${reopenedW}`);

      await setPanelOpen(client, '[class*="rightCol"]', 'w', '展开右侧栏', '收起右侧栏', true);
      await sleep(700);
      await clickByLabel(client, '收起右侧栏');
      await sleep(700);
      const rInfo = await panelTransitionInfo(client, '[class*="rightCol"]', 'w');
      assert('P4_right_collapse_is_animated',
        rInfo.mounted === true && rInfo.value <= 2 && rInfo.duration >= 0.05,
        `mounted=${rInfo.mounted} width=${rInfo.value} transition=${rInfo.transition} dur=${rInfo.duration}`);

      const tBefore = await heightOf(client, '[class*="embeddedTerminal"]');
      if (tBefore > 4) {
        await lib.evalJs(client, `(function(){
          var b = [...document.querySelectorAll('button')].find(function(x){
            var l = (x.getAttribute('aria-label')||'') + (x.title||'');
            return l.indexOf('终端') >= 0;
          });
          if (b) b.click();
          return 'closed';
        })()`).catch(() => {});
        await sleep(800);
      }
      const tInfo = await panelTransitionInfo(client, '[class*="embeddedTerminal"]', 'h');
      assert('P5_terminal_collapse_is_animated',
        tInfo.mounted === true && tInfo.value <= 4 && tInfo.duration >= 0.05,
        `mounted=${tInfo.mounted} height=${tInfo.value} transition=${tInfo.transition} dur=${tInfo.duration}`);

      await lib.screenshotPng(client, path.join(ROOT, 'acceptance', 'ui-341'), 'panel-motion.png');
    } finally {
      try {
        await lib.evalJs(client, "location.href = " + JSON.stringify(originalUrl) + "; 'restore'");
        await sleep(1200);
      } catch { /* ignore */ }
    }
    return true;
  },
};
