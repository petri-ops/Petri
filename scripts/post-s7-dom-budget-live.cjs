#!/usr/bin/env node
/**
 * scripts/post-s7-dom-budget-live.cjs — post-S7 H8 DOM 预算 / 帧率 / 几何实机取数。
 *
 * 前置：
 *   ① 无窗口 dev 栈：后端 :3001（PETRI_DB_PATH 指向隔离副本）+ vite :3000；
 *   ② 9223 默认离屏测试实例（bash scripts/start-test-instance.sh，禁 --onscreen）；
 *   ③ 本脚本自行按档位造种子（只写隔离副本，绝不写用户主库）。
 *
 * 只取数、不改产品代码、不判通过；证据落 acceptance/post-s7-2026-11-10/h8/。
 * 五类证据纪律：evidenceClass=cdp-dom-measurement，humanEyeEquivalent=false——
 * DOM 断言不冒充视觉绿，帧率读数不冒充人眼观感。离屏窗口被 Chromium 节流时如实标注。
 *
 * 档位口径（BLOCK-393 实测发现）：
 *   - 会话列表服务端硬 LIMIT 100（routes/ai-conversations.js:71），
 *     消息列表前端默认 ?limit=100（copilotConversationsClient.ts:129）、服务端 clamp 到 500。
 *     故 400/800 会话档与 100 档 DOM 读数必然相同——这不是取数 bug，是**服务端已截断**。
 *   - 因此同时测「上限内档位」(convs 25/50/100、msgs 10/50/100) 以得到真实增长曲线，
 *     与「超上限档位」(400/800) 并列，不缩分母、不删档、不回溯调参。
 *
 * 用法：node scripts/post-s7-dom-budget-live.cjs
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const { seed } = require('./post-s7-seed-conversations.cjs');
const Database = require(path.join(__dirname, '..', 'core/petri-server/node_modules/better-sqlite3'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h8/dom-budget-live.json');
const ISO_DB = process.env.PETRI_DB_PATH || '/tmp/petri-h8-isolated/data/petri.db';

// 档位表：前 5 档在服务端上限内（会产生真实 DOM 差异），后 2 档超上限（验证截断）。
const SCENARIOS = [
  { label: 'convs-25', convs: 25, msgs: 20 },
  { label: 'convs-50', convs: 50, msgs: 20 },
  { label: 'convs-100', convs: 100, msgs: 20 },
  { label: 'msgs-10', convs: 20, msgs: 10 },
  { label: 'msgs-50', convs: 20, msgs: 50 },
  { label: 'msgs-100', convs: 20, msgs: 100 },
  { label: 'convs-400-over-limit', convs: 400, msgs: 120 },
  { label: 'convs-800-over-limit', convs: 800, msgs: 120 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  if (!pages.length) throw new Error('no_test_page_on_9223');
  const client = await lib.connectTarget(pages[0]);
  // rAF 在失焦/最小化窗口被 Chromium 节流——先带到前台（离屏窗口，不开可见窗口）。
  await client.send('Page.bringToFront').catch(() => {});
  return client;
}

async function measure(client, projectId, scenario) {
  await lib.evalJs(client, `location.href='http://localhost:3000/project/${projectId}?test=1&h8=${Date.now()}'; 'nav'`);
  await sleep(5000);
  const dom = await lib.evalJs(client, `JSON.stringify({
    allNodes: document.querySelectorAll('*').length,
    scMessagesNodes: document.querySelectorAll('.sc-messages *').length,
    convRowMatches: document.querySelectorAll('[class*=convItem]').length,
    resultRows: document.querySelectorAll('[class*=resultRow]').length,
    textLen: document.body.innerText.length,
    geometry: {
      viewport: { width: innerWidth, height: innerHeight },
      scMessages: (() => { const e=document.querySelector('.sc-messages'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })(),
      root: (() => { const r=document.getElementById('root')?.getBoundingClientRect(); return r?{width:r.width,height:r.height}:null; })(),
      panels: [...document.querySelectorAll('[class*=panel],[class*=Panel]')].slice(0,8).map(e=>{const r=e.getBoundingClientRect();return {cls:String(e.className).slice(0,60),w:Math.round(r.width),h:Math.round(r.height)};})
    }
  })`);
  const parsed = typeof dom === 'string' ? JSON.parse(dom) : dom;
  return {
    label: scenario.label,
    conversationCount: scenario.convs,
    messageCount: scenario.msgs,
    allNodes: parsed.allNodes,
    scMessagesNodes: parsed.scMessagesNodes,
    convRowMatches: parsed.convRowMatches,
    resultRows: parsed.resultRows,
    textLen: parsed.textLen,
    geometry: parsed.geometry,
  };
}

// 滚动 2 屏 × 3 轮 rAF 帧间隔；离屏窗口可能被节流，如实把 samplingNote 写进证据。
async function sampleFrames(client, rounds = 3) {
  const all = [];
  for (let i = 0; i < rounds; i += 1) {
    const raw = await lib.evalJs(client, `(async () => {
      const el = document.querySelector('.sc-messages') || document.scrollingElement;
      el.scrollTop = 0;
      const gaps = [];
      let last = performance.now();
      for (let f = 0; f < 90; f++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now(); gaps.push(now - last); last = now;
        if (f === 45) el.scrollTop = Math.min(el.scrollHeight, el.clientHeight * 2);
      }
      return JSON.stringify(gaps);
    })()`);
    const gaps = JSON.parse(raw);
    all.push(...gaps);
  }
  const sorted = all.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const at = (p) => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2)) : null;
  return {
    count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : null,
    longFrameRatio: sorted.length ? Number((sorted.filter((n) => n > 33.4).length / sorted.length).toFixed(4)) : null,
    samplingNote: '离屏 9223 窗口；CDP Page.bringToFront 后采样，Chromium 仍可能节流，读数仅为该环境下的可复跑基线，不是用户观感。',
  };
}

(async () => {
  const db = new Database(ISO_DB, { readonly: true });
  const project = db.prepare("SELECT id FROM projects WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get();
  db.close();
  if (!project) throw new Error('no_active_project_in_isolated_db');
  const client = await connect();
  const samples = [];
  for (const scenario of SCENARIOS) {
    const seeded = seed(scenario);
    console.log(`[h8] ${scenario.label} seeded (db total ${seeded.totalConvs})`);
    samples.push(await measure(client, project.id, scenario));
  }
  const frameSamples = await sampleFrames(client);
  let sourceCommit = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* 非 git 环境如实留空 */ }
  const evidence = {
    schemaVersion: 1,
    kind: 'post-s7-h8-dom-budget-live',
    sourceCommit,
    platform: os.platform() + '-' + os.arch(),
    command: 'node scripts/post-s7-dom-budget-live.cjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'cdp-dom-measurement',
    humanEyeEquivalent: false,
    verdict: 'measured',
    stack: { backend: ':3001 (isolated db)', vite: ':3000', cdp: ':9223 (offscreen)', isolation: ISO_DB },
    serverSideLimits: {
      conversationsApiLimit: 100,
      conversationsApiSource: 'core/petri-server/routes/ai-conversations.js:71 (LIMIT 100, no pagination param)',
      messagesFrontendDefaultLimit: 100,
      messagesFrontendSource: 'frontend/src/components/copilot/copilotConversationsClient.ts:129',
      messagesApiClamp: 500,
      finding: '400/800 会话档与 100 档 DOM 读数相同，根因是服务端已按 100 截断；「会话列表全量 DOM」前提不成立。这不是取数 bug，按原档保留并单列归因。',
    },
    samples,
    frameSamples,
    note: '本脚本只取「拆前基线」：DOM 节点数 / rAF 帧间隔 / 几何。是否加 content-visibility 由后续切片在基线落盘后决定；节点数不降或帧率不升即回滚。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[h8] evidence ->', OUT);
  console.log('[h8]', JSON.stringify(samples.map((s) => ({ label: s.label, nodes: s.allNodes, msgs: s.scMessagesNodes, convRows: s.convRowMatches }))));
  console.log('[h8] frames', JSON.stringify(frameSamples));
  process.exit(0);
})().catch((e) => { console.error('[h8] FATAL', e.stack || e.message); process.exit(1); });
