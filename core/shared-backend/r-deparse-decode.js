'use strict';

/**
 * r-deparse-decode.js — BLOCK-133（mojibake 加映二收口）。
 *
 * R 的 jsonlite 在非 UTF-8 locale 下序列化含不可本地表示码点的字符串时，
 * 会输出 R deparse 形态的字面量文本 `<U+XXXX>`（如 `GO-BP <U+6C14><U+6CE1><U+56FE>`）。
 * 该形态是纯 ASCII、无歧义，读取侧统一解码为真实字符即可全通——
 * 与 locale 无关（写侧已在脚本层保证不再产生高位剥离乱码，见 pack BLOCK-133）。
 * 深度遍历对象/数组，只改字符串叶子，其余原样返回；非法/越界码点原样保留不猜。
 */

const R_DEPARSE_RE = /<U\+([0-9A-Fa-f]{4,6})>/g;

function decodeRDeparseString(text) {
  if (typeof text !== 'string' || !text.includes('<U+')) return text;
  return text.replace(R_DEPARSE_RE, (whole, hex) => {
    const code = Number.parseInt(hex, 16);
    if (!Number.isFinite(code) || code > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(code);
    } catch {
      return whole;
    }
  });
}

/** 深度解码 manifest（或任意 JSON 值）里的字符串叶子；原对象不改，返回新结构。 */
function decodeRDeparseManifest(value) {
  if (typeof value === 'string') return decodeRDeparseString(value);
  if (Array.isArray(value)) return value.map(decodeRDeparseManifest);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decodeRDeparseManifest(item);
    return out;
  }
  return value;
}

module.exports = { decodeRDeparseManifest, decodeRDeparseString };
