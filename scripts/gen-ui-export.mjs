/**
 * scripts/gen-ui-export.mjs — BLOCK-166 P2 独立导出（任务书 §6.4）。
 *
 * 把 gen-ui fragment 打成完全离线的独立 HTML：vendor CDN URL 按清单重写为
 * data URL（base64 内嵌），壳注入 visualize.css 工具类 + petri 主题值层 +
 * standalone `window.petri` shim（widgetState 经 localStorage 持久化、主题随
 * prefers-color-scheme、openExternal 走 window.open）。产物双击/浏览器直开即用。
 *
 * 用法：node scripts/gen-ui-export.mjs --fragment <path> --out <path> [--title <t>]
 * 纯逻辑 buildStandaloneHtml 导出供 Node 直测（test/block166-gen-ui-p2.test.mjs）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');
const { buildGenUiThemeCss, loadVisualizeCss } = require(path.join(REPO_ROOT, 'src', 'main', 'gen-ui', 'theme.js'));
const { loadVendorManifest } = require(path.join(REPO_ROOT, 'src', 'main', 'gen-ui', 'vendor.js'));

const STANDALONE_SHIM_FN = function petriGenUiStandaloneShim(config) {
  'use strict';
  var storageKey = config && typeof config.storageKey === 'string' ? config.storageKey : 'petri-gen-ui-widget-state';
  var MAX_STATE_BYTES = 16 * 1024;
  var encoder = new TextEncoder();

  function deepCopy(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }
  function normalizeState(value) {
    var next = { modelContent: null, privateContent: null };
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) next[key] = value[key];
      }
    }
    return next;
  }

  var state = null;
  try {
    var stored = window.localStorage.getItem(storageKey);
    if (stored) state = normalizeState(JSON.parse(stored));
  } catch { state = null; }

  function currentTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    var theme = currentTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.dispatchEvent(new CustomEvent('petri:set_globals', {
        detail: { globals: { widgetState: deepCopy(state), theme: theme } },
      }));
    } catch { /* 投影失败不阻断 */ }
  }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    } catch { /* 旧浏览器忽略 */ }
  }

  var api = {};
  Object.defineProperties(api, {
    widgetState: {
      enumerable: true,
      get: function () { return deepCopy(state); },
    },
    setWidgetState: {
      enumerable: true,
      value: function (value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return Promise.reject(new TypeError('widget state must be a JSON object'));
        }
        var serialized;
        try { serialized = JSON.stringify(value); } catch {
          return Promise.reject(new TypeError('widget state must be a JSON object'));
        }
        if (encoder.encode(serialized).length > MAX_STATE_BYTES) {
          return Promise.reject(new TypeError('widget state must be a JSON object of at most 16 KiB'));
        }
        var next = normalizeState(JSON.parse(serialized));
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (e) {
          return Promise.reject(new Error('standalone persistence failed: ' + e.message));
        }
        state = next;
        applyTheme();
        return Promise.resolve();
      },
    },
    openExternal: {
      enumerable: true,
      value: function (value) {
        var href = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : '';
        var url = null;
        try { url = new URL(href); } catch { url = null; }
        if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
          return Promise.reject(new Error('external link rejected: absolute http(s) URL required'));
        }
        window.open(url.href, '_blank', 'noopener');
        return Promise.resolve();
      },
    },
    sendFollowUpMessage: {
      enumerable: true,
      value: function () {
        return Promise.reject(new Error('standalone export has no chat host: follow-up unavailable'));
      },
    },
  });
  Object.freeze(api);
  Object.defineProperty(window, 'petri', { value: api, writable: false, configurable: false });
  applyTheme();
};

const SHIM_HEAD = '<script>';
const SHIM_TAIL = '</' + 'script>';

function vendorMimeFor(file) {
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

/** vendor CDN URL → data URL（base64 内嵌），同源 vendor 路径也一并内嵌。 */
function inlineVendorUrls(html) {
  const manifest = loadVendorManifest();
  let result = html;
  const byUrl = new Map();
  for (const [url, resource] of manifest.byUrl) byUrl.set(url, resource);
  // 沙箱形态路径（petri-genui://gen-<id>/vendor/<file>）同样重写（导出沙箱页 fragment 也支持）
  for (const [file, resource] of manifest.byFile) {
    byUrl.set(`petri-genui://gen-x/vendor/${file}`, resource);
  }
  for (const [url, resource] of byUrl) {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, 'resources', 'gen-ui', 'vendor', resource.file));
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    if (expected !== resource.sha256) {
      throw new Error(`bundled resource hash mismatch: ${resource.file}`);
    }
    const dataUrl = `data:${vendorMimeFor(resource.file)};base64,${bytes.toString('base64')}`;
    result = result.split(url).join(dataUrl);
  }
  return result;
}

/**
 * 组装独立 HTML。
 * @param {string} fragmentHtml 作者 fragment（vendor URL 会被内嵌重写）
 * @param {{ title?: string, storageKey?: string }} opts
 */
export function buildStandaloneHtml(fragmentHtml, opts = {}) {
  const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : 'Petri 可视化导出';
  const storageKey = typeof opts.storageKey === 'string' && opts.storageKey.trim()
    ? opts.storageKey.trim()
    : `petri-gen-ui-widget-state:${crypto.createHash('sha256').update(fragmentHtml).digest('hex').slice(0, 16)}`;
  const configJson = JSON.stringify({ storageKey }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rewritten = inlineVendorUrls(String(fragmentHtml));
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${safeTitle}</title>`,
    `<style>${loadVisualizeCss()}</style>`,
    `<style>${buildGenUiThemeCss()}</style>`,
    '</head>',
    '<body>',
    SHIM_HEAD,
    `(${STANDALONE_SHIM_FN.toString()})(${configJson});`,
    SHIM_TAIL,
    rewritten,
    '</body>',
    '</html>',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const readArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const fragmentPath = readArg('fragment');
  const outPath = readArg('out');
  const title = readArg('title');
  if (!fragmentPath || !outPath) {
    console.error('用法：node scripts/gen-ui-export.mjs --fragment <path> --out <path> [--title <t>]');
    process.exit(2);
  }
  const html = buildStandaloneHtml(fs.readFileSync(fragmentPath, 'utf8'), { title });
  fs.writeFileSync(outPath, html, 'utf8');
  const external = (html.match(/https?:\/\//g) || []).length;
  console.log(`[gen-ui-export] wrote ${outPath} (${html.length} bytes, external-url refs=${external})`);
  process.exit(external === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
