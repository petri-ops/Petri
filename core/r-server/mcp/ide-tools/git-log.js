/**
 * core/r-server/mcp/ide-tools/git-log.js
 *
 * Phase 3: IDE Git log MCP tool — `ide_git_log`.
 * Wraps `git log --pretty=format:...` to produce a structured commit list.
 *
 * Format string uses NUL separators (`%x00`) to make parsing unambiguous
 * even when subjects contain newlines / special characters.
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 3（docs/g0-ide-mcp-tools-plan.md §3）
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');

const DEFAULT_LIMIT = 20;
const HARD_MAX_LIMIT = 200;
const GIT_TIMEOUT_MS = 30_000;

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function gitLogToolDefinitions() {
  return [
    {
      name: 'ide_git_log',
      description:
        'List commits for a git repository. Returns { ok, commits: [{ sha, shortSha, author, isoDate, subject }], count, truncated }. ' +
        'Hard cap: limit ≤ 200 (default 20).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository root path (absolute or relative to cwd). Must be in allowlist.',
          },
          limit: {
            type: 'number',
            description: 'Maximum commits to return (default 20, hard cap 200).',
          },
          ref: {
            type: 'string',
            description: 'Branch / tag / SHA / ref to start from (default HEAD).',
          },
          file: {
            type: 'string',
            description: 'Optional path within the repo to filter commits (relative to repo root).',
          },
        },
        required: ['path'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

function gitLog({ path: inputPath, limit, ref, file } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { ok: false, error: 'path is required' };
  }
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;

  const repoCheck = validateGitRepo(abs);
  if (!repoCheck.ok) return repoCheck;

  // 截断上限
  const userLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  const effectiveLimit = Math.min(userLimit, HARD_MAX_LIMIT);
  const wasCapped = userLimit > HARD_MAX_LIMIT;

  // 解析 ref（不接受空字符串当 ref）
  const refArg = typeof ref === 'string' && ref.trim() ? ref.trim() : 'HEAD';

  // file 路径防御：禁止包含 NUL、禁止 .. 逃逸（git diff 自己也防，但越早拦截越好）
  let fileArg = null;
  if (typeof file === 'string' && file.trim()) {
    if (file.includes('\u0000')) {
      return { ok: false, error: 'file contains null byte' };
    }
    if (file.includes('..')) {
      return { ok: false, error: 'file path traversal not allowed' };
    }
    fileArg = file.trim();
  }

  // NUL 分隔 format：sha, shortSha, author, isoDate, subject，每条 commit 以 %n 结尾
  // 让 stdout 在按 \n 切行后，每行再按 \x00 切 5 字段。
  const format = '%H%x00%h%x00%an%x00%aI%x00%s%x00%n';
  const args = [
    '-C', abs,
    'log',
    `--pretty=format:${format}`,
    '--max-count=' + String(effectiveLimit),
  ];
  args.push(refArg);
  if (fileArg) args.push('--', fileArg);

  let proc;
  try {
    proc = spawnSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, error: `git log spawn failed: ${e.message}` };
  }
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `git log timed out after ${GIT_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `git log failed: ${proc.error.message}` };
  }
  if (typeof proc.status !== 'number' || proc.status !== 0) {
    return {
      ok: false,
      error: `git log exited ${proc.status}: ${(proc.stderr || '').trim() || 'unknown error'}`,
    };
  }

  const stdout = proc.stdout || '';
  const commits = parseLogOutput(stdout);
  // truncated 仅在 user 请求 > hard cap 时为 true（实际拿到的 ≤ 200）。
  // user 请求 limit=50 拿回 50：不算 truncate（用户没要求看更多）。
  const truncated = wasCapped;

  return {
    ok: true,
    commits,
    count: commits.length,
    truncated,
  };
}

function validateGitRepo(absRepo) {
  const proc = spawnSync('git', ['-C', absRepo, 'rev-parse', '--git-dir'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') return { ok: false, error: 'git rev-parse timed out' };
    return { ok: false, error: `git rev-parse failed: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    return { ok: false, error: 'not a git repository' };
  }
  return { ok: true };
}

/**
 * 解析 git log 输出。
 * format 为 `%H%x00%h%x00%an%x00%aI%x00%s%x00%n`：
 *   - 每个 commit 内部 5 字段以 NUL 分隔，末尾再加一个 NUL + 换行
 *   - 因此可以按 \n 切行，每行再按 \x00 切 5 字段（最后一段是空字符串）
 */
function parseLogOutput(stdout) {
  if (!stdout) return [];
  const commits = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const fields = line.split('\u0000');
    if (fields.length < 5) continue;
    const sha = fields[0];
    const shortSha = fields[1];
    const author = fields[2];
    const isoDate = fields[3];
    const subject = fields[4];
    if (!sha || !/^[0-9a-f]{4,64}$/i.test(sha)) continue;
    commits.push({
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      author: author || '',
      isoDate: isoDate || '',
      subject: subject || '',
    });
  }
  return commits;
}

const HANDLERS = {
  ide_git_log: gitLog,
};

module.exports = {
  gitLogToolDefinitions,
  HANDLERS,
};
