#!/usr/bin/env node
'use strict';
// 临时 CDP 探针：页面内 fetch / DOM 状态诊断
const http = require('node:http');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
  });
}

async function main() {
  const expr = process.argv[2];
  const targets = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.addEventListener('message', (ev) => {
    const p = JSON.parse(ev.data);
    if (p.id === 1) {
      if (p.result?.result?.value !== undefined) console.log(p.result.result.value);
      else console.log(JSON.stringify(p.result || p, null, 1));
      process.exit(0);
    }
  });
  setTimeout(() => { console.error('timeout'); process.exit(2); }, 10000);
}
main();
