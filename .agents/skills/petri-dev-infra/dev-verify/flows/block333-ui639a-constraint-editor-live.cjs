#!/usr/bin/env node
'use strict';

/**
 * BLOCK-333 补腿批 — UI-639a 约束编辑器（SceneConstraintEditor）工作区实机腿。
 *
 * UI-639a 的历史状态是「组件 4/4 + 后端契约 4/4；**工作区实机腿待补**」。本腿补的就是那一条：
 * 从**真实用户入口**走完全程，而不是调 API——文件树打开 scene 文件 → 预览里点「在 3D 模型打开」
 * → 右栏 3D 工作面 → 约束 section 用下拉选节点/面 → 提交 → 场景文件真的被改写 → 再制造一次
 * 必然失败的求值 → 错误如实透传 → 移除约束 → 文件回到无约束。
 *
 * 三条判据（照 BLOCK-322 实机腿惯例）：
 * ①**写盘事实由磁盘复核**：约束是否真的进了 `scene.scene3d.json`，本腿直接读文件判，不看 UI 自述；
 * ②**fail-closed 可见**：不可解约束必须在 UI 上出现 `constraint-editor-error`，且**不得**把约束写进文件；
 * ③**可撤销**：移除约束后文件里 constraints 归零，UI 空态回归。
 *
 * 运行前提：主 dev 栈 + Electron 测试实例在跑（:3000 Vite / :9223 CDP）。证据落 acceptance/block-333/。
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = process.env.BLOCK333_APP || 'http://localhost:3000';
const API = process.env.BLOCK333_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-333');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint, body, { timeoutMs = 60_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function evalJs(client, expression, timeoutMs = 25_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)}`);
}

function box(id, width, height, depth, position, color) {
  return {
    id,
    type: 'box',
    dimensions: { width, height, depth },
    transform: { position, rotation: [0, 0, 0] },
    material: { color, roughness: 0.4 },
  };
}

function sceneOf(title) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [box('base', 120, 80, 40, [0, 0, 0], '#4c78a8'), box('tower', 60, 60, 60, [0, 90, 60], '#d29b42')],
    constraints: [],
    metadata: { title },
  };
}

/** 读场景文件（磁盘事实，不看 UI 自述）。 */
function readScene(workspacePath) {
  const file = path.join(workspacePath, 'scene.scene3d.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  id: 'block333-ui639a-constraint-editor-live',
  description: 'UI-639a 约束编辑器工作区实机腿：文件预览→3D 工作面→约束下拉提交→写盘→fail-closed→移除',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const detail = {};
    let projectId = null;
    let workspacePath = null;

    const targets = await lib.pollTargets({ port: Number(process.env.PETRI_CDP_PORT || 9223), timeoutMs: 60_000 });
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('U0_spa_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 160) || 'none');
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (c) => evalJs(c, `document.title.length > 0`),
      fallbackSelector: 'body',
    });
    const client = await lib.connectTarget(main);

    try {
      // —— 种子：临时项目 + 双 box 场景（box 自带 6 面特征表，编辑器才有可选项）——
      const created = await rest('POST', '/data/projects', { name: `BLOCK333-UI639A-${Date.now()}` });
      projectId = created.data?.project?.id || created.data?.id || null;
      workspacePath = created.data?.project?.workspace_path || created.data?.workspace_path || null;
      if (!workspacePath && projectId) {
        const listed = await rest('GET', '/data/projects');
        const rows = Array.isArray(listed.data?.projects) ? listed.data.projects : (Array.isArray(listed.data) ? listed.data : []);
        workspacePath = (rows.find((row) => row.id === projectId) || {}).workspace_path || null;
      }
      assert('U1_seed_project', created.status === 200 && Boolean(projectId) && Boolean(workspacePath), JSON.stringify({ projectId }));
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.writeFileSync(path.join(workspacePath, 'scene.scene3d.json'), `${JSON.stringify(sceneOf('BLOCK-333 UI-639a'), null, 2)}\n`);

      // —— U2：真实入口——工作区深链打开场景文件预览，出现「在 3D 模型打开」——
      await client.send('Page.navigate', { url: `${APP}/project/${projectId}?file=scene.scene3d.json` });
      const previewActions = await poll(async () => evalJs(client,
        `(() => { const el = document.querySelector('[data-testid="workspace-preview-3d-actions"]'); return el ? el.innerText.trim() : ''; })()`),
        { timeoutMs: 45_000, label: 'preview_3d_actions' });
      assert('U2_file_preview_offers_3d_open', /在 3D 模型打开/.test(previewActions), previewActions.slice(0, 80));

      // —— U3：点进右栏 3D 工作面（约束 section 需要 ≥2 个有特征表的节点）——
      await evalJs(client, `(() => { const b = document.querySelector('[data-testid="workspace-preview-3d-actions"] button'); if (b) b.click(); return !!b; })()`);
      // 注意：只等 form 出现——若把「surface 已出现」也当返回值，poll 会在 form 渲染前就返回（实测抓到）
      const surface = await poll(async () => evalJs(client,
        `(() => { const s = document.querySelector('[data-testid="model3d-surface"]'); const f = document.querySelector('[data-testid="constraint-editor-form"]'); return s && f ? 'form' : ''; })()`),
        { timeoutMs: 60_000, label: 'constraint_editor_form' }).catch((error) => error.message);
      assert('U3_surface_and_editor_visible', surface === 'form', String(surface).slice(0, 120));

      // 下拉结构：节点 A / 面 A / 节点 B / 面 B
      const shape = await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const sels = [...form.querySelectorAll('select')];
        return { count: sels.length, options: sels.map((s) => [...s.options].map((o) => o.value).slice(0, 8)) };
      })()`);
      detail.editor = shape;
      assert('U4_editor_has_two_node_two_face_selects', shape.count === 4 && shape.options.every((o) => o.length > 0),
        JSON.stringify(shape).slice(0, 220));

      // —— U5：先选节点（面下拉随节点重建），A=base / B=tower ——
      const pickNodes = await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const setSelect = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const sels = [...form.querySelectorAll('select')];
        const nodes = [...sels[0].options].map((o) => o.value);
        if (nodes.length < 2) return { ok: false, nodes };
        setSelect(sels[0], nodes[0]);
        setSelect(sels[2], nodes[1]);
        return { ok: true, nodes };
      })()`);
      assert('U5_selects_have_two_nodes', pickNodes.ok === true, JSON.stringify(pickNodes).slice(0, 160));
      await sleep(400);
      const faces = await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const sels = [...form.querySelectorAll('select')];
        return sels.map((s) => [...s.options].map((o) => o.value));
      })()`);
      detail.faces = faces;
      assert('U6_face_selects_populated', Array.isArray(faces) && faces[1] && faces[1].length >= 6 && faces[3] && faces[3].length >= 6,
        JSON.stringify(faces).slice(0, 220));

      // —— U6c：只有「法向相反的同轴平面」可解（实测后端原话：+x/+x 被拒），故 A=+x ↔ B=-x ——
      const picked = await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const setSelect = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const sels = [...form.querySelectorAll('select')];
        setSelect(sels[1], '+x');
        setSelect(sels[3], '-x');
        return { a: sels[0].value, aFace: sels[1].value, b: sels[2].value, bFace: sels[3].value };
      })()`);
      detail.picked = picked;
      await sleep(300);
      await evalJs(client, `(() => { const b = document.querySelector('[data-testid="constraint-editor-submit"]'); if (b) b.click(); return !!b; })()`);

      await sleep(1500);
      const submitDiag = await evalJs(client, `(() => {
        const err = document.querySelector('[data-testid="constraint-editor-error"]');
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const sels = form ? [...form.querySelectorAll('select')] : [];
        return { error: err ? err.innerText.trim().slice(0, 160) : '', values: sels.map((s) => s.value) };
      })()`);
      detail.submitDiag = submitDiag;
      assert('U6b_submit_reported_no_error', !submitDiag.error, JSON.stringify(submitDiag).slice(0, 240));
      const applied = await poll(async () => {
        try { return readScene(workspacePath).constraints.length > 0; } catch { return false; }
      }, { timeoutMs: 30_000, label: 'constraint_written_to_disk' }).catch(() => false);
      const afterAdd = readScene(workspacePath);
      detail.constraint = afterAdd.constraints[0] ?? null;
      assert('U7_constraint_written_to_scene_file', applied && afterAdd.constraints[0]?.kind === 'mate',
        JSON.stringify(afterAdd.constraints[0] ?? {}).slice(0, 200));

      const uiAfterAdd = await evalJs(client, `(() => {
        const existing = document.querySelector('[data-testid="constraint-editor-existing"]');
        const err = document.querySelector('[data-testid="constraint-editor-error"]');
        return { existing: existing ? existing.innerText.trim().slice(0, 120) : '', error: err ? err.innerText.trim() : '' };
      })()`);
      detail.uiAfterAdd = uiAfterAdd;
      assert('U8_ui_reflects_constraint_without_error',
        Boolean(uiAfterAdd.existing) && !uiAfterAdd.error,
        JSON.stringify(uiAfterAdd).slice(0, 200));

      // —— U9a：前端守卫——同节点自贴合不发请求，直接给原因 ——
      const beforeBad = JSON.stringify(readScene(workspacePath).constraints);
      await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const setSelect = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const sels = [...form.querySelectorAll('select')];
        const nodes = [...sels[0].options].map((o) => o.value);
        if (!nodes.length) return false;
        setSelect(sels[0], nodes[0]);
        setSelect(sels[2], nodes[0]);
        const btn = document.querySelector('[data-testid="constraint-editor-submit"]');
        if (btn) btn.click();
        return true;
      })()`);
      await sleep(1800);
      const guardErr = await evalJs(client, `(() => { const e = document.querySelector('[data-testid="constraint-editor-error"]'); return e ? e.innerText.trim().slice(0, 160) : ''; })()`);
      detail.guard = { error: guardErr, unchanged: JSON.stringify(readScene(workspacePath).constraints) === beforeBad };
      assert('U9a_same_node_rejected_by_guard', Boolean(guardErr) && detail.guard.unchanged,
        JSON.stringify(detail.guard).slice(0, 200));

      // —— U9b：后端 fail-closed——不同节点但法向同向（+y/+y），后端必须明确拒绝且不写盘 ——
      await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const setSelect = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const sels = [...form.querySelectorAll('select')];
        const nodes = [...sels[0].options].map((o) => o.value);
        setSelect(sels[0], nodes[0]);
        setSelect(sels[2], nodes[1]);
        return true;
      })()`);
      await sleep(500);
      const badPicked = await evalJs(client, `(() => {
        const form = document.querySelector('[data-testid="constraint-editor-form"]');
        const setSelect = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const sels = [...form.querySelectorAll('select')];
        setSelect(sels[1], '+y');
        setSelect(sels[3], '+y');
        return { a: sels[0].value, aFace: sels[1].value, b: sels[2].value, bFace: sels[3].value };
      })()`);
      detail.badPicked = badPicked;
      await sleep(400);
      await evalJs(client, `(() => { const b = document.querySelector('[data-testid="constraint-editor-submit"]'); if (b) b.click(); return !!b; })()`);
      await sleep(2500);
      const backendErr = await evalJs(client, `(() => { const e = document.querySelector('[data-testid="constraint-editor-error"]'); return e ? e.innerText.trim().slice(0, 200) : ''; })()`);
      const afterBad2 = JSON.stringify(readScene(workspacePath).constraints);
      detail.failClosed = { error: backendErr, unchanged: afterBad2 === beforeBad };
      assert('U9b_invalid_constraint_fails_closed', /法向相反|同轴/.test(backendErr) && afterBad2 === beforeBad,
        JSON.stringify(detail.failClosed).slice(0, 240));

      // —— U10：移除约束 → 文件归零、UI 空态回归 ——
      const removeLabel = await evalJs(client, `(() => {
        const btn = document.querySelector('[aria-label^="移除约束"]');
        return btn ? btn.getAttribute('aria-label') : '';
      })()`);
      detail.removeLabel = removeLabel;
      await evalJs(client, `(() => { const b = document.querySelector('[aria-label^="移除约束"]'); if (b) b.click(); return !!b; })()`);
      await sleep(2000);
      const removeDiag = await evalJs(client, `(() => {
        const err = document.querySelector('[data-testid="constraint-editor-error"]');
        const existing = document.querySelector('[data-testid="constraint-editor-existing"]');
        return { error: err ? err.innerText.trim().slice(0, 160) : '', existing: existing ? existing.innerText.trim().slice(0, 80) : '' };
      })()`);
      detail.removeDiag = removeDiag;
      const removed = await poll(async () => {
        try { return readScene(workspacePath).constraints.length === 0; } catch { return false; }
      }, { timeoutMs: 20_000, label: 'constraint_removed_from_disk' }).catch(() => false);
      assert('U10_constraint_removed_from_scene_file', removed,
        JSON.stringify({ ...removeDiag, constraints: readScene(workspacePath).constraints }).slice(0, 300));

      await lib.screenshotPng(client, EVIDENCE_DIR, 'ui639a-constraint-editor-light.png');
      return true;
    } finally {
      if (projectId) {
        const deleted = await rest('DELETE', `/data/projects/${projectId}`).catch(() => null);
        detail.cleanup = { deletedProject: projectId, status: deleted?.status ?? null };
      }
      ctx.detail = detail;
      try { client.close(); } catch { /* 连接已关 */ }
    }
  },
};
