'use strict';

/**
 * M5 / BLOCK-431 — 安全与正确性判据（8 项收敛单一纯模块，零新增依赖）。
 *
 * 红线：
 *   - **不改 workspace_exec 默认放行裁决**（2026-11-05 S2）；只补补偿控制与风险声明显式化。
 *   - 本模块是判据层（纯函数、零副作用），不直接改生产调用链；
 *     生产接线（bootstrap.js / mcp-client.js / file-dialog.js / main.js / secret-scan.mjs）
 *     按蓝图归 M6-A 统一接线，带 BLOCK-92 拆前拆后同套绿基线。
 *   - 所有植入样例均为合成数据，不含真实凭据/密钥；不写盘、不发 IPC、不 spawn。
 *   - 失败一律 fail-closed + 具名 reasonCode，拒绝「异常→{}」与「全 0 统计」假成功。
 */

const crypto = require('crypto');
const path = require('path');

const MAX_DRAG_BYTES = 20 * 1024 * 1024;
const PAGE_LIMIT_MAX = 1000;
const DEPRECATED_BEARERS = Object.freeze(['desktop-local', 'Bearer desktop-local']);

/** per-boot 随机 token：每次启动都不同，废弃常量 Bearer 不再可信。 */
function createBootToken({ seed } = {}) {
  if (seed !== undefined) return crypto.createHash('sha256').update(`m5-boot-${seed}`).digest('hex');
  return crypto.randomBytes(24).toString('hex');
}

/** M5-2 空 Origin 全方法都要 token；伪造 Origin 一律拒。 */
function adjudicateLocalRequest({ origin = '', method = 'GET', token = null, bootToken = '', trusted = false } = {}) {
  const o = String(origin || '');
  if (o && !trusted) return { ok: false, reasonCode: 'ORIGIN_UNTRUSTED', status: 403 };
  if (DEPRECATED_BEARERS.includes(String(token))) return { ok: false, reasonCode: 'DEPRECATED_BEARER', status: 403 };
  if (!token || token !== bootToken) return { ok: false, reasonCode: 'TOKEN_REQUIRED', status: 403 };
  return { ok: true, reasonCode: 'OK', method: String(method).toUpperCase(), emptyOrigin: o === '' };
}

