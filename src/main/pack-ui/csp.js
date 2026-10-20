'use strict';

/**
 * BLOCK-216 Q5 — pack 视图页 CSP。
 *
 * 与 Gen UI 同一安全口径：default-src 'none' 打底；只允许包自身 origin 的
 * 脚本/样式/图片/字体；禁网络、禁子框、禁表单、禁 base/object。
 * 包页运行在 petri-pack://<packId> 独立 origin，不能访问宿主 DOM。
 */

function buildPackCsp() {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

module.exports = { buildPackCsp };
