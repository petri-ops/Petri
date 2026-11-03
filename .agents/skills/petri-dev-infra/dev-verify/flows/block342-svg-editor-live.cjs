#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block342-svg-editor-live — BLOCK-342 W1 实机腿。
 *
 * 真实入口：当前项目工作区放一份临时 SVG（跑完即删）→ 主窗 `?file=` 深链打开
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
  description: 'BLOCK-342 W1：工作区 .svg 进受治理编辑器——点选/拖拽/保存/零改动零 diff/冲突拒绝',
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

      // V2 — 编辑器挂载：画布 + 图层树 + 保存禁用（零操作零 diff 的呈现）
      await openFile(SAMPLE_REL);
      const mounted = await waitFor(client, `(function(){
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        const layers = document.querySelector('${RAIL} [data-testid="svg-editor-layers"]');
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        return canvas && layers && save ? JSON.stringify({ canvas: true, layers: layers.textContent.slice(0, 40), saveDisabled: save.disabled }) : null;
      })()`);
      assert('V2_editor_mounted', Boolean(mounted), mounted || 'svg-editor not mounted');
      if (!mounted) return false;
      const mountInfo = JSON.parse(mounted);
      assert('V2b_initial_save_disabled', mountInfo.saveDisabled === true, `saveDisabled=${mountInfo.saveDisabled}`);
      assert('V2c_layers_rendered', /图层/.test(mountInfo.layers), mountInfo.layers);

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

      // V7 — 重新打开：零操作保存仍禁用；再点保存不得改字节（零改动零 diff）
      await openFile(SAMPLE_REL);
      const reopened = await waitFor(client, `(function(){
        const save = document.querySelector('${RAIL} [data-testid="svg-editor-save"]');
        const canvas = document.querySelector('${RAIL} [data-testid="svg-editor-canvas"]');
        return save && canvas ? JSON.stringify({ saveDisabled: save.disabled }) : null;
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
      await sleep(600);
      await lib.evalJs(client, `(function(){ const s = document.querySelector('${RAIL} [data-testid="svg-editor-save"]'); if (s && !s.disabled) s.click(); return true; })()`);
      await sleep(1_500);
      const afterFill = fs.readFileSync(SAMPLE_ABS, 'utf8');
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
      return true;
    } finally {
      if (client) {
        try { client.socket.close(); } catch { /* already closed */ }
      }
      try { fs.rmSync(path.join(ROOT, SAMPLE_DIR), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
};
