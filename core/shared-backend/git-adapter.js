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
const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
function createGitAdapter(options = {}) {
  const { gitDir, workTree } = options;
  if (!gitDir || typeof gitDir !== 'string') {
    throw new GitAdapterError('git_dir_required', 'gitDir is required.');
  }
  if (!workTree || typeof workTree !== 'string') {
    throw new GitAdapterError('work_tree_required', 'workTree is required.');
  }
  const resolvedGitDir = path.resolve(gitDir);
  const resolvedWorkTree = path.resolve(workTree);
  const gitBin = options.gitBin || 'git';
  const allowHooks = options.allowHooks === true;
  const identity = options.identity || null;
  const scope = { gitDir: resolvedGitDir, workTree: resolvedWorkTree };

  /**
   * 执行一条 git 命令。参数以数组传入，不经 shell。
   *
   * @param {string[]} args
   * @param {{ allowFailure?: boolean, readOnly?: boolean, timeout?: number }} [runOptions]
   */
  function run(args, runOptions = {}) {
    const prefix = ['--git-dir', resolvedGitDir, '--work-tree', resolvedWorkTree];
    if (!allowHooks) {
      // 指向一个我们从不创建的目录 → git 找不到任何 hook，等价于禁用。
      prefix.unshift('-c', `core.hooksPath=${path.join(resolvedGitDir, 'biof3-disabled-hooks')}`);
    }
    const env = baseEnv();
    if (runOptions.readOnly) env.GIT_OPTIONAL_LOCKS = '0';
    let stdout = '';
    try {
      stdout = execFileSync(gitBin, [...prefix, ...args], {
        encoding: 'utf8',
        cwd: fs.existsSync(resolvedWorkTree) ? resolvedWorkTree : undefined,
        env: { ...env, ...(runOptions.env || {}) },
        input: runOptions.input,
        timeout: runOptions.timeout || 60000,
        maxBuffer: 32 * 1024 * 1024,
        stdio: [runOptions.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      return { ok: true, stdout: stdout == null ? '' : String(stdout), stderr: '', status: 0 };
    } catch (error) {
      const systemCode = error && typeof error.code === 'string' ? error.code : null;
      const failure = {
        ok: false,
        command: args[0] || null,
        stdout: error && error.stdout ? String(error.stdout) : '',
        stderr: redactGitDiagnostic(error && error.stderr ? String(error.stderr) : (error && error.message), scope),
        status: error && typeof error.status === 'number' ? error.status : null,
        systemCode,
        signal: error && typeof error.signal === 'string' ? error.signal : null,
        killed: error && error.killed === true,
        code: systemCode === 'ENOENT' ? 'git_executable_not_found' : 'git_command_failed',
      };
      if (runOptions.allowFailure) return failure;
      throw new GitAdapterError(failure.code, `git ${args[0] || ''} failed`, failure);
    }
  }

  function identityArgs() {
    if (!identity || !identity.name || !identity.email) return [];
    return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
  }

  return {
    gitAdapterVersion: GIT_ADAPTER_VERSION,
    gitDir: resolvedGitDir,
    workTree: resolvedWorkTree,
    gitBin,

    run,

    /** 该 gitDir 是否已经是一个仓库。 */
    isRepository() {
      if (!fs.existsSync(path.join(resolvedGitDir, 'HEAD'))) return false;
      return run(['rev-parse', '--git-dir'], { allowFailure: true, readOnly: true }).ok;
    },

    /**
     * 初始化托管仓库（git 元数据与工作区分离，用户目录不出现 .git）。
     * 幂等：已存在则只补齐本地身份配置。
     */
    initManaged() {
      fs.mkdirSync(path.dirname(resolvedGitDir), { recursive: true });
      if (!fs.existsSync(path.join(resolvedGitDir, 'HEAD'))) {
        const init = run(['init', '--quiet'], { allowFailure: true });
        if (!init.ok) throw new GitAdapterError('git_init_failed', 'Managed repository init failed.', init);
      }
      // 托管仓库自带提交身份，避免机器没有 global identity 时提交失败。
      run(['config', 'user.name', identity?.name || 'BioF3'], { allowFailure: true });
      run(['config', 'user.email', identity?.email || 'biof3@localhost'], { allowFailure: true });
      // 托管历史不对外推送，显式关闭 gc 自动打包外的远程行为面。
      run(['config', 'core.logAllRefUpdates', 'true'], { allowFailure: true });
      return this.repositoryState();
    },

    /** 仓库运行态：锁、中途操作、submodule、linked worktree、HEAD。 */
    repositoryState() {
      const hasIndexLock = fs.existsSync(path.join(resolvedGitDir, 'index.lock'));
      const mergeInProgress = fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD'));
      const cherryPickInProgress = fs.existsSync(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD'));
      const revertInProgress = fs.existsSync(path.join(resolvedGitDir, 'REVERT_HEAD'));
      const rebaseInProgress = fs.existsSync(path.join(resolvedGitDir, 'rebase-merge'))
        || fs.existsSync(path.join(resolvedGitDir, 'rebase-apply'));
      const hasSubmodules = fs.existsSync(path.join(resolvedWorkTree, '.gitmodules'));
      // 下面三个字段各需一次 git 子进程，而上面的锁/中途操作/submodule 判断
      // 全是 fs.existsSync。`bindProjectRepository()` 在 managed 模式下只读
      // fs 那几项（git-repository-binding.js:301-317），
      // linkedWorktreeCount 仅在 `mode === 'existing'` 分支使用，
      // 因此只读请求过去白付三次 fork。
      //
      // 改为惰性求值：对象形状与字段语义不变，读到才 fork，读一次缓存一次。
      // 写路径（result-changeset-service.js:242 读 headCommit）照常付出代价。
      let headProbe = null;
      const probeHead = () => {
        if (!headProbe) {
          headProbe = {
            ref: run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true, readOnly: true }),
            commit: run(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true, readOnly: true }),
          };
        }
        return headProbe;
      };
      let worktreeCount = null;
      const probeWorktrees = () => {
        if (worktreeCount === null) {
          const worktrees = run(['worktree', 'list', '--porcelain'], { allowFailure: true, readOnly: true });
          worktreeCount = worktrees.ok
            ? Math.max(0, worktrees.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length - 1)
            : 0;
        }
        return worktreeCount;
      };
      return {
        gitAdapterVersion: GIT_ADAPTER_VERSION,
        initialized: fs.existsSync(path.join(resolvedGitDir, 'HEAD')),
        // getter：读到才 fork。属性访问语义与原来完全一致，
        // 既有读取方（result-changeset-service.js:242、test/git-adapter.test.mjs:208/:344）无需改动。
        get headRef() {
          const { ref } = probeHead();
          return ref.ok ? ref.stdout.trim() || null : null;
        },
        get headCommit() {
          const { commit } = probeHead();
          return commit.ok ? commit.stdout.trim() || null : null;
        },
        get detached() {
          const { ref, commit } = probeHead();
          return ref.ok ? false : !!(commit.ok && commit.stdout.trim());
        },
        get unborn() {
          const { commit } = probeHead();
          return !(commit.ok && commit.stdout.trim());
        },
        hasIndexLock,
        mergeInProgress,
        cherryPickInProgress,
        revertInProgress,
        rebaseInProgress,
        midOperation: mergeInProgress || cherryPickInProgress || revertInProgress || rebaseInProgress,
        hasSubmodules,
        get linkedWorktreeCount() { return probeWorktrees(); },
      };
    },

    /**
     * 路径受限状态查询。必须提供显式 pathspec。
     *
     * 默认 `untracked='all'`：`normal` 会把完全未跟踪的目录折叠成一个条目
     * （例如新建的 `analysis/scripts/x.R` 只报告 `analysis/`），
     * 会让受管理路径下的用户新文件在冲突检测中漏判。
     */
    status({ paths, untracked = 'all' } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const mode = ['no', 'normal', 'all'].includes(untracked) ? untracked : 'all';
      const output = run(
        ['status', '--porcelain=v1', '-z', `--untracked-files=${mode}`, '--', ...safe],
        { allowFailure: true, readOnly: true }
      );
      if (!output.ok) throw new GitAdapterError('git_status_failed', 'Scoped git status failed.', output);
      const parsed = parsePorcelainZ(output.stdout);
      return {
        scope: 'paths',
        paths: safe,
        ...parsed,
        dirty: parsed.entries.some((entry) => !entry.untracked),
        hasUntracked: parsed.entries.some((entry) => entry.untracked),
        hasConflict: parsed.entries.some((entry) => entry.conflicted),
      };
    },

    /**
     * 仓库级状态。仅用于绑定既有用户仓库时判断 clean/dirty；
     * 托管模式下工作区可能包含大量科学数据，不应调用。
     */
    repositoryStatus({ untracked = 'normal' } = {}) {
      const mode = ['no', 'normal', 'all'].includes(untracked) ? untracked : 'normal';
      const output = run(
        ['status', '--porcelain=v1', '-z', `--untracked-files=${mode}`],
        { allowFailure: true, readOnly: true }
      );
      if (!output.ok) throw new GitAdapterError('git_status_failed', 'Repository git status failed.', output);
      const parsed = parsePorcelainZ(output.stdout);
      return {
        scope: 'repository',
        ...parsed,
        dirty: parsed.entries.some((entry) => !entry.untracked),
        hasUntracked: parsed.entries.some((entry) => entry.untracked),
        hasConflict: parsed.entries.some((entry) => entry.conflicted),
      };
    },

    /** 路径受限 diff。`staged` 走 --cached；给定 refs 则比较两个提交。 */
    diff({ paths, staged = false, fromRef = null, toRef = null } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const args = ['diff', '--no-color', '--no-ext-diff'];
      if (staged) args.push('--cached');
      if (fromRef) args.push(fromRef);
      if (toRef) args.push(toRef);
      args.push('--', ...safe);
      const output = run(args, { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_diff_failed', 'Scoped git diff failed.', output);
      return { paths: safe, patch: output.stdout };
    },

    /** 显式路径暂存。整树写法在 assertSafePathspecs 层已被拒绝。 */
    stage({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const output = run(['add', '--', ...safe], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_stage_failed', 'Scoped git add failed.', output);
      return { staged: safe };
    },

    /**
     * 路径受限提交：只提交给定 pathspec，不会带入其他已暂存内容。
     */
    commit({ message, paths } = {}) {
      if (typeof message !== 'string' || message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      const safe = assertSafePathspecs(paths, scope);
      this.stage({ paths: safe });
      const args = [...identityArgs(), 'commit', '--quiet', '--no-verify', '-m', message, '--only', '--', ...safe];
      const output = run(args, { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_commit_failed', 'Scoped git commit failed.', output);
      const head = run(['rev-parse', 'HEAD'], { allowFailure: true, readOnly: true });
      return {
        commit: head.ok ? head.stdout.trim() : null,
        paths: safe,
        message,
      };
    },

    revParse(ref) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const output = run(['rev-parse', '--verify', '--quiet', ref], { allowFailure: true, readOnly: true });
      return output.ok ? output.stdout.trim() || null : null;
    },

    /** Distinguish an absent ref from an unreadable repository. */
    readRefExact(ref) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const output = run(['rev-parse', '--verify', '--quiet', ref], {
        allowFailure: true,
        readOnly: true,
      });
      if (output.ok) {
        const oid = output.stdout.trim();
        if (/^[a-f0-9]{40}$/.test(oid)) return oid;
        throw new GitAdapterError('git_ref_read_failed', 'Git returned an invalid ref object id.', output);
      }
      if (output.status === 1) return null;
      throw new GitAdapterError('git_ref_read_failed', 'Git ref state could not be read exactly.', output);
    },

    /**
     * 批量解析多个 ref/commit：一次子进程替代 N 次 revParse。
     *
     * `inspectRevisionIntegrity` 过去按 revision 逐个 revParse，实测约
     * 20ms/revision（每 revision 两次 fork × ~10ms），于是 workspace/status
     * 的开销随项目历史线性增长，约 10 个 revision 就会撞破 250ms 事件循环预算。
     *
     * 用 `cat-file --batch-check` 一次读完 stdin 上的全部对象。返回 Map，
     * 语义与 revParse 对齐：解析不到的键映射为 null。
     */
    resolveManyRefs(refs) {
      const wanted = [...new Set((refs || []).filter(
        (ref) => typeof ref === 'string' && ref.trim() !== '' && !ref.startsWith('-'),
      ))];
      const resolved = new Map(wanted.map((ref) => [ref, null]));
      if (wanted.length === 0) return resolved;
      const output = run(['cat-file', '--batch-check=%(objectname) %(rest)'], {
        allowFailure: true,
        readOnly: true,
        // %(rest) 回显该行 ref 之后的内容，用它把结果对回请求的键，
        // 避免依赖行序或对 peel 后的名字做猜测。
        input: `${wanted.map((ref) => `${ref} ${ref}`).join('\n')}\n`,
      });
      if (!output.ok) return resolved;
      for (const line of output.stdout.split('\n')) {
        if (!line.trim()) continue;
        // 命中: "<sha> <原始键>"；未命中: "<原始键> missing"
        const hit = /^([a-f0-9]{40,64})\s+(.+)$/.exec(line);
        if (hit && resolved.has(hit[2])) resolved.set(hit[2], hit[1]);
      }
      return resolved;
    },

    /**
     * 一次列出某前缀下的全部 ref。
     *
     * 替代「对每个 current revision 各 revParse 一次」的写法。
     */
    listRefs(prefix) {
      if (typeof prefix !== 'string' || prefix.trim() === '' || prefix.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref prefix.');
      }
      const output = run(['for-each-ref', '--format=%(refname) %(objectname)', prefix], {
        allowFailure: true,
        readOnly: true,
      });
      const refs = new Map();
      if (!output.ok) return refs;
      for (const line of output.stdout.split('\n')) {
        const match = /^(\S+)\s+([a-f0-9]{40,64})$/.exec(line.trim());
        if (match) refs.set(match[1], match[2]);
      }
      return refs;
    },

    /** Atomically apply one exact BioF3 ref compare-and-swap cohort. */
    updateRefsCas({ updates } = {}) {
      if (!Array.isArray(updates) || updates.length === 0) {
        throw new GitAdapterError('ref_transaction_invalid', 'At least one ref update is required.');
      }
      const normalized = updates.map((entry) => ({
        ref: String(entry?.ref || ''),
        expectedOld: String(entry?.expectedOld || ''),
        newOid: String(entry?.newOid || ''),
      }));
      if (new Set(normalized.map((entry) => entry.ref)).size !== normalized.length
          || normalized.some((entry) =>
            !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(entry.ref)
            || !/^[a-f0-9]{40}$/.test(entry.expectedOld)
            || !/^[a-f0-9]{40}$/.test(entry.newOid)
            || entry.expectedOld === entry.newOid)) {
        throw new GitAdapterError(
          'ref_transaction_invalid',
          'Every ref transaction entry must be one unique exact BioF3 compare-and-swap.'
        );
      }
      const zero = '0'.repeat(40);
      const commands = ['start'];
      for (const entry of normalized) {
        if (entry.newOid === zero) commands.push(`delete ${entry.ref} ${entry.expectedOld}`);
        else if (entry.expectedOld === zero) commands.push(`create ${entry.ref} ${entry.newOid}`);
        else commands.push(`update ${entry.ref} ${entry.newOid} ${entry.expectedOld}`);
      }
      commands.push('prepare', 'commit');
      const result = run(['update-ref', '--stdin'], {
        allowFailure: true,
        input: `${commands.join('\n')}\n`,
      });
      if (!result.ok) {
        throw new GitAdapterError(
          'git_ref_transaction_conflict',
          'Git refs changed concurrently or could not be committed atomically.',
          result,
        );
      }
      return { updated: normalized.length, updates: normalized };
    },

    /**
     * 以 compare-and-swap 更新一个 BioF3 refs/heads 引用。
     * 调用方必须给出预期旧值；不存在的 ref 使用 40 个 0。
     */
    updateRefCas({ ref, newCommit, expectedOld } = {}) {
      if (typeof ref !== 'string' || !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/biof3/* destination is required.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(newCommit || ''))) {
        throw new GitAdapterError('new_commit_invalid', 'newCommit must be a full git object id.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(expectedOld || ''))) {
        throw new GitAdapterError('expected_old_invalid', 'expectedOld must be a full git object id or forty zeroes.');
      }
      const updated = run(['update-ref', ref, newCommit, expectedOld], { allowFailure: true });
      if (!updated.ok) throw new GitAdapterError('git_ref_conflict', 'Git ref changed concurrently.', updated);
      return { ref, commit: newCommit, previous: expectedOld };
    },

    deleteRefCas({ ref, expectedOld } = {}) {
      if (typeof ref !== 'string' || !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/biof3/* destination is required.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(expectedOld || ''))) {
        throw new GitAdapterError('expected_old_invalid', 'expectedOld must be a full git object id.');
      }
      const deleted = run(['update-ref', '-d', ref, expectedOld], { allowFailure: true });
      if (!deleted.ok) throw new GitAdapterError('git_ref_conflict', 'Git ref changed concurrently.', deleted);
      return { ref, deleted: true, previous: expectedOld };
    },

    /** 读取某个提交中的文件内容，用于版本恢复与前后比较。 */
    showFile({ ref, filePath } = {}) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const [safe] = assertSafePathspecs([filePath], scope);
      const output = run(['show', `${ref}:${safe}`], { allowFailure: true, readOnly: true });
      if (!output.ok) return null;
      return output.stdout;
    },

    /** 创建隔离分支。不切换当前 HEAD 的调用方需自行决定。 */
    createBranch({ name, startPoint = 'HEAD' } = {}) {
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(name)) {
        throw new GitAdapterError('branch_name_invalid', 'Invalid branch name.');
      }
      const output = run(['branch', name, startPoint], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_branch_failed', 'Branch creation failed.', output);
      return { branch: name, startPoint };
    },

    /**
     * 从内存文件构造隔离 commit，不 checkout、不改写工作区。
     * 临时 index + Git plumbing 只更新指定 ref，并以 expectedOld 做 CAS。
     */
    commitVirtualFiles({ parentCommit = null, ref, expectedOld = null, message, files } = {}) {
      if (parentCommit && !/^[a-f0-9]{7,40}$/.test(parentCommit)) {
        throw new GitAdapterError('parent_commit_invalid', 'parentCommit must be a git object id.');
      }
      if (typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/* destination is required.');
      }
      if (typeof message !== 'string' || message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitAdapterError('virtual_files_required', 'At least one virtual file is required.');
      }
      const safePaths = assertSafePathspecs(files.map((file) => file && file.path), scope);
      if (new Set(safePaths).size !== files.length) {
        throw new GitAdapterError('virtual_file_duplicate', 'Virtual file paths must be unique.');
      }
      const indexPath = path.join(resolvedGitDir, `biof3-index-${randomUUID()}`);
      const isolatedEnv = { GIT_INDEX_FILE: indexPath };
      try {
        const readTree = parentCommit
          ? run(['read-tree', parentCommit], { allowFailure: true, env: isolatedEnv })
          : run(['read-tree', '--empty'], { allowFailure: true, env: isolatedEnv });
        if (!readTree.ok) throw new GitAdapterError('git_read_tree_failed', 'Cannot initialize isolated Git index.', readTree);

        for (let index = 0; index < files.length; index += 1) {
          const content = files[index].content;
          if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
            throw new GitAdapterError('virtual_file_content_invalid', `Virtual file content is invalid: ${safePaths[index]}`);
          }
          let blob = null;
          let attempts = 0;
          while (attempts < HASH_OBJECT_MAX_ATTEMPTS) {
            attempts += 1;
            blob = run(['hash-object', '-w', '--stdin'], {
              allowFailure: true,
              env: isolatedEnv,
              input: content,
              timeout: HASH_OBJECT_TIMEOUT_MS,
            });
            if (blob.ok && /^[a-f0-9]{40}$/.test(blob.stdout.trim())) break;
            const transientInvocationFailure = blob.status === null && (
              ['EAGAIN', 'EINTR', 'ETIMEDOUT'].includes(blob.systemCode)
            );
            if (!transientInvocationFailure) break;
          }
          if (!blob.ok || !/^[a-f0-9]{40}$/.test(blob.stdout.trim())) {
            throw new GitAdapterError('git_hash_object_failed', 'Cannot write isolated Git blob.', {
              ...blob,
              attempts,
            });
          }
          const update = run(
            ['update-index', '--add', '--cacheinfo', '100644', blob.stdout.trim(), safePaths[index]],
            { allowFailure: true, env: isolatedEnv }
          );
          if (!update.ok) throw new GitAdapterError('git_update_index_failed', 'Cannot update isolated Git index.', update);
        }

        const tree = run(['write-tree'], { allowFailure: true, env: isolatedEnv });
        if (!tree.ok || !/^[a-f0-9]{40}$/.test(tree.stdout.trim())) {
          throw new GitAdapterError('git_write_tree_failed', 'Cannot write isolated Git tree.', tree);
        }
        const commitArgs = [...identityArgs(), 'commit-tree', tree.stdout.trim()];
        if (parentCommit) commitArgs.push('-p', parentCommit);
        commitArgs.push('-m', message);
        const commit = run(commitArgs, { allowFailure: true, env: isolatedEnv });
        if (!commit.ok || !/^[a-f0-9]{40}$/.test(commit.stdout.trim())) {
          throw new GitAdapterError('git_commit_tree_failed', 'Cannot create isolated Git commit.', commit);
        }
        const existingRef = this.revParse(ref);
        const old = expectedOld || existingRef || '0'.repeat(40);
        const updateRef = run(['update-ref', ref, commit.stdout.trim(), old], { allowFailure: true });
        if (!updateRef.ok) {
          throw new GitAdapterError('git_ref_conflict', 'Isolation ref changed concurrently.', updateRef);
        }
        return {
          commit: commit.stdout.trim(),
          tree: tree.stdout.trim(),
          ref,
          parentCommit,
          paths: safePaths,
        };
      } finally {
        try { fs.unlinkSync(indexPath); } catch { /* temporary index may not exist */ }
        try { fs.unlinkSync(`${indexPath}.lock`); } catch { /* best effort */ }
      }
    },

    listTrackedFiles({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const output = run(['ls-files', '-z', '--', ...safe], { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_ls_files_failed', 'Scoped ls-files failed.', output);
      return output.stdout.split('\0').filter(Boolean);
    },
  };
}

module.exports = {
  GIT_ADAPTER_VERSION,
  MINIMUM_GIT_VERSION,
  FORBIDDEN_PATHSPECS,
  GitAdapterError,
  detectGitRuntime,
  resetGitRuntimeCache,
  assertSafePathspecs,
  redactGitDiagnostic,
  parseGitVersion,
  createGitAdapter,
};
