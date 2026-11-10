#!/usr/bin/env node
/**
 * scripts/post-s7-cv-ab.cjs — B-09 content-visibility A/B 渲染成本测量（同条件复跑）。
 *
 * 判据修正（2026-11-10）：H8 plan 里写「节点数不降即回滚」其实不成立——
 * content-visibility:auto 跳过的是**视口外 layout/paint**，DOM 节点仍在
 * （document.querySelectorAll 计数不变）。正确指标是强制布局耗时 / rAF 帧间隔。
 * 本脚本用 CDP 同页同种子测 A（未加 cv）/ B（已加 cv）两态，取 5 轮中位数。
 *
 * 诚实边界：离屏窗口 Chromium 可能节流；读数只作该环境下 A/B 相对比较，
 * 不冒充用户观感。B 态不改善就回滚 CSS（不硬改）。
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const { seed } = require('./post-s7-seed-conversations.cjs');
const Database = require(path.join(__dirname, '..', 'core/petri-server/node_modules/better-sqlite3'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/cv-ab.json');
const ISO_DB = process.env.PETRI_DB_PATH || '/tmp/petri-h8-isolated/data/petri.db';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COST_EXPR = `(async () => {
  const el = document.querySelector('.sc-messages');
  if (!el) return JSON.stringify({ error: 'no_sc_messages' });
  const samples = [];
  for (let round = 0; round < 5; round++) {
    el.scrollTop = round * 200;
    const t0 = performance.now();
    // 强制同步布局：读取几何会 flush 待处理的 style/layout
    let total = 0;
    const rows = el.querySelectorAll('*');
    for (let i = 0; i < rows.length; i += 7) total += rows[i].getBoundingClientRect().height;
    const layoutMs = performance.now() - t0;
    samples.push(layoutMs);
    await new Promise(r => requestAnimationFrame(r));
  }
  samples.sort((a,b)=>a-b);
  return JSON.stringify({
    nodes: el.querySelectorAll('*').length,
    layoutSamples: samples,
    medianMs: +samples[2].toFixed(3),
    cvComputedOnRows: [...el.children].filter(e => getComputedStyle(e).contentVisibility === 'auto').length,
  });
})()`;

async function measure(client, label) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const raw = await lib.evalJs(client, COST_EXPR);
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (r.error) throw new Error(r.error);
    runs.push(r);
    await sleep(300);
  }
  const medians = runs.map((r) => r.medianMs).sort((a, b) => a - b);
  return { label, runs: runs.length, medianLayoutMs: medians[1], nodes: runs[0].nodes, cvComputedOnRows: runs[0].cvComputedOnRows, all: medians };
}

(async () => {
  seed({ convs: 100, msgs: 100 });
  const db = new Database(ISO_DB, { readonly: true });
  const project = db.prepare("SELECT id FROM projects WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get();
  db.close();
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const page = lib.filterPageTargets(targets, /localhost:3000/)[0];
  const client = await lib.connectTarget(page);
  await client.send('Page.bringToFront').catch(() => {});
  await lib.evalJs(client, `location.href='http://localhost:3000/project/${project.id}?test=1&cvab=${Date.now()}'; 'nav'`);
  await sleep(5000);

  const a = await measure(client, 'A-without-cv');
  // B 态：注入 cv（不改产品源码，只做 A/B 判定；确认有效才落 CSS）
  await lib.evalJs(client, `(() => {
    const s = document.createElement('style'); s.id = 'h9-cv-probe';
    s.textContent = '.sc-messages > * { content-visibility: auto; contain-intrinsic-size: auto 64px; }';
    document.head.appendChild(s); return 'injected';
  })()`);
  await sleep(1200);
  const b = await measure(client, 'B-with-cv');
  await lib.evalJs(client, `(() => { const e=document.getElementById('h9-cv-probe'); if(e) e.remove(); return 'removed'; })()`);

  const improved = b.medianLayoutMs < a.medianLayoutMs * 0.9;
  const evidence = {
    schemaVersion: 1, kind: 'post-s7-h9-cv-ab', generatedAt: new Date().toISOString(),
    platform: require('node:os').platform() + '-' + require('node:os').arch(),
    evidenceClass: 'cdp-dom-measurement', humanEyeEquivalent: false, visualVerified: false,
    criterion: 'B 态强制布局耗时中位数 < A 态 ×0.9 才落 CSS；否则回滚（不改产品源码）',
    a, b, improved,
    decision: improved ? 'apply-cv' : 'rollback-no-measurable-gain',
    note: 'content-visibility 不改 DOM 节点数；原「节点数不降即回滚」判据已修正为渲染耗时。离屏窗口读数不是人眼观感。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[cv-ab]', JSON.stringify({ a: a.medianLayoutMs, b: b.medianLayoutMs, nodes: a.nodes, cvRowsA: a.cvComputedOnRows, cvRowsB: b.cvComputedOnRows, improved, decision: evidence.decision }));
  process.exit(0);
})().catch((e) => { console.error('[cv-ab] FATAL', e.stack || e.message); process.exit(1); });
