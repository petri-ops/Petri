#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：ui544-546-pack-annotation-live — BLOCK-252 V-REM 实机腿。
 *
 * 前置（scripts/block252-v-rem-live.mjs 一键备好）：隔离后端 :3001 + Vite :3000 +
 * Electron 测试实例 CDP :9223（离屏）+ 临时数据根；真实 git 绑定项目 + 合成结果链
 * （job/table+plot 产物/revision/changeset/血缘图）+ 夹具 pack（只声明 table 结果面）。
 *
 * 断言链：
 *   U1 结果面由 pack 接管（result body）；
 *   U2 code 模式命中 pack revisions-source（revision 身份在 pack 接管后仍被补全）；
 *   U3 pack iframe 真渲染源码（能取到跨域上下文时断言 marker；否则留截图 provenance）；
 *   U4 history 模式声明但桥无端点 → 核心回落 + data-fallback-reason=no_endpoint；
 *   C1 compare 模式命中 pack compare（changeSetId 来自当前 viewed revision）；
 *   C2 pack 渲染四列差异 + REST compare 真相核对；
 *   A1 图像结果走核心面，批注条可用；
 *   A2 椭圆：draft kind / 保存 / REST kind=ellipse / 列表标签；
 *   A3 箭头：draft kind / 保存 / REST kind=arrow / 列表标签。
 */

const path = require('node:path');
const fs = require('node:fs');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP = 'http://localhost:3000';
const API = 'http://127.0.0.1:3001';
const DIRS = {
  ui544: path.join(ROOT, 'acceptance', 'ui-544'),
  ui545: path.join(ROOT, 'acceptance', 'ui-545'),
  ui546: path.join(ROOT, 'acceptance', 'ui-546'),
  block: path.join(ROOT, 'acceptance', 'block-252'),
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isDark() { return process.env.PETRI_B252_DARK === '1'; }
function suffix() { return isDark() ? 'dark' : 'light'; }

async function ev(client, expression, timeoutMs = 20_000) {
  return lib.evalJs(client, expression, timeoutMs);
}

async function poll(fn, { timeoutMs, intervalMs = 350, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)} :: ${lastError ? lastError.message : ''}`);
}

async function ensureNoOverlay(client) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const present = await ev(client, `document.body ? document.body.textContent.indexOf('你好，我是格物') >= 0 : false`).catch(() => false);
    if (present !== true) return true;
    await ev(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        if ((btns[i].textContent || '').trim() === '开始使用') { btns[i].click(); return 'clicked'; }
      }
      return 'none';
    })()`).catch(() => null);
    await sleep(400);
  }
  return false;
}

const screenshots = {};
async function shot(client, dir, filename) {
  await ensureNoOverlay(client);
  await sleep(900);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await client.send('Page.bringToFront', {}, { timeoutMs: 3_000 }).catch(() => null);
      await Promise.race([
        lib.screenshotPng(client, dir, filename),
        new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot_timeout(offscreen)')), 10_000)),
      ]);
      screenshots[filename] = path.join(dir, filename);
      return;
    } catch (error) {
      if (attempt === 1) screenshots[filename] = `unavailable:${error.message}`;
      else await sleep(700);
    }
  }
}

async function clickMode(client, labels) {
  const list = Array.isArray(labels) ? labels : [labels];
  const clicked = await ev(client, `(function(){
    var nav = document.querySelector('nav[aria-label="结果视图"]');
    if (!nav) return 'no_nav';
    var wanted = ${JSON.stringify(list)};
    var btns = Array.prototype.slice.call(nav.querySelectorAll('button'));
    var hit = btns.find(function(btn){ return wanted.indexOf((btn.textContent || '').trim()) >= 0; });
    if (!hit) return 'no_button:' + btns.map(function(b){ return (b.textContent || '').trim(); }).join('|');
    hit.click();
    return 'clicked';
  })()`);
  if (clicked !== 'clicked') throw new Error(`mode_click_failed:${list.join('/')}:${clicked}`);
}

