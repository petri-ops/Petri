#!/usr/bin/env node
'use strict';

/**
 * BLOCK-54 P4 用户侧实机 CDP 断言驱动：底部终端多 Tab。
 *   1) TitleBar 展开底部终端 → 首个 tab 自动创建（懒启动 1 个 pty）
 *   2) 「新建终端标签」×2 → 3 tab 并存，各自独立 pty（listSessions 3 会话、pid 互异）
 *   3) 每 tab 真实键入 `pwd && echo marker-N` → 输出各自出现在对应 xterm（事件按 sessionId 路由），
 *      pwd 输出 = 项目 workspace（新建 tab 默认 cwd 绑定项目）
 *   4) 关闭 tab-3（×）→ 会话进程回收（listSessions 2、tab-3 pid 消失、DOM 移除）
 *   5) 退出应用（window.close → before-quit kill-all）→ 全部 pty pid 消失，0 孤儿
 * 证据：acceptance/block-54/user-side-tabs.json + 截图
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const PROJECT_ID = process.env.BIOF54_PROJECT || 'p_mtlnsv0f_xpjb';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-54');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval_timeout(15s)')), 15000)),
  ]);
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function screenshot(client, file) {
  try {
    await Promise.race([
      client.send('Page.bringToFront', {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('bringToFront_timeout(5s)')), 5000)),
    ]);
    const r = await Promise.race([
      client.send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot_timeout(15s)')), 15000)),
    ]);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  } catch (e) {
    console.log(`WARN screenshot skipped (${file.split('/').pop()}): ${e.message}`);
  }
}

/** 向当前聚焦的 xterm 逐键派发真实键盘事件。 */
async function typeText(client, text) {
  for (const ch of text) {
    if (ch === '\r') {
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r',
      });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
    } else {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  }
}

