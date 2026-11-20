#!/usr/bin/env node
'use strict';

/** UI-715 实机腿：右键会话行（stall-508-live）→ 信息菜单截图 + DOM 读数 + 复制项点击。非产品代码。 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const OUT = '../../ui-715';

(async () => {
  const c = await connect({ port: 9223 });
  const startUrl = c.page.url;
  const findings = { legs: [] };

  // 展开目标项目树会话列表（当前项目默认展开；找到含 data-conversation-id 的行）
  await sleep(800);
  const row = await c.evalJson(`(function(){
    const rows = [...document.querySelectorAll('li[data-conversation-id]')].filter(el => el.offsetParent);
    return rows.slice(0, 3).map(el => ({ id: el.getAttribute('data-conversation-id'), title: (el.querySelector('[class*="convItemTitle"]') || {}).innerText || '', x: null, y: null }));
  })()`);
  if (!row.length) throw new Error('无可见会话行');
  const target = row[0];
  // 真实右键（Input 域 right 键）
  const pos = await c.evalJson(`(function(){
    const el = [...document.querySelectorAll('li[data-conversation-id]')].find(el => el.getAttribute('data-conversation-id') === ${JSON.stringify(target.id)});
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 10 };
  })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'right', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'right', clickCount: 1 });
  await sleep(600);
  const menu = await c.evalJson(`(function(){
    const m = document.querySelector('[role="menu"][aria-label^="会话菜单"]');
    if (!m) return null;
    const items = [...m.querySelectorAll('[role="menuitem"]')].map(b => (b.innerText || '').trim());
    const readonlyId = (m.firstElementChild ? '' : '');
    const idText = m.children[0] ? (m.children[0].innerText || '').trim() : '';
    const r = m.getBoundingClientRect();
    return { items, idText, idMatches: idText === ${JSON.stringify(target.id)}, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  })()`);
  console.log('menu:', JSON.stringify(menu));
  if (menu && menu.rect) await c.cropFull(outPath(OUT, 'context-menu-live.png'), menu.rect, 24);
  findings.legs.push({ id: 'context_menu_live', pass: !!menu && menu.idMatches && menu.items.includes('复制会话 ID'), detail: { target, menu }, file: 'context-menu-live.png' });

  // 点「复制会话 ID」→ 菜单关闭（剪贴板读取受权限限制，契约由组件测试守护，此处验证链路动作）
  await c.evalJson(`(function(){ const b = [...document.querySelectorAll('[role="menuitem"]')].find(x => (x.innerText || '').includes('复制会话 ID')); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  const closed = await c.evalJson(`!document.querySelector('[role="menu"][aria-label^="会话菜单"]')`);
  findings.legs.push({ id: 'copy_item_closes_menu', pass: closed === true, detail: { closed } });

  await c.navigate(startUrl);
  await sleep(400);
  findings.boundary = '右键交互真实输入管线；剪贴板内容契约由 LeftPanel.test（writeText 断言）守护，实机不读系统剪贴板。';
  writeJson(OUT, 'live-assertion.json', findings);
  console.log('DONE legs=', findings.legs.length, 'allPass=', findings.legs.every((l) => l.pass !== false));
  c.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
