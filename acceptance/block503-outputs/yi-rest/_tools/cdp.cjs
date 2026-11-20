#!/usr/bin/env node
'use strict';

/**
 * BLOCK-503 乙组剩余（yi-rest）共享 CDP 采集架 —— 非产品代码。
 *
 * 连接 dev Electron 主窗 CDP（9222，page target = localhost:3000），
 * 提供 evaluate / 截图（视口或元素裁剪）/ 真实 hover / 键盘 Tab / 视口仿真。
 * 只读观察 + 状态触发；零 CSS/组件写面；观感判定归用户，Agent 不代签。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/Users/zhangdiandian/Documents/1.WorkDir/Petri';
const REST = path.join(ROOT, 'acceptance', 'block503-outputs', 'yi-rest');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

function outPath(itemDir, name) {
  const dir = path.join(REST, itemDir);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function writeJson(itemDir, name, obj) {
  const p = outPath(itemDir, name);
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
  return p;
}

async function connect({ port = 9222 } = {}) {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((t) => t.type === 'page' && String(t.url).includes('localhost:3000'));
  if (!page) throw new Error('main-window page target not found (localhost:3000)');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method && listeners.length) {
      for (const fn of listeners) { try { fn(msg); } catch { /* listener error isolated */ } }
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const setEventListener = (fn) => { listeners.push(fn); };

  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) {
      throw new Error(`evaluate failed: ${m.result.exceptionDetails.text} ${JSON.stringify(m.result.exceptionDetails.exception?.description || '')}`);
    }
    return m.result?.result?.value;
  };

  const evalJson = async (expression) => JSON.parse(await evaluate(`JSON.stringify((${expression}) ?? null)`));

  const shot = async (file, { clip = null } = {}) => {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = clip;
    const m = await send('Page.captureScreenshot', params);
    const data = m.result?.data;
    if (!data) throw new Error(`screenshot failed for ${file}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };

  // 元素级裁剪截图（整视口 PNG + sips 物理坐标裁剪；CDP clip 在 dpr≠1 下失准，实测空白，弃用）
  const cropFull = async (file, rect, pad = 3) => {
    const dpr = await evalJson(`window.devicePixelRatio`);
    const full = await send('Page.captureScreenshot', { format: 'png' });
    const data = full.result?.data;
    if (!data) throw new Error('full screenshot failed');
    const tmp = `${file}.full.png`;
    fs.writeFileSync(tmp, Buffer.from(data, 'base64'));
    const dims = (() => {
      const out = require('node:child_process').execSync(`sips -g pixelWidth -g pixelHeight ${JSON.stringify(tmp)}`).toString();
      const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1] || 0);
      const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1] || 0);
      return { w, h };
    })();
    const px = (v) => Math.round(v * dpr);
    const cw = Math.min(dims.w, px(rect.w + pad * 2));
    const ch = Math.min(dims.h, px(rect.h + pad * 2));
    const cx = Math.max(0, Math.min(dims.w - cw, px(rect.x - pad)));
    const cy = Math.max(0, Math.min(dims.h - ch, px(rect.y - pad)));
    require('node:child_process').execSync(`sips -c ${ch} ${cw} --cropOffset ${cy} ${cx} ${JSON.stringify(tmp)} --out ${JSON.stringify(file)}`);
    fs.unlinkSync(tmp);
    return file;
  };

  const shotEl = async (file, selector, { index = 0, pad = 3 } = {}) => {
    const rect = await evalJson(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${index}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    if (!rect || rect.w <= 0 || rect.h <= 0) throw new Error(`element not found or zero-size: ${selector} [${index}]`);
    await sleep(120);
    await cropFull(file, rect, pad);
    return rect;
  };

  // 真实 hover（Input 域鼠标移动走真实输入管线 → :hover 生效）
  const hoverEl = async (selector, { index = 0 } = {}) => {
    const p = await evalJson(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 12) };
    })()`);
    if (!p) throw new Error(`hover target not found: ${selector} [${index}]`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await sleep(180);
    return p;
  };

  const mouseDown = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const mouseUp = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

  const clickEl = async (selector, { index = 0 } = {}) => {
    const p = await evalJson(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!p) throw new Error(`click target not found: ${selector} [${index}]`);
    await mouseDown(p.x, p.y);
    await mouseUp(p.x, p.y);
    await sleep(200);
    return p;
  };

  // 键盘 Tab（真实输入管线 → :focus-visible 键盘模态生效）
  const pressTab = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, autoRepeat: false });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(120);
  };

  // 视口仿真（@media 断点与 ResizeObserver 均响应；用完必须 clear）
  const setViewport = async (width, height = 900) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
  };
  const clearViewport = async () => {
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(250);
  };

  const navigate = async (url) => {
    await evaluate(`location.href = ${JSON.stringify(url)}`);
    await sleep(900);
  };

  const close = () => { try { ws.close(); } catch { /* noop */ } };

  return { page, url: page.url, send, evaluate, evalJson, shot, shotEl, cropFull, setEventListener, hoverEl, mouseDown, mouseUp, clickEl, pressTab, setViewport, clearViewport, navigate, close };
}

module.exports = { connect, sleep, outPath, writeJson, ROOT, REST };
