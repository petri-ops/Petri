#!/usr/bin/env node
'use strict';
/**
 * ui359-titlebar-live.cjs — UI-359 实机验收：标题栏右区死开关路由裁剪 + 面板开合快捷键。
 *
 * 背景：非工作区路由（/ 、/skills、/project/:id/results …）的 shell TitleBar 仍渲染
 * 「底部终端/右侧栏」开关，而面板在这些路由不存在——点了无可见效果（死开关）。
 * 另：面板开合无键盘快捷键。修复后：
 *   V1 工作区路由（/project/:id/*）：两开关在场，title 带平台快捷键提示；
 *   V2 Ctrl+` 开合底部终端（aria 态翻转）；
 *   V3 Ctrl+Shift+B 开合右侧栏（aria 态翻转）；结束恢复原态；
 *   V4 欢迎页 /：两开关不在场，窗口控件（win32）仍在；
 *   V5 /skills：两开关不在场；
 *   V6 /project/:id/results：两开关不在场（独立 ResultStudio）。
 */

const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
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

const TOGGLES = `(function(){
  var t = document.querySelector('button[aria-label="展开底部终端"], button[aria-label="收起底部终端"]');
  var r = document.querySelector('button[aria-label="展开右侧栏"], button[aria-label="收起右侧栏"]');
  function info(b) { return b ? { label: b.getAttribute('aria-label'), title: b.getAttribute('title') } : null; }
  return JSON.stringify({
    terminal: info(t),
    right: info(r),
    winMin: !!document.querySelector('button[aria-label="最小化"]'),
    platform: navigator.platform
  });
})()`;

// 用普通字符串承载反引号 key，避免嵌套模板字面量转义。
const PRESS_TERMINAL = "window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true })); 'k'";
const PRESS_RIGHT = "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', shiftKey: true, ctrlKey: true })); 'k'";
const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

(async () => {
  const run = lib.createRun({ name: 'ui359-titlebar-context', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-359') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  // V1 — 工作区路由：开关在场 + 快捷键提示
  let client = await attach();
  await lib.evalJs(client, nav(`/project/${pid}/chat`));
  await sleep(4000);
  client = await attach();
  const ws = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V1_workspace_toggles_present', !!ws.terminal && !!ws.right
    && /Ctrl\+`/.test(ws.terminal.title || '') && /Ctrl\+Shift\+B/.test(ws.right.title || ''),
    `工作区路由两开关在场且 title 带 Ctrl 提示（terminal=${ws.terminal && ws.terminal.label} / ${ws.terminal && ws.terminal.title}，right=${ws.right && ws.right.label} / ${ws.right && ws.right.title}）`);

  // V2 — Ctrl+` 开底部终端
  await lib.evalJs(client, PRESS_TERMINAL);
  await sleep(700);
  const afterTerm = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V2_ctrl_backtick_opens_terminal', !!afterTerm.terminal && afterTerm.terminal.label === '收起底部终端',
    `Ctrl+\` 后底部终端展开（aria=收起底部终端，实际=${afterTerm.terminal && afterTerm.terminal.label}）`);

  // V3 — Ctrl+Shift+B 收右侧栏
  await lib.evalJs(client, PRESS_RIGHT);
  await sleep(700);
  const afterRight = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V3_ctrl_shift_b_collapses_right', !!afterRight.right && afterRight.right.label === '展开右侧栏',
    `Ctrl+Shift+B 后右侧栏收起（aria=展开右侧栏，实际=${afterRight.right && afterRight.right.label}）`);

  // 恢复原态（右侧栏开、终端收）
  await lib.evalJs(client, PRESS_RIGHT);
  await sleep(400);
  await lib.evalJs(client, PRESS_TERMINAL);
  await sleep(400);
  const restored = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V3b_shortcuts_restore_state', !!restored.right && restored.right.label === '收起右侧栏'
    && !!restored.terminal && restored.terminal.label === '展开底部终端',
    `再按一次恢复原态（right=${restored.right && restored.right.label}，terminal=${restored.terminal && restored.terminal.label}）`);

  // V4 — 欢迎页：死开关不在场，窗口控件仍在
  await lib.evalJs(client, nav('/'));
  await sleep(3500);
  client = await attach();
  const home = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  const expectWin = String(home.platform || '').indexOf('Win') === 0;
  run.assert('V4_home_dead_toggles_absent', !home.terminal && !home.right && home.winMin === expectWin,
    `欢迎页死开关不在场且窗口控件符合平台（terminal=${JSON.stringify(home.terminal)}，right=${JSON.stringify(home.right)}，win最小化=${home.winMin}，platform=${home.platform}）`);

  // V5 — /skills
  await lib.evalJs(client, nav('/skills'));
  await sleep(3000);
  client = await attach();
  const skills = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V5_skills_dead_toggles_absent', !skills.terminal && !skills.right,
    `/skills 死开关不在场（terminal=${JSON.stringify(skills.terminal)}，right=${JSON.stringify(skills.right)}）`);

  // V6 — /project/:id/results（独立 ResultStudio）
  await lib.evalJs(client, nav(`/project/${pid}/results`));
  await sleep(3500);
  client = await attach();
  const results = JSON.parse(await lib.evalJs(client, TOGGLES) || '{}');
  run.assert('V6_results_dead_toggles_absent', !results.terminal && !results.right,
    `/results 死开关不在场（terminal=${JSON.stringify(results.terminal)}，right=${JSON.stringify(results.right)}）`);

  // 收尾：回工作区路由
  await lib.evalJs(client, nav(`/project/${pid}/chat`));

  return await run.finish({ observations: { pid, ws, afterTerm, afterRight, restored, home, skills, results } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
