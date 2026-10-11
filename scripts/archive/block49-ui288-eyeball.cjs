#!/usr/bin/env node
'use strict';
/**
 * BLOCK-49 P4 顺带 — UI-288 档位三选菜单 dev Electron 实机过目（CDP）。
 * 步骤：找 chat 页 composer 盾形按钮 → 打开菜单截图 → 选「项目写」→ 验证按钮标签 → 截图 → 恢复「完全访问」。
 * 证据：acceptance/block-56/ui288-menu-live.json + 2 张截图。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP_PORT = 9222;
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-56');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const results = { startedAt: new Date().toISOString(), assertions: [], screenshots: [] };
const assert = (name, pass, detail) => {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 200)}`);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const targets = await httpGetJson(`http://localhost:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return res.result && res.result.result ? res.result.result.value : undefined;
  };
  const screenshot = async (file) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
    results.screenshots.push(path.basename(file));
    console.log('NOTICE: 截图', path.basename(file));
  };
  await send('Page.enable');

  // 0) 定位 chat 页（project chat 模式或独立 chat 页）
  const curUrl = await evalJS('location.href');
  assert('dev Electron 页面可达', !!curUrl, curUrl);
  if (!/mode=chat/.test(curUrl) && /project\//.test(curUrl)) {
    await send('Page.navigate', { url: curUrl.split('?')[0] + '?mode=chat' });
    await delay(3000);
  } else if (!/chat/.test(curUrl)) {
    await send('Page.navigate', { url: 'http://localhost:3000/chat' });
    await delay(3000);
  }

  // 1) 找档位按钮（盾形 + 「完全访问」标签）
  const findBtn = await evalJS(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /完全访问|只读模式|项目写/.test(x.textContent || '') && (x.title || '').includes('访问模式'));
    return b ? { ok: true } : { ok: false, hint: btns.filter((x) => /访问模式/.test(x.title || '')).length };
  })()`);
  assert('档位按钮可见（title=选择访问模式）', findBtn && findBtn.ok, JSON.stringify(findBtn));
  if (!findBtn || !findBtn.ok) { ws.close(); throw new Error('档位按钮未找到'); }

  // 2) 打开菜单 → 三选项齐备 → 截图
  await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    b.click(); return true;
  })()`);
  await delay(400);
  const menuState = await evalJS(`(() => {
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    return { count: opts.length, titles: opts.map((o) => (o.querySelector('.sc-access-option-title') || {}).textContent) };
  })()`);
  assert('三选项齐备（完全访问/项目写/只读模式）', menuState && menuState.count === 3
    && menuState.titles[0] === '完全访问' && menuState.titles[1] === '项目写' && menuState.titles[2] === '只读模式',
    JSON.stringify(menuState));
  await screenshot(path.join(EVIDENCE_DIR, 'ui288-menu-options.png'));

  // 3) 选「项目写」→ 按钮标签应为「项目写」（回归 L1223 三档标签）
  await evalJS(`(() => {
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    const target = opts.find((o) => (o.querySelector('.sc-access-option-title') || {}).textContent === '项目写');
    target.click(); return true;
  })()`);
  await delay(300);
  const labelAfter = await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    return b ? b.textContent.trim() : null;
  })()`);
  assert('选「项目写」后按钮标签=项目写（L1223 三档标签回归）', labelAfter === '项目写', labelAfter);

  // 4) 恢复「完全访问」（不留档位副作用）
  await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    b.click(); return true;
  })()`);
  await delay(300);
  await evalJS(`(() => {
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    const target = opts.find((o) => (o.querySelector('.sc-access-option-title') || {}).textContent === '完全访问');
    if (target) target.click();
    return true;
  })()`);
  await delay(200);
  const restored = await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    return b ? b.textContent.trim() : null;
  })()`);
  assert('恢复「完全访问」（无档位副作用）', restored === '完全访问', restored);

  results.finishedAt = new Date().toISOString();
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui288-menu-live.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n证据已写入 acceptance/block-56/ui288-menu-live.json (allPass=${results.allPass})`);
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL UI-288 过目脚本异常:', (e && e.stack) || e);
  process.exit(1);
});
