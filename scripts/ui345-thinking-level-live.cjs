#!/usr/bin/env node
'use strict';
/* probe-p2-thinking.cjs — BLOCK-81 P2 实机验证：
   1) 开启渠道 reasoning 能力位（REST 写 model_profiles）
   2) 工作区 composer 档位控件出现（能力位门控生效）
   3) 选「高」→ 发送 → 任务参数携带 thinkingLevel=high（后端已收）
   4) 收尾：能力位复原（不留测试残留）
*/
const path = require('node:path');
const http = require('node:http');
const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTH = { Authorization: 'Bearer desktop-local' };

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 3001, path: p, method, headers: {
      ...AUTH, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch { resolve({ status: res.statusCode, json: null, raw: d.slice(0, 200) }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const raw = (await req('GET', '/api/ai/settings')).json || {};
  const settings = raw.settings || {};
  const profiles = settings.model_profiles || [];
  const target = profiles.find((p) => p.provider === 'deepseek') || profiles[0];
  if (!target) { console.log('NO_PROFILE'); process.exit(1); }
  console.log('target profile:', target.id, '| caps:', JSON.stringify(target.capabilities || []));

  // 1) 开启 reasoning 能力位
  const patched = profiles.map((p) => (p.id === target.id
    ? { ...p, capabilities: Array.from(new Set([...(p.capabilities || ['chat', 'streaming', 'tools']), 'reasoning'])) }
    : p));
  const w = await req('POST', '/api/ai/settings', { model_profiles: patched });
  console.log('capability enabled:', w.status, w.json && w.json.status);

  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const client = await lib.connectTarget(pages[0]);
  const pid = JSON.parse(await lib.evalJs(client, `(async () => {
    const r = await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
    const d = await r.json();
    return JSON.stringify((d.projects || [])[0] ? d.projects[0].id : '');
  })()`));

  // 2) 进工作区，等 composer 与档位控件
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${pid}'; 'nav'`);
  await sleep(4000);
  await lib.pollTargets({ timeoutMs: 15000 });
  const t2 = await lib.pollTargets({ timeoutMs: 15000 });
  const c2 = await lib.connectTarget(lib.filterPageTargets(t2, /^http:\/\/localhost:3000\//)[0]);

  let trigger = null;
  for (let i = 0; i < 12; i += 1) {
    trigger = await lib.evalJs(c2, `(function(){
      var el = document.querySelector('[data-testid="thinking-level-trigger"]');
      return el ? JSON.stringify({ level: el.getAttribute('data-level'), label: (el.textContent||'').trim() }) : null;
    })()`).catch(() => null);
    if (trigger) break;
    await sleep(1000);
  }
  console.log('thinking trigger:', trigger);

  if (!trigger) {
    console.log('CONTROL_ABSENT — 能力位门控未生效或页面未就绪');
  } else {
    // 3) 打开菜单选「高」
    await lib.evalJs(c2, `(function(){
      var el = document.querySelector('[data-testid="thinking-level-trigger"]');
      if (el) el.click();
      return 'opened';
    })()`);
    await sleep(600);
    const picked = await lib.evalJs(c2, `(function(){
      var opt = document.querySelector('[data-testid="thinking-level-option-high"]');
      if (!opt) return 'option_missing';
      opt.click();
      return 'clicked';
    })()`);
    await sleep(600);
    const after = await lib.evalJs(c2, `(function(){
      var el = document.querySelector('[data-testid="thinking-level-trigger"]');
      return el ? el.getAttribute('data-level') : null;
    })()`);
    console.log('pick:', picked, '| level now:', after);

    // 4) 发送一条消息（探针：零工具直答）
    const typed = await lib.evalJs(c2, `(function(){
      var ta = document.querySelector('textarea.sc-input');
      if (!ta) return 'no_textarea';
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'P2 档位探针：不要使用任何工具，直接回复「收到」。');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed:' + ta.value.length;
    })()`).catch((e) => 'err:' + e.message.slice(0, 60));
    console.log('typed:', typed);
    await sleep(800);
    const sent = await lib.evalJs(c2, `(function(){
      var b = [].slice.call(document.querySelectorAll('button')).find(function (x) {
        return (x.getAttribute('aria-label') || x.title || '').indexOf('发送消息') >= 0;
      });
      if (!b || b.disabled) return 'send_unavailable';
      b.click();
      return 'sent';
    })()`).catch((e) => 'err:' + e.message.slice(0, 60));
    console.log('send:', sent);
    await sleep(6000);

    // 5) 查任务参数（后端已收档位）
    const tasks = await req('GET', '/api/ai/agent/tasks?limit=5');
    const list = (tasks.json && (tasks.json.tasks || tasks.json.items)) || [];
    const latest = list[0];
    console.log('latest task params.thinkingLevel =', latest && latest.params ? latest.params.thinkingLevel : '(none)');
  }

  // 6) 复原能力位
  const restore = await req('POST', '/api/ai/settings', { model_profiles: profiles });
  console.log('capability restored:', restore.status);
  try { c2.socket.close(); } catch { /* ignore */ }
  try { client.socket.close(); } catch { /* ignore */ }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
