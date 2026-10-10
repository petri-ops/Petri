#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: app-rail-persistent — 左栏跨页面常驻（UI-341 加映三 档 2）。
 *
 * 左栏已上提为应用壳层（AppRail），因此**任何主窗页面**都应常驻左栏，
 * 而不是只在 /project/:id/* 工作区路由才存在（用户实测：点 Skills/知识空间/
 * 后端/新建任务，左栏被覆盖消失）。
 *
 * 断言链：
 *   R1_rail_on_skills        /skills 左栏常驻
 *   R2_rail_on_knowledge     /knowledge 左栏常驻
 *   R3_rail_on_backend       /backend 左栏常驻
 *   R4_rail_on_welcome       / 欢迎页左栏常驻
 *   R5_rail_on_projects      /projects 左栏常驻
 *   R6_rail_on_workspace     /project/:id 工作区左栏常驻
 *   R7_rail_on_result_mode   /project/:id/result 结果模式左栏常驻（不自动收缩）
 *
 * 判据：leftCol 元素存在且宽度 > 100（紧凑浮层模式下仍应存在；阈值为「可见的
 * 侧栏宽度」而非精确值，避免把栏宽偏好写死）。
 *
 * 证据：acceptance/ui-341/app-rail-persistent-live.json
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 导航到某页并返回该页左栏宽度；导航会换渲染上下文，故每次重拉 target 重连。 */
async function railWidthAt(clientRef, url) {
  await lib.evalJs(clientRef.client, `location.href = ${JSON.stringify(url)}; 'nav'`).catch(() => {});
  await sleep(2600);
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 15_000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) return { width: -1, error: 'no_page_target' };
  const c = await lib.connectTarget(pages[0]);
  try {
    const w = await lib.evalJs(c, `(function(){
      var e = document.querySelector('[class*="leftCol"]');
      if (!e) return -2;
      return Math.round(e.getBoundingClientRect().width);
    })()`).catch(() => -3);
    return { width: w, client: c };
  } finally {
    try { c.socket.close(); } catch { /* ignore */ }
  }
}

module.exports = {
  id: 'app-rail-persistent',
  description: 'UI-341 加映三 左栏跨页面常驻（壳层 AppRail）',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-341'),

  async run({ assert }) {
    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到');
    const client = await lib.connectTarget(pages[0]);
    const originalUrl = pages[0].url;

    const pid = await lib.evalJs(client, `(async () => {
      const r = await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
      const d = await r.json();
      return (d.projects || [])[0] ? (d.projects || [])[0].id : '';
    })()`).catch(() => '');

    const cases = [
      ['R1_rail_on_skills', '/skills'],
      ['R2_rail_on_knowledge', '/knowledge'],
      ['R3_rail_on_backend', '/backend'],
      ['R4_rail_on_welcome', '/'],
      ['R5_rail_on_projects', '/projects'],
      ['R6_rail_on_workspace', pid ? `/project/${pid}` : ''],
      ['R7_rail_on_result_mode', pid ? `/project/${pid}/result` : ''],
    ];

    try {
      const ref = { client };
      for (const [name, route] of cases) {
        if (!route) { assert(name, false, 'no_project_available'); continue; }
        const r = await railWidthAt(ref, `http://localhost:3000${route}`);
        assert(name, r.width > 100, `${route} leftCol=${r.width}${r.error ? ' ' + r.error : ''}`);
      }
    } finally {
      try { await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restore'`); await sleep(1500); } catch { /* ignore */ }
      try { client.socket.close(); } catch { /* ignore */ }
    }
    return true;
  },
};
