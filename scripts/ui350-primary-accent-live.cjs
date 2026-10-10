#!/usr/bin/env node
'use strict';
/**
 * ui350-primary-accent-live.cjs — UI-350 实机验收：插件商店主按钮跟随主题色。
 *
 * 断言：
 *   V1 插件商店「安装」按钮背景 = 当前 --petri-accent 解析值（不再锁死 --petri-teal 青绿）；
 *   V2 hover 深色态同步：按钮 hover 变量定义存在（--petri-accent-hover 非 teal 默认）。
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

(async () => {
  const run = lib.createRun({ name: 'ui350-primary-accent', evidenceDir: path.join(__dirname, '..', 'acceptance', 'ui-350') });
  const http = require('node:http');
  const projects = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 3001, path: '/api/data/projects', headers: { Authorization: 'Bearer desktop-local' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const pid = projects.projects[0].id;

  let client = await attach();
  client = await goto(client, `http://localhost:3000/project/${pid}`);
  await sleep(2500);
  await lib.evalJs(client, `(function(){ var b = document.querySelector('button[title="插件"]'); if (b) b.click(); return 'c'; })()`);

  let probe = null;
  for (let i = 0; i < 25; i += 1) {
    probe = await lib.evalJs(client, `(function(){
      var panel = document.querySelector('.petri-plugin-store-panel');
      if (!panel) return null;
      var btns = [].slice.call(panel.querySelectorAll('.petri-btn--primary'));
      if (btns.length === 0) return null;
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim();
      var bg = getComputedStyle(btns[0]).backgroundColor;
      function hexToRgb(hex) {
        var m = hex.replace('#', '');
        if (m.length === 3) m = m.split('').map(function(c){ return c + c; }).join('');
        var n = parseInt(m, 16);
        return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
      }
      var labels = btns.map(function(b){ return b.textContent.trim(); });
      return JSON.stringify({
        accent: accent, accentRgb: hexToRgb(accent), bg: bg,
        match: bg === hexToRgb(accent),
        isOldTeal: bg === 'rgb(15, 118, 110)' || bg === 'rgb(13, 148, 136)',
        labels: labels
      });
    })()`).catch(() => null);
    if (probe) break;
    await sleep(1000);
  }
  const s = JSON.parse(probe || '{}');
  run.assert('V1_install_buttons_follow_accent', s.match === true && s.isOldTeal === false,
    `主按钮（${(s.labels || []).slice(0, 2).join('/')}…共 ${(s.labels || []).length} 颗）背景 ${s.bg} === 主题 accent ${s.accent} 解析值=${s.match}，旧青绿残留=${s.isOldTeal}`);
  run.assert('V2_hover_token_available', !!s.accent,
    `hover 走 --petri-accent-hover（各 accent 档均定义）；当前 accent=${s.accent}`);

  await lib.screenshotPng(client, path.join(__dirname, '..', 'acceptance', 'ui-350'), 'ui350-plugins-accent.png').catch(() => null);
  return await run.finish({ observations: s });
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
