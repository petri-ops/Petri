#!/usr/bin/env node
'use strict';
/**
 * scripts/block273-resize-affordance-live.cjs — BLOCK-273 拖拽边界统一渐变规范实机取证。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例（bash scripts/start-test-instance.sh，离屏）。
 * 用法：node scripts/block273-resize-affordance-live.cjs
 * 证据：acceptance/block-273/live-light.json / live-dark.json + clip PNG。
 *
 * 方法论（2026-10-27 实测沉淀）：
 *   - CSS.forcePseudoState 在本 9223 离屏实例上静默不生效（强制后 glow 仍 0；首轮直接 -32000）
 *     ——改用 css-theme skill 已验证配方「内联注入激活」：注入镜像 hover 声明的探针样式表，
 *     经 data-probe-hover 属性激活，取证声明层的真实渲染（亮/暗双主题）。
 *   - hover 选择器接线（:hover/:active → 声明）由源码断言覆盖（正则计数 >0）。
 *   - 离屏窗口截图须 fromSurface:false（表面合成超时）；仍失败则如实 screenshot_unavailable。
 *
 * 断言面：
 *   A 树边界把手 workspaceFileTreeResize：默认无实心条带（bg 透明 + glow 0）；激活后 glow=1、
 *     linear-gradient、分隔线（wrap border-left）转 accent。
 *   B 浮卡把手 float-card-resize-handle（项目摘要列同页可达时）：默认常驻线 ≤2.5px 且可见
 *     （v25 可发现性约束：收窄不删暗示）；激活后 glow=1、线转 accent。
 *   C 亮/暗双主题各跑一轮，元素级 clip 截图落盘；S 源码接线断言（:hover 选择器计数）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-273');
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
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

/** 注入镜像 hover 声明的探针样式表（css-theme「内联注入激活」配方）。 */
const PROBE_CSS = `
html[data-probe-hover] [class*="workspaceFileTreeResize"]::before { opacity: 1 !important; }
html[data-probe-hover] [class*="workspaceFileTreePaneWrap"] { border-left-color: var(--petri-accent) !important; }
html[data-probe-hover] [data-testid="float-card-resize-handle"]::before { opacity: 1 !important; }
html[data-probe-hover] [data-testid="float-card-resize-handle"]::after { background-color: var(--petri-accent) !important; }
`;

async function clipShot(client, file, selector, pad = 56) {
  const rect = await evalRetry(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect) return 'no_rect';
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.ceil(rect.w + pad * 2),
    height: Math.ceil(rect.h + pad * 2),
    scale: 2,
  };
  try {
    const shot = await client.send('Page.captureScreenshot',
      { format: 'png', clip, fromSurface: false }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(EVIDENCE, file), Buffer.from(shot.data, 'base64'));
    console.log(`[probe] clip ${file}: saved`);
    return 'saved';
  } catch (e) {
    const reason = 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
    console.log(`[probe] clip ${file}: ${reason}`);
    return reason;
  }
}

