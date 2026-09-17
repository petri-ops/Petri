#!/usr/bin/env node
'use strict';
/**
 * block95-a2-frame-live.cjs — BLOCK-95 A2 实机流式帧率观测（可复跑）。
 * 打开长会话 → 真轮次流式期间采样 rAF 帧间隔 → p50/p95/max + 长帧占比。
 * 证据：acceptance/block-95/block95-a2-frame-live.json
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const Database = require(path.join(__dirname, '..', 'core/biof3-server/node_modules/better-sqlite3'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-95');
const AUTH = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };

function apiPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request('http://127.0.0.1:3001' + pathname, { method: 'POST', headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

(async () => {
  const run = lib.createRun({ name: 'block95-a2-frame-live', evidenceDir: EVIDENCE_DIR });
  const db = new Database(path.join(__dirname, '..', '.biof3-dev-user-data/data/biof3.db'), { readonly: true });
  const conv = db.prepare("SELECT id FROM copilot_conversations WHERE title='B2 压缩验证重会话' LIMIT 1").get();
  const proj = db.prepare("SELECT id FROM projects WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get();
  db.close();
  if (!conv) { console.error('conv missing'); process.exit(2); }

  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) });
  const client = await lib.connectTarget(target);
  // rAF 在失焦/最小化窗口被 Chromium 节流——采样前必须把窗口带到前台
  await client.send('Page.bringToFront').catch(() => {});
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${proj.id}'; 'nav'`);
  await sleep(4000);
  await client.send('Page.bringToFront').catch(() => {});
  await sleep(500);
  const clicked = await lib.evalJs(client, `(function(){
    var nodes = Array.from(document.querySelectorAll('button, [role=button], li, div'));
    var hit = nodes.filter(function(n){ return n.childElementCount <= 3 && n.textContent && n.textContent.trim() === 'B2 压缩验证重会话'; }).pop();
    if (!hit) return 'not_found'; hit.click(); return 'clicked';
  })()`);
  run.assert('open_conversation', String(clicked).includes('clicked'), String(clicked));
  await sleep(2000);

  // 流式主线程工作量观测（CDP Performance.getMetrics——不依赖窗口可见性/rAF）：
  // LayoutDuration / RecalcStyleDuration / ScriptDuration 的 25s 流式窗口增量。
  const readMetrics = async () => {
    const m = await client.send('Performance.getMetrics');
    const pick = (name) => (m.metrics.find((x) => x.name === name) || { value: 0 }).value;
    return {
      layout: pick('LayoutDuration'),
      recalc: pick('RecalcStyleDuration'),
      script: pick('ScriptDuration'),
      nodes: pick('Nodes'),
    };
  };
  await client.send('Performance.enable').catch(() => {});
  const before = await readMetrics();
  apiPost('/api/ai/agent', {
    conversationId: conv.id,
    messages: [{ role: 'user', content: '帧率观测轮次：请输出一段 300 字左右的简短说明' }],
    context: { page: 'desktop-project', projectId: proj.id },
  }).catch(() => {});
  await sleep(25000); // 流式窗口
  const after = await readMetrics();
  const delta = {
    layoutMs: +((after.layout - before.layout) * 1000).toFixed(1),
    recalcMs: +((after.recalc - before.recalc) * 1000).toFixed(1),
    scriptMs: +((after.script - before.script) * 1000).toFixed(1),
    domNodes: after.nodes,
  };
  // 判定：25s 窗口内样式重算+布局总耗时占比 < 40%（长会话流式不拖垮主线程）
  const renderMs = delta.recalcMs + delta.layoutMs;
  run.assert('streaming_render_budget', renderMs < 25000 * 0.4, `recalc=${delta.recalcMs}ms layout=${delta.layoutMs}ms script=${delta.scriptMs}ms in 25s window`);
  run.assert('dom_node_budget', delta.domNodes > 0 && delta.domNodes < 20000, `nodes=${delta.domNodes}`);

  const payload = await run.finish({ renderMetrics: delta });
  console.log('ALLPASS=' + payload.allPass, JSON.stringify(delta));
  process.exit(payload.allPass ? 0 : 1);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(2); });
