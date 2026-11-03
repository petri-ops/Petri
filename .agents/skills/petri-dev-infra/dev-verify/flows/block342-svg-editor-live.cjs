#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block342-svg-editor-live — BLOCK-342 W1 实机腿。
 *
 * 真实入口：当前项目工作区放一份临时 SVG（跑完即删）→ 主窗 `?file=` 深链打开
 * → 右栏缩略卡点「在编辑器打开」进整窗 modal（方案 A：编辑器不常驻 DOM）
 * → 编辑器挂载（画布/图层树/保存禁用=零改动）→ 真实指针点选 → 拖拽移动
 * → 保存写盘（文件 sha 变化 + transform 落地）→ 重新打开保存仍禁用且字节零 diff
 * → REST 反向腿：外部改动后拿旧 sha 提案必须 `svg_hash_mismatch`（人的修正不被覆盖）。
 *
 * 纪律：不设 PETRI_TEST_ONSCREEN；前置=后端 :3001 + vite :3000 + 测试实例 9223 离屏。
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK342_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-342');
const SAMPLE_DIR = 'tmp-block342-live';
const SAMPLE_REL = `${SAMPLE_DIR}/scene.svg`;
const SAMPLE_ABS = path.join(ROOT, SAMPLE_DIR, 'scene.svg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- BLOCK-342 live 样本：保留注释/缩进/自闭合，验证 span 引擎零操作零 diff -->
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
  <title>BLOCK-342</title>
  <g id="plot">
    <rect id="box" x="40" y="40" width="120" height="80" fill="#4a7cba" />
    <text id="caption" x="40" y="160" font-size="16">draft</text>
  </g>
</svg>
`;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 20_000, intervalMs = 250) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await lib.evalJs(client, expr, 5_000).catch(() => null);
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

const RAIL = '[class*="rightCol"]';

module.exports = {
  id: 'block342-svg-editor-live',
  description: 'BLOCK-342 W1+方案A：工作区 .svg 缩略卡→整窗 modal 编辑器——点选/拖拽/保存/零改动零 diff/272 列宽/冲突拒绝/关闭退场',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const projects = await rest('GET', '/data/projects');
    const list = projects.data?.projects || projects.data?.items || projects.data || [];
    const project = (Array.isArray(list) ? list : []).find((p) => p.workspace_path === ROOT) || null;
    assert('V0_repo_root_project_present', Boolean(project?.id), project ? `${project.id} ${project.name}` : 'no project whose workspace is repo root');
    if (!project) return false;

    let client = null;
    try {
      // 每轮先清空样本目录再写：留盘复用会带上上一轮的 save/篡改结果（实机抓真 flaky）
      fs.rmSync(path.join(ROOT, SAMPLE_DIR), { recursive: true, force: true });
      fs.mkdirSync(path.join(ROOT, SAMPLE_DIR), { recursive: true });
      fs.writeFileSync(SAMPLE_ABS, SVG);
      const baseSha = sha(fs.readFileSync(SAMPLE_ABS));

      const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 30_000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      assert('V1_spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
      if (!pages.length) return false;
      const main = await lib.selectPageTarget(pages, {
        probe: async (c) => lib.evalJs(c, `!!document.querySelector('${RAIL}')`, 5_000).catch(() => false),
      });
      client = await lib.connectTarget(main);

      const openFile = async (rel) => {
        // cache-buster：同一 URL 重复 assign 不会重载，会带着上一轮编辑器状态跑（实机抓真）
        await lib.evalJs(client, `location.assign('/project/${project.id}?file=${encodeURIComponent(rel)}&_t=${Date.now()}')`);
      };

      // V2 — 编辑器挂载：方案 A 入口=右栏缩略卡 → 点「在编辑器打开」→ 整窗 modal 承载
      await openFile(SAMPLE_REL);
      // V1b — 缩略卡形态：缩略图 + 入口按钮在场，且编辑器不常驻 DOM（防回退「右栏挤编辑器」）
      const thumb = await waitFor(client, `(function(){
        const card = document.querySelector('${RAIL} [data-testid="svg-editor-thumb-card"]');
        const btn = card && card.querySelector('[data-action="open-svg-editor"]');
        const img = card && card.querySelector('img');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        return card && btn && img && !canvas ? JSON.stringify({ thumb: true, btn: (btn.textContent || '').trim() }) : null;
      })()`);
      assert('V1b_thumb_entry_no_inline_editor', Boolean(thumb), thumb || 'thumb card missing or editor mounted without entry click');
      if (!thumb) return false;
      await lib.evalJs(client, `(function(){ const b = document.querySelector('${RAIL} [data-action="open-svg-editor"]'); if (b) b.click(); return true; })()`);
      const mounted = await waitFor(client, `(function(){
        const modal = document.querySelector('${RAIL} [data-testid="svg-editor-modal"]');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const layers = document.querySelector('${RAIL} [data-testid="svg-editor-layers"]');
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        return modal && canvas && layers && save ? JSON.stringify({ canvas: true, layers: layers.textContent.slice(0, 40), saveDisabled: save.disabled }) : null;
      })()`);
      assert('V2_editor_mounted', Boolean(mounted), mounted || 'svg-editor modal not mounted after entry click');
      if (!mounted) return false;
      const mountInfo = JSON.parse(mounted);
      assert('V2b_initial_save_disabled', mountInfo.saveDisabled === true, `saveDisabled=${mountInfo.saveDisabled}`);
      // 折叠默认态：色板/改动区默认收起（无 open），工具组默认展开
      const panels = await lib.evalJs(client, `(function(){
        const palette = document.querySelector('${RAIL} [data-testid="svg-editor-doc-palette"]');
        const changes = document.querySelector('${RAIL} [data-testid="svg-editor-changes"]');
        const group = document.querySelector('${RAIL} [data-testid="svg-editor-tool-group"]');
        const layers = document.querySelector('${RAIL} [data-testid="svg-editor-layers"]');
        const inspector = document.querySelector('${RAIL} [data-testid="svg-editor-inspector"]');

        return JSON.stringify({
          paletteOpen: palette ? palette.hasAttribute('open') : null,
          changesOpen: changes ? changes.hasAttribute('open') : null,
          toolGroupOpen: group ? group.dataset.open : null,
          layersOpen: layers ? layers.dataset.open : null,
          inspectorOpen: inspector ? inspector.dataset.open : null,
          toolButtons: document.querySelectorAll('[data-testid="svg-editor-tool-group"] button').length
        });
      })()`);
      const panelInfo = JSON.parse(panels);
      // 默认态契约跟随产品裁决演进：色板默认展开（2114afa8）；「未保存改动」区块已移除（5c172066，
      // svgProposal 契约保留，UI-663 按 pendingOps 方向重建时再更新本断言）
      assert('V2d_default_state',
        panelInfo.paletteOpen === true && panelInfo.changesOpen === null
          && panelInfo.toolGroupOpen === '1' && panelInfo.layersOpen === '0' && panelInfo.inspectorOpen === '0'
          && panelInfo.toolButtons >= 6,
        panels);

      // V3 — 真实点选：在画布里点 <rect> 中心 → 选中框出现 + 属性面板出现该元素
      const clicked = await lib.evalJs(client, `(function(){
        const host = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const rect = host && host.querySelector('svg #box');
        if (!rect) return JSON.stringify({ ok: false, reason: 'no #box' });
        const r = rect.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
        rect.dispatchEvent(new PointerEvent('pointerdown', opts));
        window.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        return JSON.stringify({ ok: true, x: Math.round(x), y: Math.round(y) });
      })()`);
      assert('V3_rect_dispatch_ok', JSON.parse(clicked).ok === true, clicked);

      const selected = await waitFor(client, `(function(){
        const overlays = document.querySelectorAll('${RAIL} [data-testid="svg-editor-selection"]').length;
        const props = document.querySelectorAll('${RAIL} [class*="propRow"]').length;
        return overlays > 0 && props > 0 ? JSON.stringify({ overlays, props }) : null;
      })()`);
      assert('V4_selection_visible', Boolean(selected), selected || 'no overlay/propRow after click');

      // V4b — 272 列宽（modal 内属性栏专项）：属性栏必须是 body 直接子层（独占 col2 固定 272px），
      // 嵌错进 leftCol 会被两列 grid 解释成 1fr（实测 644、与历史卡同 x）
      const insp = await lib.evalJs(client, `(function(){
        const aside = document.querySelector('${RAIL} [data-testid="svg-editor-inspector"]');
        if (!aside) return JSON.stringify({ ok: false, reason: 'no inspector after select' });
        const body = aside.parentElement;
        const r = aside.getBoundingClientRect();
        const cols = body ? getComputedStyle(body).gridTemplateColumns : '';
        return JSON.stringify({ ok: true, width: Math.round(r.width), left: Math.round(r.left), cols });
      })()`);
      const inspInfo = JSON.parse(insp);
      assert('V4b_inspector_col_272',
        inspInfo.ok === true && Math.abs(inspInfo.width - 272) <= 2
          && String(inspInfo.cols).split(' ').some((v) => Math.abs(parseFloat(v) - 272) <= 2),
        insp);

      // V5 — 真实拖拽：pointerdown → pointermove(+48/+24) → pointerup → 保存解锁
      const dragged = await lib.evalJs(client, `(function(){
        const host = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const rect = host && host.querySelector('svg #box');
        if (!rect) return JSON.stringify({ ok: false, reason: 'no #box' });
        const r = rect.getBoundingClientRect();
        const sx = r.left + r.width / 2;
        const sy = r.top + r.height / 2;
        const base = { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse', button: 0 };
        rect.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: sx, clientY: sy, buttons: 1 }));
        host.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: sx + 30, clientY: sy + 12, buttons: 1 }));
        host.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: sx + 48, clientY: sy + 24, buttons: 1 }));
        host.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: sx + 48, clientY: sy + 24, buttons: 0 }));
        return JSON.stringify({ ok: true, transform: rect.getAttribute('transform') });
      })()`);
      const dragInfo = JSON.parse(dragged);
      assert('V5_drag_applied_locally', dragInfo.ok === true && /translate\(/.test(dragInfo.transform || ''), JSON.stringify(dragInfo));

      const saveEnabled = await waitFor(client, `(function(){
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        return save && !save.disabled ? JSON.stringify({ enabled: true }) : null;
      })()`, 8_000);
      assert('V5b_save_unlocked_after_drag', Boolean(saveEnabled), saveEnabled || 'save still disabled');

      // V6 — 真实保存：写盘后 sha 变化 + transform 落地（局部性：其余字节不变）
      await lib.evalJs(client, `(function(){
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        if (save) save.click();
        return true;
      })()`);
      await sleep(1_500);
      const afterSave = fs.readFileSync(SAMPLE_ABS, 'utf8');
      const afterSha = sha(Buffer.from(afterSave, 'utf8'));
      assert('V6_file_written', afterSha !== baseSha, `base=${baseSha.slice(0, 12)} now=${afterSha.slice(0, 12)}`);
      assert('V6b_translate_persisted', /<rect[^>]*transform="translate\(48 24\)"/.test(afterSave), afterSave.match(/<rect[^>]*>/)?.[0] || 'no rect');
      assert('V6c_locality_preserved', afterSave.includes('<!-- BLOCK-342 live 样本') && afterSave.includes('<text id="caption"'), 'comment/text intact');

      // V7 — 重新打开：整页刷新后 modal 关闭（方案 A 形态回归）→ 再点入口进编辑器；零操作保存仍禁用
      await openFile(SAMPLE_REL);
      const reopenThumb = await waitFor(client, `(function(){
        const btn = document.querySelector('${RAIL} [data-action="open-svg-editor"]');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        return btn && !canvas ? 'thumb-ready' : null;
      })()`);
      assert('V7_reopen_thumb_entry', reopenThumb === 'thumb-ready', String(reopenThumb));
      await lib.evalJs(client, `(function(){ const b = document.querySelector('${RAIL} [data-action="open-svg-editor"]'); if (b) b.click(); return true; })()`);
      const reopened = await waitFor(client, `(function(){
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const modal = document.querySelector('${RAIL} [data-testid="svg-editor-modal"]');
        return save && canvas && modal ? JSON.stringify({ saveDisabled: save.disabled }) : null;
      })()`);
      assert('V7_reopen_save_disabled', Boolean(reopened) && JSON.parse(reopened).saveDisabled === true, reopened || 'not reopened');
      const beforeIdle = fs.readFileSync(SAMPLE_ABS);
      await lib.evalJs(client, `(function(){
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        if (save && !save.disabled) save.click();
        return true;
      })()`);
      await sleep(800);
      const afterIdle = fs.readFileSync(SAMPLE_ABS);
      assert('V7b_idle_resave_zero_diff', sha(beforeIdle) === sha(afterIdle), sha(beforeIdle) === sha(afterIdle) ? 'bytes identical' : 'bytes changed on idle resave');

      // V9 — W2 属性面板：改 fill → 落盘生效（人用鼠标键盘修正细节）
      await lib.evalJs(client, `(function(){
        const host = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const rect = host && host.querySelector('svg #box');
        const r = rect.getBoundingClientRect();
        const base = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 5, pointerType: 'mouse', button: 0 };
        rect.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
        host.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
        return true;
      })()`);
      const propsReady = await waitFor(client, `(function(){
        const input = document.querySelector('${RAIL} [data-attr="fill"]:not([type="color"])');
        return input ? 'ready' : null;
      })()`);
      assert('V9_props_panel_present', propsReady === 'ready', String(propsReady));
      const changed = await lib.evalJs(client, `(function(){
        const input = document.querySelector('${RAIL} [data-attr="fill"]:not([type="color"])');
        if (!input) return 'no input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '#cc0000');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ value: input.value });
      })()`);
      assert('V9b_fill_input_changed', JSON.parse(changed).value === '#cc0000', changed);
      // 即时渲染（用户抓真）：未保存时画布元素属性就应变
      const liveFill = await waitFor(client, `(function(){
        const el = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"] svg #box');
        return el && el.getAttribute('fill') === '#cc0000' ? 'live' : null;
      })()`, 6_000);
      assert('V9b2_fill_live_rendered', liveFill === 'live', String(liveFill));
      // 状态区分：未保存=实时预览态（dirty），且提示要 ⌘S 确认
      const dirtyStatus = await lib.evalJs(client, `(function(){
        const el = document.querySelector('${RAIL} [data-testid="svg-editor-status"]');
        return el ? JSON.stringify({ state: el.dataset.state, text: (el.textContent || '').slice(0, 40) }) : 'missing';
      })()`);
      const dirty = JSON.parse(dirtyStatus);
      assert('V9b3_status_dirty_preview', dirty.state === 'dirty' && /未保存/.test(dirty.text) && /确认/.test(dirty.text), dirtyStatus);
      await sleep(600);
      await lib.evalJs(client, `(function(){ const s = document.querySelector('${RAIL} [data-testid="svg-editor-save"]'); if (s && !s.disabled) s.click(); return true; })()`);
      await sleep(1_500);
      const afterFill = fs.readFileSync(SAMPLE_ABS, 'utf8');
      const savedStatus = await lib.evalJs(client, `(function(){
        const el = document.querySelector('${RAIL} [data-testid="svg-editor-status"]');
        return el ? JSON.stringify({ state: el.dataset.state, text: (el.textContent || '').slice(0, 30) }) : 'missing';
      })()`);
      const saved = JSON.parse(savedStatus);
      assert('V9d_status_saved_after_commit', saved.state === 'saved' && /已保存/.test(saved.text), savedStatus);
      assert('V9c_fill_persisted', /fill="#cc0000"/.test(afterFill), afterFill.match(/<rect[^>]*>/)?.[0] || 'no rect');

      // V10 — W2 文档色板：从文档提取到现有颜色色块
      const swatches = await lib.evalJs(client, `(function(){
        const chips = Array.from(document.querySelectorAll('${RAIL} [data-testid="svg-editor-doc-palette"] [data-color]')).map((el) => el.dataset.color);
        return JSON.stringify({ count: chips.length, has: chips.includes('#cc0000') || chips.includes('#4a7cba'), chips: chips.slice(0, 6) });
      })()`);
      const sw = JSON.parse(swatches);
      assert('V10_doc_palette_extracted', sw.count > 0 && sw.has === true, swatches);

      // V11 — W3 绘制：矩形工具拖拽 → 新元素 → 保存落盘
      await lib.evalJs(client, `(function(){ const b = document.querySelector('${RAIL} [data-tool="rect"]'); if (b) b.click(); return true; })()`);
      await sleep(300);
      // 绘制：工具切换 + 视口就绪存在时序竞争（离屏首帧），最多重试两次
      let drawSaveEnabled = null;
      for (let attempt = 0; attempt < 2 && !drawSaveEnabled; attempt += 1) {
        await lib.evalJs(client, `(function(){ const b = document.querySelector('${RAIL} [data-tool="rect"]'); if (b) b.click(); return true; })()`);
        await sleep(500);
        await lib.evalJs(client, `(function(){
          const host = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
          const svg = host && host.querySelector('svg');
          if (!svg) return false;
          const r = svg.getBoundingClientRect();
          if (r.width < 10) return false;
          const base = { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'mouse', button: 0 };
          host.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: r.left + 60, clientY: r.top + 60, buttons: 1 }));
          host.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: r.left + 140, clientY: r.top + 120, buttons: 1 }));
          host.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: r.left + 140, clientY: r.top + 120, buttons: 0 }));
          return true;
        })()`);
        drawSaveEnabled = await waitFor(client, `(function(){
          const s = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
          return s && !s.disabled ? 'unlocked' : null;
        })()`, 4_000);
      }
      assert('V11_draw_pending_op', drawSaveEnabled === 'unlocked', String(drawSaveEnabled));
      await sleep(400);
      await lib.evalJs(client, `(function(){ const s = document.querySelector('${RAIL} [data-testid="svg-editor-save"]'); if (s && !s.disabled) s.click(); return true; })()`);
      await sleep(1_500);
      const afterDraw = fs.readFileSync(SAMPLE_ABS, 'utf8');
      const rectCount = (afterDraw.match(/<rect/g) || []).length;
      assert('V11b_draw_persisted', rectCount === 2, `rect count=${rectCount}`);

      // V12 — W4 选区 → 会话上下文（单一 copilotAsk 通道，不建第二注入面）
      // 用图层树选中 #box（比画布指针更稳：绘制后布局有变化）
      const layerPick = await lib.evalJs(client, `(function(){
        const btn = Array.from(document.querySelectorAll('${RAIL} [data-testid="svg-editor-layers"] button')).find((b) => (b.textContent || '').includes('#box'));
        if (!btn) return 'no layer';
        btn.click();
        return 'picked';
      })()`);
      assert('V12_pre_select', layerPick === 'picked', String(layerPick));
      await waitFor(client, `(function(){ return document.querySelector('${RAIL} [data-action="ask-agent"]') ? 'ready' : null; })()`, 6_000);
      const asked = await lib.evalJs(client, `(function(){
        window.__block342Asked = null;
        if (!window.__block342Listener) {
          window.__block342Listener = (event) => { window.__block342Asked = event.detail; };
          window.addEventListener('petri:copilot-ask', window.__block342Listener);
        }
        const btn = document.querySelector('${RAIL} [data-action="ask-agent"]');
        if (!btn) return 'no button';
        btn.click();
        return 'clicked';
      })()`);
      assert('V12_ask_agent_clicked', asked === 'clicked', String(asked));
      await sleep(600);
      const askedPayload = await lib.evalJs(client, `JSON.stringify(window.__block342Asked || null)`);
      const payload = JSON.parse(askedPayload);
      assert('V12b_context_prompt_has_path', Boolean(payload && typeof payload.prompt === 'string' && payload.prompt.includes(SAMPLE_REL)), askedPayload ? askedPayload.slice(0, 160) : 'null');

      // V8 — 冲突安全：外部改文件后拿旧 sha 提案必须 409 svg_hash_mismatch
      // 外部改动任一处即可（不依赖具体颜色：前面步骤已经改过 fill）
      const tampered = fs.readFileSync(SAMPLE_ABS, 'utf8').replace(/fill="[^"]*"/, 'fill="#111111"');
      fs.writeFileSync(SAMPLE_ABS, tampered);
      const stale = await rest('POST', '/svg/edit', {
        projectId: project.id,
        path: SAMPLE_REL,
        ops: [{ op: 'set_attr', target: { id: 'caption' }, name: 'fill', value: '#ff0000' }],
        apply: true,
        beforeSha256: sha(Buffer.from(afterDraw, 'utf8')),
      });
      const staleCode = typeof stale.data?.error === 'string' ? stale.data.error : stale.data?.error?.code;
      assert('V8_stale_apply_rejected', stale.status === 409 && staleCode === 'svg_hash_mismatch', `status=${stale.status} code=${staleCode} body=${JSON.stringify(stale.data).slice(0, 160)}`);

      await lib.screenshotPng(client, EVIDENCE_DIR, 'block342-svg-editor-live.png');

      // V13 — 关闭编辑器：modal 退场 + 缩略卡仍在（退出回「瞄一眼」形态，方案 A 出口可用）
      await lib.evalJs(client, `(function(){ const b = document.querySelector('${RAIL} [data-action="close-svg-editor"]'); if (b) b.click(); return true; })()`);
      const closed = await waitFor(client, `(function(){
        const modal = document.querySelector('${RAIL} [data-testid="svg-editor-modal"]');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const card = document.querySelector('${RAIL} [data-testid="svg-editor-thumb-card"]');
        return !modal && !canvas && card ? 'closed' : null;
      })()`, 8_000);
      assert('V13_close_returns_to_thumb', closed === 'closed', String(closed));
      return true;
    } finally {
      if (client) {
        try { client.socket.close(); } catch { /* already closed */ }
      }
      // 不在此清理样本目录：连续两次运行会互删（实机抓真 ENOENT 竞态）。
      // 样本留盘供手工复现，目录已登记 impact-map 忽略规则。
    }
  },
};
