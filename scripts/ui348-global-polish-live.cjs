#!/usr/bin/env node
'use strict';
/**
 * ui348-global-polish-live.cjs — UI-348 实机验收：右栏后端卡删除 + 全局页主题色 + 顶栏冲突。
 *
 * 用户裁决（2026-09-11）：①右栏「后端」卡删除（管理面已在左栏入口的全局页）；
 * ②后端/知识空间页主题色随设置适配；③Skills/知识空间/后端顶栏「Petri」区
 * 分隔线错位/布局冲突优化。
 *
 * 断言：
 *   V1 右栏 home 空态不再有「后端」卡（其余快捷卡保留）；
 *   V2 /knowledge /backend 页头图标色 = 主题 accent token（非硬编码紫 #8b5cf6）；
 *   V3 全局页顶栏无品牌 chip「Petri」、左右分区线退场（border 0）；
 *   V4 回归：欢迎页顶栏品牌 chip 不受影响（仍在）。
 */

const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

async function goto(client, url) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'nav'`);
  await sleep(3500);
  return attach();
}

(async () => {
  const run = lib.createRun({ name: 'ui348-global-polish', evidenceDir: path.join(ROOT_PATH(), 'acceptance', 'ui-348') });
  let client = await attach();

  /* V1 — 右栏 home 空态无「后端」卡 */
  client = await goto(client, 'http://localhost:3000/');
  // 在欢迎页直接查 DOM 不行（右栏在工作区）；进项目工作区 → 打开右栏 home
  const projects = await (await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } })).json();
  const pid = projects.projects[0].id;
  client = await goto(client, `http://localhost:3000/project/${pid}`);
  await sleep(2500);
  const v1 = await lib.evalJs(client, `(function(){
    var cards = [].slice.call(document.querySelectorAll('button[class*="emptyResultLaunchCard"]'));
    var labels = cards.map(function(c){ return c.textContent.trim(); });
    return JSON.stringify({ labels: labels, hasBackend: labels.indexOf('后端') >= 0 });
  })()`).catch(() => '{}');
  const v1s = JSON.parse(v1 || '{}');
  run.assert('V1_right_panel_backend_card_removed', v1s.hasBackend === false && (v1s.labels || []).length >= 4,
    `右栏快捷卡=${JSON.stringify(v1s.labels)}，「后端」卡已删除=${v1s.hasBackend === false}`);

  /* V2 + V3 — 全局页主题色与顶栏 */
  for (const route of ['knowledge', 'backend']) {
    client = await goto(client, `http://localhost:3000/${route}`);
    await sleep(1500);
    const probe = await lib.evalJs(client, `(function(){
      function rgb(el) { return el ? getComputedStyle(el).color : null; }
      var icon = document.querySelector('[class*="pageIcon"]');
      var iconBg = icon ? getComputedStyle(icon).backgroundColor : null;
      var iconFg = rgb(icon);
      var zoneBorders = [].slice.call(document.querySelector('header').children).map(function(z) {
        return getComputedStyle(z).borderRightWidth;
      });
      var chip = document.querySelector('header [class*="centerTitleMain"]');
      return JSON.stringify({
        iconBg: iconBg, iconFg: iconFg,
        hardViolet: (iconBg || '').indexOf('139, 92, 246') >= 0 || (iconFg || '') === 'rgb(139, 92, 246)',
        zoneBorders: zoneBorders,
        chipGone: !chip,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim()
      });
    })()`).catch(() => '{}');
    const s = JSON.parse(probe || '{}');
    run.assert(`V2_${route}_accent_theme`, s.hardViolet === false && !!s.iconFg && s.iconFg !== 'rgb(139, 92, 246)',
      `${route} 页头图标色 fg=${s.iconFg} bg=${s.iconBg}（硬编码紫已清除=${s.hardViolet === false}，当前 accent=${s.accent}）`);
    run.assert(`V3_${route}_titlebar_bare`, s.chipGone === true && (s.zoneBorders || []).every((w) => w === '0px'),
      `${route} 顶栏品牌 chip 已隐藏（chipGone=${s.chipGone}），分区线全部退场（borders=${JSON.stringify(s.zoneBorders)}）`);
  }

  /* V4 — 欢迎页顶栏回归（品牌 chip 仍在） */
  client = await goto(client, 'http://localhost:3000/');
  await sleep(1500);
  const v4 = await lib.evalJs(client, `(function(){
    var chip = document.querySelector('header [class*="centerTitleMain"]');
    return JSON.stringify({ chip: !!chip, text: chip ? chip.textContent.trim() : null });
  })()`).catch(() => '{}');
  const v4s = JSON.parse(v4 || '{}');
  run.assert('V4_welcome_chip_untouched', v4s.chip === true,
    `欢迎页顶栏品牌 chip 保留（chip=${v4s.chip}，text=${v4s.text}）`);

  return await run.finish({});
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});

function ROOT_PATH() {
  return path.join(__dirname, '..');
}
