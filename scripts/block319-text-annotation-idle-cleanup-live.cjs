#!/usr/bin/env node
'use strict';
/**
 * scripts/block319-text-annotation-idle-cleanup-live.cjs — BLOCK-319 / UI-624 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block319-text-annotation-idle-cleanup-live.cjs
 * 证据：acceptance/block-317/live-text-annotation-idle-cleanup.json。
 *
 * 用户截图：文件预览顶部常驻「写下对这段文字的批注」输入框，没有选区时禁用、
 * 看起来毫无作用。清理后：
 * A 空闲（无批注/无待填）不渲染批注条：无输入框、无「加入上下文」、无占位文案；
 * B 有文本批注时恢复批注条（列表 + 加入上下文），仍无拖拽画框开关。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-317');
const RAW_TIMEOUT = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1000); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(400);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 180));
}

const READ_STATE = `(function(){
  var bar = document.querySelector('[data-testid="annotation-bar"]');
  var input = document.querySelector('[data-testid="annotation-comment-input"]');
  var add = document.querySelector('[data-testid="annotation-add-to-task"]');
  return JSON.stringify({
    bar: !!bar,
    barMode: bar ? bar.getAttribute('data-mode') : null,
    input: !!input,
    addToContext: !!add,
    addLabel: add ? add.textContent.trim() : null,
    toggle: !!document.querySelector('[data-testid="annotation-toggle"]'),
    placeholderInDom: document.body.textContent.indexOf('写下对这段文字的批注') >= 0,
    hasList: !!document.querySelector('[data-testid="annotation-list"]'),
  });
})()`;

async function openFilesPanel(client) {
  await evalRetry(client, `(function(){
    var more = document.querySelector('[aria-label="展开更多工具"]');
    if (more) more.click();
    return 'more';
  })()`);
  await sleep(300);
  await evalRetry(client, `(function(){
    var item = [...document.querySelectorAll('#titlebar-tool-menu button')].find(function(b){ return b.textContent.trim() === '文件'; });
    if (!item) item = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
    if (item) item.click();
    return item ? 'clicked' : 'no_item';
  })()`);
  await sleep(700);
}

async function openNoteFile(client) {
  const clicked = await evalRetry(client, `(function(){
    var candidates = [...document.querySelectorAll('button, [role="treeitem"], [role="button"], [class*="fileTreeLink"]')];
    var target = candidates.find(function(el){ return (el.textContent || '').trim() === 'notes.md'; });
    if (!target) {
      target = [...document.querySelectorAll('span')].find(function(el){ return (el.textContent || '').trim() === 'notes.md' && /fileTreeLink/.test(String(el.className)); });
    }
    if (target) { target.click(); return 'clicked'; }
    return 'not_found';
  })()`);
  if (clicked !== 'clicked') return clicked;
  await pagePoll(client, `!!document.querySelector('[data-testid="annotation-bar"]') || document.body.textContent.indexOf('notes.md') >= 0`, { label: 'file preview' });
  await sleep(700);
  return clicked;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 320) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 240)}`);
    return ok === true || ok === 'true';
  };

  const created = await rest('POST', '/data/projects', { name: 'BLOCK319-验收-' + Date.now(), modality: 'general' });
  const project = created.data && created.data.project;
  const projectId = project && project.id;
  const workspacePath = project && project.workspace_path;
  assert('P0_project_created', Boolean(projectId && workspacePath), `id=${projectId || 'none'}`);
  const notePath = path.join(workspacePath, 'notes.md');
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, '# 验收笔记\n\n第一行正文\n第二行正文\n', 'utf8');

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  const bootstrap = async () => {
    await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
    await pagePoll(client, `!!document.getElementById('root')`, { label: 'root' });
    await evalRetry(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
      if (btn) { btn.click(); return 'dismissed'; }
      return 'no_banner';
    })()`);
    await sleep(700);
    await openFilesPanel(client);
    const opened = await openNoteFile(client);
    assert('P1_note_opened', opened === 'clicked', `open=${opened}`);
  };

  await bootstrap();
  const idle = JSON.parse(await evalRetry(client, READ_STATE));
  assert('A0_idle_no_annotation_bar',
    idle.bar === false && idle.input === false && idle.addToContext === false && idle.placeholderInDom === false,
    JSON.stringify(idle));

  // 种一条文本批注 → 重新加载并打开同一文件 → 批注条恢复
  const seeded = await rest('POST', '/result-studio/annotations', {
    projectId,
    surface: 'workspace-file',
    filePath: 'notes.md',
    artifactName: 'notes.md',
    kind: 'text-selection',
    page: null,
    anchor: { kind: 'text-range', startLine: 3, endLine: 3, startColumn: null, endColumn: null, quote: '第一行正文', language: 'md' },
    comment: '这段需要复核',
    color: 'amber',
  });
  assert('B0_annotation_seeded', seeded.ok === true, `status=${seeded.status} body=${JSON.stringify(seeded.data).slice(0, 180)}`);

  await evalRetry(client, `location.reload(); 'reload'`);
  await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after reload' });
  await sleep(900);
  await openFilesPanel(client);
  const opened = await openNoteFile(client);
  assert('B1_note_reopened', opened === 'clicked', `open=${opened}`);
  await sleep(900);
  const annotated = JSON.parse(await evalRetry(client, READ_STATE));
  assert('B2_annotation_bar_restored',
    annotated.bar === true && annotated.barMode === 'text' && annotated.addToContext === true
      && annotated.addLabel === '加入上下文' && annotated.toggle === false,
    JSON.stringify(annotated));
  assert('B3_no_idle_input_confusion', annotated.input === false && annotated.placeholderInDom === false,
    `input=${annotated.input} placeholder=${annotated.placeholderInDom}`);

  let screenshot = 'not_attempted';
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 15000 });
    fs.writeFileSync(path.join(EVIDENCE, 'text-annotation-idle-cleanup.png'), Buffer.from(shot.data, 'base64'));
    screenshot = 'saved';
  } catch (e) {
    screenshot = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 100);
  }

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: '文件预览文本批注条（BLOCK-319/UI-624：空闲不渲染空输入条；有批注恢复列表+加入上下文）',
    idle, annotated,
    notes: { screenshot },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-text-annotation-idle-cleanup.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-319 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block319-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
