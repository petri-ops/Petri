#!/usr/bin/env node
'use strict';

/**
 * UI-330 / BLOCK-78 P3 实机 UI 视角验收（dev Electron + CDP）。
 *   S1 ssh(dell) 项目：卡片「项目运行摘要」渲染 + 「远程执行 · dell」 +
 *      「资源 · dell」节点真值 + 本机 R/Py 芯片不出现 + 指挥席本机兜底不出现
 *   S2 expanded「项目」节存在与否诚实记录（宽窗 expanded 断言数据集/会话行）
 *   S3 local 项目对照：后端运行状态芯片在、无「远程执行」、无「资源 · dell」
 *   S4 折叠：点击「收起摘要概览」→ 卡片消失
 * 前置：dev 栈（--remote-debugging-port=9222）载入 BLOCK-78 全部代码；
 *       至少一个 dell ssh 项目（REST 创建）与一个 local 项目。
 * 证据：acceptance/block-78/ui330-live.json + ui330-*.png
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-78');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout_30s')), 30_000)),
  ]);
  if (r.exceptionDetails) throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
  return r.result?.value;
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── 准备项目：dell ssh（新建）+ local（列表里找） ──
  const created = await fetchJson(`${API}/data/projects`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: `B78UI验收-${Date.now()}`, workspaceKind: 'ssh', sshHost: 'dell', remotePath: '/root/petri-block78-demo' }),
  });
  const sshProjectId = created.project && created.project.id;
  assert('P0 dell ssh project created', !!sshProjectId, JSON.stringify(created).slice(0, 120));

  const projects = await fetchJson(`${API}/data/projects`);
  const all = projects.projects || projects || [];
  const localProject = (Array.isArray(all) ? all : []).find((p) => (p.workspace_kind || p.workspaceKind || 'local') !== 'ssh');
  assert('P0 local project available', !!localProject, localProject && localProject.id);

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000/.test(t.url));
  if (!pages.length) throw new Error('no_page_target');
  let main = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({
      tree: document.querySelectorAll('[class*="projectTree"]').length
    })`).catch(() => null);
    c0.socket.close();
    if (probe && JSON.parse(probe).tree > 0) { main = p; break; }
  }
  main = main || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();

  async function openProjectAndCard(projectId) {
    await evalJS(client, `location.href = 'http://localhost:3000/project/${projectId}'`);
    for (let i = 0; i < 20; i++) {
      await delay(1000);
      const ready = await evalJS(client, `JSON.stringify({
        tree: document.querySelectorAll('[class*="projectTree"]').length > 0,
        url: location.pathname
      })`).catch(() => null);
      if (ready && JSON.parse(ready).tree && String(JSON.parse(ready).url).includes(projectId)) break;
    }
    // 展开摘要概览（默认收起）
    await evalJS(client, `(() => { const b = document.querySelector('button[aria-label="展开摘要概览"]'); if (b) b.click(); return !!b; })()`);
    for (let i = 0; i < 15; i++) {
      await delay(1000);
      const card = await evalJS(client, `!!document.querySelector('[aria-label="项目运行摘要"]')`).catch(() => false);
      if (card) break;
    }
    return evalJS(client, `JSON.stringify({
      card: !!document.querySelector('[aria-label="项目运行摘要"]'),
      remoteExec: document.body.textContent.includes('远程执行 · dell'),
      resourceRemote: document.body.textContent.includes('资源 · dell'),
      chips: !!document.querySelector('[aria-label="后端运行状态"]'),
      fallback: document.body.textContent.includes('指挥席本机'),
      pendingCost: document.body.textContent.includes('待接入'),
      projectInfoSection: !!document.querySelector('[aria-label="项目信息"]'),
      datasetRow: document.body.textContent.includes('数据集'),
      attention: !!document.querySelector('[aria-label="需要关注"]')
    })`);
  }

  // ── S1/S2 ssh 项目 ──
  const ssh = JSON.parse(await openProjectAndCard(sshProjectId));
  assert('S1 ssh: card renders', ssh.card, JSON.stringify(ssh).slice(0, 200));
  assert('S1 ssh: 远程执行 · dell', ssh.remoteExec);
  // 资源行等读数稳定：首击含 ensureAgent 部署（~2-3s），加载态显示兜底文案属正常过渡
  let resourceRemote = ssh.resourceRemote;
  let fallbackAfterSettle = ssh.fallback;
  for (let i = 0; i < 15 && !resourceRemote; i++) {
    await delay(1000);
    const s = JSON.parse(await evalJS(client, `JSON.stringify({
      remote: document.body.textContent.includes('资源 · dell'),
      fallback: document.body.textContent.includes('指挥席本机')
    })`).catch(() => '{}') || '{}');
    resourceRemote = !!s.remote;
    fallbackAfterSettle = !!s.fallback;
    if (s.remote) break;
  }
  assert('S1 ssh: 资源 · dell (节点真值)', resourceRemote, '等待远程快照 fetch 完成（含首击 agent 部署）');
  assert('S1 ssh: 本机 R/Py 芯片不出现', !ssh.chips);
  assert('S1 ssh: 指挥席本机兜底不出现（真值已接）', !fallbackAfterSettle);
  assert('S2 expanded: 项目信息节 + 数据集行', ssh.projectInfoSection && ssh.datasetRow,
      `projectInfo=${ssh.projectInfoSection}`);
  await screenshot(client, 'ui330-ssh-card.png');

  // ── S3 local 对照 ──
  if (localProject) {
    const loc = JSON.parse(await openProjectAndCard(localProject.id));
    assert('S3 local: card renders', loc.card);
    assert('S3 local: 本机 R/Py 芯片出现', loc.chips);
    assert('S3 local: 无 远程执行 · dell', !loc.remoteExec);
    assert('S3 local: 无 资源 · dell', !loc.resourceRemote);
    await screenshot(client, 'ui330-local-card.png');
  }

  // ── S4 折叠：收起后卡片消失 ──
  await evalJS(client, `(() => { const b = document.querySelector('button[aria-label="收起摘要概览"]'); if (b) b.click(); return !!b; })()`);
  await delay(1200);
  const collapsed = await evalJS(client, `!document.querySelector('[aria-label="项目运行摘要"]')`);
  assert('S4 收起摘要概览 → 卡片消失', collapsed);

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui330-live.json'), JSON.stringify(results, null, 2));
  log(`allPass=${results.allPass}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
