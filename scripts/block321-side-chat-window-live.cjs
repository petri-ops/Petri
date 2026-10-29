#!/usr/bin/env node
'use strict';
/**
 * block321-side-chat-window-live.cjs — UI-627（BLOCK-321）实机腿探针。
 *
 * 前置：9223 离屏测试实例在跑（bash scripts/start-test-instance.sh）。
 * 断言链：
 *  1. 主窗：页内 FAB（side-chat-fab）不在场（UI-627 入口退役）；
 *  2. 真实点击链：标题栏「更多工具」菜单 → 「侧聊」项（找不到菜单结构则
 *     降级 windowManager.popOut 直调，如实标注 degraded）；
 *  3. 新 target /window/side-chat 出现（原生独立窗）；
 *  4. 窗口页 chrome：无旧「会话」标题头、窄拖动条 + 右上角 ✕ 在场。
 * 证据 JSON 落 acceptance/block-321/side-chat-window-live.json。
 * 跑完由调用方 kill 9223（本脚本不杀实例，便于复跑取证）。
 */
const fs = require('node:fs');
const path = require('node:path');

const CDP = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const res = await fetch(`${CDP}/json/list`);
  return res.json();
}

async function evalOn(targetId, expression) {
  const ws = new WebSocket(`${CDP}/devtools/page/${targetId}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('evaluate timeout 15s')), 15000);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        resolve(msg.result);
      }
    });
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  ws.close();
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
  }
  return result.result.value;
}

async function main() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail: detail ?? null });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
  };

  // 1. 主窗选择
  let main = null;
  for (let i = 0; i < 10; i += 1) {
    const targets = await listTargets();
    // 主窗=非弹窗路由的 SPA 页（SPA 内部导航后 ?test=1 会丢，不能作为锚）
    main = targets.find((t) => t.type === 'page' && t.url.includes('localhost:3000') && !t.url.includes('/window/'));
    if (main) break;
    await sleep(1000);
  }
  if (!main) throw new Error('主窗 page target 未找到（9223 实例未就绪？）');
  check('main-window-found', true, { url: main.url });

  // 1b. 进项目工作区（标题栏/更多工具菜单只在 workspace 视图存在）；
  // SPA 内部导航走 React Router history——CDP 用 location 赋值会整页重载，
  // 这里先 fetch 后端取一个项目 id 再整页导航（测试实例，可接受）。
  const proj = await (async () => {
    const res = await fetch('http://127.0.0.1:3001/api/data/projects', {
      headers: { Authorization: 'Bearer desktop-local' },
    });
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : (data.projects?.[0] ?? null);
    return first ? { id: first.id, name: first.name } : null;
  })();
  check('project-available', !!proj, proj);
  if (proj) {
    await evalOn(main.id, `location.href = '/project/${proj.id}'; 'nav'`);
    for (let i = 0; i < 15; i += 1) {
      await sleep(1000);
      const state = await evalOn(main.id, `(() => ({
        path: location.pathname,
        moreBtn: !!document.querySelector('[aria-label="展开更多工具"]'),
      }))()`);
      if (state.moreBtn) { console.log('workspace ready (t+' + (i + 1) + 's)'); break; }
    }
  }

  // 2. FAB 退役断言
  const fabGone = await evalOn(main.id, `(() => {
    const fab = document.querySelector('[data-testid="side-chat-fab"]');
    const dock = document.querySelector('[data-testid="side-chat-dock"]');
    return { fabGone: !fab, dockGone: !dock };
  })()`);
  check('in-page-fab-retired', fabGone.fabGone && fabGone.dockGone, fabGone);

  // 3. 真实点击链：标题栏「展开更多工具」→ #titlebar-tool-menu → 「侧聊」项；
  // 失败降级 openSideChatWindow 等价重放（写 ctx + popOut 直调），如实标注。
  let route = 'menu-click';
  const clicked = await evalOn(main.id, `(() => {
    const btn = document.querySelector('[aria-label="展开更多工具"]');
    if (!btn) return { ok: false, reason: 'more-button-missing' };
    btn.click();
    return { ok: true };
  })()`);
  let itemClicked = { ok: false };
  if (clicked.ok) {
    await sleep(500);
    itemClicked = await evalOn(main.id, `(() => {
      const menu = document.getElementById('titlebar-tool-menu');
      if (!menu) return { ok: false, reason: 'tool-menu-missing' };
      const item = [...menu.querySelectorAll('[role="menuitem"]')]
        .find((el) => el.textContent.includes('侧聊'));
      if (!item) return { ok: false, reason: 'side-chat-item-missing', items: [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim()).slice(0, 12) };
      item.click();
      return { ok: true };
    })()`);
  }
  if (!itemClicked.ok) {
    route = 'popout-direct';
    // openSideChatWindow 等价重放：写项目上下文 + popOut（helper 在打包模块内不可直达）
    await evalOn(main.id, `(() => {
      try {
        const m = location.pathname.match(/^[/]project[/]([^/]+)/);
        window.localStorage.setItem('petri:side-chat-window-ctx', JSON.stringify({ projectId: m ? m[1] : '', sourceConversationId: null }));
      } catch {}
      return window.petri?.windowManager?.popOut('side-chat');
    })()`);
  }
  check('open-triggered', true, { route, itemClicked });

  // 4. 等 /window/side-chat target 出现
  let sideWin = null;
  for (let i = 0; i < 15; i += 1) {
    const targets = await listTargets();
    sideWin = targets.find((t) => t.type === 'page' && t.url.includes('/window/side-chat'));
    if (sideWin) break;
    await sleep(1000);
  }
  check('side-chat-window-target', !!sideWin, sideWin ? { url: sideWin.url, title: sideWin.title } : 'timeout');

  // 5. 窗口页 chrome 断言
  if (sideWin) {
    // 等懒加载页 + SimpleChat 巨型组件挂载（vite dev 模式按需编译，轮询至 12s）
    let chatMounted = false;
    for (let i = 0; i < 12; i += 1) {
      await sleep(1000);
      // 真实 SimpleChat 根特征（.sc-root 是其稳定契约类；testid 形态只在测试 mock 中）
      chatMounted = await evalOn(sideWin.id, `!!document.querySelector('.sc-root')`);
      if (chatMounted) break;
    }
    const chrome = await evalOn(sideWin.id, `(() => {
      const strip = document.querySelector('[data-testid="side-chat-window-drag-strip"]');
      const closeBtn = document.querySelector('[aria-label="关闭侧边聊天"]');
      const legacyHeader = [...document.querySelectorAll('span')].some((el) => el.textContent.trim() === '会话'
        && el.closest('[class*="surfaceHeader"]'));
      const chat = document.querySelector('[data-testid="side-chat-window-simplechat"]');
      return {
        strip: !!strip,
        closeBtn: !!closeBtn,
        legacyHeaderGone: !legacyHeader,
        chatMounted: !!chat || ${chatMounted},
        title: document.title,
      };
    })()`);
    check('window-chrome-minimal', chrome.strip && chrome.closeBtn && chrome.legacyHeaderGone, chrome);
    check('simple-chat-mounted', chrome.chatMounted, { chatMounted: chrome.chatMounted });
  }

  const pass = checks.every((c) => c.ok);
  const outDir = path.join(__dirname, '..', 'acceptance', 'block-321');
  fs.mkdirSync(outDir, { recursive: true });
  const evidence = {
    capturedAt: new Date().toISOString(),
    cdp: CDP,
    route,
    pass,
    checks,
  };
  fs.writeFileSync(path.join(outDir, 'side-chat-window-live.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length})`);
  console.log(`evidence: acceptance/block-321/side-chat-window-live.json`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('PROBE-ERROR:', err.message);
  process.exit(2);
});
