/**
 * src/main/gen-ui/csp.js
 *
 * BLOCK-166 [C 层] 沙箱页 CSP（规格 §6.1）：
 * default-src 'none' 打底；gen-ui 需内联脚本/样式 + 白名单 CDN；
 * frame-src/form-action 全禁；connect-src 仅 blob:/data:（等于禁网络 API）。
 */

const STATIC_DOMAINS = [
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.bunny.net',
];

function httpsSources(domains) {
  return domains.map((domain) => `https://${domain}`).join(' ');
}

function buildGenUiCsp() {
  // 'self' = 页面自身 origin（petri-genui://gen-<id>）：vendor 走 /vendor/* 自源路径，
  // 白名单 CDN 域只覆盖作者 fragment 显式引用的外域资产。
  const scriptSrc = ["'self'", "'unsafe-inline'", httpsSources(STATIC_DOMAINS)].join(' ');
  const styleFontSrc = ["'self'", "'unsafe-inline'", httpsSources(STATIC_DOMAINS)].join(' ');
  const imgMediaSrc = ['blob:', 'data:', httpsSources(STATIC_DOMAINS)].join(' ');
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${styleFontSrc}`,
    `font-src ${styleFontSrc}`,
    `img-src ${imgMediaSrc}`,
    `media-src ${imgMediaSrc}`,
    // scheme 源不加引号（'blob:' 带引号是非法源，Chromium 整条忽略——实测日志在案）
    "connect-src blob: data:",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

module.exports = { STATIC_DOMAINS, buildGenUiCsp };
