#!/usr/bin/env node
/**
 * scripts/post-s7-layout-ab.cjs — B-11 CenterPanel 双层同名 layout 的几何 A/B 判定。
 *
 * 现状：外层 div 与内层 div 都挂 styles.workspaceSessionLayout（横排 flex + gap 20px），
 * 但外层同时带 workspaceSessionFrameChat 变体；CSS 里另有 workspaceSessionFrame
 * （竖排 column + padding）。疑似外层本应是 Frame 却误挂 Layout。
 *
 * 本脚本不改产品源码：只在 CDP 页面里临时把首层类名换成 Frame 对应的真实 CSS 规则，
 * 量三态视口下四块几何差异。差异非平凡 → 登记「需独立切片 + 人眼过目」，不改代码；
 * 差异可忽略 → 才允许后续切片做类名收敛。
 *
 * 五类证据纪律：DOM 几何断言不冒充视觉绿，人眼观感仍 pending_human_eye。
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const { seed } = require('./post-s7-seed-conversations.cjs');
const Database = require(path.join(__dirname, '..', 'core/petri-server/node_modules/better-sqlite3'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/layout-ab.json');
const ISO_DB = process.env.PETRI_DB_PATH || '/tmp/petri-h8-isolated/data/petri.db';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEOM = `JSON.stringify({
  viewport: { w: innerWidth, h: innerHeight },
  blocks: {
    sessionLayoutFirst: (() => { const e=document.querySelector('[class*=workspaceSessionLayout]'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),display:getComputedStyle(e).display,flexDirection:getComputedStyle(e).flexDirection,gap:getComputedStyle(e).gap}; })(),
    sessionInset: (() => { const e=document.querySelector('[class*=workspaceSessionInset]'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}; })(),
    scMessages: (() => { const e=document.querySelector('.sc-messages'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}; })(),
    root: (() => { const r=document.getElementById('root')?.getBoundingClientRect(); return r?{w:+r.width.toFixed(1),h:+r.height.toFixed(1)}:null; })(),
  },
  overflow: { docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth },
  sameClassLayers: document.querySelectorAll('[class*=workspaceSessionLayout]').length,
})`;

async function phase(client, width, height, label) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  const raw = await lib.evalJs(client, GEOM);
  return { label, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) };
}

(async () => {
  seed({ convs: 20, msgs: 20 });
  const db = new Database(ISO_DB, { readonly: true });
  const project = db.prepare("SELECT id FROM projects WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get();
  db.close();
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const client = await lib.connectTarget(lib.filterPageTargets(targets, /localhost:3000/)[0]);
  await client.send('Page.bringToFront').catch(() => {});
  await lib.evalJs(client, `location.href='http://localhost:3000/project/${project.id}?test=1&layoutab=${Date.now()}'; 'nav'`);
  await sleep(5000);

  const viewports = [[1600, 1000], [4000, 2500], [1000, 625]];
  const a = [];
  for (const [w, h] of viewports) a.push(await phase(client, w, h, `${w}x${h}`));

  // B 态：把首层 workspaceSessionLayout 的布局语义换成 Frame（column + padding），只注入不落盘
  await lib.evalJs(client, `(() => {
    const s = document.createElement('style'); s.id = 'h9-layout-probe';
    s.textContent = '[class*=workspaceSessionLayout]:first-of-type { flex-direction: column; gap: 0; padding: 0 var(--petri-space-6, 24px); }';
    document.head.appendChild(s); return 'injected';
  })()`);
  await sleep(1000);
  const b = [];
  for (const [w, h] of viewports) b.push(await phase(client, w, h, `${w}x${h}`));
  await lib.evalJs(client, `(() => { const e=document.getElementById('h9-layout-probe'); if(e) e.remove(); return 'removed'; })()`);
  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

  const deltas = a.map((x, i) => {
    const y = b[i];
    const pick = (k) => {
      const p = x.blocks[k], q = y.blocks[k];
      if (!p || !q) return null;
      return { dw: +(q.w - p.w).toFixed(1), dh: +(q.h - p.h).toFixed(1), dx: +(q.x - p.x).toFixed(1), dy: +(q.y - p.y).toFixed(1) };
    };
    return { label: x.label, sessionLayoutFirst: pick('sessionLayoutFirst'), sessionInset: pick('sessionInset'), scMessages: pick('scMessages'), root: pick('root') };
  });
  const material = deltas.flatMap((d) => Object.values(d).filter((v) => v && typeof v === 'object'))
    .some((v) => Math.abs(v.dw) > 2 || Math.abs(v.dh) > 2 || Math.abs(v.dx) > 2 || Math.abs(v.dy) > 2);

  const evidence = {
    schemaVersion: 1, kind: 'post-s7-h9-layout-ab', generatedAt: new Date().toISOString(),
    platform: require('node:os').platform() + '-' + require('node:os').arch(),
    evidenceClass: 'cdp-dom-measurement', humanEyeEquivalent: false, visualVerified: false,
    finding: 'CenterPanel 外层挂 workspaceSessionLayout 但配 workspaceSessionFrameChat 变体；CSS 另有 workspaceSessionFrame（column + padding）——双层同名 layout 是真实结构歧义。',
    a, b, deltas, materialDifference: material,
    decision: material ? 'no-code-change-needs-independent-slice-and-human-eye' : 'safe-to-converge-in-followup-slice',
    pendingHumanEye: '布局观感（悬浮摘要定位 / 阴影裁切 / 缩窗三态）需人眼过目；DOM 几何断言不替代。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[layout-ab]', JSON.stringify({ materialDifference: material, decision: evidence.decision, deltas: deltas.map((d) => ({ label: d.label, scMessages: d.scMessages })) }));
  process.exit(0);
})().catch((e) => { console.error('[layout-ab] FATAL', e.stack || e.message); process.exit(1); });
