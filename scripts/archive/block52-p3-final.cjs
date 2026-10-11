#!/usr/bin/env node
'use strict';
/** P3 收尾：抓取 ResultView 当前最终状态（含新 Revision 指示）。 */
const fs = require('node:fs');
const path = require('node:path');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

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
    expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(`evaluate_failed: ${r.exceptionDetails.text}`);
  return r.result.value;
}

async function main() {
  const targets = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
  const state = await evalJS(client, `(() => {
    const text = document.body.innerText;
    return { tail: text.slice(-800) };
  })()`);
  console.log(JSON.stringify(state, null, 2));
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    path.join(__dirname, '..', 'acceptance', 'block-52', 'p3-05-final-state.png'),
    Buffer.from(r.data, 'base64'),
  );
  console.log('screenshot saved: p3-05-final-state.png');
}

main().catch((e) => { console.error('driver_error:', e.message); process.exit(2); });