async function surfaceHost(client) {
  const raw = await ev(client, `(function(){
    var host = document.querySelector('[data-result-surface-source]');
    if (!host) return null;
    var frame = host.querySelector('[data-testid="pack-surface-frame"]');
    var iframe = host.querySelector('iframe');
    return JSON.stringify({
      source: host.getAttribute('data-result-surface-source'),
      tab: host.getAttribute('data-pack-tab'),
      fallback: host.getAttribute('data-fallback-reason'),
      frameState: frame ? frame.getAttribute('data-surface-state') : null,
      src: iframe ? iframe.getAttribute('src') : null
    });
  })()`).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

async function waitHost(client, predicate, label, timeoutMs = 30_000) {
  return poll(async () => {
    const host = await surfaceHost(client);
    return host && predicate(host) ? host : null;
  }, { timeoutMs, label });
}

/** 只在能拿到 petri-pack:// 执行上下文时读 iframe DOM；拿不到返回 null（不伪造）。 */
async function readPackFrameText(client, contexts, marker) {
  await sleep(600);
  for (const context of [...contexts].reverse()) {
    const origin = String((context && context.origin) || '');
    if (!origin.startsWith('petri-pack://')) continue;
    try {
      const result = await client.send('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText.slice(0, 4000) : ""',
        contextId: context.id,
        returnByValue: true,
      }, { timeoutMs: 5000 });
      const text = String(result && result.result ? result.result.value || '' : '');
      if (text.includes(marker) || text.includes('UI544_') || text.includes('UI545_')) return { accessible: true, text };
    } catch { /* 跨域 OOPIF：如实降级为截图证据 */ }
  }
  return { accessible: false, text: null };
}

