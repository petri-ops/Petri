/**
 * core/r-server/mcp/ide-tools/path-allowlist.js
 *
 * 路径白名单 — IDE MCP 工具的文件/终端操作必须在白名单内。
 * 复用 core/shared-backend/path-safe.js 的 safeJoinUnder 做路径解析，
 * 避免在工具层重新实现路径逃逸防御。
 *
 * 白名单策略：
 * - 允许"当前工作目录 cwd()"（r-server 进程启动时的工作目录）
 * - 允许系统临时目录（os.tmpdir()）
 * - 拒绝其它路径（含 ~/.ssh、/etc、其它项目根）
 * - 不允许直接访问 .git/ 内部文件
 *
 * 设计依据：G0-IDE-MCP-TOOLS 工作包 Phase 1（docs/g0-ide-mcp-tools-plan.md §4.1）
 */

'use strict';

const path = require('node:path');
const os = require('node:os');
const { safeJoinUnder } = require('../../../shared-backend/path-safe');

const HOME = os.homedir();
const BIOF3_LOG_DIR = path.join(HOME, '.biof3', 'logs');

/**
 * 构造允许的根目录集合。返回绝对路径数组。
 * 包含：进程当前工作目录、系统临时目录、~/.biof3/logs
 */
function allowedRoots() {
  const roots = [path.resolve(process.cwd()), os.tmpdir(), BIOF3_LOG_DIR];
  // 去重（process.cwd() 可能在 tmpdir 内）
  return [...new Set(roots)];
}

/**
 * 拒绝名单：相对路径段、git 内部、node_modules 等。
 * 这些前缀即便在白名单内也拒绝。
 */
const DENY_SEGMENTS = new Set([
  '.git',
  '.ssh',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
]);

/**
 * 把用户提供的输入路径解析并校验是否在白名单内。
 *
 * @param {string} inputPath - 用户输入的路径（绝对或相对，相对相对 cwd）
 * @returns {{ok: true, absolutePath: string} | {ok: false, reason: string}}
 */
function resolveAllowlisted(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { ok: false, reason: 'path must be a non-empty string' };
  }
  if (inputPath.includes('\u0000')) {
    return { ok: false, reason: 'path contains null byte' };
  }
  const candidates = allowedRoots();
  let lastErr = null;
  for (const root of candidates) {
    const joined = safeJoinUnder(root, inputPath);
    if (joined) {
      // 二次验证：拒绝名单
      const segments = joined.split(path.sep);
      for (const seg of segments) {
        if (DENY_SEGMENTS.has(seg)) {
          return { ok: false, reason: `path segment "${seg}" is deny-listed` };
        }
      }
      return { ok: true, absolutePath: joined };
    }
    lastErr = `path must resolve under ${root}`;
  }
  return { ok: false, reason: lastErr || 'path not in allowlist' };
}

/**
 * 校验两个路径都在白名单内（用于 rename 等双路径操作）。
 */
function resolveAllowlistedPair(oldPath, newPath) {
  const oldRes = resolveAllowlisted(oldPath);
  if (!oldRes.ok) return { ok: false, reason: `oldPath: ${oldRes.reason}` };
  const newRes = resolveAllowlisted(newPath);
  if (!newRes.ok) return { ok: false, reason: `newPath: ${newRes.reason}` };
  return { ok: true, oldPath: oldRes.absolutePath, newPath: newRes.absolutePath };
}

module.exports = {
  allowedRoots,
  resolveAllowlisted,
  resolveAllowlistedPair,
  BIOF3_LOG_DIR,
};
