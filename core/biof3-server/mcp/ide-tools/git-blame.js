/**
 * core/biof3-server/mcp/ide-tools/git-blame.js
 *
 * Phase 3: IDE Git blame MCP tool — `ide_git_blame`.
 * Wraps `git blame --line-porcelain` to fetch per-line attribution.
 *
 * Refuses:
 *   - non-git paths
 *   - files not tracked by git (`git ls-files --error-unmatch`)
 *   - line ranges > HARD_MAX_LINES (10000)
 *
 * Porcelain format (per source line):
 *   <sha> <origLine> <finalLine> [<numLines>]
 *   author <author>
 *   author-mail <email>
 *   author-time <epoch>
 *   author-tz <offset>
 *   committer ...
 *   committer-tz ...
 *   summary <subject>
 *   [previous <sha> <path>]
 *   filename <path>
 *   \t<content>
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 3（docs/g0-ide-mcp-tools-plan.md §3）
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');

const HARD_MAX_LINES = 10000;
const GIT_TIMEOUT_MS = 30_000;

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function gitBlameToolDefinitions() {
  return [
    {
      name: 'ide_git_blame',
      description:
        'Annotate a tracked file with per-line commits. Returns { ok, blame: [{ lineNumber, sha, shortSha, author, isoDate, content }] }. ' +
        'Hard cap on returned lines = 10000 (combined across startLine..endLine).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository root path (absolute or relative to cwd). Must be in allowlist.',
          },
          file: {
            type: 'string',
            description: 'Path to the tracked file, relative to the repository root. Required.',
          },
          startLine: {
            type: 'number',
            description: '1-based start line (inclusive). Optional.',
          },
          endLine: {
            type: 'number',
            description: '1-based end line (inclusive). Optional.',
          },
        },
        required: ['path', 'file'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

function gitBlame({ path: inputPath, file, startLine, endLine } = {}) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return { ok: false, error: 'path is required' };
  }
  if (typeof file !== 'string' || !file.trim()) {
    return { ok: false, error: 'file is required' };
  }
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;

  const repoCheck = validateGitRepo(abs);
  if (!repoCheck.ok) return repoCheck;

  // file 路径防御
  if (file.includes('\u0000')) {
    return { ok: false, error: 'file contains null byte' };
  }
  if (file.includes('..')) {
    return { ok: false, error: 'file path traversal not allowed' };
  }
  const fileRel = file.trim();

  // 1. 文件必须在 git 索引内（未跟踪拒绝）
  const lsCheck = spawnSync('git', ['-C', abs, 'ls-files', '--error-unmatch', '--', fileRel], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (lsCheck.error) {
    if (lsCheck.error.code === 'ETIMEDOUT') {
      return { ok: false, error: 'git ls-files timed out' };
    }
    return { ok: false, error: `git ls-files failed: ${lsCheck.error.message}` };
  }
  if (lsCheck.status !== 0) {
    return { ok: false, error: 'file is not tracked by git' };
  }

  // 2. 解析 startLine / endLine
  const start = parsePositiveInt(startLine, 1);
  const end = parsePositiveInt(endLine, Number.POSITIVE_INFINITY);
  if (typeof start === 'string') return { ok: false, error: start };
  if (typeof end === 'string') return { ok: false, error: end };
  if (Number.isFinite(end) && end < start) {
    return { ok: false, error: 'endLine must be >= startLine' };
  }

  // 3. 计算有效范围 & hard cap
  let range = null;
  if (Number.isFinite(end)) {
    range = end - start + 1;
    if (range > HARD_MAX_LINES) {
      return {
        ok: false,
        error: `line range ${range} exceeds hard cap ${HARD_MAX_LINES}; narrow startLine/endLine`,
      };
    }
  }
  // user 未指定 endLine 时也按 HARD_MAX_LINES 截断（一次最多 10k 行）
  const effectiveStart = start;
  const effectiveEnd = Number.isFinite(end) ? Math.min(end, start + HARD_MAX_LINES - 1) : start + HARD_MAX_LINES - 1;

  // 4. 构造 git blame 命令
  const args = ['-C', abs, 'blame', '--line-porcelain'];
  if (Number.isFinite(end) || start > 1) {
    args.push('-L' + String(effectiveStart) + ',' + String(effectiveEnd));
  }
  args.push('--', fileRel);

  let proc;
  try {
    proc = spawnSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (e) {
    return { ok: false, error: `git blame spawn failed: ${e.message}` };
  }
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `git blame timed out after ${GIT_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `git blame failed: ${proc.error.message}` };
  }
  if (typeof proc.status !== 'number' || proc.status !== 0) {
    return {
      ok: false,
      error: `git blame exited ${proc.status}: ${(proc.stderr || '').trim() || 'unknown error'}`,
    };
  }

  const output = proc.stdout || '';
  const blame = parseBlamePorcelain(output);
  const truncated = Number.isFinite(end) && (effectiveEnd - effectiveStart + 1) < range;

  return {
    ok: true,
    file: fileRel,
    blame,
    count: blame.length,
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

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    return 'startLine/endLine must be a positive integer (1-based)';
  }
  return value;
}

/**
 * 解析 git blame --line-porcelain 输出，逐行构造 blame[]。
 * 每条记录以 SHA 起始，其后跟若干 header 行，最后以 `\t<content>` 结尾。
 *
 * git 在 0..0 行（空文件或范围超出末行）时输出 0 行；当文件从未提交过但被
 * 跟踪时，sha 字段为 40 个 0。本解析器忽略这种全 0 SHA 的"未提交"行。
 */
