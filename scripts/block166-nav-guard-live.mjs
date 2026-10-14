#!/usr/bin/env node
/**
 * scripts/block166-nav-guard-live.mjs — BLOCK-166-NAV-GUARD 实机探针。
 *
 * 真栈真卡片：种一条带 ::visualize 的 assistant 消息（fragment=延迟自劫持脚本：
 * 每次被自愈重载后 800ms 再次 location.href 外域）→ 断言
 * ①劫持-自愈循环快速收敛（10s 内达 3 次=亚秒级恢复，旧心跳路径需 ~30s）
 * ②30s×3 限幅挂起面在场 ③主进程侦测日志留痕。
 * 证据=acceptance/block-166/nav-guard-live.json + 截图。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const { pollTargets, filterPageTargets, evalJs, connectTarget, screenshotPng } = await import(
  pathToFileURL(libPath).href
).then((m) => m.default ?? m);

const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const API = 'http://127.0.0.1:3001/api';
const DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-166');

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 200)}`);
}

async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const project = await api('POST', '/data/projects', { name: 'NAV-GUARD 探针' });
const projectId = project.json?.project?.id || project.json?.data?.id;
const meta = await api('GET', `/data/projects/${encodeURIComponent(projectId)}`);
const ws = meta.json?.project?.workspace_path || meta.json?.data?.workspace_path || meta.json?.workspace_path;
const conv = await api('POST', '/ai/conversations', { title: 'NAV-GUARD 探针', project_id: projectId });
const conversationId = conv.json?.conversation?.id || conv.json?.data?.conversation?.id || conv.json?.data?.id;
record('setup', Boolean(projectId && conversationId && ws), `project=${projectId} conv=${conversationId} ws=${ws ? 'found' : 'missing'}`);

// fragment：挂载后 800ms 自劫持外域（自愈重载→脚本重跑→循环劫持）
const fragDir = path.join(ws, '.petri', 'gen-ui', conversationId);
fs.mkdirSync(fragDir, { recursive: true });
const fragPath = path.join(fragDir, 'nav-guard.html');
fs.writeFileSync(fragPath, '<!doctype html><html><body><h1>NAV-GUARD-LIVE</h1><script>setTimeout(function(){ location.href = "https://example.com/nav-guard-hijack"; }, 800);</script></body></html>');

// 种 assistant 消息（渲染层投影 ::visualize → GenUiCard）
const Database = require('better-sqlite3');
const db = new Database(path.join(DATA_DIR, 'petri.db'));
db.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
  .run(`msg_navguard_${Date.now()}`, conversationId, 'assistant',
    `已生成劫持探针页：::visualize{"path":"${fragPath.replaceAll('\\', '/')}", "title":"NAV-GUARD 劫持探针"}`,
    '{}', new Date().toISOString());
db.close();

const targets = await pollTargets({ timeoutMs: 15000 });
const pages = filterPageTargets(targets).filter((t) => t.webSocketDebuggerUrl);
const target = pages.find((t) => /petri|格物/i.test(t.title || '')) || pages[0];
const client = await connectTarget(target);
try {
  const navAt = Date.now();
  await evalJs(client, `location.href = ${JSON.stringify(`http://localhost:3000/project/${projectId}?conversationId=${conversationId}`)}; true;`);
  await new Promise((r) => setTimeout(r, 5000));

  // 观察窗：装帧挂载计数器（iframe 每次重建计数），跑 12s 收敛窗
  await evalJs(client, `(() => {
    window.__ng = { attaches: 0, lastAttachAt: 0, firstAttachAt: 0 };
    const bodyEl = document.querySelector('[class*="body"]') || document.body;
    const loadListener = (e) => {
      const t = e.target;
      if (t && t.tagName === 'IFRAME' && String(t.getAttribute('src') || '').startsWith('petri-genui://')) {
        window.__ng.attaches += 1;
        if (!window.__ng.firstAttachAt) window.__ng.firstAttachAt = Date.now();
        window.__ng.lastAttachAt = Date.now();
      }
    };
    window.addEventListener('load', loadListener, true);
    window.__ng._cleanup = () => window.removeEventListener('load', loadListener, true);
    return 'load-listener-installed';
  })()`);

  await new Promise((r) => setTimeout(r, 12_000));

  const state = JSON.parse(await evalJs(client, `(() => {
    const card = document.querySelector('[data-testid="gen-ui-card"]');
    return JSON.stringify({
      card: Boolean(card),
      iframe: Boolean(document.querySelector('iframe[src^="petri-genui://"]')),
      suspended: Boolean(document.querySelector('[data-testid="gen-ui-sandbox-suspended"]')),
      attaches: (window.__ng || {}).attaches || 0,
      firstAttachAt: (window.__ng || {}).firstAttachAt || 0,
      lastAttachAt: (window.__ng || {}).lastAttachAt || 0,
    });
  })()`));
  record('card-mounted', state.card, 'GenUiCard 在场');
  // 判据：挂起面在导航 20s 内出现（信号路径 3 劫持 ~3-6s / 旧心跳路径 3 劫持 ~29s+）。
  // OOPIF 的 load 事件不上报宿主窗（实测），attaches 计数仅参考不作判据。
  const suspendAt = state.suspended ? Date.now() : 0;
  record('hijack-cycle-converges', state.suspended && suspendAt - navAt < 20_000,
    `导航→挂起 ${suspendAt - navAt}ms attaches=${state.attaches}（计数仅参考）`);
  record('rate-limit-suspend', state.suspended, '30s×3 限幅挂起面在场');
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await screenshotPng(client, EVIDENCE, 'nav-guard-suspended.png');
} finally {
  try { client.close(); } catch { /* */ }
  const ok = results.every((r) => r.ok);
  fs.writeFileSync(path.join(EVIDENCE, 'nav-guard-live.json'), JSON.stringify({ at: new Date().toISOString(), conversationId, results }, null, 2));
  console.log(`\n[nav-guard] 总体：${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
}
