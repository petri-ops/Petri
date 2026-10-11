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
  const scriptSrc = ["'unsafe-inline'", httpsSources(STATIC_DOMAINS)].join(' ');
  const styleFontSrc = ["'unsafe-inline'", httpsSources(STATIC_DOMAINS)].join(' ');
  const imgMediaSrc = ['blob:', 'data:', httpsSources(STATIC_DOMAINS)].join(' ');
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${styleFontSrc}`,
    `font-src ${styleFontSrc}`,
    `img-src ${imgMediaSrc}`,
    `media-src ${imgMediaSrc}`,
    "connect-src 'blob:' 'data:'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

module.exports = { STATIC_DOMAINS, buildGenUiCsp };
