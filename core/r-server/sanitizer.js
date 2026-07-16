// M1-3 R 脚本注入防护（H2）
// 桌面版/Web 版共用——r-server 拼 R 脚本参数时调用。
//
// 三个函数：
//   sanitizeParam(input)  — 白名单校验文件名/参数，合法返回原值，非法返回 null
//   assertSafePath(absPath, baseDir) — 防路径穿越，越界抛异常
//   sanitizeRString(input) — 插值进 R "..." 内的值，转义引号/反斜杠；含换行则拒（防 R 代码注入）

const path = require('path');

// 仅允许字母数字 _ - . /，禁任何 shell 元字符与引号
const SAFE_NAME = /^[A-Za-z0-9_\-./]+$/;
const SHELL_DANGER = /[;`$|&<>(){}!\\\n\r'"]/;

/**
 * 白名单校验 R 脚本参数（文件名/工具 ID/分组名等）。
 * 合法返回原字符串，非法返回 null。
 */
function sanitizeParam(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  if (SHELL_DANGER.test(input)) return null;
  if (!SAFE_NAME.test(input)) return null;
  return input;
}

/**
 * 路径穿越防护。absPath 必须在 baseDir 内（或等于 baseDir）。
 * 越界抛 Error。
 */
function assertSafePath(absPath, baseDir) {
  const resolved = path.resolve(absPath);
  const base = path.resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('路径越界: ' + absPath);
  }
}

/**
 * 转义插值进 R 双引号字符串内的文件路径值。
 * 转义 " 和 \，拒绝换行/回车（防闭合字符串后注入 R 代码）。
 * 合法返回转义后的字符串，含危险控制字符返回 null。
 */
function sanitizeRString(input) {
  if (typeof input !== 'string') return null;
  // 换行/回车等控制字符直接拒（防 R 代码注入）
  if (/[\n\r]/.test(input)) return null;
  // 转义反斜杠和双引号
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = { sanitizeParam, assertSafePath, sanitizeRString };
