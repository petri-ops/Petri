#!/usr/bin/env node
'use strict';
/**
 * ui451-file-tabs-live.cjs — UI-451 文件面板多 tab 常驻实机验证：
 *   T0  播种 3 个样例文件（a.txt / b.md / c.txt）
 *   T1  点开首个文件 → tab 条出现（1 tab）
 *   T2  再开 2 个 → 3 tab 且顺序 [a,b,c]，活动=c
 *   T3  草稿保留：a.txt 编辑打标记 → 脏点出现 → 切 b 再回 a → 标记仍在 + 脏点仍在
 *   T4  拖拽排序：c 拖到 a 左半区 → 顺序 [c,a,b]
 *   T5  右键批量：菜单四项在场；关闭其他（含脏 tab）→ 确认弹层出现 → 取消不动；
 *       再来一次 → 放弃并关闭 → 只剩锚 tab
 *   T6  X 关闭干净 tab → 全关后空态恢复
 *   T7  跨右栏 tab 常驻：重开 a/b 并打标记 → 切到「结果」tab 再切回 → tab 与草稿/脏点原样
 *   T8  几何：tab 条贴工具条之下、高度合理；活动实例可见、隐藏实例不可见
 *   截图：多开草稿态 / 关闭确认弹层 / 终态（整窗）
 * 证据：acceptance/ui-451/ui451-file-tabs-live.json + png
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-451');
const FILE_A = 'ui451-tab-a.txt';
const FILE_B = 'ui451-tab-b.md';
const FILE_C = 'ui451-tab-c.txt';
const MARKER_1 = 'UI451DRAFT1';
const MARKER_2 = 'UI451DRAFT2';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
      headers: {
        Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function clickTreeFile(name) {
  let clicked = 'none';
  for (let round = 0; round < 4 && clicked === 'none'; round++) {
    clicked = await EVAL(
      `(function(){
        var rows=document.querySelectorAll('[role="treeitem"]');
        for(var i=0;i<rows.length;i++){var t=rows[i].getAttribute('title')||'';if(t.indexOf('${name}')>=0){rows[i].click();return 'clicked:'+t;}}
        return 'none';
      })()`);
    if (clicked === 'none') await sleep(1800);
  }
  return String(clicked);
}

const tabOrder = () => EVAL(
  `JSON.stringify(Array.from(document.querySelectorAll('[data-file-tab-path]')).map(function(el){return el.getAttribute('data-file-tab-path');}))`);

(async () => {
  const run = lib.createRun({ name: 'ui451-file-tabs-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();
  const front = async () => { try { await client.send('Page.bringToFront'); } catch { /* ignore */ } };
  await front();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();

  // ── T0 播种（先删后传，内容确定性）──
  await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/delete`, { paths: [FILE_A, FILE_B, FILE_C] });
  const seedBody = (name) => ({
    toPath: name,
    dataB64: Buffer.from(`UI-451 tab 样例：${name}\n` + '内容行。\n'.repeat(6), 'utf8').toString('base64'),
    offset: 0,
  });
  const upA = await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/upload`, seedBody(FILE_A));
  const upB = await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/upload`, seedBody(FILE_B));
  const upC = await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/upload`, seedBody(FILE_C));
  run.assert('T0_seed_uploaded', upA.status === 200 && upB.status === 200 && upC.status === 200,
    `a=${upA.status} b=${upB.status} c=${upC.status}`);

  // ── 打开右栏「文件」tab（药丸不在场时走「+」工具菜单兜底）──
  let filesOpened = await EVAL(
    `(function(){var b=document.querySelectorAll('button, [role=tab]');for(var i=b.length-1;i>=0;i--){if((b[i].textContent||'').trim()==='文件'){b[i].click();return 'clicked';}}return 'not_found';})()`);
  await sleep(2000);
  let treeVisible = await EVAL(`!!document.querySelector('[data-testid="file-tree-refresh"]')`);
  if (!treeVisible) {
    await front();
    await EVAL(`(function(){var b=document.querySelector('[aria-label="展开更多工具"]');if(b)b.click();return 'menu';})()`);
    await sleep(600);
    await EVAL(
      `(function(){var items=document.querySelectorAll('#titlebar-tool-menu [role="menuitem"]');for(var i=0;i<items.length;i++){if((items[i].textContent||'').trim()==='文件'){items[i].click();return 'opened';}}return 'not_found';})()`);
    await sleep(2000);
    treeVisible = await EVAL(`!!document.querySelector('[data-testid="file-tree-refresh"]')`);
  }
  run.assert('V0_files_tab_opened', treeVisible === true || treeVisible === 'true', `first=${String(filesOpened)} treeVisible=${String(treeVisible)}`);
  client = await attach();

  // ── T1 点开文件 a → tab 条出现 ──
  const clickA = await clickTreeFile(FILE_A);
  await sleep(1800);
  const t1 = JSON.parse(await EVAL(
    `(function(){
      var strip=document.querySelector('[data-testid="file-tab-strip"]');
      var tabs=strip?strip.querySelectorAll('[data-file-tab-path]').length:0;
      return JSON.stringify({strip:!!strip,tabs:tabs,first:strip?strip.querySelector('[data-file-tab-path]').getAttribute('data-file-tab-path'):null});
    })()`));
  run.assert('T1_first_file_tab', clickA.indexOf('clicked') === 0 && t1.strip && t1.tabs === 1 && t1.first === FILE_A,
    `click=${clickA} ${JSON.stringify(t1)}`);

  // ── T2 再开 b、c → 3 tab 顺序 [a,b,c]，活动=c ──
  await front();
  await clickTreeFile(FILE_B);
  await sleep(1200);
  await clickTreeFile(FILE_C);
  await sleep(1500);
  const t2Order = JSON.parse(await tabOrder());
  const t2Active = await EVAL(
    `var el=document.querySelector('[data-file-tab-path][aria-selected="true"]');el?el.getAttribute('data-file-tab-path'):null`);
  run.assert('T2_three_tabs_order_abc',
    t2Order.length === 3 && t2Order[0] === FILE_A && t2Order[1] === FILE_B && t2Order[2] === FILE_C && t2Active === FILE_C,
    `order=${JSON.stringify(t2Order)} active=${String(t2Active)}`);

  // ── T3 草稿保留：a 编辑打标 → 切走再回 → 标记/脏点都在 ──
  await front();
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${FILE_A}"]');el.click();return 'act';})()`);
  await sleep(800);
  const insert1 = await EVAL(
    `(function(){
      var host=document.querySelector('[data-file-preview-path="${FILE_A}"][class*="workspaceFilePreviewKeepAliveActive"]');
      if(!host) return 'no_host';
      var ed=host.querySelector('[contenteditable="true"]');
      if(!ed) return 'no_editor';
      ed.focus();
      document.execCommand('insertText', false, '${MARKER_1}');
      return 'inserted:'+(ed.textContent.indexOf('${MARKER_1}')>=0);
    })()`);
  await sleep(400);
  const dot1 = await EVAL(`document.querySelectorAll('[data-testid="file-tab-dirty"]').length`);
  await front();
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${FILE_B}"]');el.click();return 'act';})()`);
  await sleep(600);
  const bActiveWhileDraft = await EVAL(
    `(function(){
      var host=document.querySelector('[data-file-preview-path="${FILE_B}"][class*="workspaceFilePreviewKeepAliveActive"]');
      return host?'on_b':'not_on_b';
    })()`);
  await front();
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${FILE_A}"]');el.click();return 'act';})()`);
  await sleep(600);
  const draftProbe = await EVAL(
    `(function(){
      var host=document.querySelector('[data-file-preview-path="${FILE_A}"][class*="workspaceFilePreviewKeepAliveActive"]');
      if(!host) return JSON.stringify({back:false});
      var ed=host.querySelector('[contenteditable="true"]');
      return JSON.stringify({back:true, hasDraft: ed?ed.textContent.indexOf('${MARKER_1}')>=0:false, dots:document.querySelectorAll('[data-testid="file-tab-dirty"]').length});
    })()`);
  let t3 = {}; try { t3 = JSON.parse(draftProbe); } catch {}
  run.assert('T3a_dirty_dot_on_edit', String(insert1).indexOf('inserted:true') === 0 && Number(dot1) === 1,
    `insert=${String(insert1)} dots=${String(dot1)}`);
  run.assert('T3b_draft_preserved_after_switch', t3.back === true && t3.hasDraft === true && Number(t3.dots) === 1,
    `switch=${bActiveWhileDraft} ${draftProbe}`);
  await front();
  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui451-tabs-draft.png').catch(() => {});

  // ── T4 拖拽排序：c 拖到 a 左半区 → [c,a,b] ──
  await front();
  const dragStart = await EVAL(
    `(function(){
      var from=document.querySelector('[data-file-tab-path="${FILE_C}"]');
      var to=document.querySelector('[data-file-tab-path="${FILE_A}"]');
      if(!from||!to) return 'no_tab';
      var dt=new DataTransfer();
      dt.setData('application/x-gewu-file-tab', '${FILE_C}');
      window.__ui451dt = dt;
      from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
      var r=to.getBoundingClientRect();
      var cx=r.left+5, cy=r.top+r.height/2;
      to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:cx,clientY:cy}));
      return 'dragging';
    })()`);
  // React 状态落地后再读插入指示类（同步读会读到 setState 前的 className）；
  // drop 必须复用同一 DataTransfer（新dt的getData为空→组件按载荷缺失早退）
  await sleep(300);
  const dropHint = await EVAL(
    `(function(){
      var to=document.querySelector('[data-file-tab-path="${FILE_A}"]');
      var from=document.querySelector('[data-file-tab-path="${FILE_C}"]');
      if(!to||!from) return 'no_tab';
      var hinted=to.className.indexOf('workspaceFileTabDropLeft')>=0;
      var r=to.getBoundingClientRect();
      var dt=window.__ui451dt;
      to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+5,clientY:r.top+r.height/2}));
      from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
      return 'dropped:'+hinted;
    })()`);
  await sleep(600);
  const t4Order = JSON.parse(await tabOrder());
  run.assert('T4_drag_reorder', String(dragStart) === 'dragging' && String(dropHint).indexOf('dropped:true') === 0
    && t4Order[0] === FILE_C && t4Order[1] === FILE_A && t4Order[2] === FILE_B,
    `drag=${String(dragStart)}/${String(dropHint)} order=${JSON.stringify(t4Order)}`);

  // ── T5 右键批量关闭（锚=当前首位 tab）：菜单四项 → 关闭其他（含脏 a）→ 取消 → 确认关 ──
  const anchor = t4Order[0];
  await front();
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${anchor}"]');var e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(e);return 'menu';})()`);
  await sleep(500);
  const menuProbe = JSON.parse(await EVAL(
    `(function(){
      var menu=document.querySelector('[data-testid="file-tab-menu"]');
      return JSON.stringify({
        menu:!!menu,
        close:!!document.querySelector('[data-testid="file-tab-menu-close"]'),
        closeOthers:!!document.querySelector('[data-testid="file-tab-menu-closeOthers"]'),
        closeRight:!!document.querySelector('[data-testid="file-tab-menu-closeRight"]'),
        closeAll:!!document.querySelector('[data-testid="file-tab-menu-closeAll"]')
      });
    })()`));
  run.assert('T5a_menu_items_present', menuProbe.menu && menuProbe.close && menuProbe.closeOthers && menuProbe.closeRight && menuProbe.closeAll,
    JSON.stringify(menuProbe));

  await EVAL(`(function(){var b=document.querySelector('[data-testid="file-tab-menu-closeOthers"]');b.click();return 'clicked';})()`);
  await sleep(500);
  const dialogSeen = await EVAL(`!!document.querySelector('[data-testid="file-tab-close-dialog"]')`);
  await front();
  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui451-close-confirm.png').catch(() => {});
  // 取消：tab 数不变、脏点仍在
  const cancelBtns = await EVAL(
    `(function(){
      var dlg=document.querySelector('[data-testid="file-tab-close-dialog"]');
      if(!dlg) return 'no_dialog';
      var btns=dlg.querySelectorAll('button');
      for(var i=0;i<btns.length;i++){if((btns[i].textContent||'').trim()==='取消'){btns[i].click();return 'canceled';}}
      return 'no_cancel_btn';
    })()`);
  await sleep(500);
  const afterCancel = JSON.parse(await EVAL(
    `(function(){
      return JSON.stringify({tabs:document.querySelectorAll('[data-file-tab-path]').length, dots:document.querySelectorAll('[data-testid="file-tab-dirty"]').length, dialog:!!document.querySelector('[data-testid="file-tab-close-dialog"]')});
    })()`));
  run.assert('T5b_cancel_keeps_tabs', dialogSeen === true && String(cancelBtns) === 'canceled'
    && afterCancel.tabs === 3 && afterCancel.dots === 1 && afterCancel.dialog === false,
    `dialog=${String(dialogSeen)} cancel=${String(cancelBtns)} ${JSON.stringify(afterCancel)}`);

  // 再来一次 → 放弃修改并关闭 → 只剩锚 b，b 成为活动预览
  await front();
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${anchor}"]');el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return 'menu';})()`);
  await sleep(500);
  await EVAL(`(function(){var b=document.querySelector('[data-testid="file-tab-menu-closeOthers"]');b.click();return 'clicked';})()`);
  await sleep(500);
  await EVAL(`(function(){var b=document.querySelector('[data-testid="file-tab-close-confirm"]');b.click();return 'confirmed';})()`);
  await sleep(800);
  const afterCloseOthers = JSON.parse(await EVAL(
    `(function(){
      var tabs=Array.from(document.querySelectorAll('[data-file-tab-path]')).map(function(el){return el.getAttribute('data-file-tab-path');});
      var activeHost=document.querySelector('[data-file-preview-path][class*="workspaceFilePreviewKeepAliveActive"]');
      return JSON.stringify({tabs:tabs, activePath:activeHost?activeHost.getAttribute('data-file-preview-path'):null, dots:document.querySelectorAll('[data-testid="file-tab-dirty"]').length});
    })()`));
  run.assert('T5c_confirm_close_others', afterCloseOthers.tabs.length === 1 && afterCloseOthers.tabs[0] === anchor
    && afterCloseOthers.activePath === anchor && Number(afterCloseOthers.dots) === 0,
    JSON.stringify(afterCloseOthers));

  // ── T6 X 关闭干净 tab → 全关恢复空态 ──
  await front();
  await EVAL(
    `(function(){var tab=document.querySelector('[data-file-tab-path="${anchor}"]');var x=tab.querySelector('button[aria-label^="关闭 "]');x.click();return 'closed';})()`);
  await sleep(600);
  const emptyProbe = JSON.parse(await EVAL(
    `(function(){
      var body=document.body.textContent||'';
      return JSON.stringify({tabs:document.querySelectorAll('[data-file-tab-path]').length, empty:body.indexOf('选择一个文本、图片或 PDF 文件预览')>=0, strip:!!document.querySelector('[data-testid="file-tab-strip"]')});
    })()`));
  run.assert('T6_x_close_to_empty', emptyProbe.tabs === 0 && emptyProbe.empty === true && emptyProbe.strip === false,
    JSON.stringify(emptyProbe));

  // ── T7 跨右栏 tab 常驻：重开 a/b → a 打标 → 切「结果」tab 再回 → tab/草稿/脏点原样 ──
  await front();
  await clickTreeFile(FILE_A);
  await sleep(1200);
  await clickTreeFile(FILE_B);
  await sleep(1200);
  await EVAL(`(function(){var el=document.querySelector('[data-file-tab-path="${FILE_A}"]');el.click();return 'act';})()`);
  await sleep(600);
  const insert2 = await EVAL(
    `(function(){
      var host=document.querySelector('[data-file-preview-path="${FILE_A}"][class*="workspaceFilePreviewKeepAliveActive"]');
      if(!host) return 'no_host';
      var ed=host.querySelector('[contenteditable="true"]');
      if(!ed) return 'no_editor';
      ed.focus();
      document.execCommand('insertText', false, '${MARKER_2}');
      return 'inserted:'+(ed.textContent.indexOf('${MARKER_2}')>=0);
    })()`);
  await front();
  await EVAL(`(function(){var b=document.querySelector('[aria-label="展开更多工具"]');if(b)b.click();return 'menu';})()`);
  await sleep(600);
  const awayPick = await EVAL(
    `(function(){
      var items=Array.from(document.querySelectorAll('#titlebar-tool-menu [role="menuitem"]'));
      for(var i=0;i<items.length;i++){
        var label=(items[i].textContent||'').trim();
        if(label!=='文件' && label.indexOf('关闭')<0 && items[i].className.indexOf('toolMenuItemActive')<0){ items[i].click(); return 'away:'+label; }
      }
      return 'none';
    })()`);
  await sleep(2000);
  const filesHiddenWhileAway = await EVAL(
    `(function(){
      var pane=document.querySelector('[class*="workspaceFilePreviewPane"]');
      if(!pane) return 'no_pane';
      return getComputedStyle(pane).visibility;
    })()`);
  await front();
  await EVAL(
    `(function(){var b=document.querySelectorAll('button, [role=tab]');for(var i=b.length-1;i>=0;i--){if((b[i].textContent||'').trim()==='文件'){b[i].click();return 'back';}}return 'not_found';})()`);
  await sleep(1500);
  const backProbe = JSON.parse(await EVAL(
    `(function(){
      var tabs=Array.from(document.querySelectorAll('[data-file-tab-path]')).map(function(el){return el.getAttribute('data-file-tab-path');});
      var host=document.querySelector('[data-file-preview-path="${FILE_A}"][class*="workspaceFilePreviewKeepAliveActive"]');
      var ed=host?host.querySelector('[contenteditable="true"]'):null;
      return JSON.stringify({tabs:tabs, dots:document.querySelectorAll('[data-testid="file-tab-dirty"]').length,
        hasDraft: ed?ed.textContent.indexOf('${MARKER_2}')>=0:false, aActive: !!host});
    })()`));
  run.assert('T7a_tab_draft_survives_right_tab_switch',
    String(insert2).indexOf('inserted:true') === 0 && String(awayPick).indexOf('away:') === 0
    && filesHiddenWhileAway === 'hidden' && backProbe.tabs.length === 2
    && backProbe.tabs[0] === FILE_A && backProbe.tabs[1] === FILE_B
    && Number(backProbe.dots) === 1 && backProbe.hasDraft === true && backProbe.aActive === true,
    `insert=${String(insert2)} away=${String(awayPick)} hiddenWhileAway=${String(filesHiddenWhileAway)} ${JSON.stringify(backProbe)}`);

  // ── T8 几何与可见性 ──
  const t8 = JSON.parse(await EVAL(
    `(function(){
      var strip=document.querySelector('[data-testid="file-tab-strip"]');
      var sr=strip.getBoundingClientRect();
      var toolbar=document.querySelector('[class*="workspaceFilesToolbar"]');
      var tr=toolbar.getBoundingClientRect();
      var activeHost=document.querySelector('[data-file-preview-path][class*="workspaceFilePreviewKeepAliveActive"]');
      var hiddenHosts=Array.from(document.querySelectorAll('[data-file-preview-path]:not([class*="workspaceFilePreviewKeepAliveActive"])'));
      return JSON.stringify({
        stripH: Math.round(sr.height),
        stripBelowToolbar: sr.top >= tr.bottom - 1,
        activeVisible: activeHost?getComputedStyle(activeHost).visibility==='visible':null,
        hiddenCount: hiddenHosts.length,
        hiddenInvisible: hiddenHosts.every(function(h){return getComputedStyle(h).visibility==='hidden';})
      });
    })()`));
  run.assert('T8_geometry_visibility', t8.stripH >= 24 && t8.stripH <= 44 && t8.stripBelowToolbar === true
    && t8.activeVisible === true && t8.hiddenCount === 1 && t8.hiddenInvisible === true,
    JSON.stringify(t8));
  await front();
  await lib.screenshotPng(client, EVIDENCE_DIR, 'ui451-final.png').catch(() => {});

  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui451-file-tabs] FATAL', err && err.message);
  process.exit(2);
});
