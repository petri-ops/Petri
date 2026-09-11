#!/usr/bin/env node
'use strict';
/* probe-a7.cjs — 复现 ui341 flow A7 失败：建临时项目→欢迎页首问→导航后 dump 左栏状态 */
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await resp.json(); } catch {}
  return { ok: resp.ok, data };
}

(async () => {
  const targets = await lib.pollTargets({ timeoutMs: 15000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  const client = await lib.connectTarget(pages[0]);
  const originalUrl = pages[0].url;

  const created = await rest('POST', '/data/projects', { name: 'A7探针-' + Date.now(), modality: 'general' });
  const projectId = created.data.project.id;
  console.log('project:', projectId);

  await lib.evalJs(client, "location.href = 'http://localhost:3000/?project=" + projectId + "'; 'nav'");
  for (let i = 0; i < 20; i++) {
    if (await lib.evalJs(client, '!!document.querySelector(String.fromCharCode(91,97,114,105,97,45,108,97,98,101,108,61,34,27426,36814,39029,34,93))').catch(() => false)) break;
    await sleep(1000);
  }
  await sleep(1000);

  const typed = await lib.evalJs(client, `(function(){
    var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
    if (!ta) return 'no_textarea';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'A7 探针：请直接回复收到，不要使用工具。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  console.log('type:', typed);
  const clicked = await lib.evalJs(client, `(function(){
    var btns = [...document.querySelectorAll('[class*="chatMount"] button')];
    var send = btns.find(b => (b.getAttribute('title')||'').includes('发送消息'));
    if (!send || send.disabled) return 'send_unavailable';
    send.click(); return 'sent';
  })()`);
  console.log('send:', clicked);

  // 等 URL 进工作区
  for (let i = 0; i < 25; i++) {
    const href = await lib.evalJs(client, 'location.href').catch(() => '');
    if (href.includes('/project/' + projectId)) { console.log('navigated at t+' + i + 's'); break; }
    await sleep(1000);
  }
  // 每秒 dump projectTree/leftCol 状态，共 15 秒
  for (let i = 0; i < 15; i++) {
    const v = await lib.evalJs(client, `JSON.stringify({
      t: ${i},
      href: location.href.slice(-20),
      tree: document.querySelectorAll(String.fromCharCode(91,99,108,97,115,115,42,61,34,112,114,111,106,101,99,116,84,114,101,101,34,93)).length,
      treeText: (function(){ var e = document.querySelector(String.fromCharCode(91,99,108,97,115,115,42,61,34,112,114,111,106,101,99,116,84,114,101,101,34,93)); return e ? e.textContent.slice(0,40) : '(null)'; })(),
      snip: document.body.innerText.slice(0,60).replace(/\\n/g,'|')
    })`).catch(e => 'ERR ' + e.message.slice(0, 60));
    console.log(v);
    await sleep(1000);
  }

  // 清理
  const convs = await rest('GET', '/ai/conversations?status=all&project_id=' + projectId);
  for (const c of (convs.data && convs.data.conversations) || []) await rest('DELETE', '/ai/conversations/' + c.id);
  await rest('DELETE', '/data/projects/' + projectId);
  await lib.evalJs(client, "location.href = " + JSON.stringify(originalUrl) + "; 'restore'");
  console.log('cleaned');
  client.socket.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