/** M5-1 MCP 写面 stdio command 白名单；args 不接受 shell 拼接串。 */
function adjudicateMcpCommand({ command = '', args = [], allowlisted = ['node', 'npx', 'python3'] } = {}) {
  const cmd = path.basename(String(command || ''));
  if (!allowlisted.includes(cmd)) return { ok: false, reasonCode: 'MCP_COMMAND_NOT_ALLOWLISTED', status: 403 };
  if (!Array.isArray(args)) return { ok: false, reasonCode: 'MCP_ARGS_NOT_ARRAY', status: 400 };
  if (args.some((a) => typeof a === 'string' && /[;&|`$]/.test(a))) {
    return { ok: false, reasonCode: 'MCP_ARGS_SHELL_METACHAR', status: 400 };
  }
  return { ok: true, reasonCode: 'OK', command: cmd };
}

/** M5-3 drag 路径：登记根 + realpath 边界 + basename + 内容长度上限。 */
function adjudicateDragPath({ localPath = '', registeredRoots = [], realpath = '', name = '', bytes = 0 } = {}) {
  const resolved = String(realpath || localPath);
  const rootHit = registeredRoots.some((root) => {
    const r = String(root);
    return resolved === r || resolved.startsWith(`${r}${path.sep}`);
  });
  if (!rootHit) return { ok: false, reasonCode: 'DRAG_PATH_OUTSIDE_REGISTERED_ROOT', status: 403 };
  if (String(name) !== path.basename(String(name))) return { ok: false, reasonCode: 'DRAG_NAME_NOT_BASENAME', status: 400 };
  if (Number(bytes) > MAX_DRAG_BYTES) return { ok: false, reasonCode: 'DRAG_CONTENT_TOO_LARGE', status: 413 };
  return { ok: true, reasonCode: 'OK', resolved, rootHit };
}

/** M5-4 帧导航 allowlist（含 userinfo 过滤）+ 权限降级覆盖所有 session。 */
function adjudicateFrameNavigation({ url = '', allowlist = [] } = {}) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return { ok: false, reasonCode: 'INVALID_URL', status: 400 }; }
  if (parsed.username || parsed.password) return { ok: false, reasonCode: 'USERINFO_FORBIDDEN', status: 403 };
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!allowlist.some((a) => String(a) === origin)) return { ok: false, reasonCode: 'FRAME_ORIGIN_NOT_ALLOWLISTED', status: 403 };
  return { ok: true, reasonCode: 'OK', origin };
}

function adjudicatePermissionSessions({ sessions = [], sessionCreatedHook = false, denied = [] } = {}) {
  const missing = sessions.filter((s) => !denied.includes(s));
  if (missing.length) return { ok: false, reasonCode: 'PERMISSION_DENY_INCOMPLETE', missing };
  if (sessions.length > 1 && !sessionCreatedHook) {
    return { ok: false, reasonCode: 'SESSION_CREATED_HOOK_MISSING' };
  }
  return { ok: true, reasonCode: 'OK', covered: sessions.length };
}

/** M5-5 tar 条目校验 + zip 失败清理计划。 */
function adjudicateTarEntry({ path: entryPath = '', type = 'file', linkname = '' } = {}) {
  const p = String(entryPath);
  if (path.posix.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) return { ok: false, reasonCode: 'TAR_ABSOLUTE_PATH' };
  if (p.split(/[\\/]/).includes('..')) return { ok: false, reasonCode: 'TAR_PATH_TRAVERSAL' };
  if (type === 'symlink' || type === 'link') return { ok: false, reasonCode: 'TAR_LINK_ENTRY', linkname: String(linkname) };
  return { ok: true, reasonCode: 'OK' };
}

function cleanupPlan({ destDir = '', failed = false } = {}) {
  return failed
    ? { remove: String(destDir), reason: 'ZIP_FAILED' }
    : { remove: null, reason: null };
}

/** M5-6 假成功治理：统一 IPC 失败信封 + DDL 静默不得判成功。 */
function failureEnvelope({ error, operation = 'unknown' } = {}) {
  return Object.freeze({
    ok: false,
    code: (error && error.code) || 'OPERATION_FAILED',
    operation: String(operation),
    message: error && error.message ? String(error.message).slice(0, 200) : 'operation failed',
    stats: null,
  });
}

function ddlOutcome({ succeeded = false, suppressed = false } = {}) {
  if (!succeeded) return { ok: false, code: suppressed ? 'DDL_FAILED_SILENTLY' : 'DDL_FAILED' };
  if (suppressed) return { ok: false, code: 'DDL_RESULT_SUPPRESSED' };
  return { ok: true, code: 'DDL_OK' };
}

/** M5-7 git grep 只有 exit 1 = 无命中；其它错误（含 ENOENT/128/-1）一律 fail-closed。 */
function adjudicateGitGrepResult({ exitCode, stderr = '' } = {}) {
  if (exitCode === 0) return { status: 'matched' };
  if (exitCode === 1 && !String(stderr).trim()) return { status: 'no-match' };
  return { status: 'fail-closed', reasonCode: 'GIT_GREP_FAILED', stderr: String(stderr).slice(0, 200) };
}

/** 渲染层日志脱敏（token / key / Bearer 形态）。 */
function redactLog(line = '') {
  return String(line)
    .replace(/(token|api[_-]?key|secret|password|authorization)\s*[=:]\s*[^\s,;"']+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
}

/**
 * BLOCK-437（M5-3 生产接线，按最佳实践默认）— 拖入/导入源范围判定。
 *
 * 与 `adjudicateDragPath` 的区别：那个针对「已登记根内的拖出/拖放」，要求 roots 命中；
 * `fs/import-from` 的源路径按设计在项目根之外（用户从桌面任意位置拖文件进来），
 * 因此不能用 roots 命中，改用「允许根 + 设备路径拒绝 + realpath 归一」三件套：
 *   1. 绝对路径 / 无 NUL / basename 长度上限；
 *   2. 拒绝伪文件系统（/dev /proc /sys）—— 这些不是用户文件，读了也没有意义；
 *   3. 归一后的 realpath 必须落在允许根内（默认 家目录 / 临时目录 / /Volumes），
 *      防符号链接逃逸；`PETRI_DRAG_SOURCE_ROOTS='*'` 可显式放开（自担风险，写入证据时记录）。
 */
const DRAG_SOURCE_MAX_NAME = 255;
const DRAG_SOURCE_DEVICE_PREFIXES = ['/dev', '/proc', '/sys'];

function adjudicateDragSource({ localPath = '', realpath = '', allowedRoots = [], exists = true } = {}) {
  const raw = String(localPath || '');
  if (!raw) return { ok: false, reasonCode: 'DRAG_SOURCE_EMPTY', status: 400 };
  if (raw.includes('\u0000')) return { ok: false, reasonCode: 'DRAG_SOURCE_NUL_BYTE', status: 400 };
  if (!path.isAbsolute(raw)) return { ok: false, reasonCode: 'DRAG_SOURCE_NOT_ABSOLUTE', status: 400 };

  const resolved = String(realpath || raw);
  const base = path.basename(resolved);
  if (!base || base.length > DRAG_SOURCE_MAX_NAME) {
    return { ok: false, reasonCode: 'DRAG_SOURCE_NAME_INVALID', status: 400 };
  }
  if (base === '..' || base === '.') {
    return { ok: false, reasonCode: 'DRAG_SOURCE_NAME_INVALID', status: 400 };
  }
  for (const prefix of DRAG_SOURCE_DEVICE_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)) {
      return { ok: false, reasonCode: 'DRAG_SOURCE_DEVICE_PATH', status: 403 };
    }
  }
  if (exists === false) return { ok: false, reasonCode: 'DRAG_SOURCE_MISSING', status: 404 };

  const roots = (Array.isArray(allowedRoots) ? allowedRoots : [])
    .map((r) => String(r || ''))
    .filter(Boolean);
  if (roots.length > 0 && !roots.includes('*')) {
    const hit = roots.some((root) => {
      const normalized = root.endsWith(path.sep) ? root.slice(0, -1) : root;
      return resolved === normalized || resolved.startsWith(`${normalized}${path.sep}`);
    });
    if (!hit) return { ok: false, reasonCode: 'DRAG_SOURCE_OUTSIDE_ALLOWED_ROOTS', status: 403 };
  }
  return { ok: true, reasonCode: 'OK', resolved };
}

/** M5-8 limit/offset 断言 + 原子写 tmp+rename 计划。 */
function adjudicatePaging({ limit, offset = 0 } = {}) {
  const l = Number(limit);
  const o = Number(offset);
  if (!Number.isInteger(l) || l < 0 || l > PAGE_LIMIT_MAX) return { ok: false, reasonCode: 'INVALID_LIMIT' };
  if (!Number.isInteger(o) || o < 0) return { ok: false, reasonCode: 'INVALID_OFFSET' };
  return { ok: true, reasonCode: 'OK', limit: l, offset: o };
}

function atomicWritePlan({ target = '' } = {}) {
  const t = String(target);
  return Object.freeze({ tmp: `${t}.${process.pid}.tmp`, rename: t, strategy: 'tmp+rename' });
}

module.exports = {
  MAX_DRAG_BYTES,
  PAGE_LIMIT_MAX,
  DEPRECATED_BEARERS,
  createBootToken,
  adjudicateLocalRequest,
  adjudicateMcpCommand,
  adjudicateDragPath,
  adjudicateFrameNavigation,
  adjudicatePermissionSessions,
  adjudicateTarEntry,
  cleanupPlan,
  failureEnvelope,
  ddlOutcome,
  adjudicateGitGrepResult,
  adjudicateDragSource,
  DRAG_SOURCE_MAX_NAME,
  redactLog,
  adjudicatePaging,
  atomicWritePlan,
};
