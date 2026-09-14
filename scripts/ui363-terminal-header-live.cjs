#!/usr/bin/env node
'use strict';
/**
 * ui363-terminal-header-live.cjs — UI-363 实机验收：底部终端冗余外层头部清理。
 *
 * 背景（用户裁决：信息多了红框部分冗余）——原面板有两层头：外层「终端 新标签/
 * 清空/×」+ 内层会话 tab 行。修复后砍掉外层 header，对标 VS Code 面板单行布局：
 * tab 与「+」居左，清空/关闭面板居右；面板开关仍可经顶栏 toggle 与 Ctrl/Cmd+`。
 *
 * 断言：
 *   V1 Ctrl+` 展开终端后：外层 header 不在场；
 *   V2 tab 行内含「清空」与「关闭终端面板」，终端宿主可见（面板高度 > 0）；
 *   V3 再按 Ctrl+` 面板收起（高度归 0），开关语义不受影响。
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

const PRESS_TERMINAL = "window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true })); 'k'";
const nav = (p) => `location.href = 'http://localhost:3000${p}'; 'nav'`;

const MEASURE = `(function(){
  var q = function(sel) { return document.querySelector(sel); };
  var panel = q('section[class*="embeddedTerminal"]');
  var legacyHeader = q('[class*="embeddedTerminalHeader"]');
  var tabRow = q('[class*="embeddedTerminalTabs"]');
  var clearBtn = tabRow ? Array.from(tabRow.querySelectorAll('button')).find(function(b) { return b.textContent.indexOf('清空') !== -1; }) : null;
  var closeBtn = q('button[aria-label="关闭终端面板"]');
  var closeInRow = !!(closeBtn && tabRow && tabRow.contains(closeBtn));
  var host = q('[class*="embeddedTerminalHost"]');
  return JSON.stringify({
    legacyHeader: !!legacyHeader,
    clearInRow: !!clearBtn && !!tabRow,
    closeInRow: closeInRow,
    panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    panelStyleHeight: panel ? panel.style.height : null,
    hostVisible: !!host
  });
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui363-terminal-header', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-363') });
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  let client = await attach();
  await lib.evalJs(client, nav(`/project/${pid}/chat`));
  await sleep(4000);
  client = await attach();

  // V1 + V2 — Ctrl+` 展开：无外层 header，tab 行含清空/关闭，宿主可见
  await lib.evalJs(client, PRESS_TERMINAL);
  await sleep(1500);
  const open = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V1_legacy_header_removed', open.legacyHeader === false,
    `外层 header 不在场（legacyHeader=${open.legacyHeader}）`);
  run.assert('V2_actions_in_tab_row_and_visible', open.clearInRow === true && open.closeInRow === true
    && (open.panelHeight || 0) > 80 && open.hostVisible === true,
    `清空/关闭面板居于 tab 行且面板可见（clearInRow=${open.clearInRow}，closeInRow=${open.closeInRow}，height=${open.panelHeight}）`);

  // V3 — 再按 Ctrl+` 收起（内联 height 归 0；rect 残留 2px 为拖拽把手溢出，
  // 非面板本体——以 style.height 为准）
  await lib.evalJs(client, PRESS_TERMINAL);
  await sleep(1200);
  const closed = JSON.parse(await lib.evalJs(client, MEASURE) || '{}');
  run.assert('V3_toggle_still_closes', closed.panelStyleHeight === '0px',
    `再按 Ctrl+\` 面板收起（style.height=${closed.panelStyleHeight}，rect=${closed.panelHeight}）`);

  // 收尾：恢复展开前的关闭态（原态即关闭）
  return await run.finish({ observations: { pid, open, closed } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
