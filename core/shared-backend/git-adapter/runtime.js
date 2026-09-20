'use strict';

// BLOCK-92 Wave C-9 — git 运行时探测/诊断脱敏/pathspec 安全校验/porcelain 解析
// 与 unified-diff 反演外迁（原 git-adapter.js 29-305 + 1518-1537 行，
// 纯搬运零行为变化）。

'use strict';

/**
 * shared-backend/git-adapter.js
 *
 * G0-RS1 — Result Studio 的唯一 Git 命令边界。
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md ADR-RS-3
 * - 以子进程调用系统 git，不引入 simple-git / isomorphic-git / nodegit / dugite。
 * - 所有命令由本文件生成；UI 与 Harness 不得自行拼接 git shell 命令。
 *
 * 不变量：
 * - 永不使用 `git add .` / `git add -A` / `git add -u`；所有暴露的写操作必须携带显式 pathspec。
 * - 参数以数组传入 execFileSync，不经过 shell，因此不存在命令注入面。
 * - 以 `-` 开头的 pathspec 一律拒绝，避免把用户路径解释成 git 选项。
 * - 托管仓库默认不执行任何 git hooks。
 * - 诊断信息在返回前脱敏：绝对路径、home 目录与疑似凭据不外泄。
 * - 本模块不判定科学有效性，也不写 Artifact；它只负责文本版本事实。
 */

const { execFileSync } = require('child_process');
const path = require('path');
// 避免参数 `path` 与 module 同名遮蔽
const os = require('os');


const GIT_ADAPTER_VERSION = 1;

/** 低于该版本不保证 `--porcelain=v1 -z` 与 worktree 子命令行为一致。 */
const MINIMUM_GIT_VERSION = Object.freeze({ major: 2, minor: 20, patch: 0 });

/**
 * 整树暂存与等价写法一律禁止。RS 的每次修改都必须能回答"改了哪些路径"。
 */
const FORBIDDEN_PATHSPECS = Object.freeze(new Set([
  '.', './', '..', '*', ':', ':/', ':/.',
  '-A', '--all', '-u', '--update', '--no-all', '-a',
]));

