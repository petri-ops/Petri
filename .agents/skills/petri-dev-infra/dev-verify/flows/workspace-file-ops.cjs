#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: workspace-file-ops — BLOCK-89 P3 工作区文件操作实机验收。
 *
 * 断言链（REST 面 + 真 Chromium UI 面双层）：
 *   A0a backend_rest_healthy          dev 后端 REST 可达
 *   A0b app_page_ready                CDP 页面 root 就绪
 *   A0c temp_project_created          临时验收项目建好（带 workspace_path）
 *   A1  rest_mkdir                    fs/mkdir 递归建目录 + tree 核对
 *   A2  rest_move_file                fs/move 文件（目标父目录自动建）+ tree 双侧核对
 *   A3  rest_copy_dir_recursive       fs/copy 目录递归复制 + 内容核对
 *   A4  rest_delete_batch             fs/delete 批量删除 + tree 消失核对
 *   A5  rest_conflict_409             目标已存在 → 409 target_already_exists（目标不被破坏）
 *   A6  rest_escape_400               越界路径（..）→ 400
 *   A7  ui_context_menu_delete        页内 contextmenu → 右键菜单 → 删除确认弹层 → 文件真删
 *   A8  ui_mkdir_via_menu             菜单「新建文件夹」→ 输入弹层 → 目录出现
 *   A9  ui_drag_move                  页内真 DragEvent（DataTransfer 构造）拖文件到目录行 → 移动生效
 *   A10 ui_ctrl_drag_copy             Ctrl+拖（ctrlKey: true）→ 复制生效（组件测试环境限制的实机补位断言）
 *   A99 cleanup                       临时项目删除 + 页面导航还原
 *
 * 环境边界（如实登记，不虚设断言）：ssh 后端实机链路需可达的真节点；本 flow
 * 以 local 项目走实机全链，ssh 同构语义由 P1 契约测试锁定（fake backend 透传 +
 * 错误映射），双后端代码路径同构（workspaceGateway 透传，plan D1）。
 *
 * 前置：测试实例（CDP 9223，bash scripts/start-test-instance.sh；后端 3001 同源）。后端/前端代码有变更须先重启 dev 栈+重启测试实例。
 * 证据：acceptance/block-89/workspace-file-ops-live.json
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
    try {
      return await lib.evalJs(client, expr);
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

/** 页内轮询：expr 每秒求值，为 truthy 即返回其字符串结果。 */
async function pagePoll(client, expr, { timeoutMs = 15000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(1000);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

module.exports = {
  id: 'workspace-file-ops',
  description: 'BLOCK-89 P3 工作区文件操作实机：REST move/copy/delete/mkdir 双语义 + 右键菜单/删除确认/新建文件夹/拖拽移动/Ctrl+拖复制（真 Chromium）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-89'),

  async run(ctx) {
    const { assert } = ctx;
    const evidenceDir = path.join(ROOT, 'acceptance', 'block-89');
    fs.mkdirSync(evidenceDir, { recursive: true });

    let projectId = null;
    let client = null;
    let originalUrl = null;

    // ── A0 前置 ──
    const health = await rest('GET', '/data/projects');
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    client = await lib.connectTarget(target);
    originalUrl = target.url;
    const rootReady = await evalRetry(client, `!!document.getElementById('root')`);
    assert('A0b_app_page_ready', rootReady === true || rootReady === 'true', String(rootReady));

    const created = await rest('POST', '/data/projects', { name: 'BLOCK89-验收-' + Date.now(), modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
    const workspacePath = projResp && projResp.data && (projResp.data.project
      ? projResp.data.project.workspace_path : projResp.data.workspace_path);
    assert('A0c_temp_project_created', Boolean(projectId && workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 160));

    const wsApi = `/workspaces/${encodeURIComponent(projectId)}`;
    const treeOf = async (prefix) => {
      const r = await rest('GET', `${wsApi}/tree?prefix=${encodeURIComponent(prefix || '')}`);
      return r.data && r.data.ok ? (r.data.entries || []).map((e) => `${e.type}:${e.name}`) : ['tree_err'];
    };

    // ── A1 REST mkdir ──
    const mkdir = await rest('POST', `${wsApi}/fs/mkdir`, { path: 'datasets/raw' });
    assert('A1_rest_mkdir', mkdir.ok && mkdir.data && mkdir.data.ok
      && (await treeOf('datasets')).includes('dir:raw'),
      JSON.stringify(mkdir.data).slice(0, 120));

    // ── A2 REST move 文件（种子文件直写工作区；目标父目录自动建）──
    fs.writeFileSync(path.join(workspacePath, 'a.txt'), 'block89 move me');
    const mv = await rest('POST', `${wsApi}/fs/move`, { fromPath: 'a.txt', toPath: 'datasets/raw/b.txt' });
    const rootAfterMove = await treeOf('');
    const rawAfterMove = await treeOf('datasets/raw');
    assert('A2_rest_move_file', mv.ok && !rootAfterMove.includes('file:a.txt')
      && rawAfterMove.includes('file:b.txt'),
      `mv=${JSON.stringify(mv.data).slice(0, 80)} raw=${rawAfterMove.join(',')}`);

    // ── A3 REST copy 目录递归 ──
    const cp = await rest('POST', `${wsApi}/fs/copy`, { fromPath: 'datasets', toPath: 'datasets-copy' });
    const copied = await treeOf('datasets-copy/raw');
    assert('A3_rest_copy_dir_recursive', cp.ok && copied.includes('file:b.txt'),
      `cp=${JSON.stringify(cp.data).slice(0, 80)} copied=${copied.join(',')}`);

    // ── A4 REST delete 批量 ──
    const del = await rest('POST', `${wsApi}/fs/delete`, { paths: ['datasets-copy/raw/b.txt', 'datasets-copy/raw'] });
    const copiedAfter = await treeOf('datasets-copy');
    assert('A4_rest_delete_batch', del.ok && del.data && del.data.removed === 2
      && copiedAfter.join(',').indexOf('file:b.txt') === -1,
      `del=${JSON.stringify(del.data).slice(0, 80)} rest=${copiedAfter.join(',')}`);

    // ── A5 冲突 409 ──
    fs.writeFileSync(path.join(workspacePath, 'conflict.txt'), 'keep');
    const conflict = await rest('POST', `${wsApi}/fs/copy`, { fromPath: 'datasets/raw/b.txt', toPath: 'conflict.txt' });
    const conflictBody = conflict.data || {};
    assert('A5_rest_conflict_409', conflict.status === 409
      && conflictBody.code === 'target_already_exists'
      && fs.readFileSync(path.join(workspacePath, 'conflict.txt'), 'utf-8') === 'keep',
      `status=${conflict.status} code=${conflictBody.code || conflictBody.error}`);

    // ── A6 越界 400 ──
    const escape = await rest('POST', `${wsApi}/fs/mkdir`, { path: '../escape-block89' });
    assert('A6_rest_escape_400', escape.status === 400, `status=${escape.status}`);

    // 导航进临时项目工作区页（右栏文件树 UI 面）
    await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
    // 右栏默认 home tab（UI-359 治理：tab 在标题栏）——点「文件」tab 挂载 RightFileTree
    await pagePoll(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){
        return b.textContent.trim() === '文件'; });
      if (!btn) return '';
      btn.click();
      return 'clicked';
    })()`, { label: 'files tab in titlebar' });
    await pagePoll(client, `String((document.querySelectorAll('[role="treeitem"]')||[]).length >= 2)`,
      { label: 'tree rows render' });

    // ── A7 UI 右键菜单删除链 ──
    fs.writeFileSync(path.join(workspacePath, 'ui-del.txt'), 'delete me');
    // 树 2s 轮询会自行出现新文件（local 项目），等待 ui-del.txt 行渲染
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('ui-del.txt') >= 0; }))`, { label: 'ui-del row' });

    const menuShown = await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('ui-del.txt') >= 0; });
      if (!row) return 'no_row';
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return 'dispatched';
    })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="file-tree-menu-delete"]'))`,
      { label: 'context menu' });
    await evalRetry(client, `document.querySelector('[data-testid="file-tree-menu-delete"]').click(); 'clicked'`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="file-tree-dialog-confirm"]'))`,
      { label: 'delete dialog' });
    await evalRetry(client, `document.querySelector('[data-testid="file-tree-dialog-confirm"]').click(); 'confirmed'`);
    await pagePoll(client, `(function(){
      var gone = ![...document.querySelectorAll('[role="treeitem"]')].some(function(el){
        return el.textContent.indexOf('ui-del.txt') >= 0; });
      var menuClosed = !document.querySelector('[data-testid="file-tree-menu"]');
      var dialogClosed = !document.querySelector('[data-testid="file-tree-dialog"]');
      return String(gone && menuClosed && dialogClosed);
    })()`, { timeoutMs: 20000, label: 'ui delete converge' });
    const uiDelGone = await rest('GET', `${wsApi}/tree?prefix=`);
    assert('A7_ui_context_menu_delete',
      menuShown === 'dispatched'
      && !(uiDelGone.data.entries || []).some((e) => e.name === 'ui-del.txt'),
      `menu=${menuShown} tree_has=${(uiDelGone.data.entries || []).map((e) => e.name).join(',')}`);

    // ── A8 UI 菜单新建文件夹 ──
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.getAttribute('aria-expanded') !== null; });
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return 'dispatched';
    })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="file-tree-menu-mkdir"]'))`,
      { label: 'mkdir menu item' });
    await evalRetry(client, `document.querySelector('[data-testid="file-tree-menu-mkdir"]').click(); 'clicked'`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="file-tree-dialog-input"]'))`,
      { label: 'mkdir dialog input' });
    const inputSet = await evalRetry(client, `(function(){
      var input = document.querySelector('[data-testid="file-tree-dialog-input"]');
      var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto.set.call(input, 'ui-made-dir');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'set';
    })()`);
    await evalRetry(client, `document.querySelector('[data-testid="file-tree-dialog-confirm"]').click(); 'created'`);
    // UI 链完成核对：确认弹层关闭（成功路径 onDone 才关）；结果核对走 REST
    await pagePoll(client, `String(!document.querySelector('[data-testid="file-tree-dialog"]'))`,
      { timeoutMs: 20000, label: 'mkdir dialog closed' });
    const mkdirTree = await rest('GET', `${wsApi}/tree?prefix=datasets`);
    // 树渲染核对：展开 datasets 后 ui-made-dir 行出现（新建目录建在第一个目录行下）
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.getAttribute('aria-expanded') !== null && el.textContent.indexOf('datasets-copy') === -1
          && el.textContent.indexOf('datasets') >= 0; });
      if (!row) return 'no_row';
      row.click();
      return 'expanded';
    })()`);
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('ui-made-dir') >= 0; }))`, { timeoutMs: 20000, label: 'mkdir row rendered' });
    assert('A8_ui_mkdir_via_menu',
      String(await evalRetry(client, `String(!document.querySelector('[data-testid="file-tree-dialog"]'))`)) === 'true'
      && (mkdirTree.data.entries || []).some((e) => e.name === 'ui-made-dir'),
      `mkdir dialog closed + datasets/ui-made-dir on REST tree (${(mkdirTree.data.entries || []).map((e) => e.name).join(',')})`);

    // ── A9 UI 拖拽移动（真 DragEvent + DataTransfer 构造，Chromium 全支持）──
    fs.writeFileSync(path.join(workspacePath, 'drag-me.txt'), 'drag');
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('drag-me.txt') >= 0; }))`, { label: 'drag-me row' });
    const dragResult = await evalRetry(client, `(function(){
      var rows = [...document.querySelectorAll('[role="treeitem"]')];
      var src = rows.find(function(el){ return el.textContent.indexOf('drag-me.txt') >= 0; });
      var dst = rows.find(function(el){ return el.getAttribute('aria-expanded') !== null
        && el.textContent.indexOf('datasets') >= 0; });
      if (!src || !dst) return 'missing_rows';
      var dt = new DataTransfer();
      dt.setData('application/x-petri-tree-item', JSON.stringify({ path: 'drag-me.txt', name: 'drag-me.txt', type: 'file' }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ctrlKey: false }));
      return 'dropped';
    })()`);
    // 收敛以 REST 为准（源目录行在 A8 已展开，移动后 drag-me 仍会在目标目录内渲染，
    // 「行消失」不成立）；根目录核对辅助证明这是移动而非复制。
    let dragMoved = false;
    {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !dragMoved) {
        const inDst = await rest('GET', `${wsApi}/tree?prefix=datasets`);
        const atRoot = await rest('GET', `${wsApi}/tree?prefix=`);
        dragMoved = (inDst.data.entries || []).some((e) => e.name === 'drag-me.txt')
          && !(atRoot.data.entries || []).some((e) => e.name === 'drag-me.txt');
        if (!dragMoved) await sleep(1000);
      }
    }
    assert('A9_ui_drag_move', dragResult === 'dropped' && dragMoved,
      `drop=${dragResult} movedTo=datasets/drag-me.txt rootCleared=${dragMoved}`);

    // ── A10 UI Ctrl+拖 = 复制 ──
    fs.writeFileSync(path.join(workspacePath, 'ctrl-drag.txt'), 'copy');
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('ctrl-drag.txt') >= 0; }))`, { label: 'ctrl-drag row' });
    const copyResult = await evalRetry(client, `(function(){
      var rows = [...document.querySelectorAll('[role="treeitem"]')];
      var src = rows.find(function(el){ return el.textContent.indexOf('ctrl-drag.txt') >= 0; });
      var dst = rows.find(function(el){ return el.getAttribute('aria-expanded') !== null
        && el.textContent.indexOf('datasets') >= 0; });
      if (!src || !dst) return 'missing_rows';
      var dt = new DataTransfer();
      dt.setData('application/x-petri-tree-item', JSON.stringify({ path: 'ctrl-drag.txt', name: 'ctrl-drag.txt', type: 'file' }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ctrlKey: true }));
      return 'dropped_ctrl';
    })()`);
    // 收敛：复制品落进 datasets（源保留由根目录核对证明）
    let copyLanded = false;
    {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !copyLanded) {
        const inDst = await rest('GET', `${wsApi}/tree?prefix=datasets`);
        copyLanded = (inDst.data.entries || []).some((e) => e.name === 'ctrl-drag.txt');
        if (!copyLanded) await sleep(1000);
      }
    }
    const rootCopy = await rest('GET', `${wsApi}/tree?prefix=`);
    assert('A10_ui_ctrl_drag_copy', copyResult === 'dropped_ctrl' && copyLanded
      && (rootCopy.data.entries || []).some((e) => e.name === 'ctrl-drag.txt'),
      `drop=${copyResult}（复制 = 源保留于根 + 落点 datasets/ctrl-drag.txt）`);

    // ── A99 清理与还原 ──
    let cleanupOk = false;
    try {
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        cleanupOk = d.ok;
        projectId = null;
      }
      await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
      await sleep(2000);
    } catch { cleanupOk = false; }
    assert('A99_cleanup_restored', cleanupOk, '临时项目已删除 + 页面导航还原');

    return true;
  },
};