function parseBlamePorcelain(output) {
  if (!output) return [];
  const lines = output.split('\n');
  const blame = [];
  let current = null;

  for (const line of lines) {
    if (current === null) {
      // 期望 header 行：<sha> <origLine> <finalLine> [<numLines>]
      const header = /^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(line);
      if (!header) continue;
      const sha = header[1];
      const finalLine = Number(header[3]);
      current = {
        sha,
        finalLine,
        author: '',
        authorTime: null,
        authorTz: '',
        summary: '',
        content: '',
      };
      continue;
    }
    if (line.startsWith('author ')) {
      current.author = line.slice('author '.length);
      continue;
    }
    if (line.startsWith('author-time ')) {
      const n = Number(line.slice('author-time '.length));
      if (Number.isFinite(n)) current.authorTime = n;
      continue;
    }
    if (line.startsWith('author-tz ')) {
      current.authorTz = line.slice('author-tz '.length);
      continue;
    }
    if (line.startsWith('summary ')) {
      current.summary = line.slice('summary '.length);
      continue;
    }
    if (line.startsWith('\t')) {
      // 内容行：以 \t 开头；将 current 推到 blame[]
      current.content = line.slice(1);
      // git 默认情况下，summary 字段就是 commit subject
      blame.push({
        lineNumber: current.finalLine,
        sha: current.sha,
        shortSha: current.sha.slice(0, 7),
        author: current.author,
        isoDate: current.authorTime ? epochToIso(current.authorTime, current.authorTz) : '',
        content: current.content,
      });
      current = null;
      continue;
    }
    // 其它 header 行（committer / boundary / filename / previous / etc.）忽略
  }

  return blame;
}

function epochToIso(epoch, tz) {
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return '';
  // 拼成 ISO 8601
  const iso = d.toISOString().replace(/\.\d{3}Z$/, 'Z'); // UTC
  if (!tz) return iso;
  // 简单覆盖：如果 tz 是 +0800 → +08:00
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz);
  if (!m) return iso;
  // 重新计算带 tz 的 ISO
  const local = new Date(epoch * 1000);
  const offsetMinutes = (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]));
  const shifted = new Date(local.getTime() + offsetMinutes * 60 * 1000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${m[1]}${m[2]}:${m[3]}`;
}

const HANDLERS = {
  ide_git_blame: gitBlame,
};

module.exports = {
  gitBlameToolDefinitions,
  HANDLERS,
};
