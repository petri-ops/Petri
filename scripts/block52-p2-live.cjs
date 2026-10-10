#!/usr/bin/env node
'use strict';

/**
 * BLOCK-52 P2 实机 CDP 断言驱动：
 *   图片引用流（Files 预览「引用到对话」→ composer 图片引用卡 → 发送合成正文）
 * 证据（断言 JSON + 截图）落 acceptance/block-52/。
 * 前置：dev Electron 已以 --remote-debugging-port=9222 启动；
 *       desktop 项目（workspace=本仓库）figures/quote-live.png 存在。
 */
const fs = require('node:fs');
const path = require('node:path');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const PROJECT_ID = process.env.BIOF52_PROJECT || 'p_mt15b0aw_f0xa'; // desktop 项目（workspace=仓库）
const FILE_PATH = 'figures/quote-live.png';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-52');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJS(client, expr) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function screenshot(client, file) {
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = { startedAt: new Date().toISOString(), page: page.url, assertions: [] };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 1. 导航到 desktop 项目
  await evalJS(client, `(location.href = '/project/${PROJECT_ID}?mode=chat', true)`);
  await delay(2500);

  // 2. 通过 projectOpenWorkspaceFile 事件打开目标图片（右栏 Files 预览）
  await evalJS(client, `(window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', {
    detail: { projectId: '${PROJECT_ID}', relativePath: '${FILE_PATH}', name: 'quote-live.png' }
  })), true)`);
  await delay(2000);

  // 3. 预览区应出现「引用到对话」按钮 → 点击
  const quoteBtn = await evalJS(client, `(() => {
    const b = [...document.querySelectorAll('button')].find(el => el.textContent.includes('引用到对话'));
    if (!b) return null;
    b.click();
    return true;
  })()`);
  assert('右栏图片预览出现「引用到对话」按钮并可点击', quoteBtn === true, quoteBtn);
  await delay(600);
  await screenshot(client, path.join(EVIDENCE_DIR, 'p2-01-file-preview-quote.png'));

  // 4. composer 出现图片引用卡
  const card = await evalJS(client, `(() => {
    const card = document.querySelector('.sc-image-ref');
    if (!card) return null;
    return {
      name: card.querySelector('.sc-image-ref-name')?.textContent,
      source: card.querySelector('.sc-image-ref-source')?.textContent,
      hasThumb: !!card.querySelector('.sc-image-ref-thumb'),
      thumbSrc: card.querySelector('.sc-image-ref-thumb')?.getAttribute('src')?.slice(0, 40),
    };
  })()`);
  assert('composer 出现图片引用卡（缩略图+名称+来源行）',
    !!card && card.hasThumb && card.name === 'quote-live.png',
    JSON.stringify(card));

  // 5. 输入文本 + Enter 发送
  const typed = await evalJS(client, `(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '这是一张测试图，请忽略图片内容本身，只回复“已收到图片引用”六个字。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  assert('composer 输入并发送', typed && typed.ok, JSON.stringify(typed));
  await delay(3000);
  await screenshot(client, path.join(EVIDENCE_DIR, 'p2-02-message-sent.png'));

  // 6. 消息流出现合成正文：[引用图片 quote-live.png] + path: figures/quote-live.png
  const lastMsg = await evalJS(client, `(() => {
    const nodes = [...document.querySelectorAll('[class*="message"], [class*="bubble"]')];
    const text = nodes.map(n => n.textContent).join('\\n\\n');
    return {
      hasImageRef: text.includes('【引用图片 quote-live.png】'),
      hasPath: text.includes('figures/quote-live.png'),
      tail: text.slice(-300),
    };
  })()`);
  assert('消息正文含 【引用图片 quote-live.png】 前缀', lastMsg.hasImageRef, lastMsg.tail);
  assert('消息正文含 workspace 相对路径（模型可据此 read_image）', lastMsg.hasPath);

  // 7. 发送后引用卡清空
  const cardGone = await evalJS(client, `!document.querySelector('.sc-image-ref')`);
  assert('发送后图片引用卡清空', cardGone === true);

  results.finishedAt = new Date().toISOString();
  results.pass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p2-live-assertions.json'), JSON.stringify(results, null, 2));
  console.log(results.pass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => { console.error('driver_error:', e.message); process.exit(2); });
