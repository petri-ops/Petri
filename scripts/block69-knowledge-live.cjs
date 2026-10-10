#!/usr/bin/env node
'use strict';

/**
 * BLOCK-69 UI-318 知识空间实机 CDP 验收（dev Electron，migration 009 已应用）。
 *
 * plan §6 五场景全覆盖；DashScope key 缺位时（D7 设计内分支）：
 *   - 诚实失败/空态断言照常执行（不崩、不假启用、error 如实）
 *   - 依赖嵌入通道的完整命中断言记 blocked_on_dashscope_key，配置 key 后复跑本脚本即补齐
 *
 * 场景映射：
 *   S1 上传 txt/md → 状态流转（有 key: ready+块数；无 key: failed+embed 诚实 error）
 *   S2 启用后对话命中 / 关闭后不命中（有 key: 全链；无 key: 启用 409 诚实拒绝）
 *   S3 检索测试框 top-k 命中（有 key: 双通道命中；无 key: 诚实空态提示）
 *   S4 删除单事务两通道同灭 + 清空两步确认（UI 两步确认/删除全环境；通道断言有 key）
 *   S5 无 DashScope key → 诚实空态，不崩不假启用（全环境断言）
 *
 * 前置：dev Electron（--remote-debugging-port=9222）+ vite :3000 + backend :3001。
 * 证据：acceptance/block-69/ui318-live.json + ui318-*.png
 * 跑法（Node 24）：PATH 前置 fnm v24.20.0 后 node scripts/block69-knowledge-live.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const API = process.env.PETRI_API_BASE || 'http://localhost:3001/api';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-69');

function fetchJson(url, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts || {}, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (opts && opts.body) req.write(opts.body);
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

const SAMPLE_MD = [
  '# BRCA2 知识库验收样本',
  'BRCA2 参与同源重组修复，胚系突变显著提高胰腺癌与乳腺癌风险。',
  '',
  '## 队列说明',
  '本样本整理 TCGA 队列 BRCA2 携带者的临床特征，用于知识空间实机验收。',
].join('\n');

// S2 对话命中断言用唯一标记（任意模型无法凭常识得知 42.7 与该标记的绑定）
const MARKER_DOC_MD = [
  '# 知识空间实机验收标记文档',
  '知识点标记 ZEBRA-7Q：本条为知识空间实机验收植入的唯一标记，对应数值 42.7。',
].join('\n');
const MARKER_QUESTION = '请查阅知识空间：标记 ZEBRA-7Q 对应的数值是多少？只依据知识空间检索结果回答，并给出数值。';

function postBody(url, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('agent_sse_timeout')));
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

async function agentReply(userText) {
  const raw = await postBody(`${API}/ai/agent?legacy=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: userText }] }),
  });
  let text = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const j = JSON.parse(payload);
      const delta = j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content || '';
      if (delta) text += delta;
    } catch {}
  }
  return text;
}

async function pollDocReady(name, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const docs = await fetchJson(`${API}/knowledge/documents`);
    const doc = (docs.body.documents || []).find((d) => d.name === name);
    if (doc && (doc.status === 'ready' || doc.status === 'failed')) return doc;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`poll_doc_timeout: ${name}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = {
    startedAt: new Date().toISOString(),
    embeddingKeyConfigured: false,
    assertions: [],
    keyDependentAssertions: [],
  };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };
  const assertKeyDep = (name, pass, detail = '') => {
    results.keyDependentAssertions.push({ name, pass: !!pass, status: results.embeddingKeyConfigured ? 'verified' : 'blocked_on_dashscope_key', detail: String(detail).slice(0, 400) });
    log(`${results.embeddingKeyConfigured ? (pass ? 'PASS' : 'FAIL') : 'BLOCK'} ${name}`);
  };

  // ── 前置：主窗探测（projectTree + rightCol 判真主窗；多窗并存 visibilityState 不可靠）──
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.body);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000\/project\//.test(t.url));
  if (!pages.length) throw new Error('no_project_page_target');
  let main = null;
  let fallback = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({
      tree: document.querySelectorAll('[class*="projectTree"]').length,
      right: !!document.querySelector('[class*="rightCol"]'),
      composer: !!document.querySelector('textarea.sc-input'),
    })`).catch(() => null);
    c0.socket.close();
    if (!probe) continue;
    const s = JSON.parse(probe);
    if (s.tree > 0 && s.right) { main = p; break; }
    if (!fallback && s.composer) fallback = p;
  }
  main = main || fallback || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();
  await client.send('Page.reload');
  // 等应用可交互（重启后水合可能较慢）
  let interactive = false;
  for (let i = 0; i < 30; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (interactive) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive_after_reload');
  await new Promise((r) => setTimeout(r, 1500));

  // ── 前置：key 状态（S5 分支判定）。注意 /api/ai/settings 可能把 ai-settings 包在 settings 字段下 ──
  const settings = await fetchJson(`${API}/ai/settings`);
  const settingsBody = settings.body || {};
  const credStatus = settingsBody.credential_status || (settingsBody.settings && settingsBody.settings.credential_status) || {};
  results.embeddingKeyConfigured = !!credStatus.dashscope;
  log(`dashscope key configured = ${results.embeddingKeyConfigured}`);
  if (!results.embeddingKeyConfigured) {
    // 与知识空间端点交叉核对（两者同源 getAiSettings，不一致说明判定出错）
    const spaceProbe = await fetchJson(`${API}/knowledge/space`).then((r) => r.body);
    if (spaceProbe.embeddingAvailable) {
      throw new Error('key_detection_mismatch: /api/ai/settings 与 /api/knowledge/space 不一致');
    }
  }

  // 清场：确保初始空间关闭、文档清空（幂等可复跑）
  await fetchJson(`${API}/knowledge/space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  await fetchJson(`${API}/knowledge/space/clear`, { method: 'POST' });
  const space0 = await fetchJson(`${API}/knowledge/space`);
  assert('P0 前置：空间初始关闭且知识 REST 面可达', space0.body.status === 'ok' && space0.body.space && space0.body.space.enabled === false,
    JSON.stringify({ enabled: space0.body.space?.enabled, embeddingAvailable: space0.body.embeddingAvailable }));

  // ── S5：无 key 诚实空态（有 key 时此组自然通过：开关可点、无 notice）──
  const composer = JSON.parse(await evalJS(client, `JSON.stringify({
    brain: !!document.querySelector('[data-testid="knowledge-composer-toggle"]'),
    brainDisabled: document.querySelector('[data-testid="knowledge-composer-toggle"]')?.disabled ?? null,
    brainTitle: document.querySelector('[data-testid="knowledge-composer-toggle"]')?.getAttribute('title') || '',
  })`));
  if (!results.embeddingKeyConfigured) {
    assert('S5a 无 key：composer 大脑开关 disabled（不假启用）', composer.brain && composer.brainDisabled === true, JSON.stringify(composer));
    assert('S5b 无 key：开关 title 诚实说明需配置 DashScope key', /DashScope/.test(composer.brainTitle), composer.brainTitle);
  } else {
    assert('S5a 有 key：composer 大脑开关可用', composer.brain && composer.brainDisabled === false, JSON.stringify(composer));
  }

  // 打开右栏知识 tab：右侧栏收起时 tab rail/飞出按钮不渲染 → 先展开右侧栏，再经飞出菜单点「知识」
  let tabState = { ok: false };
  for (let attempt = 0; attempt < 3 && !tabState.ok; attempt++) {
    const openTab = await evalJS(client, `(async () => {
      const expandRight = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开右侧栏'));
      if (expandRight) { expandRight.click(); await new Promise((r) => setTimeout(r, 900)); }
      const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具') || (b.getAttribute('aria-label') || '').includes('展开更多工具'));
      if (more) { more.click(); await new Promise((r) => setTimeout(r, 600)); }
      const items = [...document.querySelectorAll('button, [role="menuitem"]')].filter((e) => e.textContent.trim() === '知识');
      const item = items.pop();
      if (!item) return JSON.stringify({ ok: false, reason: 'no_knowledge_item' });
      item.click();
      await new Promise((r) => setTimeout(r, 1200));
      return JSON.stringify({ ok: true, panel: !!document.querySelector('[data-testid="knowledge-panel"]') });
    })()`);
    tabState = JSON.parse(openTab);
    if (!tabState.ok) await new Promise((r) => setTimeout(r, 2000));
  }
  assert('S5c 右栏「知识」tab 可打开且 KnowledgeSpacePanel 渲染', tabState.ok && tabState.panel, JSON.stringify(tabState));

  const panelState = JSON.parse(await evalJS(client, `JSON.stringify({
    notice: document.querySelector('[data-testid="knowledge-embed-unavailable"]')?.textContent || '',
    toggle: !!document.querySelector('[data-testid="knowledge-toggle"]'),
    toggleDisabled: document.querySelector('[data-testid="knowledge-toggle"]')?.disabled ?? null,
    upload: !!document.querySelector('[data-testid="knowledge-upload"]'),
    searchInput: !!document.querySelector('[data-testid="knowledge-search-input"]'),
  })`));
  if (!results.embeddingKeyConfigured) {
    assert('S5d 无 key：面板诚实空态（DashScope notice + 开关禁用）',
      /DashScope/.test(panelState.notice) && panelState.toggleDisabled === true, JSON.stringify(panelState));
  }
  assert('S5e 面板核心控件齐备（上传/检索测试框）', panelState.upload && panelState.searchInput, JSON.stringify(panelState));

  // ── S2（无 key 分支）：启用请求被诚实拒绝（409），不假启用 ──
  const enableResp = await fetchJson(`${API}/knowledge/space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  if (!results.embeddingKeyConfigured) {
    assert('S2a 无 key：启用端点 409 诚实拒绝（D7）', enableResp.status === 409 && /DashScope|嵌入/.test(enableResp.body.error || ''),
      `status=${enableResp.status} error=${enableResp.body.error}`);
    const spaceAfterDeny = await fetchJson(`${API}/knowledge/space`);
    assert('S2b 无 key：空间保持未启用', spaceAfterDeny.body.space.enabled === false, JSON.stringify(spaceAfterDeny.body.space));
  } else {
    assert('S2a 有 key：启用成功', enableResp.status === 200 && enableResp.body.space.enabled === true, JSON.stringify(enableResp.body));
    const keyDepEnable = enableResp;
    void keyDepEnable;
  }

  // ── S1：上传 md → 状态流转 ──
  const uploadResult = JSON.parse(await evalJS(client, `(async () => {
    try {
      const content = ${JSON.stringify(SAMPLE_MD)};
      const form = new FormData();
      form.append('files', new File([content], 'brca2-acceptance.md', { type: 'text/markdown' }));
      const resp = await fetch(${JSON.stringify(API)} + '/knowledge/documents', { method: 'POST', body: form });
      return JSON.stringify({ status: resp.status, body: await resp.json() });
    } catch (e) { return JSON.stringify({ status: 0, error: String(e) }); }
  })()`));
  const up = uploadResult.body || {};
  assert('S1a 上传端点接受 md 并建档', uploadResult.status === 200 && (up.accepted || []).length === 1, JSON.stringify(uploadResult).slice(0, 300));

  // 轮询状态至终态（failed 或 ready）
  let finalDoc = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const docs = await fetchJson(`${API}/knowledge/documents`);
    finalDoc = (docs.body.documents || []).find((d) => d.name === 'brca2-acceptance.md');
    if (finalDoc && (finalDoc.status === 'ready' || finalDoc.status === 'failed')) break;
  }
  if (!finalDoc) throw new Error('upload_doc_not_found_after_poll');
  if (results.embeddingKeyConfigured) {
    assertKeyDep('S1b 上传 md → ready 且块数合理', finalDoc.status === 'ready' && finalDoc.chunkCount >= 1,
      JSON.stringify(finalDoc));
  } else {
    assert('S1b 无 key：文档诚实 failed 且 error 指向嵌入不可用（D7 不静默降级）',
      finalDoc.status === 'failed' && /嵌入|embed/i.test(finalDoc.error || ''), JSON.stringify(finalDoc));
  }

  // ── S3：检索测试框 ──
  const searchResp = await fetchJson(`${API}/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'BRCA2 胰腺癌' }),
  });
  if (results.embeddingKeyConfigured) {
    assertKeyDep('S3 检索测试框 top-k 命中合理（双通道）',
      searchResp.body.hits.length >= 1 && searchResp.body.hits[0].docName === 'brca2-acceptance.md',
      JSON.stringify(searchResp.body.hits));
  } else {
    assert('S3a 无 key：检索端点诚实空（无就绪块）', searchResp.status === 200 && searchResp.body.hits.length === 0 && searchResp.body.readyChunks === 0,
      JSON.stringify(searchResp.body));
  }

  // UI 检索框：无 key 场景发查询 → 诚实提示（不崩）
  const uiSearch = JSON.parse(await evalJS(client, `(async () => {
    try {
      const input = document.querySelector('[data-testid="knowledge-search-input"]');
      const btn = document.querySelector('[data-testid="knowledge-search-btn"]');
      if (!input || !btn) return JSON.stringify({ ok: false, reason: 'missing_controls' });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'BRCA2 胰腺癌');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      btn.click();
      await new Promise((r) => setTimeout(r, 2500));
      const note = document.querySelector('[class*="searchNote"]')?.textContent || '';
      const hits = document.querySelectorAll('[data-testid="knowledge-search-hits"] > div').length;
      return JSON.stringify({ ok: true, note, hits });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
  })()`));
  assert('S3b UI 检索测试框可交互且诚实呈现（不崩）', uiSearch.ok === true, JSON.stringify(uiSearch).slice(0, 300));

  // ── S2c/S2d：真实对话命中 / 关闭后不再命中（唯一标记词，模型无法凭常识得知）──
  if (results.embeddingKeyConfigured) {
    await evalJS(client, `(async () => {
      const form = new FormData();
      form.append('files', new File([${JSON.stringify(MARKER_DOC_MD)}], 'marker-doc.md', { type: 'text/markdown' }));
      await fetch(${JSON.stringify(API)} + '/knowledge/documents', { method: 'POST', body: form });
      return 'seeded';
    })()`);
    const markerDoc = await pollDocReady('marker-doc.md', 60000);
    if (markerDoc.status !== 'ready') throw new Error('marker_doc_not_ready: ' + JSON.stringify(markerDoc));

    const replyOn = await agentReply(MARKER_QUESTION);
    assert('S2c 启用后对话命中知识（回复含标记数值 42.7）', /42\.7/.test(replyOn),
      `reply=${replyOn.slice(0, 200)}`);

    await fetchJson(`${API}/knowledge/space`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });
    const replyOff = await agentReply(MARKER_QUESTION);
    assert('S2d 关闭开关后同问题不再命中（回复不含 42.7）', !/42\.7/.test(replyOff),
      `reply=${replyOff.slice(0, 200)}`);
  }

  await screenshot(client, 'ui318-live-panel.png');

  // ── S4：删除（单事务两通道同灭）+ 清空两步确认 ──
  if (results.embeddingKeyConfigured) {
    const docsNow = await fetchJson(`${API}/knowledge/documents`);
    let delOk = true;
    for (const d of docsNow.body.documents || []) {
      const delResp = await fetchJson(`${API}/knowledge/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      if (delResp.status !== 200) delOk = false;
    }
    assertKeyDep('S4a 删除文档成功（含标记文档）', delOk, `deleted=${(docsNow.body.documents || []).length}`);
    const searchAfterDel = await fetchJson(`${API}/knowledge/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'BRCA2 胰腺癌' }),
    });
    assertKeyDep('S4b 删除后两条检索通道均不再命中', searchAfterDel.body.hits.length === 0 && searchAfterDel.body.readyChunks === 0,
      JSON.stringify(searchAfterDel.body.readyChunks));
  } else {
    // 无 key：UI 删除入口存在且可执行（通道同灭断言需 key，复跑补齐）
    // 面板空闲态 10s 慢轮询——等 doc row 出现（≤15s）
    let rowSeen = false;
    for (let i = 0; i < 15; i++) {
      rowSeen = JSON.parse(await evalJS(client, `JSON.stringify({ rows: document.querySelectorAll('[data-testid="knowledge-doc-row"]').length })`)).rows > 0;
      if (rowSeen) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert('S4-pre 面板轮询出现已上传文档行（空闲慢刷 10s 生效）', rowSeen, 'waited up to 15s');
    const uiDelete = JSON.parse(await evalJS(client, `(async () => {
      try {
        const row = document.querySelector('[data-testid="knowledge-doc-row"]');
        if (!row) return JSON.stringify({ ok: false, reason: 'no_doc_row' });
        const del = [...row.querySelectorAll('button')].pop();
        del.click();
        await new Promise((r) => setTimeout(r, 2000));
        return JSON.stringify({ ok: true, rowsLeft: document.querySelectorAll('[data-testid="knowledge-doc-row"]').length });
      } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
    })()`));
    assert('S4a 无 key：UI 文档行删除可执行', uiDelete.ok === true, JSON.stringify(uiDelete));

    const delApi = await fetchJson(`${API}/knowledge/documents`, { method: 'GET' });
    assert('S4b 无 key：删除后文档清单一致（诚实）', (delApi.body.documents || []).every((d) => d.name !== 'brca2-acceptance.md'),
      JSON.stringify(delApi.body.documents));
  }

  // 清空两步确认（UI）：第一次点击 = 确认文案，第二次 = 执行
  // 需要 documents.length>0 才渲染清空按钮 → 先经 REST 重建一份 failed/ready 文档，
  // 并等面板轮询到它（空闲 10s 慢刷）
  await evalJS(client, `(async () => {
    const form = new FormData();
    form.append('files', new File(['验收清空样本'], 'clear-sample.txt', { type: 'text/plain' }));
    await fetch(${JSON.stringify(API)} + '/knowledge/documents', { method: 'POST', body: form });
    await new Promise((r) => setTimeout(r, 1500));
    return 'seeded';
  })()`);
  let clearBtnSeen = false;
  for (let i = 0; i < 15; i++) {
    clearBtnSeen = JSON.parse(await evalJS(client, `JSON.stringify({ b: !!document.querySelector('[data-testid="knowledge-clear"]') })`)).b;
    if (clearBtnSeen) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const clearTwoStep = JSON.parse(await evalJS(client, `(async () => {
    try {
      const btn = document.querySelector('[data-testid="knowledge-clear"]');
      if (!btn) return JSON.stringify({ ok: false, reason: 'no_clear_btn' });
      const rowsBefore = document.querySelectorAll('[data-testid="knowledge-doc-row"]').length;
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const confirmText = btn.textContent || '';
      if (!confirmText.includes('确认清空')) return JSON.stringify({ ok: false, reason: 'no_confirm_step', text: confirmText });
      btn.click();
      await new Promise((r) => setTimeout(r, 3500));
      const rowsAfter = document.querySelectorAll('[data-testid="knowledge-doc-row"]').length;
      return JSON.stringify({ ok: true, confirmText, rowsBefore, rowsAfter });
    } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); }
  })()`));
  assert('S4c 清空空间两步确认生效（先确认文案后执行清空）',
    clearTwoStep.ok === true && clearTwoStep.rowsBefore > 0 && clearTwoStep.rowsAfter === 0, JSON.stringify(clearTwoStep));

  await screenshot(client, 'ui318-live.png');

  results.blockedCount = results.keyDependentAssertions.filter((a) => a.status === 'blocked_on_dashscope_key').length;
  results.allPass = results.assertions.every((a) => a.pass)
    && results.keyDependentAssertions.every((a) => a.status === 'blocked_on_dashscope_key' || a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui318-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass} blocked=${results.blockedCount}`);
  client.socket.close();
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
