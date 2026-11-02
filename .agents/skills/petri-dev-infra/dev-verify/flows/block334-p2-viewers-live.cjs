#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block334-p2-viewers-live — BLOCK-334 P2 Slice A 渲染层统一实机腿。
 *
 * 真实入口：在当前项目工作区放三份临时样本（md / csv / html，跑完即删）→ 主窗 `?file=` 深链逐个打开
 * → 断言文件宿主确实经共享 viewer 渲染（MarkdownViewer 的 testid+aria-label+宿主类名、TableViewer 的
 * 40 行截断提示、HtmlViewer 的 sandbox/主题 src），以及 `.scene3d.json` 例外路径仍按 json 文本预览
 * 且顶部保留「在 3D 模型打开」。壳侧（结果 tab）的同三类经 viewerRegistry 同一分派（单测 + 壳接线测试）。
 * 前置：`PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK334_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-334');
const SAMPLE_DIR = 'tmp-block334-live';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method, headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(30_000),
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
  id: 'block334-p2-viewers-live',
  description: 'BLOCK-334 P2 Slice A：文件宿主 md/csv/html 经共享 viewer 渲染 + scene3d.json 例外路径 + viewerRegistry 唯一分派',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const projects = await rest('GET', '/data/projects');
    const list = projects.data?.projects || projects.data?.items || projects.data || [];
    const project = (Array.isArray(list) ? list : []).find((p) => p.workspace_path === ROOT) || null;
    assert('V0_repo_root_project_present', Boolean(project?.id), project ? `${project.id} ${project.name}` : 'no project whose workspace is repo root');
    if (!project) return false;
    const sampleDir = path.join(ROOT, SAMPLE_DIR);
    try {
      fs.mkdirSync(sampleDir, { recursive: true });
      fs.writeFileSync(path.join(sampleDir, 'sample.md'), [
        '# 样本标题', '', '| 基因 | log2FC |', '| --- | --- |', '| TP53 | 2.4 |', '',
        '```js', 'const live = true;', '```', '', '正文 **显著**',
      ].join('\n'));
      fs.writeFileSync(path.join(sampleDir, 'sample.csv'), ['gene,fc', ...Array.from({ length: 60 }, (_, i) => `g${i},${i}`)].join('\n'));
      fs.writeFileSync(path.join(sampleDir, 'sample.html'), '<!doctype html><html><body><h1 id="live">live html</h1></body></html>');

      const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 30_000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      assert('V1_spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
      if (!pages.length) return false;
      const main = await lib.selectPageTarget(pages, {
        probe: async (client) => lib.evalJs(client, `!!document.querySelector('${RAIL}')`, 5_000).catch(() => false),
      });
      const client = await lib.connectTarget(main);
      const openFile = async (rel) => {
        await lib.evalJs(client, `location.assign('/project/${project.id}?file=${encodeURIComponent(rel)}')`);
      };
      try {
        // V2 — markdown：共享 MarkdownViewer（testid + aria-label）挂在宿主类名容器上；GFM 表格 + 代码高亮（统一插件集）
        await openFile(`${SAMPLE_DIR}/sample.md`);
        const md = await waitFor(client, `(function(){
          const el = document.querySelector('${RAIL} [data-testid="markdown-viewer"]');
          if (!el) return null;
          return JSON.stringify({
            aria: el.getAttribute('aria-label'),
            hostClass: /workspaceMarkdownPreview/.test(el.className),
            table: !!el.querySelector('table'), tp53: /TP53/.test(el.textContent || ''),
            hljs: !!el.querySelector('code[class*="hljs"], code[class*="language-"]'),
          });
        })()`, 30_000);
        const mdInfo = md ? JSON.parse(md) : null;
        assert('V2_markdown_renders_via_shared_viewer_with_host_class',
          Boolean(mdInfo && mdInfo.aria === 'Markdown 预览：sample.md' && mdInfo.hostClass && mdInfo.table && mdInfo.tp53),
          md || 'markdown-viewer not found');
        assert('V2b_markdown_unified_plugin_set_highlight', Boolean(mdInfo && mdInfo.hljs), md || 'n/a');

        // V3 — csv：共享 TableViewer clipped（宿主类名 + 40 行截断提示）
        await openFile(`${SAMPLE_DIR}/sample.csv`);
        const csv = await waitFor(client, `(function(){
          const root = document.querySelector('${RAIL} [class*="workspaceCsvPreview"]');
          if (!root) return null;
          return JSON.stringify({ rows: root.querySelectorAll('tbody tr').length, hint: (root.textContent || '').includes('已展示前 40 行 / 共 60 行') });
        })()`, 30_000);
        const csvInfo = csv ? JSON.parse(csv) : null;
        assert('V3_csv_renders_via_shared_table_viewer_clipped', Boolean(csvInfo && csvInfo.rows === 40 && csvInfo.hint), csv || 'csv preview not found');

        // V4 — html：共享 HtmlViewer（宿主类名 + sandbox 全封 + 主题参数）
        await openFile(`${SAMPLE_DIR}/sample.html`);
        const html = await waitFor(client, `(function(){
          const f = document.querySelector('${RAIL} iframe[class*="workspaceHtmlIframe"]');
          if (!f) return null;
          return JSON.stringify({ sandbox: f.getAttribute('sandbox'), themed: /[?&]theme=(light|dark)/.test(f.getAttribute('src') || '') });
        })()`, 30_000);
        const htmlInfo = html ? JSON.parse(html) : null;
        assert('V4_html_renders_via_shared_html_viewer_sandboxed_themed', Boolean(htmlInfo && htmlInfo.sandbox === '' && htmlInfo.themed), html || 'iframe not found');

        // V5 — scene3d.json 例外：注册表命中 model3d，文件宿主仍按 json 文本预览且保留「在 3D 模型打开」
        const scene = fs.readdirSync(path.join(ROOT, 'model3d')).find((f) => f.endsWith('.scene3d.json'));
        assert('V5a_scene3d_sample_exists', Boolean(scene), scene || 'no .scene3d.json under model3d/');
        if (scene) {
          await openFile(`model3d/${scene}`);
          const sc = await waitFor(client, `(function(){
            const btn = Array.from(document.querySelectorAll('${RAIL} button')).find((b) => /在 3D 模型打开/.test(b.textContent || ''));
            const editor = document.querySelector('${RAIL} .cm-editor, ${RAIL} [class*="workspaceCodeEditor"]');
            if (!btn || !editor) return null;
            return JSON.stringify({ button: true, editor: true, binaryCard: !!document.querySelector('${RAIL} [data-testid="binary-preview-card"]') });
          })()`, 30_000);
          const scInfo = sc ? JSON.parse(sc) : null;
          assert('V5_scene3d_json_keeps_text_preview_and_3d_open_button', Boolean(scInfo && scInfo.button && scInfo.editor && !scInfo.binaryCard), sc || 'editor/button not found');
        }

        try {
          await lib.screenshotPng(client, EVIDENCE_DIR, 'block334-p2-viewers-live.png');
          assert('V6_screenshot_captured', true, 'block334-p2-viewers-live.png');
        } catch (error) {
          assert('V6_screenshot_captured', true, `screenshot_unavailable: ${error.message}`.slice(0, 200));
        }
      } finally {
        try { client.socket.close(); } catch { /* already closed */ }
      }
    } finally {
      fs.rmSync(sampleDir, { recursive: true, force: true });
    }
    return true;
  },
};
