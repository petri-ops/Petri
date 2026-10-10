#!/usr/bin/env node
'use strict';
/**
 * ui349-back-unify-live.cjs — UI-349 实机验收：后端/知识空间/Skills/插件四页返回按钮统一。
 *
 * 用户裁决：四个页面的返回按钮「形式文字 保持统一」。
 * 统一后形态 = 左箭头 + 「返回」文字、30px 高、1px 边框、8px 圆角。
 *
 * 断言：四页返回按钮 text=返回、aria=返回，几何一致（高≈30、圆角≈8）。
 */

const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_page_target');
  return lib.connectTarget(target);
}

async function goto(client, url) {
  await lib.evalJs(client, `location.href = ${JSON.stringify(url)}; 'nav'`);
  await sleep(3500);
  return attach();
}

const MEASURE = `(function(){
  function read(btn) {
    if (!btn) return null;
    var cs = getComputedStyle(btn);
    var r = btn.getBoundingClientRect();
    return { text: btn.textContent.trim(), aria: btn.getAttribute('aria-label'), h: Math.round(r.height), radius: cs.borderRadius };
  }
  return JSON.stringify(read(document.querySelector('button[aria-label="返回"]')));
})()`;

(async () => {
  const run = lib.createRun({ name: 'ui349-back-unify', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-349') });
  const http = require('node:http');
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  const shapes = {};
  for (const route of ['backend', 'knowledge', 'skills']) {
    let client = await attach();
    client = await goto(client, `http://localhost:3000/${route}`);
    await sleep(1200);
    const s = JSON.parse(await lib.evalJs(client, MEASURE) || 'null');
    shapes[route] = s;
    run.assert(`F_${route}_back`, !!s && s.text === '返回' && s.aria === '返回' && Math.abs(s.h - 30) <= 1 && s.radius === '8px',
      `${route} 返回按钮=${JSON.stringify(s)}`);
  }

  // 插件页（工作区模式）
  let client = await attach();
  client = await goto(client, `http://localhost:3000/project/${pid}`);
  await sleep(2500);
  await lib.evalJs(client, `(function(){ var b = document.querySelector('button[title="插件"]'); if (b) b.click(); return 'c'; })()`);
  let shape = null;
  for (let i = 0; i < 25; i += 1) {
    shape = JSON.parse(await lib.evalJs(client, `(function(){
      var panel = document.querySelector('.petri-plugin-store-panel');
      if (!panel) return 'null';
      function read(btn) {
        if (!btn) return null;
        var cs = getComputedStyle(btn);
        var r = btn.getBoundingClientRect();
        return { text: btn.textContent.trim(), aria: btn.getAttribute('aria-label'), h: Math.round(r.height), radius: cs.borderRadius };
      }
      return JSON.stringify(read(panel.querySelector('button[aria-label="返回"]')));
    })()`).catch(() => 'null') || 'null');
    if (shape && shape !== 'null') break;
    await sleep(1000);
  }
  shapes.plugins = shape;
  run.assert(`F_plugins_back`, !!shape && shape.text === '返回' && shape.aria === '返回' && Math.abs(shape.h - 30) <= 1 && shape.radius === '8px',
    `插件页返回按钮=${JSON.stringify(shape)}`);

  const ref = shapes.backend;
  const allSame = ['knowledge', 'skills', 'plugins'].every((k) => {
    const s = shapes[k];
    return s && ref && s.text === ref.text && s.h === ref.h && s.radius === ref.radius;
  });
  run.assert('F_all_identical', allSame,
    `四页返回按钮形态文字一致（text/高度/圆角）：${JSON.stringify(shapes)}`);

  return await run.finish({ observations: { shapes } });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