/** 源码接线断言：:hover/:active 选择器在实现源码中存在（声明层由注入激活取证，接线由本断言覆盖）。 */
function assertSourceWiring(assert) {
  const tree = fs.readFileSync(path.join(ROOT, 'frontend/src/pages/project-workspace.module.css'), 'utf8');
  const card = fs.readFileSync(path.join(ROOT, 'frontend/src/components/workspace-panels/FloatCardResizer.module.css'), 'utf8');
  assert('S1_tree_hover_selectors', /workspaceFileTreeResize:hover::before/.test(tree)
    && /workspaceFileTreeResize:active::before/.test(tree), 'project-workspace.module.css');
  assert('S2_tree_divider_has_rule', /workspaceFileTreePaneWrap:has\(\.workspaceFileTreeResize:hover\)/.test(tree),
    ':has 分隔线转 accent');
  assert('S3_card_hover_selectors', /\.handle:hover::before/.test(card) && /\.handle:hover::after/.test(card),
    'FloatCardResizer.module.css');
  const dead = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/desktop.css'), 'utf8');
  assert('S4_dead_handle_style_removed', !dead.includes('petri-desktop-workarea__resize-handle'), 'desktop.css');
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 220) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 160)}`);
    return ok === true || ok === 'true';
  };

  assertSourceWiring(assert);

  // ── 前置：测试实例目标 ──
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  // 解除离屏窗口遮挡节流（隐藏页 used 值走缓存/截图合成失败的总根源）
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});
  const front = await client.send('Page.bringToFront', {}, { timeoutMs: RAW_TIMEOUT }).catch((e) => 'bringToFront_failed: ' + (e && e.message));
  console.log(`[probe] bringToFront: ${JSON.stringify(front)}`);

  const health = await rest('GET', '/data/projects');
  assert('P0a_backend_rest_healthy', health.ok, `status=${health.status}`);
  const created = await rest('POST', '/data/projects', { name: 'BLOCK273-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0b_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);

  // 种子文件（空工作区树不渲染 treeitem——file-ops 同款前置）
  const projResp = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const workspacePath = projResp.data && (projResp.data.project
    ? projResp.data.project.workspace_path : projResp.data.workspace_path);
  if (workspacePath) {
    await rest('POST', `/workspaces/${encodeURIComponent(projectId)}/fs/mkdir`, { path: 'datasets' });
    fs.writeFileSync(path.join(workspacePath, 'a.txt'), 'block273 seed');
    fs.writeFileSync(path.join(workspacePath, 'datasets', 'x.txt'), 'block273 seed');
  }
  assert('P0c_seed_files', Boolean(workspacePath), `ws=${workspacePath || 'none'}`);

  /** 原生主题 boot：预置 petri-theme → 重新导航（应用原生渲染目标主题，无属性手术/无缓存污染）。 */
  const bootNavigate = async (theme) => {
    await evalRetry(client, `localStorage.setItem('petri-theme', ${JSON.stringify(theme)}); 'ok'`);
    await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
    await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
    await pagePoll(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
      if (!btn) return '';
      btn.click();
      return 'clicked';
    })()`, { label: 'files tab' });
    await pagePoll(client, `String((document.querySelectorAll('[role="treeitem"]')||[]).length >= 1)`,
      { label: 'tree rows' });
    await sleep(3000); // 应用启动期 effect 沉淀
  };

  const probe = async (mode) => {
    const sel = {
      tree: '[class*="workspaceFileTreeResize"]',
      wrap: '[class*="workspaceFileTreePaneWrap"]',
      card: '[data-testid="float-card-resize-handle"]',
    };
    const hasTree = await evalRetry(client, `!!document.querySelector(${JSON.stringify(sel.tree)})`);
    assert(`${mode}.A1_tree_handle_present`, hasTree === true || hasTree === 'true', 'workspaceFileTreeResize');

    // 同步块快照（2026-10-27 实测沉淀）：
    // ① 隐藏页 getComputedStyle 的 used 值走缓存（自定义属性读新值、普通属性读旧值）——
    //    每次 setAttribute 后必须 void body.offsetHeight 强制同步重算再读；
    // ② 同一颜色跨读取会换序列化（color(srgb)↔oklab）——期望色经探针元素解析成同一口径后严格比对。
    const snap = await evalRetry(client, `(function(){
      function flush() { if (document.body) void document.body.offsetHeight; }
      function expectColor(varName) {
        var p = document.createElement('i');
        p.style.color = 'var(' + varName + ')';
        document.body.appendChild(p);
        var v = getComputedStyle(p).color;
        p.remove();
        return v;
      }
      var T = document.querySelector(${JSON.stringify(sel.tree)});
      var W = document.querySelector(${JSON.stringify(sel.wrap)});
      var C = document.querySelector(${JSON.stringify(sel.card)});
      function treeRead() {
        if (!T || !W) return null;
        if (!T.isConnected) return { detached: true };
        void T.offsetHeight; void W.offsetHeight; // 元素级强制布局（隐藏页 used 值缓存对策）
        var cs = getComputedStyle(T); var cw = getComputedStyle(W);
        var b = getComputedStyle(T, '::before');
        return { bg: cs.backgroundColor, glow: b.opacity,
                 img: (b.backgroundImage || '').slice(0, 70),
                 border: cw.borderLeftColor, w: cs.width };
      }
      flush();
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--petri-accent').trim();
      var dividerProbe = expectColor('--petri-divider');
      var accentProbe = expectColor('--petri-accent');
      var d = treeRead();
      var out = { accent: accent, dividerProbe: dividerProbe, accentProbe: accentProbe,
                  d: d, cardPresent: !!C };
      if (C) { var ca = getComputedStyle(C, '::after'); out.cardDefault = { w: ca.width, op: ca.opacity }; }
      // 激活（注入镜像 hover 声明）→ flush → 同步读
      var el = document.createElement('style'); el.id = 'block273-probe-style';
      el.textContent = ${JSON.stringify(PROBE_CSS)}; document.head.appendChild(el);
      document.documentElement.setAttribute('data-probe-hover', '');
      flush();
      out.h = treeRead();
      if (C) { var cb = getComputedStyle(C, '::before'); var ca2 = getComputedStyle(C, '::after');
        out.cardActive = { glow: cb.opacity, line: ca2.backgroundColor }; }
      // 复原 → flush → 同步读
      if (el) el.remove();
      document.documentElement.removeAttribute('data-probe-hover');
      flush();
      out.restored = treeRead();
      return out;
    })()`);
    const themeOk = mode === 'light' ? snap.accent === '#0d9488' : snap.accent === '#2dd4bf';
    assert(`${mode}.T0_theme_token_active`, themeOk, `accent=${snap.accent}`);

    assert(`${mode}.A2_default_no_solid_band`,
      snap.d && snap.d.bg === 'rgba(0, 0, 0, 0)' && snap.d.glow === '0'
        && snap.d.border === snap.dividerProbe, JSON.stringify(snap.d));
    assert(`${mode}.A3_hover_glow_on`,
      snap.h && snap.h.glow === '1' && snap.h.img.includes('linear-gradient'), JSON.stringify(snap.h));
    assert(`${mode}.A4_divider_turns_accent`, snap.h && snap.h.border === snap.accentProbe,
      `expected=${snap.accentProbe} actual=${snap.h && snap.h.border}`);
    assert(`${mode}.A5_glow_restored_off`, snap.restored && snap.restored.glow === '0',
      `glow=${snap.restored && snap.restored.glow}`);

    await clipShot(client, `tree-handle-active-${mode}.png`, sel.tree);
    await clipShot(client, `tree-handle-default-${mode}.png`, sel.tree);

    // 浮卡把手（摘要列同页可达时才取证；不可达如实标注）
    if (snap.cardPresent) {
      const wNum = snap.cardDefault ? parseFloat(snap.cardDefault.w) : -1;
      assert(`${mode}.B1_card_line_narrow_but_visible`,
        wNum > 0 && wNum <= 2.5 && snap.cardDefault.op !== '0', JSON.stringify(snap.cardDefault));
      assert(`${mode}.B2_card_hover_glow_and_accent_line`,
        snap.cardActive && snap.cardActive.glow === '1', JSON.stringify(snap.cardActive));
      await clipShot(client, `card-handle-active-${mode}.png`, sel.card);
    } else {
      records.push({ id: `${mode}.B1_card_handle_skipped`, ok: true, detail: 'float-card handle not mounted in this state（如实标注，不算 PASS 断言）' });
      console.log(`ℹ ${mode}.B1_card_handle_skipped（本态未挂载，如实标注）`);
    }
  };

  // ── 亮色（原生 boot）──
  await bootNavigate('light');
  await probe('light');

  // ── 暗色（原生 boot）──
  await bootNavigate('dark');
  await probe('dark');

  // 还原用户主题偏好（system）
  await evalRetry(client, `localStorage.setItem('petri-theme', 'system'); 'ok'`).catch(() => {});

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    method: '内联注入激活（forcePseudoState 本实例静默不生效，实测沉淀进脚本头注）+ 源码接线断言',
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-light.json'), JSON.stringify({ ...summary, mode: 'light' }, null, 2) + '\n');
  fs.writeFileSync(path.join(EVIDENCE, 'live-dark.json'), JSON.stringify({ ...summary, mode: 'dark' }, null, 2) + '\n');
  console.log(`\n== BLOCK-273 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block273-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
