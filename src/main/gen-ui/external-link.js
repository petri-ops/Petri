/**
 * src/main/gen-ui/external-link.js
 *
 * BLOCK-166 [C 层] openExternal 白名单（规格 §6.5）：仅放行绝对 http(s)。
 * guest 桥做同规则预检（快速拒绝不发 RPC），本模块是主进程权威裁决；
 * 两层规则保持一致，主进程侧为准。内嵌凭证（user:pass@）一并拒绝。
 */

function isAllowedExternalHref(href) {
  if (typeof href !== 'string') return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return false; // 相对路径/裸文本解析失败 → 拒绝
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return true;
}

module.exports = { isAllowedExternalHref };