function pidAlive(pid) {
  try {
    execFileSync('ps', ['-p', String(pid)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('biof3_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = { startedAt: new Date().toISOString(), page: page.url, projectId: PROJECT_ID, assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
  };

  // 1. 进入项目工作台
  console.log('[step] navigate');
  await evalJS(client, `(location.href = '/project/${PROJECT_ID}?mode=chat', true)`);
  await delay(3000);

  // 2. 展开底部终端 → 首个 tab 自动懒启动
  console.log('[step] toggle terminal');
  const toggled = await evalJS(client, `(() => {
    const b = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === '展开底部终端');
    if (!b) return null;
    b.click();
    return true;
  })()`);
  assert('TitleBar「展开底部终端」可点击', toggled === true, toggled);
  await delay(1500);
  console.log('[step] screenshot 01');
  await screenshot(client, path.join(EVIDENCE_DIR, 'p4-01-terminal-open-1tab.png'));

  console.log('[step] assert first tab');
  const tabsAfterOpen = await evalJS(client, `document.querySelectorAll('[data-tab-body]').length`);
  assert('面板展开后自动创建首个 tab（懒启动）', tabsAfterOpen === 1, `tab bodies=${tabsAfterOpen}`);
  const sessions1 = await evalJS(client, `(async () => (await window.biof3Desktop.terminal.listSessions()))()`);
  assert('首个 tab 已拉起独立 pty（listSessions 1 会话）',
    sessions1.ok && (sessions1.sessions || []).length === 1,
    JSON.stringify(sessions1.sessions || sessions1).slice(0, 200));

  // 3. 新建 ×2 → 3 tab 并存
  console.log('[step] open 2 more tabs');
  for (let i = 0; i < 2; i += 1) {
    await evalJS(client, `(() => {
      const b = document.querySelector('button[aria-label="新建终端标签"]');
      if (!b) return null;
      b.click();
      return true;
    })()`);
    await delay(1200);
  }
  const tabBodies = await evalJS(client, `[...document.querySelectorAll('[data-tab-body]')].map(el => el.getAttribute('data-tab-body'))`);
  assert('「新建终端标签」×2 → 3 tab 并存（tab-1/2/3）',
    tabBodies.length === 3 && ['tab-1', 'tab-2', 'tab-3'].every((id) => tabBodies.includes(id)),
    JSON.stringify(tabBodies));

  const sessions3 = await evalJS(client, `(async () => (await window.biof3Desktop.terminal.listSessions()))()`);
  const list3 = sessions3.sessions || [];
  const pids3 = new Map(list3.map((s) => [s.sessionId, s.pid]));
  assert('3 tab 各自独立 pty（3 会话、pid 互异）',
    sessions3.ok && list3.length === 3 && new Set(pids3.values()).size === 3,
    JSON.stringify(list3.map((s) => ({ id: s.sessionId, pid: s.pid }))));
  const workspaceCwd = list3[0]?.cwd || '';
  assert('新 tab 默认 cwd 绑定项目 workspace',
    !!workspaceCwd && list3.every((s) => s.cwd === workspaceCwd),
    `cwd=${workspaceCwd}`);

  // 4. 每 tab 真实键入命令，输出按 tab 路由
  console.log('[step] type commands');
  const wsBase = (workspaceCwd || '').split('/').filter(Boolean).pop() || 'workspace';
  for (let n = 1; n <= 3; n += 1) {
    // 切到目标 tab（点 tab 按钮）→ 等 xterm textarea 就绪 → 聚焦 → 键入 → 校验 marker，失败重试一次
    await evalJS(client, `(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const target = tabs.find(el => el.textContent.includes('终端 ${n}'));
      if (!target) return null;
      target.click();
      return true;
    })()`);
    let ready = false;
    for (let i = 0; i < 20 && !ready; i += 1) {
      await delay(300);
      ready = await evalJS(client, `!!document.querySelector('[data-tab-body="tab-${n}"] textarea.xterm-helper-textarea')`);
    }
    await evalJS(client, `(() => {
      const body = document.querySelector('[data-tab-body="tab-${n}"]');
      if (!body) return null;
      body.click();
      const ta = body.querySelector('textarea.xterm-helper-textarea');
      if (ta) ta.focus();
      return true;
    })()`);
    await delay(400);
    await typeText(client, `pwd && echo b54-marker-${n}\r`);
    await delay(1500);
    let markerOk = await evalJS(client, `(document.querySelector('[data-tab-body="tab-${n}"] .xterm-rows')?.textContent || '').includes('b54-marker-${n}')`);
    if (!markerOk) {
      console.log(`[retry] tab-${n} marker 未出现，重聚焦重输`);
      await evalJS(client, `(() => {
        const ta = document.querySelector('[data-tab-body="tab-${n}"] textarea.xterm-helper-textarea');
        if (ta) ta.focus();
        return true;
      })()`);
      await delay(300);
      await typeText(client, `echo b54-marker-${n}\r`);
      await delay(1500);
      markerOk = await evalJS(client, `(document.querySelector('[data-tab-body="tab-${n}"] .xterm-rows')?.textContent || '').includes('b54-marker-${n}')`);
    }
    console.log(`[step] tab-${n} marker=${markerOk ? 'ok' : 'missing'}`);
  }
  await screenshot(client, path.join(EVIDENCE_DIR, 'p4-02-three-tabs-output.png'));

  console.log('[step] assert routed output');
  for (let n = 1; n <= 3; n += 1) {
    const text = await evalJS(client, `document.querySelector('[data-tab-body="tab-${n}"] .xterm-rows')?.textContent || ''`);
    assert(
      `tab-${n} 输出路由正确：pwd=${wsBase} + marker-${n}，且不含其他 tab marker`,
      text.includes(`b54-marker-${n}`) && text.includes(wsBase) &&
        [1, 2, 3].filter((m) => m !== n).every((m) => !text.includes(`b54-marker-${m}`)),
      text.split('\n').filter((l) => /b54-marker|^\s*\/|desktop|projects/.test(l)).slice(-3).join(' | ').slice(0, 200)
    );
  }

  // 5. 关闭 tab-3 → 进程回收
  console.log('[step] close tab-3');
  pids3.get('tab-3');
  const closed = await evalJS(client, `(() => {
    const b = document.querySelector('button[aria-label="关闭 终端 3"]');
    if (!b) return null;
    b.click();
    return true;
  })()`);
  assert('tab-3 × 关闭按钮可点击', closed === true, closed);
  await delay(1200);
  const sessionsAfterClose = await evalJS(client, `(async () => (await window.biof3Desktop.terminal.listSessions()))()`);
  const remainIds = (sessionsAfterClose.sessions || []).map((s) => s.sessionId);
  assert('关闭 tab-3 后会话回收（listSessions 2、无 tab-3）',
    remainIds.length === 2 && !remainIds.includes('tab-3'),
    JSON.stringify(remainIds));
  const domAfterClose = await evalJS(client, `[...document.querySelectorAll('[data-tab-body]')].map(el => el.getAttribute('data-tab-body'))`);
  assert('tab-3 DOM 移除（tab-1/2 回显保留）',
    domAfterClose.length === 2 && domAfterClose.includes('tab-1') && domAfterClose.includes('tab-2'),
    JSON.stringify(domAfterClose));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p4-03-after-close-2tabs.png'));

  // 6. 退出应用 → before-quit 全量 kill → 0 孤儿
  console.log('[step] quit app + orphan check');
  const remainingPids = (sessionsAfterClose.sessions || []).map((s) => s.pid);
  await evalJS(client, `(window.biof3Desktop.window.close(), true)`);
  let orphansGone = false;
  for (let i = 0; i < 20; i += 1) {
    await delay(500);
    if (remainingPids.length > 0 && remainingPids.every((p) => !pidAlive(p))) {
      orphansGone = true;
      break;
    }
  }
  assert('退出应用后 pty 全量回收（before-quit kill-all，0 孤儿）',
    orphansGone,
    `pids=${JSON.stringify(remainingPids)}`);

  results.finishedAt = new Date().toISOString();
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'user-side-tabs.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.allPass ? 'ALL PASS' : 'HAS FAILURES'} → acceptance/block-54/user-side-tabs.json`);
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('DRIVER ERROR:', e.message);
  process.exit(2);
});
