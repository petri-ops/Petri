#!/usr/bin/env node
'use strict';
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');
function req(url, opts = {}) {
  return new Promise((res, rej) => {
    const r = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }); r.on('error', rej); if (opts.body) r.write(opts.body); r.end();
  });
}
async function main() {
  const targets = await req('http://127.0.0.1:9222/json');
  const c = await new CdpClient(targets[0].webSocketDebuggerUrl).connect();
  const errors = [];
  await c.send('Runtime.enable').catch(() => {});
  const sub = (m, p) => errors.push(`${m}: ${String(p.exception?.description || p.text || '').slice(0, 200)}`);
  c.on('Runtime.exceptionThrown', (p) => sub('EXC', p));
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'warning') errors.push(`${p.type}: ` + String(p.args?.map((a) => a.value || a.description || '').join(' ')).slice(0, 250)); });
  const pid = process.argv[2];
  await c.send('Page.navigate', { url: `http://localhost:3000/project/${pid}` });
  await new Promise((r) => setTimeout(r, 35000));
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression: "JSON.stringify({path:location.pathname,text:document.body.innerText.slice(0,180),btn:document.querySelectorAll('[class*=xterm]').length})", returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('probe_timeout')), 10000)),
  ]);
  console.log('state:', r.result && r.result.value);
  console.log('errors:', errors.slice(0, 8));
  c.socket.close();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