const SENSITIVE_VALUE = /(?:sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

const MAX_STATUS_ENTRIES = 5000;
const MAX_DIAGNOSTIC_LENGTH = 2000;
const HASH_OBJECT_TIMEOUT_MS = 10000;
const HASH_OBJECT_MAX_ATTEMPTS = 2;

class GitAdapterError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'GitAdapterError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 脱敏诊断文本：先替换工作区/home 绝对路径，再屏蔽疑似凭据，最后截断。
 *
 * @param {string} value
 * @param {{ workTree?: string|null, gitDir?: string|null }} [scope]
 * @returns {string}
 */
function redactGitDiagnostic(value, scope = {}) {
  if (value == null) return '';
  let text = String(value);
  const replacements = [
    [scope.gitDir, '<gitdir>'],
    [scope.workTree, '<workspace>'],
    [os.homedir(), '<home>'],
    [os.tmpdir(), '<tmp>'],
  ];
  for (const [absolute, token] of replacements) {
    if (!absolute) continue;
    // Match both the raw value and the platform-resolved form so redaction
    // works regardless of how the path string appears in the diagnostic
    // (e.g. a Unix-style '/tmp/ws' passed as workTree on Windows).
    const candidates = new Set([absolute, path.resolve(absolute)]);
    for (const candidate of candidates) {
      while (text.includes(candidate)) text = text.replace(candidate, token);
    }
  }
  text = text.replace(SENSITIVE_VALUE, '<redacted>');
  text = text.replace(/\s+$/, '');
  if (text.length > MAX_DIAGNOSTIC_LENGTH) {
    return `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…[truncated]`;
  }
  return text;
}

function parseGitVersion(raw) {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(String(raw || ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  };
}

function versionAtLeast(actual, minimum) {
  if (!actual) return false;
  if (actual.major !== minimum.major) return actual.major > minimum.major;
  if (actual.minor !== minimum.minor) return actual.minor > minimum.minor;
  return actual.patch >= minimum.patch;
}

function baseEnv() {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME || os.homedir(),
    // 稳定输出、绝不交互、不弹凭据窗口。
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}

/**
 * 进程内 git 运行时探测缓存。键为 gitBin。
 *
 * 同一进程内 git 的可用性与版本不会变化，而 `git --version` 在本机实测
 * 约 9～11ms（不同调用环境下可达 ~117ms）。此前该函数不缓存，
 * `bindProjectRepository()` 每次调用都会 fork 一次，而 Result Studio 的
 * 每个只读请求都会 bind 一次（`routes/result-studio.js:302-338`），
 * 因此该 fork 出现在结果查看的热路径上。
 *
 * 只缓存 available/version 这类进程生命周期常量；仓库运行态不在此列。
 */
const gitRuntimeCache = new Map();

/** 清空运行时探测缓存。仅供测试与显式重新探测使用。 */
function resetGitRuntimeCache() {
  gitRuntimeCache.clear();
}

/**
 * 检测系统 git 可用性。按 gitBin 在进程内缓存；用 `refresh: true` 强制重探。
 *
 * @param {{ gitBin?: string, refresh?: boolean }} [options]
 * @returns {{ available: boolean, gitBin: string, version: object|null, versionRaw: string|null,
 *            meetsMinimum: boolean, reason: string|null, minimum: object }}
 */
function detectGitRuntime(options = {}) {
  const gitBin = options.gitBin || 'git';
  if (!options.refresh && gitRuntimeCache.has(gitBin)) {
    return gitRuntimeCache.get(gitBin);
  }
  const result = detectGitRuntimeUncached(gitBin);
  // 只缓存成功探测。失败可能是暂时的（git 尚未安装、PATH 未就绪），
  // 缓存它会把一次暂时故障变成本进程内的永久故障；而失败路径本就提前阻断，
  // 不在热路径上。冻结以防调用方改到共享对象。
  if (result.available) gitRuntimeCache.set(gitBin, Object.freeze(result));
  return result;
}

function detectGitRuntimeUncached(gitBin) {
  const result = {
    gitAdapterVersion: GIT_ADAPTER_VERSION,
    available: false,
    gitBin,
    version: null,
    versionRaw: null,
    meetsMinimum: false,
    reason: null,
    minimum: MINIMUM_GIT_VERSION,
  };
  let raw;
  try {
    raw = execFileSync(gitBin, ['--version'], {
      encoding: 'utf8',
      env: baseEnv(),
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    result.reason = error && error.code === 'ENOENT'
      ? 'git_executable_not_found'
      : 'git_version_probe_failed';
    return result;
  }
  const version = parseGitVersion(raw);
  result.versionRaw = String(raw || '').trim();
  result.version = version;
  if (!version) {
    result.reason = 'git_version_unparsable';
    return result;
  }
  result.available = true;
  result.meetsMinimum = versionAtLeast(version, MINIMUM_GIT_VERSION);
  if (!result.meetsMinimum) result.reason = 'git_version_below_minimum';
  return result;
}

/**
 * 校验并规范化 pathspec 列表。
 *
 * 拒绝整树写法、选项注入、绝对路径、`..` 逃逸与 NUL。
 *
 * @param {string[]} paths
 * @param {{ workTree?: string|null }} [scope]
 * @returns {string[]} posix 相对路径
 * @throws {GitAdapterError}
 */
function assertSafePathspecs(paths, scope = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new GitAdapterError('pathspec_required', 'Explicit pathspecs are required; whole-tree operations are forbidden.');
  }
  const normalized = [];
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      throw new GitAdapterError('pathspec_invalid', 'Each pathspec must be a non-empty string.');
    }
    const raw = candidate.trim();
    if (raw.includes('\0')) {
      throw new GitAdapterError('pathspec_invalid', 'Pathspec must not contain NUL.');
    }
    if (FORBIDDEN_PATHSPECS.has(raw)) {
      throw new GitAdapterError('pathspec_whole_tree_forbidden', `Whole-tree pathspec is forbidden: ${raw}`);
    }
    if (raw.startsWith('-')) {
      throw new GitAdapterError('pathspec_option_like', `Pathspec must not start with "-": ${raw}`);
    }
    if (raw.startsWith(':')) {
      throw new GitAdapterError('pathspec_magic_forbidden', `Pathspec magic is not allowed: ${raw}`);
    }
    let relative = raw.split(path.sep).join('/');
    if (path.isAbsolute(raw)) {
      if (!scope.workTree) {
        throw new GitAdapterError('pathspec_absolute', `Absolute pathspec requires a work tree: ${raw}`);
      }
      const workTree = path.resolve(scope.workTree);
      const resolved = path.resolve(raw);
      if (resolved !== workTree && !resolved.startsWith(workTree + path.sep)) {
        throw new GitAdapterError('pathspec_outside_worktree', 'Pathspec resolves outside the work tree.');
      }
      relative = path.relative(workTree, resolved).split(path.sep).join('/');
      if (relative === '') {
        throw new GitAdapterError('pathspec_whole_tree_forbidden', 'Pathspec must not target the work tree root.');
      }
    }
    if (relative.split('/').includes('..')) {
      throw new GitAdapterError('pathspec_traversal', `Pathspec must not traverse upwards: ${raw}`);
    }
    const posix = path.posix.normalize(relative);
    if (posix === '.' || posix === '/' || posix === '') {
      throw new GitAdapterError('pathspec_whole_tree_forbidden', 'Pathspec must not target the work tree root.');
    }
    normalized.push(posix.replace(/^\.\//, ''));
  }
  return [...new Set(normalized)];
}

function parsePorcelainZ(stdout) {
  const entries = [];
  const chunks = String(stdout || '').split('\0');
  let truncated = false;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    if (entries.length >= MAX_STATUS_ENTRIES) {
      truncated = true;
      break;
    }
    const indexStatus = chunk[0];
    const worktreeStatus = chunk[1];
    let filePath = chunk.slice(3);
    // 重命名/复制条目把来源路径放在下一个 NUL 分段。
    let originalPath = null;
    if (indexStatus === 'R' || indexStatus === 'C') {
      originalPath = chunks[index + 1] || null;
      index += 1;
    }
    entries.push({
      path: filePath,
      originalPath,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      untracked: indexStatus === '?' && worktreeStatus === '?',
      conflicted: indexStatus === 'U' || worktreeStatus === 'U'
        || (indexStatus === 'A' && worktreeStatus === 'A')
        || (indexStatus === 'D' && worktreeStatus === 'D'),
    });
  }
  return { entries, truncated };
}

/**
 * 创建绑定到具体仓库的 Adapter。
 *
 * @param {{ gitDir: string, workTree: string, gitBin?: string, allowHooks?: boolean,
 *           identity?: { name: string, email: string }|null }} options
 */
// BLOCK-29.5 — ref 安全校验：非空字符串、trim 后不以 '-' 开头（防参数注入）；
// 空/非法值回退 null（调用方决定 HEAD 兜底）。log/blame/区间 diff 共用。
function assertSafeRef(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('-')) return null;
  return trimmed;
}


function invertUnifiedDiff(patch) {
  const lines = patch.split('\n');
  const out = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      out.push(line);
    } else if (line.startsWith('@@')) {
      out.push(line);
    } else if (line.startsWith('+')) {
      out.push('-' + line.slice(1));
    } else if (line.startsWith('-')) {
      out.push('+' + line.slice(1));
    } else {
      // context（' '）或空行
      out.push(line);
    }
  }
  return out.join('\n');
}


module.exports = {
  assertSafeRef,
  GIT_ADAPTER_VERSION,
  MINIMUM_GIT_VERSION,
  FORBIDDEN_PATHSPECS,
  GitAdapterError,
  redactGitDiagnostic,
  parseGitVersion,
  versionAtLeast,
  baseEnv,
  resetGitRuntimeCache,
  detectGitRuntime,
  assertSafePathspecs,
  parsePorcelainZ,
  invertUnifiedDiff,
  HASH_OBJECT_TIMEOUT_MS,
  HASH_OBJECT_MAX_ATTEMPTS,
};
