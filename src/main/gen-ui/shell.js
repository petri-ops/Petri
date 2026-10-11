/**
 * src/main/gen-ui/shell.js
 *
 * BLOCK-166 [C 层] HTML 外壳拼装（规格 §6.2，加载顺序固定不可乱——坑 9）：
 *   1. <script id="petri-gen-ui-initial-state"> 初始状态快照（P0 恒 null，P2 接持久化）
 *   2. guest 基础脚本：高度测量回报（ResizeObserver + 防反馈回路过滤；P1 扩 window.petri 桥）
 *   3. 基础 CSS（P0 最小主题变量骨架；P1 移植 visualize.css 工具类全量）
 *   4. 作者 fragment（vendor CDN URL 已重写为沙箱路径）
 * CSP 由协议响应头携带（csp.js），壳内不再重复 meta-CSP。
 */

const { rewriteVendorUrls } = require('./vendor');

const HTML_MAX_BYTES = 1_048_576;

// P0 最小主题骨架：--petri-* → 标准变量名映射的占位层（P1 全量映射 + 热更新）。
const BASE_CSS = [
  ':root{',
  '--background:#12141c;--foreground:#e6ebf2;--muted:rgba(230,235,242,.08);--muted-foreground:#8fa0b5;',
  '--border:rgba(230,235,242,.14);--primary:#43d1ae;--primary-foreground:#08131d;',
  '--font-size-base:14px;',
  '}',
  'html,body{margin:0;padding:0;background:var(--background);color:var(--foreground);',
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:var(--font-size-base);}',
].join('');

// guest 基础脚本：高度回报（postMessage 直达 parent；反馈回路过滤——高度差≈视口差则忽略，坑 5）。
const GUEST_BOOTSTRAP = `
(function () {
  'use strict';
  var last = 0;
  var lastViewport = window.innerHeight;
  function report() {
    var height = Math.ceil(document.body.getBoundingClientRect().height);
    var viewport = window.innerHeight;
    var heightDelta = Math.abs(height - last);
    var viewportDelta = Math.abs(viewport - lastViewport);
    last = height; lastViewport = viewport;
    if (heightDelta > 0 && Math.abs(heightDelta - viewportDelta) <= 2 && viewportDelta > 0) return;
    try { window.parent.postMessage({ type: 'petri-gen-ui-height', height: height }, '*'); } catch (e) {}
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(report).observe(document.documentElement);
  }
  window.addEventListener('load', report);
  setTimeout(report, 60);
})();
`;

function escapeJsonForScript(json) {
  return JSON.stringify(json).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * 拼装完整沙箱页 HTML。
 * @param {object} opts
 * @param {string} opts.fragmentHtml   作者 fragment 原文（已通过 1MB/读取校验）
 * @param {string} opts.sandboxOrigin  如 petri-genui://gen-abc123
 * @param {unknown} opts.initialState  初始 widgetState 快照（P0 恒 null）
 */
function assembleGenUiShell({ fragmentHtml, sandboxOrigin, initialState = null }) {
  const rewritten = rewriteVendorUrls(String(fragmentHtml), sandboxOrigin);
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<style>${BASE_CSS}</style>`,
    '</head>',
    '<body>',
    `<script type="application/json" id="petri-gen-ui-initial-state">${escapeJsonForScript(initialState)}</script>`,
    `<script>${GUEST_BOOTSTRAP}</script>`,
    rewritten,
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { HTML_MAX_BYTES, assembleGenUiShell };
