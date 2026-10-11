/**
 * src/main/gen-ui/shell.js
 *
 * BLOCK-166 [C 层] HTML 外壳拼装（规格 §6.2，加载顺序固定不可乱——坑 9）：
 *   1. <style> visualize.css（agent 契约变量 + 工具类，ZCode 移植）
 *   2. <style> petri 主题值层（theme.js 的 --petri-* token 映射，覆盖契约层默认值）
 *   3. <script id="petri-gen-ui-initial-state"> 初始 widgetState 快照（P1 内存版；
 *      P2 接 SQLite 持久化）
 *   4. guest 桥（guest-bridge.js 序列化内联：window.petri + 高度回报 + tooltip +
 *      资源失败横幅；作者 fragment 之前执行）
 *   5. 作者 fragment（vendor CDN URL 已重写为沙箱路径）
 * CSP 由协议响应头携带（csp.js），壳内不再重复 meta-CSP。
 */

const { rewriteVendorUrls } = require('./vendor');
const { buildGenUiThemeCss, loadVisualizeCss } = require('./theme');
const { buildGuestBridgeScript } = require('./guest-bridge');

const HTML_MAX_BYTES = 1_048_576;

function escapeJsonForScript(json) {
  return JSON.stringify(json).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * 拼装完整沙箱页 HTML。
 * @param {object} opts
 * @param {string} opts.fragmentHtml   作者 fragment 原文（已通过 1MB/读取校验）
 * @param {string} opts.sandboxOrigin  如 petri-genui://gen-abc123
 * @param {string} [opts.hostOrigin]   宿主聊天窗 origin（guest 校验 parent 消息用；
 *                                     未知时桥退化为 source-only 校验）
 * @param {unknown} [opts.initialState] 初始 widgetState 快照（P1 内存版）
 */
function assembleGenUiShell({ fragmentHtml, sandboxOrigin, hostOrigin = '', initialState = null }) {
  const rewritten = rewriteVendorUrls(String(fragmentHtml), sandboxOrigin);
  const bridgeConfig = hostOrigin ? { hostOrigin, sandboxOrigin } : { sandboxOrigin };
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<style>${loadVisualizeCss()}</style>`,
    `<style>${buildGenUiThemeCss()}</style>`,
    '</head>',
    '<body>',
    `<script type="application/json" id="petri-gen-ui-initial-state">${escapeJsonForScript(initialState)}</script>`,
    buildGuestBridgeScript(bridgeConfig),
    rewritten,
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { HTML_MAX_BYTES, assembleGenUiShell };