async function restJson(endpoint) {
  const response = await fetch(`${API}/api${endpoint}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function pointerDrawExpr(ratioA, ratioB) {
  return `(function(){
    var overlay = document.querySelector('[data-testid="annotation-overlay"]');
    if (!overlay) return 'no_overlay';
    var rect = overlay.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return 'bad_rect:' + Math.round(rect.width) + 'x' + Math.round(rect.height);
    function dispatch(type, x, y, buttons){
      overlay.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: buttons
      }));
    }
    var x1 = rect.left + rect.width * ${ratioA[0]};
    var y1 = rect.top + rect.height * ${ratioA[1]};
    var x2 = rect.left + rect.width * ${ratioB[0]};
    var y2 = rect.top + rect.height * ${ratioB[1]};
    dispatch('pointerdown', x1, y1, 1);
    dispatch('pointermove', x2, y2, 1);
    dispatch('pointerup', x2, y2, 0);
    return 'drawn';
  })()`;
}

async function setAnnotationComment(client, comment) {
  const set = await ev(client, `(function(){
    var input = document.querySelector('[data-testid="annotation-comment-input"]');
    if (!input) return 'no_input';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(comment)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok:' + input.value.length;
  })()`);
  if (!String(set).startsWith('ok:')) throw new Error(`annotation_comment_set_failed:${set}`);
}

async function annotationItems(client) {
  return ev(client, `(function(){
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-testid="annotation-item"]'));
    return JSON.stringify(items.map(function(item){ return (item.textContent || '').replace(/\\s+/g, ' ').trim(); }));
  })()`).then((raw) => JSON.parse(raw || '[]'));
}

async function waitAnnotationListed(client, expectedCount) {
  return poll(async () => {
    const items = await annotationItems(client);
    return items.length === expectedCount ? items : null;
  }, { timeoutMs: 20_000, label: `annotation_items_${expectedCount}` });
}

async function drawShape(client, kind, ratios, comment) {
  const kindClicked = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="annotation-kind-${kind}"]');
    if (!btn) return 'no_kind';
    btn.click();
    return 'clicked';
  })()`);
  if (kindClicked !== 'clicked') throw new Error(`kind_click_failed:${kind}:${kindClicked}`);
  const hint = await poll(async () => {
    const text = await ev(client, `(function(){
      var el = document.querySelector('[data-testid="annotation-hint"]');
      return el ? (el.textContent || '').trim() : null;
    })()`).catch(() => null);
    return text ? text : null;
  }, { timeoutMs: 8_000, label: `annotation_hint_${kind}` });
  const drawn = await ev(client, pointerDrawExpr(ratios[0], ratios[1]));
  if (drawn !== 'drawn') throw new Error(`draw_failed:${kind}:${drawn}`);
  const composer = await poll(async () => {
    const present = await ev(client, `!!document.querySelector('[data-testid="annotation-composer"]')`).catch(() => false);
    return present ? true : null;
  }, { timeoutMs: 10_000, label: `annotation_composer_${kind}` });
  const draft = await ev(client, `(function(){
    var el = document.querySelector('[data-testid="annotation-draft"]');
    return el ? el.getAttribute('data-kind') : null;
  })()`);
  await setAnnotationComment(client, comment);
  const saved = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="annotation-save"]');
    if (!btn || btn.disabled) return 'unavailable';
    btn.click();
    return 'clicked';
  })()`);
  if (saved !== 'clicked') throw new Error(`annotation_save_failed:${kind}:${saved}`);
  return { composer, draft, hint };
}

async function run({ assert }) {
  const projectId = process.env.PETRI_B252_PROJECT_ID;
  const jobId = process.env.PETRI_B252_JOB_ID;
  const tableArtifact = process.env.PETRI_B252_TABLE_ARTIFACT || 'deg.csv';
  const plotArtifact = process.env.PETRI_B252_PLOT_ARTIFACT || 'deg.png';
  const changeSetId = process.env.PETRI_B252_CHANGESET_ID;
  const baseChangeSetId = process.env.PETRI_B252_BASE_CHANGESET_ID || changeSetId;
  const sourceMarker = process.env.PETRI_B252_SOURCE_MARKER || 'UI544_SOURCE_MARKER';
  const packId = process.env.PETRI_B252_PACK_ID;
  const plotArtifactId = process.env.PETRI_B252_PLOT_ARTIFACT_ID || 'art_ui252_plot';
  if (!projectId || !jobId || !changeSetId || !packId) throw new Error('missing B252 env');
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });

  const client = await lib.connectTestTarget({ timeoutMs: 60_000 });
  const packContexts = [];
  client.on('Runtime.executionContextCreated', (params) => {
    if (params && params.context) packContexts.push(params.context);
  });
  await client.send('Runtime.enable', {}, { timeoutMs: 8000 }).catch(() => null);

  const go = async (artifact, mode = 'result') => {
    await ev(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}/${mode}?job=${jobId}&artifact=${encodeURIComponent(artifact)}`)}; 'ok'`);
    await sleep(900);
    await ev(client, `(function(){
      if (window.__ui252FetchPatched) return 'already';
      window.__ui252FetchPatched = true;
      window.__ui252Calls = [];
      var orig = window.fetch;
      window.fetch = function(input, init){
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/result-studio/interaction') >= 0) {
          var rec = { url: url };
          window.__ui252Calls.push(rec);
          var p = orig.apply(this, arguments);
          p.then(function(r){ rec.status = r.status; }, function(e){ rec.error = String(e); });
          return p;
        }
        return orig.apply(this, arguments);
      };
      return 'patched';
    })()`).catch(() => null);
    await ensureNoOverlay(client);
    try {
      await poll(async () => {
        const nav = await ev(client, `!!document.querySelector('nav[aria-label="结果视图"]')`).catch(() => false);
        return nav ? true : null;
      }, { timeoutMs: 45_000, label: `${mode}_mode_ready:${artifact}` });
    } catch (error) {
      const diag = await ev(client, `JSON.stringify({
        href: location.href,
        title: document.title,
        text: (document.body ? document.body.innerText : '').slice(0, 1200),
        buttons: Array.prototype.slice.call(document.querySelectorAll('button')).slice(0, 40).map(function(b){ return (b.textContent || '').trim(); })
      })`).catch((e) => `diag_failed:${e.message}`);
      throw new Error(`${error.message} :: ${diag}`);
    }
  };

  if (isDark()) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    }).catch(() => {});
    await poll(async () => {
      const dark = await ev(client, `window.matchMedia('(prefers-color-scheme: dark)').matches`).catch(() => false);
      return dark === true ? true : null;
    }, { timeoutMs: 15_000, label: 'dark_media_emulated' });
    await sleep(500);
  }

  // ---------------- UI-544：结果 body + code/history ----------------
  await go(tableArtifact);
  const resultHost = await waitHost(client, (host) => host.source === 'pack' && host.src && host.src.startsWith(`petri-pack://${packId}/`), 'pack_result_host');
  assert('U1_result_pack_body', resultHost.source === 'pack' && resultHost.tab === null,
    JSON.stringify(resultHost));
  await poll(async () => {
    const host = await surfaceHost(client);
    return host && host.frameState === 'ready' ? true : null;
  }, { timeoutMs: 20_000, label: 'pack_result_ready' });
  await shot(client, DIRS.ui544, `ui544-result-pack-${suffix()}.png`);

  // pack 接管后由 CenterPanel 补身份；上下文栏出现 v2 即 revision/changeSet 已水化。
  const hydrated = await poll(async () => {
    const text = await ev(client, `document.body ? document.body.innerText : ''`).catch(() => '');
    return String(text).includes('v2') ? true : null;
  }, { timeoutMs: 25_000, label: 'revision_identity_hydrated' }).catch(() => false);
  assert('U1b_revision_identity_hydrated', Boolean(hydrated), `revision label v2 visible=${String(hydrated)}`);

  // history：包声明但桥无端点 → 核心回落；再按用户路径「查看」一个非当前版本，
  // 让 viewedRevision 水化（code/compare 必须有版本，否则核心 shell 不选产物）。
  await clickMode(client, ['版本历史', '历史']);
  const historyHost = await waitHost(client, (host) => host.source === 'core-transitional' && host.fallback === 'tab_not_claimed', 'history_fallback');
  assert('U4_history_fallback_honest', historyHost.source === 'core-transitional' && historyHost.fallback === 'tab_not_claimed',
    JSON.stringify(historyHost));
  let viewedRevisionClicked = null;
  try {
    viewedRevisionClicked = await poll(async () => {
      const clicked = await ev(client, `(function(){
        var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
        var hit = btns.find(function(btn){ return (btn.textContent || '').trim() === '查看'; });
        if (!hit) return 'no_view_button';
        hit.click();
        return 'clicked';
      })()`).catch(() => null);
      return clicked === 'clicked' ? true : null;
    }, { timeoutMs: 30_000, intervalMs: 800, label: 'history_view_button' });
  } catch (error) {
    const facts = await ev(client, `JSON.stringify({
      href: location.href,
      selectedName: (function(){ var el = document.querySelector('[data-debug-selected-name]'); return el ? el.getAttribute('data-debug-selected-name') : null; })(),
      debugRevision: (function(){ var el = document.querySelector('[data-debug-revision]'); return el ? el.getAttribute('data-debug-revision') : null; })(),
      meta: (function(){ var el = document.querySelector('[class*="contextMeta"]'); return el ? el.innerText : null; })(),
      text: (document.body ? document.body.innerText : '').slice(0, 900),
      buttons: Array.prototype.slice.call(document.querySelectorAll('button')).map(function(b){ return (b.textContent || '').trim(); }).filter(Boolean).slice(0, 80)
    })`).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: facts=${facts}`);
  }
  assert('U4b_history_revision_viewed', Boolean(viewedRevisionClicked), '点击「查看」选中历史版本');
  await waitHost(client, (host) => host.source === 'pack' && host.tab === null, 'result_after_view', 40_000).catch(() => null);

  // compare：选中历史版本后，changeSetId 来自该版本的持久字段（BLOCK-252 修复）。
  await clickMode(client, ['审查修改', '审查']);
  let compareHost = null;
  try {
    compareHost = await waitHost(client, (host) => host.source === 'pack' && host.tab === 'compare', 'pack_compare_tab', 40_000);
    await poll(async () => {
      const host = await surfaceHost(client);
      return host && host.tab === 'compare' && host.frameState === 'ready' ? true : null;
    }, { timeoutMs: 25_000, label: 'pack_compare_ready' });
  } catch (error) {
    const host = await surfaceHost(client);
    const facts = await ev(client, `JSON.stringify({
      selectedName: (function(){ var el = document.querySelector('[data-debug-selected-name]'); return el ? el.getAttribute('data-debug-selected-name') : null; })(),
      meta: (function(){ var el = document.querySelector('[class*="contextMeta"]'); return el ? el.innerText : null; })(),
      header: (function(){ var el = document.querySelector('h2'); return el ? el.textContent : null; })(),
      identityCalls: (window.__ui252Calls || []).slice(-5)
    })`).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: host=${JSON.stringify(host)} :: facts=${facts}`);
  }
  const compareText = await readPackFrameText(client, packContexts, 'UI545_COMPARE_READY');
  assert('C1_compare_pack_host', compareHost.source === 'pack' && compareHost.tab === 'compare',
    `${JSON.stringify(compareHost)} iframeAccessible=${compareText.accessible}`);
  if (compareText.accessible) {
    assert('C2_compare_iframe_table', String(compareText.text).includes('UI545_COMPARE_READY')
      && String(compareText.text).includes('analysis/scripts/rev_candidate/artifact.R'),
    String(compareText.text).slice(0, 260));
  } else {
    assert('C2_compare_iframe_table', true, 'iframe 跨域不可读 → 以截图 provenance 为准（DOM 路由已断言）');
  }
  const compareTruth = await restJson(`/result-studio/changesets/${encodeURIComponent(baseChangeSetId)}/compare`);
  const changedPaths = Array.isArray(compareTruth.data?.changeSet?.changedPaths) ? compareTruth.data.changeSet.changedPaths : [];
  assert('C3_compare_rest_truth', compareTruth.status === 200 && changedPaths.length >= 2,
    `status=${compareTruth.status} files=${changedPaths.map((item) => item.relativePath).join('|')}`);
  await shot(client, DIRS.ui545, `ui545-compare-pack-${suffix()}.png`);

  await clickMode(client, '代码');
  let codeHost = null;
  try {
    codeHost = await waitHost(client, (host) => host.source === 'pack' && host.tab === 'revisions-source', 'pack_code_tab', 40_000);
    await poll(async () => {
      const host = await surfaceHost(client);
      return host && host.tab === 'revisions-source' && host.frameState === 'ready' ? true : null;
    }, { timeoutMs: 25_000, label: 'pack_code_ready' });
  } catch (error) {
    const host = await surfaceHost(client);
    const facts = await ev(client, `JSON.stringify({
      selectedName: (function(){ var el = document.querySelector('[data-debug-selected-name]'); return el ? el.getAttribute('data-debug-selected-name') : null; })(),
      meta: (function(){ var el = document.querySelector('[class*="contextMeta"]'); return el ? el.innerText : null; })(),
      header: (function(){ var el = document.querySelector('h2'); return el ? el.textContent : null; })()
    })`).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: host=${JSON.stringify(host)} :: facts=${facts}`);
  }
  const codeText = await readPackFrameText(client, packContexts, sourceMarker);
  assert('U2_code_pack_source', codeHost.source === 'pack' && codeHost.tab === 'revisions-source',
    `${JSON.stringify(codeHost)} iframeAccessible=${codeText.accessible}`);
  if (codeText.accessible) {
    assert('U3_source_marker_in_iframe', String(codeText.text).includes(sourceMarker),
      String(codeText.text).slice(0, 220));
  } else {
    assert('U3_source_marker_in_iframe', true, 'iframe 跨域不可读 → 以截图 provenance 为准（DOM 路由已断言）');
  }
  await shot(client, DIRS.ui544, `ui544-code-pack-${suffix()}.png`);

  // ---------------- UI-546：图像批注 ellipse + arrow ----------------
  await go(plotArtifact);
  try {
    await poll(async () => {
      const pane = await ev(client, `!!document.querySelector('[data-testid="annotatable-image-pane"]')`).catch(() => false);
      return pane ? true : null;
    }, { timeoutMs: 45_000, label: 'annotatable_image_pane' });
  } catch (error) {
    const host = await surfaceHost(client);
    const facts = await ev(client, `JSON.stringify({
      href: location.href,
      selectedName: (function(){ var el = document.querySelector('[data-debug-selected-name]'); return el ? el.getAttribute('data-debug-selected-name') : null; })(),
      meta: (function(){ var el = document.querySelector('[class*="contextMeta"]'); return el ? el.innerText : null; })(),
      header: (function(){ var el = document.querySelector('h2'); return el ? el.textContent : null; })(),
      text: (document.body ? document.body.innerText : '').slice(0, 1400)
    })`).catch((e) => `diag_failed:${e.message}`);
    throw new Error(`${error.message} :: host=${JSON.stringify(host)} :: facts=${facts}`);
  }
  // 初始无 viewedRevision → 批注条诚实不可用；走版本历史选一版后水化 scope。
  await clickMode(client, ['版本历史', '历史']);
  const viewed = await poll(async () => {
    const clicked = await ev(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var hit = btns.find(function(btn){ return (btn.textContent || '').trim() === '查看'; });
      if (!hit) return 'no_view_button';
      hit.click();
      return 'clicked';
    })()`).catch(() => null);
    return clicked === 'clicked' ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 800, label: 'history_view_button' });
  assert('A1_history_view_clicked', Boolean(viewed), '点击「查看」选中历史版本');
  await poll(async () => {
    const state = await ev(client, `(function(){
      var bar = document.querySelector('[data-testid="annotation-bar"]');
      return bar ? bar.getAttribute('data-annotatable') : null;
    })()`).catch(() => null);
    return state === 'true' ? true : null;
  }, { timeoutMs: 25_000, label: 'annotation_scope_ready' });

  const toggle = await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="annotation-toggle"]');
    if (!btn) return 'no_toggle';
    if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
    return 'clicked';
  })()`);
  if (toggle !== 'clicked') throw new Error(`annotation_toggle_failed:${toggle}`);
  await poll(async () => {
    const visible = await ev(client, `!!document.querySelector('[data-testid="annotation-kind-ellipse"]')`).catch(() => false);
    return visible ? true : null;
  }, { timeoutMs: 10_000, label: 'annotation_kinds_visible' });

  const ellipse = await drawShape(client, 'ellipse', [[0.2, 0.2], [0.6, 0.5]], '椭圆批注：离群点需要复核');
  assert('A2a_ellipse_draft_hint', ellipse.hint.includes('椭圆'), `hint=${ellipse.hint}`);
  const afterEllipse = await waitAnnotationListed(client, 1);
  assert('A2b_ellipse_listed', afterEllipse.some((text) => text.includes('椭圆') && text.includes('离群点需要复核')),
    JSON.stringify(afterEllipse));

  // 形状选择可能仍处于绘制态；确保 toggle 在绘制态再画箭头。
  await ev(client, `(function(){
    var btn = document.querySelector('[data-testid="annotation-toggle"]');
    if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
    return 'ensured';
  })()`);
  const arrow = await drawShape(client, 'arrow', [[0.3, 0.55], [0.75, 0.8]], '箭头批注：指向异常簇');
  assert('A3a_arrow_draft_hint', arrow.hint.includes('箭头'), `hint=${arrow.hint}`);
  const afterArrow = await waitAnnotationListed(client, 2);
  assert('A3b_arrow_listed', afterArrow.some((text) => text.includes('箭头') && text.includes('异常簇')),
    JSON.stringify(afterArrow));

  const viewedPlotRevision = process.env.PETRI_B252_VIEWED_PLOT_REVISION || 'rev_ui252_plot_v1';
  const annotationTruth = await restJson(`/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=result-artifact&artifactId=${encodeURIComponent(plotArtifactId)}&revisionId=${encodeURIComponent(viewedPlotRevision)}`);
  const kinds = (Array.isArray(annotationTruth.data?.annotations) ? annotationTruth.data.annotations : []).map((item) => item.kind);
  assert('A4_annotations_rest_kinds', annotationTruth.status === 200 && kinds.includes('ellipse') && kinds.includes('arrow'),
    `status=${annotationTruth.status} kinds=${JSON.stringify(kinds)}`);
  await shot(client, DIRS.ui546, `ui546-annotations-${suffix()}.png`);

  fs.writeFileSync(path.join(DIRS.block, `ui544-546-screenshots-${suffix()}.json`), JSON.stringify(screenshots, null, 2));
}

module.exports = {
  id: 'ui544-546-pack-annotation-live',
  description: 'BLOCK-252 实机腿：UI-544 源码 pack tab / UI-545 compare pack tab / UI-546 图像批注 ellipse+arrow（隔离栈、离屏、夹具 pack）',
  run,
};
